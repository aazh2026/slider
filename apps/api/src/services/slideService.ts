/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 幻灯片服务（docs/backend-design.md §5.2 幻灯片路由 / §5.3 乐观并发）
 * ---------------------------------------------------------------------------
 * **乐观并发**：所有写操作必须携带 `baseVersionId`；
 * 与当前版本不匹配 → 409 SLIDE_VERSION_CONFLICT 并附带当前版本。
 *
 * **版本历史**：每次写入都在 `slide_versions` 留一条快照；
 * AI 编辑额外留 `patch`（增量补丁，可读、可回放）。
 */

import { and, eq } from 'drizzle-orm';

import {
  LayoutEngine,
  applyPatches,
  type IRPatch,
  type SlideIR,
  type SlideOutlineItem,
} from '@ppt/core';

import { ApiError } from '../errors';
import { slides, slideVersions, type SlideRow } from '../db/schema';
import { isUuid } from '../utils/uuid';
import type { DbHandle } from '../db/client';

export interface SlideWriteOptions {
  projectId: string;
  slideId: string;
  /** 客户端持有的版本 —— 必须匹配 */
  baseVersionId: string;
  /** 写入者 */
  author: string;
  description?: string;
  /** AI 编辑的补丁留痕 */
  patch?: IRPatch[];
}

export interface SlideWriteResult {
  slide: SlideRow;
  versionId: string;
}

/** 读取一页（带 projectId 条件） */
export async function findSlide(
  db: DbHandle,
  projectId: string,
  slideId: string
): Promise<SlideRow | undefined> {
  const rows = await db.db
    .select()
    .from(slides)
    .where(and(eq(slides.projectId, projectId), eq(slides.slideId, slideId)))
    .limit(1);
  return rows[0];
}

/**
 * 写入一页
 * ---------------------------------------------------------------------------
 * 顺序很重要：**先查版本、再写**。两个并发请求基于同一 baseVersionId 时，
 * 恰好一个成功，另一个拿到 409。
 */
export async function writeSlide(
  db: DbHandle,
  ir: SlideIR,
  opts: SlideWriteOptions
): Promise<SlideWriteResult> {
  const current = await findSlide(db, opts.projectId, opts.slideId);
  if (!current) throw ApiError.notFound('幻灯片不存在');

  if (current.versionId !== opts.baseVersionId) {
    throw ApiError.versionConflict('内容已被他人修改，请刷新后重试', {
      currentVersionId: current.versionId,
      expectedVersionId: opts.baseVersionId,
    });
  }

  const versionId = crypto.randomUUID();

  const [updated] = await db.db
    .update(slides)
    .set({ ir, versionId, updatedAt: new Date() })
    .where(
      and(
        eq(slides.projectId, opts.projectId),
        eq(slides.slideId, opts.slideId),
        eq(slides.versionId, opts.baseVersionId)
      )
    )
    .returning();

  if (!updated) {
    // 并发写入的另一个请求抢先了 —— 重新读一次，带上真实当前版本
    const latest = await findSlide(db, opts.projectId, opts.slideId);
    throw ApiError.versionConflict('内容已被他人修改，请刷新后重试', {
      currentVersionId: latest?.versionId,
      expectedVersionId: opts.baseVersionId,
    });
  }

  await db.db.insert(slideVersions).values({
    projectId: opts.projectId,
    slideId: opts.slideId,
    versionId,
    author: opts.author,
    description: opts.description ?? null,
    snapshot: ir,
    patch: opts.patch ?? null,
  });

  return { slide: updated, versionId };
}

/**
 * 施加 AI 补丁
 * ---------------------------------------------------------------------------
 * 顺序：patchApplier 校验 → 施加 → 质量复评 → 落库。
 * patchApplier 抛出的错误由统一错误处理器映射（UNKNOWN_ELEMENT → 404）。
 */
export async function applyPatchToSlide(
  db: DbHandle,
  opts: SlideWriteOptions,
  patches: IRPatch[]
): Promise<SlideWriteResult & { ir: SlideIR }> {
  const current = await findSlide(db, opts.projectId, opts.slideId);
  if (!current) throw ApiError.notFound('幻灯片不存在');

  const next = applyPatches(current.ir, patches);
  const result = await writeSlide(db, next, { ...opts, patch: patches });
  return { ...result, ir: next };
}

/**
 * 版式编译：outline（+content）→ SlideIR 集合
 * ---------------------------------------------------------------------------
 * 用的是 `@ppt/core` 的同一份 LayoutEngine —— 前端调同一个函数，
 * 不存在"前端预览和后端导出不一样"的问题。
 */
export async function compileSlides(
  db: DbHandle,
  projectId: string,
  outline: SlideOutlineItem[],
  template: { theme: Parameters<typeof LayoutEngine.generateSlideIR>[1] },
  author = 'system'
): Promise<SlideRow[]> {
  const total = outline.length;
  const written: SlideRow[] = [];

  for (const [idx, item] of outline.entries()) {
    const ir = LayoutEngine.generateSlideIR(
      item,
      template.theme,
      idx + 1,
      total,
      item.content
    );

    const existing = await findSlide(db, projectId, item.slideId);
    if (existing) {
      const versionId = crypto.randomUUID();
      const [updated] = await db.db
        .update(slides)
        .set({ ir, versionId, orderIndex: idx + 1, updatedAt: new Date() })
        .where(
          and(eq(slides.projectId, projectId), eq(slides.slideId, item.slideId))
        )
        .returning();
      if (updated) {
        await db.db.insert(slideVersions).values({
          projectId,
          slideId: item.slideId,
          versionId,
          author,
          description: '版式重新编译',
          snapshot: ir,
          patch: null,
        });
        written.push(updated);
      }
    } else {
      const versionId = crypto.randomUUID();
      const [inserted] = await db.db
        .insert(slides)
        .values({
          projectId,
          slideId: item.slideId,
          orderIndex: idx + 1,
          ir,
          versionId,
        })
        .returning();
      if (inserted) {
        await db.db.insert(slideVersions).values({
          projectId,
          slideId: item.slideId,
          versionId,
          author,
          description: '版式首次编译',
          snapshot: ir,
          patch: null,
        });
        written.push(inserted);
      }
    }
  }

  return written;
}

/** 回滚到某个版本 */
export async function rollbackSlide(
  db: DbHandle,
  projectId: string,
  slideId: string,
  versionId: string,
  baseVersionId: string
): Promise<SlideWriteResult> {
  // version_id 是 uuid 列 —— 形态不对就别进数据库（否则类型转换抛错 → 500）
  if (!isUuid(versionId)) throw ApiError.notFound('版本不存在');

  const rows = await db.db
    .select()
    .from(slideVersions)
    .where(
      and(
        eq(slideVersions.projectId, projectId),
        eq(slideVersions.slideId, slideId),
        eq(slideVersions.versionId, versionId)
      )
    )
    .limit(1);

  const target = rows[0];
  if (!target) throw ApiError.notFound('版本不存在');

  return writeSlide(db, target.snapshot, {
    projectId,
    slideId,
    baseVersionId,
    author: 'user',
    description: `回滚到版本 ${versionId}`,
  });
}
