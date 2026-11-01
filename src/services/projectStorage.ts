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

/* -------------------------------------------------------------------------- */
/* 服务                                                                        */
/* -------------------------------------------------------------------------- */

export const ProjectStorage = {
  /**
   * 项目列表
   * ---------------------------------------------------------------------------
   * 返回的是**摘要**（不含 IR）。点开某个项目时再拉全量。
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
        template: BUILT_IN_TEMPLATES[0]!,
        outline: [],
        slides: [],
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

  /** 复制项目 */
  async duplicateProject(projectId: string): Promise<PresentationProject> {
    const data = await api.post<{ project: ServerProjectRow }>(
      `/api/projects/${projectId}/duplicate`
    );
    return toPresentationProject(data.project);
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

  /** 质量评估（服务端权威） */
  async evaluateQuality(projectId: string): Promise<PresentationProject['qualityReport']> {
    const data = await api.post<{ report: PresentationProject['qualityReport'] }>(
      '/api/quality/evaluate',
      { projectId }
    );
    return data.report;
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
    return toPresentationProject(data.project);
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
