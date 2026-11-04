/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 项目存储 —— **服务端优先**，本地兜底
 * ---------------------------------------------------------------------------
 * 设计原则（docs/backend-design.md §5.2 / §9）：
 *
 *   1. **服务端是唯一权威**。项目、大纲、幻灯片、版本都存在服务端；
 *      前端不再把整个 IR 塞进 localStorage。
 *   2. **只有网络故障才回退本地**。后端返回 409（版本冲突）、404、422
 *      这些**业务错误必须原样上抛** —— 悄悄回退到本地会把"冲突"变成
 *      "看起来保存成功了"，那是比报错严重得多的失败。
 *   3. 本地缓存只保存**列表快照**，用于离线时仍能看到项目清单；
 *      真正的数据回源服务端。
 */

import {
  BUILT_IN_TEMPLATES,
  LayoutEngine,
  QualityEngine,
  createStarterProjects,
  defaultVisualIntent,
  type PresentationProject,
  type PresentationRequirement,
  type SlideIR,
  type SlideOutlineItem,
  type TemplateIR,
} from '@ppt/core';

import { ApiClientError, api } from './apiClient';

/* -------------------------------------------------------------------------- */
/* 本地快照                                                                     */
/* -------------------------------------------------------------------------- */

const STORAGE_KEY = 'ai_ppt_studio_projects_v2';

/** 本地快照 —— 只用于离线时展示列表 */
interface LocalSnapshot {
  id: string;
  name: string;
  topic: string;
  pageCount: number;
  outlineCount: number;
  updatedAt: number;
}

function readLocalSnapshot(): LocalSnapshot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LocalSnapshot[]) : [];
  } catch (err) {
    console.warn('[ProjectStorage] 读本地快照失败：', err);
    return [];
  }
}

function writeLocalSnapshot(list: LocalSnapshot[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (err) {
    console.warn('[ProjectStorage] 写本地快照失败：', err);
  }
}

/* -------------------------------------------------------------------------- */
/* 服务端 DTO                                                                   */
/* -------------------------------------------------------------------------- */

interface ServerProjectRow {
  id: string;
  name: string;
  requirement: PresentationRequirement;
  template: TemplateIR;
  outline: SlideOutlineItem[] | null;
  qualityReport?: PresentationProject['qualityReport'];
  /** 真实页数 —— 服务端 `slides` 表的行数（列表摘要里一定有） */
  slideCount?: number;
  createdAt: string | Date;
  updatedAt: string | Date;
}

interface ServerSlideMeta {
  slideId: string;
  orderIndex: number;
  versionId: string;
  updatedAt?: string | Date;
}

interface ServerSlide {
  slideId: string;
  orderIndex: number;
  versionId: string;
  ir: SlideIR;
  updatedAt?: string | Date;
}

/**
 * 项目全量详情
 * ---------------------------------------------------------------------------
 * `slideVersions` 是**当前版本号**映射（slideId → versionId），
 * 与 `PresentationProject.versions`（版本**历史**）不是一回事 ——
 * 前者用于乐观锁的 baseVersionId，后者用于版本回溯。
 */
export interface ProjectDetail {
  project: PresentationProject;
  slideVersions: Record<string, string>;
}

/** 服务端项目行 → 前端 PresentationProject */
function toPresentationProject(row: ServerProjectRow, slides: SlideIR[] = []): PresentationProject {
  return {
    id: row.id,
    name: row.name,
    requirement: row.requirement,
    template: row.template,
    outline: row.outline ?? [],
    slides,
    // 服务端给了页数就用服务端的；没给就退回"内存里加载了几页"
    slideCount: row.slideCount ?? slides.length,
    versions: {},
    qualityReport: row.qualityReport ?? undefined,
    createdAt: new Date(row.createdAt).getTime(),
    updatedAt: new Date(row.updatedAt).getTime(),
  };
}

/** 是不是"服务端根本没连上"—— 只有这种情况才允许回退本地 */
function isOffline(err: unknown): boolean {
  return err instanceof ApiClientError && err.code === 'NETWORK_ERROR';
}

/**
 * 模板 id → 内置模板
 * ---------------------------------------------------------------------------
 * 服务端只报 `templateId`（不报整份模板），前端据此还原深/浅底。
 * 找不到就回落到默认模板 —— 宁可显示成浅底，也不能让整个列表渲染不出来。
 */
function templateById(templateId: string): TemplateIR {
  return BUILT_IN_TEMPLATES.find((t) => t.templateId === templateId) ?? BUILT_IN_TEMPLATES[0]!;
}

/* -------------------------------------------------------------------------- */
/* 服务                                                                        */
/* -------------------------------------------------------------------------- */

export const ProjectStorage = {
  /**
   * 项目列表
   * ---------------------------------------------------------------------------
   * 返回的是**摘要**（不含 IR）。点开某个项目时再拉全量。
   *
   * 摘要里带着两样"列表要显示、但正文里没有"的东西：
   *   · `templateId` —— 用来还原这份文稿用的是哪份模板（深底还是浅底）；
   *   · `slideCount` —— 真实页数（摘要里没有每一页的 IR，`slides` 恒为空数组）。
   *
   * 少了它们，作品库的深/浅筛选永远筛不出东西、每张卡片都写"0 页"。
   */
  async listProjects(): Promise<PresentationProject[]> {
    try {
      const data = await api.get<{
        projects: Array<{
          id: string;
          name: string;
          topic: string;
          pageCount: number;
          outlineCount: number;
          templateId: string;
          slideCount: number;
          createdAt: string | Date;
          updatedAt: string | Date;
        }>;
      }>('/api/projects');

      writeLocalSnapshot(
        data.projects.map((p) => ({
          id: p.id,
          name: p.name,
          topic: p.topic,
          pageCount: p.pageCount,
          outlineCount: p.outlineCount,
          updatedAt: new Date(p.updatedAt).getTime(),
        }))
      );

      return data.projects.map((p) => ({
        id: p.id,
        name: p.name,
        requirement: {
          topic: p.topic,
          purpose: '',
          audience: '',
          pageCount: p.pageCount,
          style: '',
          depth: '',
          aspectRatio: '16:9' as const,
        },
        template: templateById(p.templateId),
        outline: [],
        slides: [],
        slideCount: p.slideCount,
        versions: {},
        createdAt: new Date(p.createdAt).getTime(),
        updatedAt: new Date(p.updatedAt).getTime(),
      }));
    } catch (err) {
      if (!isOffline(err)) throw err;
      console.warn('[ProjectStorage] 服务端不可达，回退到本地快照');
      return readLocalSnapshot().map((s) => ({
        id: s.id,
        name: s.name,
        requirement: {
          topic: s.topic,
          purpose: '',
          audience: '',
          pageCount: s.pageCount,
          style: '',
          depth: '',
          aspectRatio: '16:9' as const,
        },
        template: BUILT_IN_TEMPLATES[0]!,
        outline: [],
        slides: [],
        versions: {},
        createdAt: s.updatedAt,
        updatedAt: s.updatedAt,
      }));
    }
  },

  /**
   * 拉取项目全量（含每一页的 IR 与当前版本号）
   */
  async loadProject(projectId: string): Promise<ProjectDetail> {
    const data = await api.get<{ project: ServerProjectRow & { slides: ServerSlideMeta[] } }>(
      `/api/projects/${projectId}`
    );

    const metas = data.project.slides ?? [];
    const slides: SlideIR[] = [];
    const slideVersions: Record<string, string> = {};
    for (const meta of metas) {
      const slide = await this.getSlide(projectId, meta.slideId);
      slides.push(slide.ir);
      slideVersions[slide.slideId] = slide.versionId;
    }

    return { project: toPresentationProject(data.project, slides), slideVersions };
  },

  /** 单页 IR */
  async getSlide(
    projectId: string,
    slideId: string
  ): Promise<{ slideId: string; versionId: string; ir: SlideIR }> {
    const data = await api.get<{ slide: ServerSlide }>(
      `/api/projects/${projectId}/slides/${slideId}`
    );
    return { slideId: data.slide.slideId, versionId: data.slide.versionId, ir: data.slide.ir };
  },

  /** 创建项目 */
  async createProject(input: {
    name: string;
    requirement: PresentationRequirement;
    template?: TemplateIR;
    outline?: SlideOutlineItem[];
  }): Promise<PresentationProject> {
    const data = await api.post<{ project: ServerProjectRow }>('/api/projects', {
      name: input.name,
      requirement: input.requirement,
      template: input.template,
      outline: input.outline,
    });
    return toPresentationProject(data.project);
  },

  /** 更新项目（改名 / 换需求 / 换模板 / 换大纲） */
  async updateProject(
    projectId: string,
    patch: {
      name?: string;
      requirement?: PresentationRequirement;
      template?: TemplateIR;
      outline?: SlideOutlineItem[];
    }
  ): Promise<PresentationProject> {
    const data = await api.patch<{ project: ServerProjectRow }>(`/api/projects/${projectId}`, patch);
    return toPresentationProject(data.project);
  },

  /** 删除项目 */
  async deleteProject(projectId: string): Promise<void> {
    await api.del(`/api/projects/${projectId}`);
  },

  /**
   * 应用模板 —— **服务端权威**。
   *
   * 前端只发**意图**（项目 id + 模板 id），不发样式：
   * 模板长什么样由服务端查库决定，而不是客户端塞一份 TemplateIR 上去。
   * （docs/backend-design.md「POST /api/templates/:id/apply 应用模板并重映射元素样式
   *   （服务端权威）」；docs/backend-features.md TPL-03「服务端权威执行」）
   *
   * 走 PATCH /api/projects/:id 也能存下模板，但那是"客户端说自己要哪份模板"——
   * 服务端不校验这份模板是否真实存在、是否属于这个用户。
   */
  async applyTemplate(projectId: string, templateId: string): Promise<PresentationProject> {
    const data = await api.post<{ project: ServerProjectRow }>(
      `/api/templates/${templateId}/apply`,
      { projectId }
    );
    return toPresentationProject(data.project);
  },

  /** 复制项目 */
  async duplicateProject(projectId: string): Promise<PresentationProject> {
    const data = await api.post<{ project: ServerProjectRow }>(
      `/api/projects/${projectId}/duplicate`
    );
    return toPresentationProject(data.project);
  },

  /**
   * 导出 bundle —— 服务端那份**完整的**（含每一页的 IR 与页序）。
   * ---------------------------------------------------------------------------
   * 作品库里那份是摘要，`slides` 恒为空数组 —— 直接导它会得到一份没有页面的
   * 空壳，再导入回去什么也恢复不了。所以导之前必须回服务端取 bundle。
   *
   * bundle 的形状正是导入端（`POST /api/projects/import`）认的形状：
   * `slides: [{slideId, orderIndex, ir}]`。
   */
  async exportProjectBundle(projectId: string): Promise<{
    name: string;
    requirement: PresentationRequirement;
    template: TemplateIR;
    outline: SlideOutlineItem[];
    slides: Array<{ slideId: string; orderIndex: number; ir: SlideIR }>;
  }> {
    const data = await api.get<{
      bundle: {
        name: string;
        requirement: PresentationRequirement;
        template: TemplateIR;
        outline: SlideOutlineItem[] | null;
        slides: Array<{ slideId: string; orderIndex: number; ir: SlideIR }> | null;
      };
    }>(`/api/projects/${projectId}/export`);

    const b = data.bundle;
    return {
      name: b.name,
      requirement: b.requirement,
      template: b.template,
      outline: b.outline ?? [],
      slides: b.slides ?? [],
    };
  },

  /** 大纲 → 幻灯片（服务端编译，权威） */
  async compileProject(
    projectId: string
  ): Promise<Array<{ slideId: string; versionId: string }>> {
    const data = await api.post<{ slides: Array<{ slideId: string; versionId: string }> }>(
      `/api/projects/${projectId}/compile`
    );
    return data.slides;
  },

  /** 重新生成大纲（走服务端 AI / 降级链） */
  async regenerateOutline(
    projectId: string,
    requirement?: PresentationRequirement
  ): Promise<{ outline: SlideOutlineItem[]; source: string; degraded: boolean }> {
    return api.post<{ outline: SlideOutlineItem[]; source: string; degraded: boolean }>(
      `/api/projects/${projectId}/outline/regenerate`,
      requirement ? { requirement } : {}
    );
  },

  /** 局部更新单页 —— 必须带 baseVersionId（乐观锁） */
  async updateSlide(
    projectId: string,
    slideId: string,
    baseVersionId: string,
    ir: SlideIR
  ): Promise<{ versionId: string; ir: SlideIR }> {
    const data = await api.patch<{ slide: { versionId: string; ir: SlideIR } }>(
      `/api/projects/${projectId}/slides/${slideId}`,
      { baseVersionId, ir }
    );
    return data.slide;
  },

  /** AI 补丁编辑 —— 返回补丁与施加后的 IR */
  async applyAiPatches(
    projectId: string,
    slideId: string,
    baseVersionId: string,
    instruction: string,
    mode?: 'content' | 'style' | 'layout'
  ): Promise<{
    patches: unknown[];
    message: string;
    source: string;
    degraded: boolean;
    versionId: string;
    ir: SlideIR;
  }> {
    return api.post<{
      patches: unknown[];
      message: string;
      source: string;
      degraded: boolean;
      versionId: string;
      ir: SlideIR;
    }>(`/api/projects/${projectId}/slides/${slideId}/patches`, { baseVersionId, instruction, mode });
  },

  /** 导入 IR JSON */
  async importProjectFromJson(jsonString: string): Promise<PresentationProject> {
    const parsed = JSON.parse(jsonString);
    if (!parsed.slides || !parsed.name) {
      throw new Error('无效的 Slide IR 项目格式文件。');
    }
    const data = await api.post<{ project: ServerProjectRow }>('/api/projects/import', {
      name: `${parsed.name} (导入)`,
      requirement: parsed.requirement,
      template: parsed.template,
      outline: parsed.outline ?? [],
      slides: parsed.slides,
    });
    // 导入接口只回项目行、不回页数 —— 页数就是这份 JSON 里的页数
    const slideCount = Array.isArray(parsed.slides) ? parsed.slides.length : 0;
    return { ...toPresentationProject(data.project), slideCount };
  },

  /* ------------------------------------------------------------------ */
  /* 本地能力（离线兜底 / 首次使用）                                      */
  /* ------------------------------------------------------------------ */

  /** 本地样例项目 —— 只在离线时使用 */
  getLocalStarterProjects(): PresentationProject[] {
    return createStarterProjects();
  },

  /** 在本地建一个空白项目（离线时用） */
  createLocalBlankProject(
    name: string = '未命名演示文稿',
    templateId: string = 'tpl_modern_light'
  ): PresentationProject {
    const template = BUILT_IN_TEMPLATES.find((t) => t.templateId === templateId) ?? BUILT_IN_TEMPLATES[0]!;

    const outlineItem: SlideOutlineItem = {
      slideId: `slide_${Date.now()}_01`,
      order: 1,
      title: name,
      purpose: '演示文稿总体目标与定位',
      keyMessage: '以清晰的逻辑与专业的视觉规范阐述核心价值',
      visualIntent: defaultVisualIntent('title_cover'),
      layoutPreference: 'title_cover',
      requiredElements: ['主标题', '副标题', '作者信息'],
      speakerNotes: '开场致辞与背景介绍。',
      bulletPoints: ['项目战略背景', '核心业务价值'],
    };

    const firstSlide = LayoutEngine.generateSlideIR(outlineItem, template.theme, 1, 1);

    const project: PresentationProject = {
      id: `proj_${Date.now()}`,
      name,
      requirement: {
        topic: name,
        purpose: '业务与技术规划汇报',
        audience: '管理层与相关利益方',
        pageCount: 1,
        style: template.theme.isDark ? '科技沉浸深色' : '清爽明亮纯白',
        depth: '商业与技术规划',
        aspectRatio: '16:9',
      },
      template,
      outline: [outlineItem],
      slides: [firstSlide],
      versions: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    project.qualityReport = QualityEngine.evaluatePresentation(project);
    return project;
  },
};
