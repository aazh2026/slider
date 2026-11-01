/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 质量路由（docs/backend-design.md §5.2 / §7.3）
 * ---------------------------------------------------------------------------
 *   POST /api/quality/evaluate   四维评分（服务端权威）
 *   POST /api/quality/auto-fix    自动修复（越界、重复 ID、补齐）
 *
 * 质量引擎是**纯确定性计算** —— 前后端跑同一份代码（@ppt/core），
 * 所以服务端分数与前端即时预览一定一致。
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';

import { QualityEngine, type PresentationProject } from '@ppt/core';

import { ApiError } from '../errors';
import { requireAuth } from '../middleware/auth';
import { projects, slides } from '../db/schema';
import type { DbHandle } from '../db/client';
import { updateProject } from '../services/projectService';
import { respond, requireUserId } from './_helpers';
import type { AppEnv } from '../types';

export const qualityRoutes = new Hono<AppEnv>();

const EvaluateSchema = z.object({
  projectId: z.string().min(1),
});

/** 从 DB 组装 PresentationProject —— 质量引擎的输入 */
async function loadProject(
  db: DbHandle,
  userId: string,
  projectId: string
): Promise<PresentationProject> {
  const rows = await db.db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  const project = rows[0];
  if (!project) throw ApiError.notFound('项目不存在');

  const slideRows = await db.db
    .select()
    .from(slides)
    .where(eq(slides.projectId, projectId))
    .orderBy(slides.orderIndex);

  return {
    id: project.id,
    name: project.name,
    requirement: project.requirement,
    template: project.template,
    outline: project.outline ?? [],
    slides: slideRows.map((s) => s.ir),
    versions: {},
    qualityReport: project.qualityReport ?? undefined,
    createdAt: project.createdAt?.getTime() ?? Date.now(),
    updatedAt: project.updatedAt?.getTime() ?? Date.now(),
  };
}

qualityRoutes.post('/evaluate', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const body = EvaluateSchema.parse(await c.req.json().catch(() => null));

  const project = await loadProject(c.get('db'), userId, body.projectId);
  const report = QualityEngine.evaluatePresentation(project);

  // 结果落库 —— 便于前端随时回看最近一次评分
  await updateProject(c.get('db'), userId, project.id, { qualityReport: report });

  return respond(c, { report });
});

qualityRoutes.post('/auto-fix', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const body = EvaluateSchema.parse(await c.req.json().catch(() => null));

  const db = c.get('db');
  const project = await loadProject(db, userId, body.projectId);

  const before = QualityEngine.evaluatePresentation(project);
  const fixed = QualityEngine.autoFixProject(project);
  const after = QualityEngine.evaluatePresentation(fixed);

  // 修复后的 IR 写回 slides 表
  for (const [idx, ir] of fixed.slides.entries()) {
    const slideRows = await db.db
      .select()
      .from(slides)
      .where(and(eq(slides.projectId, project.id), eq(slides.slideId, ir.slideId)))
      .limit(1);
    const target = slideRows[0];
    if (!target) continue;
    const versionId = crypto.randomUUID();
    await db.db
      .update(slides)
      .set({ ir, versionId, orderIndex: idx + 1, updatedAt: new Date() })
      .where(eq(slides.id, target.id));
  }

  await updateProject(db, userId, project.id, { qualityReport: after });

  return respond(c, {
    before,
    after,
    slides: fixed.slides,
  });
});
