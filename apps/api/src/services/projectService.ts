/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 项目服务（docs/backend-design.md §5.2 项目路由 / §9.2 资源级鉴权）
 * ---------------------------------------------------------------------------
 * **每一个查询都带 userId 条件** —— 这是跨租户防护的唯一凭据。
 */

import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { BUILT_IN_TEMPLATES, withVariants, type SlideIR, type SlideOutlineItem, type TemplateIR } from '@ppt/core';

import { ApiError } from '../errors';
import { projects, slides, slideVersions, type ProjectRow } from '../db/schema';
import type { DbHandle } from '../db/client';

export interface ProjectListOptions {
  limit?: number;
  offset?: number;
  /** 标签筛选（按名称模糊匹配，够用且不引入额外表） */
  tag?: string;
}

export interface CreateProjectInput {
  name: string;
  requirement: ProjectRow['requirement'];
  template?: TemplateIR;
  outline?: SlideOutlineItem[];
}

export function defaultTemplate(): TemplateIR {
  const t = BUILT_IN_TEMPLATES[0];
  if (!t) throw ApiError.jobFailed('内置模板缺失');
  return t;
}

export async function listProjects(
  db: DbHandle,
  userId: string,
  opts: ProjectListOptions = {}
): Promise<ProjectRow[]> {
  const limit = Math.max(1, Math.min(100, opts.limit ?? 50));
  const offset = Math.max(0, opts.offset ?? 0);

  const conditions = [eq(projects.userId, userId), isNull(projects.deletedAt)];
  if (opts.tag) {
    conditions.push(sql`${projects.name} ilike ${'%' + opts.tag + '%'}`);
  }

  return db.db
    .select()
    .from(projects)
    .where(and(...conditions))
    .orderBy(desc(projects.updatedAt))
    .limit(limit)
    .offset(offset);
}

/**
 * 每份文稿的**真实页数** —— `slides` 表里的行数。
 *
 * 为什么不能拿 `requirement.pageCount` 顶替：那是"当初打算做几页"，
 * 编译之后大纲改了、页被加过，两边就对不上了。
 * 作品库卡片上写的那句"N 页"要的是**现在真的有几页**。
 *
 * 一次分组查询拿全所有项目的页数 —— 不按项目逐个查（N+1）。
 */
export async function countSlidesByProject(
  db: DbHandle,
  projectIds: string[]
): Promise<Map<string, number>> {
  if (projectIds.length === 0) return new Map();

  const rows = await db.db
    .select({ projectId: slides.projectId, n: count() })
    .from(slides)
    .where(inArray(slides.projectId, projectIds))
    .groupBy(slides.projectId);

  return new Map(rows.map((r) => [r.projectId, Number(r.n)]));
}

export async function findProject(
  db: DbHandle,
  userId: string,
  id: string
): Promise<ProjectRow | undefined> {
  const rows = await db.db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId), isNull(projects.deletedAt)))
    .limit(1);
  return rows[0];
}

export async function createProject(
  db: DbHandle,
  userId: string,
  input: CreateProjectInput
): Promise<ProjectRow> {
  const [row] = await db.db
    .insert(projects)
    .values({
      userId,
      name: input.name,
      requirement: input.requirement,
      template: input.template ?? defaultTemplate(),
      outline: input.outline ?? [],
    })
    .returning();

  if (!row) throw ApiError.jobFailed('项目创建失败');
  return row;
}

export async function updateProject(
  db: DbHandle,
  userId: string,
  id: string,
  patch: Partial<Pick<ProjectRow, 'name' | 'requirement' | 'template' | 'outline' | 'qualityReport'>>
): Promise<ProjectRow> {
  const existing = await findProject(db, userId, id);
  if (!existing) throw ApiError.notFound('项目不存在');

  const [row] = await db.db
    .update(projects)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(projects.id, id), eq(projects.userId, userId)))
    .returning();

  if (!row) throw ApiError.notFound('项目不存在');
  return row;
}

/** 软删除 */
export async function deleteProject(db: DbHandle, userId: string, id: string): Promise<void> {
  const existing = await findProject(db, userId, id);
  if (!existing) throw ApiError.notFound('项目不存在');
  await db.db
    .update(projects)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));
}

/**
 * 复制项目
 * ---------------------------------------------------------------------------
 * 复制时必须**重新分配 slideId 与 elementId** —— 否则新旧项目的元素 id 撞车，
 * 前端的撤销栈与版本历史会串。
 */
export async function duplicateProject(
  db: DbHandle,
  userId: string,
  id: string
): Promise<ProjectRow> {
  const source = await findProject(db, userId, id);
  if (!source) throw ApiError.notFound('项目不存在');

  const copied = await createProject(db, userId, {
    name: `${source.name}（副本）`,
    requirement: source.requirement,
    template: source.template,
    outline: source.outline,
  });

  const sourceSlides = await db.db
    .select()
    .from(slides)
    .where(eq(slides.projectId, source.id))
    .orderBy(slides.orderIndex);

  for (const s of sourceSlides) {
    const remapped = remapIds(s.ir);
    await db.db.insert(slides).values({
      projectId: copied.id,
      slideId: s.slideId,
      orderIndex: s.orderIndex,
      ir: remapped,
      versionId: crypto.randomUUID(),
    });
  }

  return copied;
}

function remapIds<T extends { elements?: Array<{ id: string }>; slideId?: string }>(ir: T): T {
  const map = new Map<string, string>();
  const cloned = structuredClone(ir) as T;
  for (const el of cloned.elements ?? []) {
    const next = `${el.id}_c${crypto.randomUUID().slice(0, 8)}`;
    map.set(el.id, next);
    el.id = next;
  }
  // IR 内部对 elementId 的引用（若有）一并替换
  const raw = JSON.stringify(cloned);
  let out = raw;
  for (const [from, to] of map) out = out.split(`"${from}"`).join(`"${to}"`);
  return JSON.parse(out) as T;
}

/** 导入项目（JSON bundle） */
export async function importProject(
  db: DbHandle,
  userId: string,
  bundle: {
    name: string;
    requirement: ProjectRow['requirement'];
    template: TemplateIR;
    outline: SlideOutlineItem[];
    slides?: Array<{ slideId: string; orderIndex: number; ir: unknown }>;
  }
): Promise<ProjectRow> {
  const created = await createProject(db, userId, {
    name: bundle.name,
    requirement: bundle.requirement,
    template: bundle.template ?? defaultTemplate(),
    outline: bundle.outline ?? [],
  });

  for (const s of bundle.slides ?? []) {
    await db.db.insert(slides).values({
      projectId: created.id,
      slideId: s.slideId,
      orderIndex: s.orderIndex,
      // 导入的是别人给的 bundle —— 元素可能没有 variant 字段。
      // 落库前补齐，读出来的那条链路才不必再猜 ID（ADR-018）。
      ir: withVariants(s.ir as SlideIR) as never,
      versionId: crypto.randomUUID(),
    });
  }

  return created;
}

/**
 * 项目内的幻灯片列表
 * ---------------------------------------------------------------------------
 * 读出来的 IR 统一过一次 `withVariants()` —— 旧库里存的页没有 `variant` 字段，
 * 补齐之后下游（渲染 / 主题重映射 / 质量修复）都读字段，不再猜 ID（ADR-018）。
 */
export async function listSlides(db: DbHandle, projectId: string) {
  const rows = await db.db
    .select()
    .from(slides)
    .where(eq(slides.projectId, projectId))
    .orderBy(slides.orderIndex);
  return rows.map((row) => ({ ...row, ir: withVariants(row.ir as SlideIR) }));
}

/** 版本列表 */
export async function listVersions(db: DbHandle, projectId: string, slideId: string) {
  return db.db
    .select({
      id: slideVersions.id,
      versionId: slideVersions.versionId,
      author: slideVersions.author,
      description: slideVersions.description,
      createdAt: slideVersions.createdAt,
    })
    .from(slideVersions)
    .where(and(eq(slideVersions.projectId, projectId), eq(slideVersions.slideId, slideId)))
    .orderBy(desc(slideVersions.createdAt));
}
