/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 项目路由（docs/backend-design.md §5.2）
 * ---------------------------------------------------------------------------
 *   GET    /api/projects                       列表
 *   POST   /api/projects                       创建
 *   POST   /api/projects/import                导入 IR JSON
 *   GET    /api/projects/:id                   详情
 *   PATCH  /api/projects/:id                   改名 / 换需求 / 换模板
 *   DELETE /api/projects/:id                   软删除
 *   POST   /api/projects/:id/duplicate         复制
 *   GET    /api/projects/:id/export            导出 IR JSON
 *   PATCH  /api/projects/:id/outline           批量更新大纲
 *   POST   /api/projects/:id/outline/regenerate 重新生成大纲（AI）
 *   POST   /api/projects/:id/compile           大纲 → SlideIR
 *   GET    /api/projects/:id/content           只返回内容槽位
 *   GET    /api/projects/:id/slides            幻灯片列表
 *   GET    /api/projects/:id/slides/:slideId   单页
 *   PATCH  /api/projects/:id/slides/:slideId   局部更新（乐观锁）
 *   DELETE /api/projects/:id/slides/:slideId   删除单页
 *   POST   /api/projects/:id/slides/:slideId/patches  AI 编辑（IRPatch）
 *   GET    /api/projects/:id/slides/:slideId/versions 版本列表
 *   POST   /api/projects/:id/slides/:slideId/versions/:versionId/rollback 回滚
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';

import {
  PresentationRequirementSchema,
  SlideOutlineItemSchema,
  type SlideElement,
  type SlideIR,
} from '@ppt/core';

import { ApiError } from '../errors';
import { requireAuth, requireProject, requireSlide } from '../middleware/auth';
import {
  countSlidesByProject,
  createProject,
  defaultTemplate,
  deleteProject,
  duplicateProject,
  importProject,
  listProjects,
  listSlides,
  listVersions,
  updateProject,
} from '../services/projectService';
import {
  applyPatchToSlide,
  compileSlides,
  rollbackSlide,
  writeSlide,
} from '../services/slideService';
import { OutlineAgent } from '../services/agents/outlineAgent';
import { EditAgent } from '../services/agents/editAgent';
import { respond, requireUserId } from './_helpers';
import type { AppEnv } from '../types';

export const projectRoutes = new Hono<AppEnv>();

/* -------------------------------------------------------------------------- */
/* 入参契约                                                                     */
/* -------------------------------------------------------------------------- */

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(200),
  requirement: PresentationRequirementSchema,
  template: z.unknown().optional(),
  outline: z.array(SlideOutlineItemSchema).optional(),
});

const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  requirement: PresentationRequirementSchema.optional(),
  template: z.unknown().optional(),
  outline: z.array(SlideOutlineItemSchema).optional(),
});

const UpdateOutlineSchema = z.object({
  outline: z.array(SlideOutlineItemSchema),
});

const PatchSlideSchema = z.object({
  /** 乐观锁 —— 必填 */
  baseVersionId: z.string().min(1),
  /** 整页替换 */
  ir: z.unknown().optional(),
  /** 元素级局部更新（按 id 合并） */
  elements: z.array(z.unknown()).optional(),
  description: z.string().max(500).optional(),
});

const ApplyPatchesSchema = z.object({
  baseVersionId: z.string().min(1),
  /** 直接给补丁 */
  patches: z.array(z.unknown()).optional(),
  /** 或者给指令让 AI 生成补丁 */
  instruction: z.string().min(1).max(4000).optional(),
  mode: z.enum(['content', 'style', 'layout']).optional(),
  description: z.string().max(500).optional(),
});

/**
 * 导入端认的那份 bundle 形状
 * ---------------------------------------------------------------------------
 * `packages/core/src/engine/exportEngine.ts` 里写明了这份约定：
 *
 *   > bundle 的形状（`GET /api/projects/:id/export` 的载荷）
 *   > **就是导入端认的形状**：导出去能再导回来，中间不丢东西。
 *
 * 原来这里写的是 `slides: z.array(z.unknown())` —— **一个字段都不校验**。
 * 后果（实测，见 `apps/api/tests/integration/import-bundle.test.ts`）：
 *
 *   · `orderIndex` **重复** → 照样落库，但 `listSlides` 是按 orderIndex 排序的，
 *     同键的行顺序由数据库决定 —— 导出的**页序丢了**，
 *     「导出去能再导回来」当场失效，而且没有任何报错
 *   · `orderIndex` 为 0 / 负数 → 违反领域内核的契约
 *   · 字段缺失 → NOT NULL / 唯一约束在数据库里炸 → 客户端拿到 **500**，
 *     而入参问题该给的是 **400**
 *
 * 页序基线取 **1-based**：五份设计文档从头到尾没规定页码从几开始，
 * 能定住它的是领域内核的契约 —— `packages/core/src/contracts/outline.ts`：
 * `order: z.number().int().min(1)`。
 * 而 `slides.orderIndex` 与大纲的 `order` 是**同步**的
 * （docs/backend-features.md PRJ-10 / SLD-08：「重排后同步更新 `order` 字段与 `slides.orderIndex`」），
 * 所以两者同基线；服务端别处写的也是 `idx + 1`。
 */
const ImportSlideSchema = z.object({
  slideId: z.string().min(1),
  orderIndex: z.number().int().min(1),
  /**
   * IR 整体 —— 必须是个对象。
   *
   * 用 `z.record` 而不是某个具体形状的 object schema，两个原因：
   *   · Zod 的 object 默认**剥掉**未声明的字段 —— 用它会把 IR 削成空壳（丢数据）；
   *   · 仓库里**没有** IR 的运行时 schema（只有 outline / content / requirement），
   *     凭空写一个就是**编造契约**，所以不写。
   */
  ir: z.record(z.string(), z.unknown()),
});

/**
 * bundle 里的页序必须唯一。
 *
 * 重复的 orderIndex 不会报错，只会让排序的键相同 —— 页序从此由数据库决定，
 * 是个**静默**的数据损坏，比直接拒绝难查得多。
 */
const ImportSlidesSchema = z
  .array(ImportSlideSchema)
  .superRefine((slides, ctx) => {
    const byOrder = new Map<number, number>();
    const bySlideId = new Map<string, number>();
    slides.forEach((s, i) => {
      const prevOrder = byOrder.get(s.orderIndex);
      if (prevOrder !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [i, 'orderIndex'],
          message: `orderIndex 重复：${s.orderIndex}（第 ${prevOrder + 1} 页与第 ${i + 1} 页）`,
        });
      } else {
        byOrder.set(s.orderIndex, i);
      }

      const prevSlide = bySlideId.get(s.slideId);
      if (prevSlide !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [i, 'slideId'],
          message: `slideId 重复：${s.slideId}（第 ${prevSlide + 1} 页与第 ${i + 1} 页）`,
        });
      } else {
        bySlideId.set(s.slideId, i);
      }
    });
  });

const ImportProjectSchema = z.object({
  name: z.string().min(1).max(200),
  requirement: PresentationRequirementSchema,
  template: z.unknown().optional(),
  outline: z.array(z.unknown()).optional(),
  /**
   * `slides` **必填** —— docs/backend-features.md PRJ-07：
   * 「校验 `slides`/`name` 字段合法性；非法文件返回明确错误而非崩溃」；
   * docs/test-cases.md TC-CONTRACT-034~036 也把「400 缺 slides 字段」列为用例。
   * 原来这里是 `.optional()`，于是缺 slides 的文件会被**静默当成空项目**导进去。
   */
  slides: ImportSlidesSchema,
});

/* -------------------------------------------------------------------------- */
/* 项目 CRUD                                                                    */
/* -------------------------------------------------------------------------- */

projectRoutes.get('/', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const limit = Number(c.req.query('limit') ?? 50);
  const offset = Number(c.req.query('offset') ?? 0);
  const tag = c.req.query('tag');

  const rows = await listProjects(c.get('db'), userId, {
    limit: Number.isFinite(limit) ? limit : 50,
    offset: Number.isFinite(offset) ? offset : 0,
    tag: tag ?? undefined,
  });

  // 摘要要带上**作品库卡片真正要显示的两样东西**：模板与页数。
  // 少了它们，前端只能瞎猜：模板一律当成默认的浅色（深色筛选于是永远筛不出东西），
  // 页数一律当成 0（每张卡片都写"0 页"）。见 known_gaps 里对应的一条。
  const slideCounts = await countSlidesByProject(
    c.get('db'),
    rows.map((r) => r.id)
  );

  return respond(c, {
    projects: rows.map((p) => ({
      id: p.id,
      name: p.name,
      topic: p.requirement?.topic ?? '',
      pageCount: p.requirement?.pageCount ?? 0,
      outlineCount: p.outline?.length ?? 0,
      /** 模板 id —— 前端据此还原深/浅底，不再一律当成默认模板 */
      templateId: p.template?.templateId ?? '',
      /** 真实页数 —— slides 表里的行数，不是"打算做几页" */
      slideCount: slideCounts.get(p.id) ?? 0,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    })),
  });
});

projectRoutes.post('/', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const body = CreateProjectSchema.parse(await c.req.json().catch(() => null));

  const row = await createProject(c.get('db'), userId, {
    name: body.name,
    requirement: body.requirement,
    template: (body.template as never) ?? defaultTemplate(),
    outline: body.outline as never,
  });

  return respond(c, { project: row }, 201);
});

projectRoutes.post('/import', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const body = ImportProjectSchema.parse(await c.req.json().catch(() => null));

  const row = await importProject(c.get('db'), userId, {
    name: body.name,
    requirement: body.requirement,
    template: (body.template as never) ?? defaultTemplate(),
    outline: (body.outline as never) ?? [],
    slides: (body.slides as never) ?? [],
  });

  return respond(c, { project: row }, 201);
});

projectRoutes.get('/:id', requireAuth, requireProject, async (c) => {
  const project = c.get('project')!;
  const slides = await listSlides(c.get('db'), project.id);

  return respond(c, {
    project: {
      ...project,
      slides: slides.map((s) => ({
        slideId: s.slideId,
        orderIndex: s.orderIndex,
        versionId: s.versionId,
        updatedAt: s.updatedAt,
      })),
    },
  });
});

projectRoutes.patch('/:id', requireAuth, requireProject, async (c) => {
  const userId = requireUserId(c);
  const body = UpdateProjectSchema.parse(await c.req.json().catch(() => null));

  const row = await updateProject(c.get('db'), userId, c.get('project')!.id, {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.requirement !== undefined ? { requirement: body.requirement } : {}),
    ...(body.template !== undefined ? { template: body.template as never } : {}),
    ...(body.outline !== undefined ? { outline: body.outline as never } : {}),
  });

  return respond(c, { project: row });
});

projectRoutes.delete('/:id', requireAuth, requireProject, async (c) => {
  const userId = requireUserId(c);
  await deleteProject(c.get('db'), userId, c.get('project')!.id);
  return respond(c, { deleted: true });
});

projectRoutes.post('/:id/duplicate', requireAuth, requireProject, async (c) => {
  const userId = requireUserId(c);
  const row = await duplicateProject(c.get('db'), userId, c.get('project')!.id);
  return respond(c, { project: row }, 201);
});

projectRoutes.get('/:id/export', requireAuth, requireProject, async (c) => {
  const project = c.get('project')!;
  const slides = await listSlides(c.get('db'), project.id);

  return respond(c, {
    bundle: {
      name: project.name,
      requirement: project.requirement,
      template: project.template,
      outline: project.outline,
      slides: slides.map((s) => ({
        slideId: s.slideId,
        orderIndex: s.orderIndex,
        ir: s.ir,
      })),
    },
  });
});

/* -------------------------------------------------------------------------- */
/* 大纲与编译                                                                   */
/* -------------------------------------------------------------------------- */

projectRoutes.patch('/:id/outline', requireAuth, requireProject, async (c) => {
  const userId = requireUserId(c);
  const body = UpdateOutlineSchema.parse(await c.req.json().catch(() => null));

  const row = await updateProject(c.get('db'), userId, c.get('project')!.id, {
    outline: body.outline as never,
  });

  return respond(c, { outline: row.outline });
});

projectRoutes.post('/:id/outline/regenerate', requireAuth, requireProject, async (c) => {
  const userId = requireUserId(c);
  const project = c.get('project')!;
  const body = (await c.req.json().catch(() => null)) as { requirement?: unknown } | null;

  const requirement = PresentationRequirementSchema.parse(
    body?.requirement ?? project.requirement
  );

  const agent = new OutlineAgent({ router: c.get('modelRouter') });
  const result = await agent.generate(requirement);

  const row = await updateProject(c.get('db'), userId, project.id, {
    requirement,
    outline: result.outline as never,
  });

  return respond(c, {
    outline: row.outline,
    source: result.source,
    degraded: result.degraded,
  });
});

projectRoutes.post('/:id/compile', requireAuth, requireProject, async (c) => {
  const project = c.get('project')!;

  if (!project.outline || project.outline.length === 0) {
    throw ApiError.validation('请先生成或填写大纲');
  }

  const written = await compileSlides(
    c.get('db'),
    project.id,
    project.outline as never,
    project.template as never
  );

  return respond(c, {
    slides: written.map((s) => ({
      slideId: s.slideId,
      orderIndex: s.orderIndex,
      versionId: s.versionId,
    })),
  });
});

projectRoutes.get('/:id/content', requireAuth, requireProject, async (c) => {
  const project = c.get('project')!;
  return respond(c, {
    content: (project.outline ?? []).map((o) => ({
      slideId: o.slideId,
      order: o.order,
      title: o.title,
      layoutPreference: o.layoutPreference,
      content: o.content ?? null,
      bulletPoints: o.bulletPoints ?? [],
    })),
  });
});

/* -------------------------------------------------------------------------- */
/* 幻灯片                                                                       */
/* -------------------------------------------------------------------------- */

projectRoutes.get('/:id/slides', requireAuth, requireProject, async (c) => {
  const rows = await listSlides(c.get('db'), c.get('project')!.id);
  return respond(c, {
    slides: rows.map((s) => ({
      slideId: s.slideId,
      orderIndex: s.orderIndex,
      versionId: s.versionId,
      updatedAt: s.updatedAt,
    })),
  });
});

projectRoutes.get('/:id/slides/:slideId', requireAuth, requireProject, requireSlide, async (c) => {
  const slide = c.get('slide')!;
  return respond(c, {
    slide: {
      slideId: slide.slideId,
      orderIndex: slide.orderIndex,
      versionId: slide.versionId,
      ir: slide.ir,
      updatedAt: slide.updatedAt,
    },
  });
});

/** 局部更新 —— 元素几何/样式，带乐观锁 */
projectRoutes.patch('/:id/slides/:slideId', requireAuth, requireProject, requireSlide, async (c) => {
  const body = PatchSlideSchema.parse(await c.req.json().catch(() => null));
  const project = c.get('project')!;
  const slide = c.get('slide')!;

  let nextIr: SlideIR;
  if (body.ir) {
    nextIr = body.ir as SlideIR;
  } else if (body.elements) {
    nextIr = mergeElements(slide.ir, body.elements as SlideElement[]);
  } else {
    throw ApiError.validation('缺少更新内容：需要 ir 或 elements');
  }

  const result = await writeSlide(c.get('db'), nextIr, {
    projectId: project.id,
    slideId: slide.slideId,
    baseVersionId: body.baseVersionId,
    author: 'user',
    description: body.description ?? '手动编辑',
  });

  return respond(c, {
    slide: { slideId: slide.slideId, versionId: result.versionId, ir: nextIr },
  });
});

projectRoutes.delete('/:id/slides/:slideId', requireAuth, requireProject, requireSlide, async (c) => {
  const project = c.get('project')!;
  const slide = c.get('slide')!;

  const { slides } = await import('../db/schema');
  await c
    .get('db')
    .db.delete(slides)
    .where(and(eq(slides.projectId, project.id), eq(slides.slideId, slide.slideId)));

  return respond(c, { deleted: true });
});

/** AI 编辑 —— 走 IRPatch 协议 */
projectRoutes.post(
  '/:id/slides/:slideId/patches',
  requireAuth,
  requireProject,
  requireSlide,
  async (c) => {
    const body = ApplyPatchesSchema.parse(await c.req.json().catch(() => null));
    const project = c.get('project')!;
    const slide = c.get('slide')!;
    const db = c.get('db');

    // 情形 1：客户端直接给补丁
    if (body.patches && body.patches.length > 0) {
      const { IRPatchSchema } = await import('@ppt/core');
      const patches = body.patches.map((p) => IRPatchSchema.parse(p));
      const result = await applyPatchToSlide(
        db,
        {
          projectId: project.id,
          slideId: slide.slideId,
          baseVersionId: body.baseVersionId,
          author: 'user',
          description: body.description ?? '手工补丁',
        },
        patches as never
      );
      return respond(c, {
        patches,
        message: '补丁已施加',
        versionId: result.versionId,
        ir: result.ir,
      });
    }

    // 情形 2：给指令，让 AI 生成补丁
    if (!body.instruction) {
      throw ApiError.validation('需要 patches 或 instruction');
    }

    const ir = slide.ir;
    const elementDigest = (ir.elements ?? []).map((el) => ({
      id: el.id,
      role: el.role,
      text: typeof el.content === 'string' ? el.content : extractText(el),
    }));

    const agent = new EditAgent({ router: c.get('modelRouter') });
    const agentResult = await agent.generate({
      slideId: slide.slideId,
      instruction: body.instruction,
      layout: 'cards_grid',
      currentContent: { bullets: [] },
      elementDigest,
      mode: body.mode,
    });

    const { IRPatchSchema } = await import('@ppt/core');
    const patches = agentResult.patches.map((p) => IRPatchSchema.parse(p));

    const result = await applyPatchToSlide(
      db,
      {
        projectId: project.id,
        slideId: slide.slideId,
        baseVersionId: body.baseVersionId,
        author: 'ai',
        description: body.description ?? agentResult.message,
      },
      patches as never
    );

    return respond(c, {
      patches,
      message: agentResult.message,
      source: agentResult.source,
      degraded: agentResult.degraded,
      versionId: result.versionId,
      ir: result.ir,
    });
  }
);

projectRoutes.get(
  '/:id/slides/:slideId/versions',
  requireAuth,
  requireProject,
  requireSlide,
  async (c) => {
    const project = c.get('project')!;
    const slide = c.get('slide')!;
    const rows = await listVersions(c.get('db'), project.id, slide.slideId);
    return respond(c, { versions: rows });
  }
);

projectRoutes.post(
  '/:id/slides/:slideId/versions/:versionId/rollback',
  requireAuth,
  requireProject,
  requireSlide,
  async (c) => {
    const body = PatchSlideSchema.pick({ baseVersionId: true })
      .parse(await c.req.json().catch(() => null));
    const project = c.get('project')!;
    const slide = c.get('slide')!;

    const result = await rollbackSlide(
      c.get('db'),
      project.id,
      slide.slideId,
      c.req.param('versionId')!,
      body.baseVersionId
    );

    return respond(c, {
      slide: { slideId: slide.slideId, versionId: result.versionId, ir: result.slide.ir },
    });
  }
);

/* -------------------------------------------------------------------------- */
/* 工具                                                                         */
/* -------------------------------------------------------------------------- */

/** 元素级合并 —— 按 id 就地替换，其余元素保持不变 */
function mergeElements(ir: SlideIR, updates: SlideElement[]): SlideIR {
  const next = structuredClone(ir);
  const index = new Map(next.elements.map((el, i) => [el.id, i]));

  for (const update of updates) {
    const at = index.get(update.id);
    if (at === undefined) {
      throw ApiError.validation(`元素不存在：${update.id}`, { field: 'elements' });
    }
    const current = next.elements[at]!;
    next.elements[at] = {
      ...current,
      ...update,
      geometry: update.geometry ? { ...current.geometry, ...update.geometry } : current.geometry,
      style: update.style ? { ...current.style, ...update.style } : current.style,
    };
  }
  return next;
}

/** 提取元素里的文本（用于 AI 元素摘要） */
function extractText(el: SlideElement): string {
  const c = el.content as unknown;
  if (typeof c === 'string') return c;
  if (c && typeof c === 'object' && 'text' in c) {
    const t = (c as { text?: unknown }).text;
    if (typeof t === 'string') return t;
  }
  return '';
}
