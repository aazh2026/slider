/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 应用外壳 —— 认证闸门 + 服务端优先的数据流
 * ---------------------------------------------------------------------------
 * 与旧版的根本差别：
 *
 *   旧版：项目存在 localStorage，AI 请求失败就返回一份写死的大纲。
 *   新版：项目、大纲、幻灯片、版本**都在服务端**；前端只保留一份
 *         用于即时反馈的本地镜像，并**防抖同步**回服务端。
 *
 * 同步走乐观锁（baseVersionId）—— 服务端拒绝陈旧写入并回报当前版本，
 * 前端据此提示"内容已被他人修改"，而不是悄悄覆盖。
 *
 * ---------------------------------------------------------------------------
 * **为什么用 ref 存 projects / slideVersions**
 *
 * 防抖同步是"延迟 700ms 后按需执行"的异步动作。它必须读到**执行那一刻**
 * 的最新状态，而不是捕获调用那一刻的快照 —— 否则：
 *
 *   1. 用户拖动元素 → 排一次同步
 *   2. 同步还没触发，用户做了 AI 编辑 → 服务端版本号变了
 *   3. 同步触发 → 拿旧的 baseVersionId 去写 → 服务端正确地报 409
 *
 * 也就是说，功能上"能工作"，但每次 AI 编辑后紧跟着的编辑都会失败。
 * 用 ref 读最新值 + 同步失败后重新排期，才能把这条竞态关掉。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PresentationProject,
  TemplateIR,
  PresentationRequirement,
} from '@ppt/core';
import { BUILT_IN_TEMPLATES } from '@ppt/core';
import { QualityEngine } from '@ppt/core';
import { remapSlidesToTheme } from '@ppt/core';
import { ProjectStorage } from './services/projectStorage';
import { mergeProjectSummaries, pageCountOf } from './services/projectMerge';
import { AuthService, type AuthUser } from './services/authService';
import { ApiClientError, SESSION_EXPIRED_EVENT, describeError } from './services/apiClient';
import { SidebarNav, NavTab } from './components/SidebarNav';
import { ProjectsManager } from './components/ProjectsManager';
import { CreationCenter } from './components/CreationCenter';
import { OutlineEditor } from './components/OutlineEditor';
import { Workbench } from './components/Workbench';
import { TemplateCenter } from './components/TemplateCenter';
import { QualityCenter } from './components/QualityCenter';
import { ExportModal } from './components/ExportModal';
import { PresentationMode } from './components/PresentationMode';
import { AuthScreen } from './components/AuthScreen';

/** 同步防抖间隔 —— 拖拽等连续操作不该每帧打一次服务端 */
const SYNC_DEBOUNCE_MS = 700;

type SyncState = 'idle' | 'syncing' | 'conflict' | 'error';

export default function App() {
  /* ---------------------------------------------------------------- */
  /* 认证                                                              */
  /* ---------------------------------------------------------------- */
  // undefined = 还在问"我是谁"，null = 确实没登录
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await AuthService.me();
        if (!cancelled) setUser(me);
      } catch (err) {
        if (cancelled) return;
        setBootError(describeError(err));
        setUser(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 服务端说会话失效了 → 回登录页
  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  /**
   * 登出。
   *
   * 顺序很重要：**先让服务端作废会话，再清前端状态**。
   * 反过来的话，服务端不知道这个会话已经不要了 —— Cookie 还在，
   * 30 天内同一个 Cookie 仍然有效（`Max-Age=2592000`），
   * 等于「点了退出登录」只是把界面藏起来，会话其实没断。
   */
  const handleLogout = useCallback(async () => {
    try {
      await AuthService.logout();
    } catch {
      // 服务端登出失败也要把本地状态清掉 ——
      // 否则用户被困在一个已经出问题的会话里，连重试的入口都没有。
    }
    setUser(null);
    setProjects([]);
    setActiveProjectId('');
  }, []);

  /* ---------------------------------------------------------------- */
  /* 工作台状态                                                         */
  /* ---------------------------------------------------------------- */
  const [currentTab, setCurrentTab] = useState<NavTab>('workbench');
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isPresenting, setIsPresenting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [isUiDark, setIsUiDark] = useState<boolean>(false);

  /**
   * 当前页码 —— 由 Workbench 上报（见 Workbench 的 onActiveSlideChange）。
   * ---------------------------------------------------------------------------
   * 导出（PNG/SVG 只导当前页）与放映（从当前页开始）都要知道"用户停在第几页"。
   * 页码的真源只有 Workbench 里的 activeSlideIndex 一份 —— 这里存的是**镜像**，
   * 只读不写，免得父子两个真源互相打架。
   */
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);

  const [projects, setProjects] = useState<PresentationProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>('');
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** 每页的**当前**服务端版本号 —— 乐观锁的 baseVersionId 来源 */
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  /**
   * 模板相关的错误 —— **单独存一份**。
   *
   * 防抖同步成功时会 setSyncNotice(null)（"同步完了，没什么要说的"），
   * 那会把任何提示都抹掉 —— 包括用户正需要的失败原因。
   * 模板失败与幻灯片同步是两件事，提示不该互相清场。
   */
  const [templateNotice, setTemplateNotice] = useState<string | null>(null);

  /** 上一次已同步到服务端的项目快照 —— 用来算出"哪几页改了" */
  const syncedRef = useRef<Record<string, PresentationProject>>({});
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* 异步动作要读的"最新值" —— 见文件头注释 */
  const projectsRef = useRef<PresentationProject[]>([]);
  const slideVersionsRef = useRef<Record<string, string>>({});
  const scheduleSyncRef = useRef<((projectId: string) => void) | null>(null);

  /** 统一写入口：state 与 ref 永远保持一致 */
  const applyProjects = useCallback(
    (updater: (prev: PresentationProject[]) => PresentationProject[]) => {
      const next = updater(projectsRef.current);
      projectsRef.current = next;
      setProjects(next);
    },
    []
  );

  const applySlideVersions = useCallback(
    (updater: (prev: Record<string, string>) => Record<string, string>) => {
      const next = updater(slideVersionsRef.current);
      slideVersionsRef.current = next;
    },
    []
  );

  useEffect(() => {
    if (isUiDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isUiDark]);

  /* ---------------------------------------------------------------- */
  /* 加载                                                              */
  /* ---------------------------------------------------------------- */

  const loadProjectDetail = useCallback(async (projectId: string) => {
    const detail = await ProjectStorage.loadProject(projectId);
    applyProjects((prev) => {
      const others = prev.filter((p) => p.id !== projectId);
      // 摘要 → 全量：保留服务端返回的完整项目
      return [detail.project, ...others];
    });
    applySlideVersions(() => detail.slideVersions);
    syncedRef.current[projectId] = detail.project;
    return detail.project;
  }, [applyProjects, applySlideVersions]);

  const loadProjects = useCallback(async () => {
    setIsLoadingProjects(true);
    setLoadError(null);
    try {
      const list = await ProjectStorage.listProjects();
      // 摘要只更新标量字段 —— 绝不覆盖已加载的全量（详见 projectMerge.ts）
      applyProjects((prev) => mergeProjectSummaries(list, prev));
      if (list.length > 0) {
        setActiveProjectId((prev) => prev || list[0]!.id);
      }
    } catch (err) {
      setLoadError(describeError(err));
    } finally {
      setIsLoadingProjects(false);
    }
  }, [applyProjects]);

  useEffect(() => {
    if (user) void loadProjects();
  }, [user, loadProjects]);

  // 选中项目后拉全量（含每页 IR）
  useEffect(() => {
    if (!user || !activeProjectId) return;
    let cancelled = false;
    (async () => {
      try {
        const detail = await ProjectStorage.loadProject(activeProjectId);
        if (cancelled) return;
        applyProjects((prev) =>
          prev.map((p) => (p.id === detail.project.id ? detail.project : p))
        );
        applySlideVersions(() => detail.slideVersions);
        syncedRef.current[activeProjectId] = detail.project;
      } catch (err) {
        if (!cancelled) setLoadError(describeError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, activeProjectId, applyProjects, applySlideVersions]);

  const currentProject =
    projects.find((p) => p.id === activeProjectId) ?? projects[0] ?? null;

  /**
   * 侧边栏的质量分徽章 —— **要么是真算出来的，要么不显示**
   * ---------------------------------------------------------------------------
   * 之前没有报告时侧边栏显示一个写死的 92 分（`?? 92`）。那不是分数，是
   * 安慰剂 —— 用户会以为这份文稿已经体检过了。而服务端的 `quality_report`
   * 列在正常流程里恒为 NULL（前端从不调 `/api/quality/evaluate`），
   * 所以「没有报告」是常态而非异常。
   *
   * 这里本地算一份：与服务端跑的是同一份 `@ppt/core`，算出来的分数与服务端
   * 权威评分逐项相等（`e2e/quality.e2e.ts` 有对账断言）。
   */
  const currentQualityReport = useMemo(
    () =>
      currentProject
        ? (currentProject.qualityReport ??
          QualityEngine.evaluatePresentation(currentProject))
        : undefined,
    [currentProject]
  );

  /**
   * 传给导出与放映的页码 —— **必须夹紧**。
   * ---------------------------------------------------------------------------
   * 页数会变（删页），页码可能越界；越界的 index 会让 ExportModal 的
   * slideIds 变成空、PresentationMode 直接渲染成 null（整块黑屏）。
   */
  const safeSlideIndex = Math.min(
    activeSlideIndex,
    Math.max(0, (currentProject?.slides.length ?? 1) - 1)
  );

  /* ---------------------------------------------------------------- */
  /* 同步（防抖 + 乐观锁）                                              */
  /* ---------------------------------------------------------------- */

  const syncProject = useCallback(async (project: PresentationProject) => {
    const previous = syncedRef.current[project.id];
    if (!previous) {
      // 还没建立基线（第一次看到它）—— 先记下来，别急着写
      syncedRef.current[project.id] = project;
      return;
    }

    const prevById = new Map(previous.slides.map((s) => [s.slideId, s]));
    const changed = project.slides.filter((s) => {
      const before = prevById.get(s.slideId);
      return !before || JSON.stringify(before) !== JSON.stringify(s);
    });

    if (changed.length === 0) return;

    setSyncState('syncing');
    try {
      for (const slide of changed) {
        // 读**执行时**的版本号，不是排期时的
        const baseVersionId = slideVersionsRef.current[slide.slideId];
        if (!baseVersionId) {
          // 这页还没在服务端登记过（新建页）—— 跳过，由编译流程统一写入
          continue;
        }
        const result = await ProjectStorage.updateSlide(
          project.id,
          slide.slideId,
          baseVersionId,
          slide
        );
        applySlideVersions((prev) => ({ ...prev, [slide.slideId]: result.versionId }));
      }
      syncedRef.current[project.id] = project;
      setSyncState('idle');
      setSyncNotice(null);
    } catch (err) {
      if (err instanceof ApiClientError && err.isVersionConflict) {
        // 冲突 —— 服务端手里有更新的版本。不覆盖，提示用户刷新
        setSyncState('conflict');
        setSyncNotice(
          `内容已被其他会话修改（服务端版本 ${String(
            err.details?.['currentVersionId'] ?? '未知'
          )}），本次本地修改未保存。请刷新页面获取最新内容。`
        );
        return;
      }
      setSyncState('error');
      setSyncNotice(`同步失败：${describeError(err)}`);
    }
  }, [applySlideVersions]);

  const scheduleSync = useCallback((projectId: string) => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null;
      // 读最新状态，不是排期时的快照
      const latest = projectsRef.current.find((p) => p.id === projectId);
      if (!latest) return;
      void syncProject(latest).then(() => {
        // 同步期间又改了 → 再排一轮
        const after = projectsRef.current.find((p) => p.id === projectId);
        if (after && after !== latest) {
          scheduleSyncRef.current?.(projectId);
        }
      });
    }, SYNC_DEBOUNCE_MS);
  }, [syncProject]);

  // 供上面的递归重排使用（避免 useCallback 循环依赖）
  useEffect(() => {
    scheduleSyncRef.current = scheduleSync;
  }, [scheduleSync]);

  /** 本地立即更新（保证拖拽手感），随后防抖同步 */
  const handleUpdateCurrentProject = useCallback(
    (updated: PresentationProject) => {
      applyProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      scheduleSync(updated.id);
    },
    [applyProjects, scheduleSync]
  );

  /* ---------------------------------------------------------------- */
  /* 项目操作                                                          */
  /* ---------------------------------------------------------------- */

  const handleSelectProject = useCallback((projectId: string) => {
    setActiveProjectId(projectId);
    setCurrentTab('workbench');
    // 换项目 → 页码归零（上一份文稿的页码对这份没有意义）
    setActiveSlideIndex(0);
  }, []);

  const handleCreateNewProject = useCallback(
    async (name: string, templateId: string) => {
      const template =
        BUILT_IN_TEMPLATES.find((t) => t.templateId === templateId) ?? BUILT_IN_TEMPLATES[0]!;
      const requirement: PresentationRequirement = {
        topic: name,
        purpose: '业务与技术规划汇报',
        audience: '管理层与相关利益方',
        pageCount: 6,
        style: template.theme.isDark ? '科技沉浸深色' : '清爽明亮纯白',
        depth: '商业与技术规划',
        aspectRatio: '16:9',
      };
      try {
        const created = await ProjectStorage.createProject({ name, requirement, template });
        applyProjects((prev) => [created, ...prev]);
        setActiveProjectId(created.id);
        setCurrentTab('create');
      } catch (err) {
        setSyncNotice(`创建项目失败：${describeError(err)}`);
      }
    },
    [applyProjects]
  );

  const handleDuplicateProject = useCallback(async (projectId: string) => {
    try {
      const created = await ProjectStorage.duplicateProject(projectId);
      // 副本的页数与原件相同。复制接口只回项目行、不回页数，
      // 这里用原件的权威页数补上 —— 否则新卡片会写"0 页"。
      const source = projectsRef.current.find((p) => p.id === projectId);
      const withCount: PresentationProject = {
        ...created,
        slideCount: source ? pageCountOf(source) : created.slideCount,
      };
      applyProjects((prev) => [withCount, ...prev]);
      setActiveProjectId(created.id);
    } catch (err) {
      setSyncNotice(`复制项目失败：${describeError(err)}`);
    }
  }, [applyProjects]);

  const handleDeleteProject = useCallback(
    async (projectId: string) => {
      try {
        await ProjectStorage.deleteProject(projectId);
        applyProjects((prev) => {
          const next = prev.filter((p) => p.id !== projectId);
          if (activeProjectId === projectId) {
            setActiveProjectId(next[0]?.id ?? '');
          }
          return next;
        });
      } catch (err) {
        setSyncNotice(`删除项目失败：${describeError(err)}`);
      }
    },
    [activeProjectId, applyProjects]
  );

  const handleImportProject = useCallback(async (jsonString: string) => {
    try {
      const created = await ProjectStorage.importProjectFromJson(jsonString);
      applyProjects((prev) => [created, ...prev]);
      setActiveProjectId(created.id);
      setCurrentTab('workbench');
    } catch (err) {
      setSyncNotice(`导入失败：${describeError(err)}`);
    }
  }, [applyProjects]);

  const handleStartPresentProject = useCallback((projectToPresent: PresentationProject) => {
    setActiveProjectId(projectToPresent.id);
    setIsPresenting(true);
  }, []);

  /** 改名 —— 立刻落服务端（不是靠防抖同步，名称是列表的主要标识） */
  const handleRenameProject = useCallback(
    async (name: string) => {
      if (!currentProject) return;
      const updated = { ...currentProject, name };
      applyProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      try {
        await ProjectStorage.updateProject(currentProject.id, { name });
      } catch (err) {
        setSyncNotice(`重命名失败：${describeError(err)}`);
      }
    },
    [currentProject, applyProjects]
  );

  /* ---------------------------------------------------------------- */
  /* 主题切换（深色 / 浅色）                                            */
  /* ---------------------------------------------------------------- */

  /**
   * 应用模板 —— **服务端权威**。
   *
   * 前端只发**意图**（项目 id + 模板 id），模板长什么样由服务端查库决定
   * （POST /api/templates/:id/apply）。
   *
   * 关键：**失败时本地状态一个字都不改**。
   * 以前这里是"先乐观换成本地模板，再发请求" —— 请求失败时界面已经显示
   * "用上了"，服务端却还是旧模板，刷新一下就露馅。那是假成功。
   *
   * 只把**模板**合并回本地（不动 slides / requirement）——
   * 服务端对"用哪份模板"是权威的，其余字段本地可能还有未保存的编辑。
   */
  const handleApplyTemplate = useCallback(
    async (t: TemplateIR): Promise<boolean> => {
      if (!currentProject) return false;
      try {
        const updated = await ProjectStorage.applyTemplate(currentProject.id, t.templateId);
        applyProjects((prev) =>
          prev.map((p) =>
            p.id === updated.id
              ? { ...p, template: updated.template, updatedAt: updated.updatedAt }
              : p
          )
        );
        setTemplateNotice(null);
        return true;
      } catch (err) {
        setTemplateNotice(`模板更新失败：${describeError(err)}`);
        return false;
      }
    },
    [currentProject, applyProjects]
  );

  const handleToggleSlideTheme = useCallback(async () => {
    if (!currentProject) return;

    const isCurrentlyDark = currentProject.template.theme.isDark;
    const targetTemplate = isCurrentlyDark
      ? BUILT_IN_TEMPLATES.find((t) => !t.theme.isDark) ?? BUILT_IN_TEMPLATES[0]!
      : BUILT_IN_TEMPLATES.find((t) => t.theme.isDark) ?? BUILT_IN_TEMPLATES[4]!;

    // 模板先落到服务端 —— 失败就到此为止，不改本地状态
    const applied = await handleApplyTemplate(targetTemplate);
    if (!applied) return;

    // 主题重映射只有一份实现（packages/core/src/engine/themeRemap.ts）——
    // 语义判断读 `variant` 字段，不猜 ID 字符串（ADR-018）。
    const updatedSlides = remapSlidesToTheme(currentProject.slides, targetTemplate.theme);

    const updatedProject: PresentationProject = {
      ...currentProject,
      template: targetTemplate,
      slides: updatedSlides,
      updatedAt: Date.now(),
    };
    updatedProject.qualityReport = QualityEngine.evaluatePresentation(updatedProject);

    // 模板已经在服务端落库了（handleApplyTemplate）；幻灯片的样式改动走防抖同步
    handleUpdateCurrentProject(updatedProject);
  }, [currentProject, handleApplyTemplate, handleUpdateCurrentProject]);

  /* ---------------------------------------------------------------- */
  /* 大纲生成 / 编译（服务端权威）                                       */
  /* ---------------------------------------------------------------- */

  const handleGenerateOutline = useCallback(
    async (req: PresentationRequirement) => {
      if (!currentProject) return;
      setIsGenerating(true);
      setSyncNotice(null);
      try {
        const result = await ProjectStorage.regenerateOutline(currentProject.id, req);
        const updatedProject: PresentationProject = {
          ...currentProject,
          name: req.topic,
          requirement: req,
          outline: result.outline,
          updatedAt: Date.now(),
        };
        applyProjects((prev) =>
          prev.map((p) => (p.id === updatedProject.id ? updatedProject : p))
        );
        syncedRef.current[updatedProject.id] = updatedProject;
        setCurrentTab('outline');

        setSyncNotice(
          result.degraded
            ? '⚠️ 模型不可用，本轮大纲由服务端本地降级实现按主题动态生成（非固定文案）。'
            : null
        );
      } catch (err) {
        setSyncNotice(`生成大纲失败：${describeError(err)}`);
      } finally {
        setIsGenerating(false);
      }
    },
    [currentProject, applyProjects]
  );

  /** 大纲编辑 —— 立刻落服务端（大纲不是幻灯片，防抖同步管不到它） */
  const handleUpdateOutline = useCallback(
    (outline: PresentationProject['outline']) => {
      if (!currentProject) return;
      const updated = { ...currentProject, outline };
      applyProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      void ProjectStorage.updateProject(currentProject.id, { outline }).catch((err) =>
        setSyncNotice(`大纲保存失败：${describeError(err)}`)
      );
    },
    [currentProject, applyProjects]
  );

  const handleConfirmAndGenerateSlides = useCallback(async () => {
    if (!currentProject) return;
    setIsCompiling(true);
    setSyncNotice(null);
    try {
      // 大纲改动先落服务端，再编译
      await ProjectStorage.updateProject(currentProject.id, { outline: currentProject.outline });
      await ProjectStorage.compileProject(currentProject.id);
      const detail = await loadProjectDetail(currentProject.id);
      applyProjects((prev) => prev.map((p) => (p.id === detail.id ? detail : p)));
      setCurrentTab('workbench');
    } catch (err) {
      setSyncNotice(`编译失败：${describeError(err)}`);
    } finally {
      setIsCompiling(false);
    }
  }, [currentProject, loadProjectDetail, applyProjects]);

  /* ---------------------------------------------------------------- */
  /* AI 编辑（服务端施加补丁）                                           */
  /* ---------------------------------------------------------------- */

  const handleAiEdit = useCallback(
    async (
      slideId: string,
      instruction: string,
      mode: 'content' | 'style' | 'layout'
    ): Promise<{ message: string; degraded: boolean }> => {
      if (!currentProject) throw new Error('没有选中的项目');
      const baseVersionId = slideVersionsRef.current[slideId];
      if (!baseVersionId) throw new Error('这一页还没有服务端版本号，请先编译');

      const result = await ProjectStorage.applyAiPatches(
        currentProject.id,
        slideId,
        baseVersionId,
        instruction,
        mode
      );

      // 服务端已经把补丁施加到 IR 上并写库 —— 前端直接采纳服务端结果
      applySlideVersions((prev) => ({ ...prev, [slideId]: result.versionId }));

      const updated: PresentationProject = {
        ...currentProject,
        slides: currentProject.slides.map((s) => (s.slideId === slideId ? result.ir : s)),
        updatedAt: Date.now(),
      };
      applyProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      // 服务端已是这一页的权威 —— 基线同步过去，避免防抖同步把旧 IR 又写回去
      syncedRef.current[currentProject.id] = updated;

      return { message: result.message, degraded: result.degraded };
    },
    [currentProject, applyProjects, applySlideVersions]
  );

  /* ---------------------------------------------------------------- */
  /* 渲染                                                              */
  /* ---------------------------------------------------------------- */

  if (user === undefined) {
    return (
      <div className="min-h-screen w-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-500 dark:text-slate-400 text-sm">
        正在检查会话…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="relative">
        {bootError && (
          <div
            data-testid="boot-error"
            className="absolute top-3 left-1/2 -translate-x-1/2 z-50 max-w-xl px-4 py-2 rounded-xl text-xs font-semibold shadow-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/30 text-amber-800 dark:text-amber-300"
          >
            无法连接后端：{bootError}
          </div>
        )}
        <AuthScreen
          onAuthenticated={(u) => {
            setBootError(null);
            setUser(u);
          }}
        />
      </div>
    );
  }

  if (!currentProject) {
    // 没有项目时**仍然要渲染外壳** —— 侧边栏是唯一的导航入口，
    // 只渲染一个空状态页面会让用户无法回到「我的作品」去新建项目。
    return (
      <div className="flex flex-row h-screen w-screen overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans transition-colors duration-150">
        <SidebarNav
          currentTab={currentTab}
          onSelectTab={setCurrentTab}
          projectName=""
          onRenameProject={() => {}}
          onOpenExport={() => setIsExportModalOpen(true)}
          onStartPresent={() => setIsPresenting(true)}
          qualityReport={undefined}
          hasOutline={false}
          hasSlides={false}
          isUiDark={isUiDark}
          onToggleUiTheme={() => setIsUiDark((d) => !d)}
          isSlideDark={false}
          onToggleSlideTheme={() => {}}
          allProjects={projects}
          onSwitchProject={(id) => setActiveProjectId(id)}
          onCreateNewProject={() => setCurrentTab('projects')}
          onLogout={() => void handleLogout()}
          userEmail={user.email}
        />
        <main className="flex-1 flex flex-col h-full overflow-hidden relative">
          {currentTab === 'projects' ? (
            <ProjectsManager
              projects={projects}
              currentProjectId={activeProjectId}
              onSelectProject={handleSelectProject}
              onCreateNewProject={(name, templateId) => void handleCreateNewProject(name, templateId)}
              onDuplicateProject={(id) => void handleDuplicateProject(id)}
              onDeleteProject={(id) => void handleDeleteProject(id)}
              onImportProject={(json) => void handleImportProject(json)}
              onStartPresentProject={handleStartPresentProject}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400" data-testid="empty-projects">
                {isLoadingProjects
                  ? '正在加载项目…'
                  : '还没有任何项目，去「我的作品」新建一个演示文稿。'}
              </p>
              {loadError && (
                <p className="text-xs text-red-600 dark:text-red-400" data-testid="load-error">
                  {loadError}
                </p>
              )}
              <button
                onClick={() => setCurrentTab('projects')}
                data-testid="goto-projects"
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold"
              >
                打开项目管理
              </button>
            </div>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-row h-screen w-screen overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans transition-colors duration-150">
      {/* 同步状态条 */}
      {(syncNotice || templateNotice || syncState === 'syncing') && (
        <div
          data-testid="sync-notice"
          className="absolute top-3 left-1/2 -translate-x-1/2 z-50 max-w-xl px-4 py-2 rounded-xl text-xs font-semibold shadow-lg backdrop-blur border bg-white/90 dark:bg-slate-900/90 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
        >
          {/* 模板失败优先于同步提示 —— 它是用户此刻唯一能采取行动的信息 */}
          {syncState === 'syncing' ? '正在同步到服务端…' : (templateNotice ?? syncNotice)}
        </div>
      )}

      <SidebarNav
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        projectName={currentProject.name}
        onRenameProject={(name) => void handleRenameProject(name)}
        onOpenExport={() => setIsExportModalOpen(true)}
        onStartPresent={() => setIsPresenting(true)}
        qualityReport={currentQualityReport}
        hasOutline={currentProject.outline.length > 0}
        hasSlides={currentProject.slides.length > 0}
        isUiDark={isUiDark}
        onToggleUiTheme={() => setIsUiDark((d) => !d)}
        isSlideDark={currentProject.template.theme.isDark}
        onToggleSlideTheme={handleToggleSlideTheme}
        allProjects={projects}
        onSwitchProject={(id) => setActiveProjectId(id)}
        onCreateNewProject={() => setCurrentTab('projects')}
        onLogout={() => void handleLogout()}
        userEmail={user.email}
      />

      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {currentTab === 'projects' && (
          <ProjectsManager
            projects={projects}
            currentProjectId={activeProjectId}
            onSelectProject={handleSelectProject}
            onCreateNewProject={(name, templateId) => void handleCreateNewProject(name, templateId)}
            onDuplicateProject={(id) => void handleDuplicateProject(id)}
            onDeleteProject={(id) => void handleDeleteProject(id)}
            onImportProject={(json) => void handleImportProject(json)}
            onStartPresentProject={handleStartPresentProject}
          />
        )}

        {currentTab === 'create' && (
          <CreationCenter
            requirement={currentProject.requirement}
            selectedTemplate={currentProject.template}
            onSelectTemplate={(t: TemplateIR) => {
              // 创作中心选模板也要**落库** —— 只改本地 state 的话，
              // 这个选择活不过一次刷新。
              void handleApplyTemplate(t);
            }}
            onGenerateOutline={(req) => handleGenerateOutline(req)}
            isGenerating={isGenerating}
          />
        )}

        {currentTab === 'outline' && (
          <OutlineEditor
            outline={currentProject.outline}
            onUpdateOutline={handleUpdateOutline}
            onConfirmAndGenerateSlides={handleConfirmAndGenerateSlides}
            isCompiling={isCompiling}
          />
        )}

        {currentTab === 'workbench' && (
          <Workbench
            project={currentProject}
            onUpdateProject={handleUpdateCurrentProject}
            onStartPresent={() => setIsPresenting(true)}
            onActiveSlideChange={setActiveSlideIndex}
            onAiEdit={handleAiEdit}
          />
        )}

        {currentTab === 'templates' && (
          <TemplateCenter
            currentTemplate={currentProject.template}
            onApplyTemplate={handleApplyTemplate}
            project={currentProject}
            onUpdateProject={handleUpdateCurrentProject}
          />
        )}

        {currentTab === 'quality' && (
          <QualityCenter
            project={currentProject}
            onUpdateProject={handleUpdateCurrentProject}
            onOpenWorkbench={() => setCurrentTab('workbench')}
          />
        )}
      </main>

      {isPresenting && (
        <PresentationMode
          project={currentProject}
          initialSlideIndex={safeSlideIndex}
          onClose={() => setIsPresenting(false)}
        />
      )}

      <ExportModal
        project={currentProject}
        currentSlideIndex={safeSlideIndex}
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
      />
    </div>
  );
}
