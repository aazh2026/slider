/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 模板路由（docs/backend-design.md §5.2 / §10）
 * ---------------------------------------------------------------------------
 *   GET  /api/templates            模板库（内置 + 用户 + 提取）
 *   POST /api/templates/extract    上传文件 → 真实解析 → TemplateIR
 *   POST /api/templates/:id/apply  应用模板（服务端权威）
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, isNull, or } from 'drizzle-orm';

import { BUILT_IN_TEMPLATES, type TemplateIR } from '@ppt/core';

import { ApiError } from '../errors';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { projects, templates } from '../db/schema';
import { extractTemplate } from '../services/agents/extractAgent';
import { updateProject } from '../services/projectService';
import { respond, requireUserId } from './_helpers';
import type { AppEnv } from '../types';

export const templateRoutes = new Hono<AppEnv>();

const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

templateRoutes.get('/', requireAuth, async (c) => {
  const userId = requireUserId(c);

  const rows = await c.get('db').db.select().from(templates);

  const mine = rows.filter((t) => t.ownerId === userId);
  const shared = rows.filter((t) => t.ownerId === null);

  return respond(c, {
    builtin: BUILT_IN_TEMPLATES.map((t) => ({
      templateId: t.templateId,
      name: t.name,
      category: t.category,
      description: t.description,
      theme: t.theme,
      canvas: t.canvas,
    })),
    user: mine.map((t) => ({
      templateId: t.templateId,
      name: t.name,
      category: t.category,
      ir: t.ir,
      source: t.source,
    })),
    shared: shared.map((t) => ({
      templateId: t.templateId,
      name: t.name,
      category: t.category,
      source: t.source,
    })),
  });
});

/** 上传 → 真实解析（magic bytes + OOXML 主题抽取） */
templateRoutes.post(
  '/extract',
  requireAuth,
  rateLimit({ limit: 10, windowMs: 60_000, name: 'templates' }),
  async (c) => {
    const userId = requireUserId(c);

    const form = await c.req.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || typeof file === 'string') {
      throw ApiError.validation('缺少上传文件（multipart/form-data，字段名 file）');
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length === 0) throw ApiError.validation('上传文件为空');
    if (bytes.length > MAX_UPLOAD_BYTES) {
      throw ApiError.validation(`文件过大（上限 ${MAX_UPLOAD_BYTES} 字节）`);
    }

    const result = await extractTemplate({ filename: file.name, bytes });

    const [row] = await c
      .get('db')
      .db.insert(templates)
      .values({
        ownerId: userId,
        templateId: result.template.templateId,
        name: result.template.name,
        category: result.template.category,
        ir: result.template,
        source: 'extracted',
      })
      .returning();

    return respond(
      c,
      {
        template: result.template,
        detected: result.detected,
        warnings: result.warnings,
        record: row ?? null,
      },
      201
    );
  }
);

const ApplyTemplateSchema = z.object({
  projectId: z.string().min(1),
});

/** 应用模板到项目 —— 服务端权威（前端只发意图，不改几何） */
templateRoutes.post('/:id/apply', requireAuth, async (c) => {
  const userId = requireUserId(c);
  const body = ApplyTemplateSchema.parse(await c.req.json().catch(() => null));

  const templateId = c.req.param('id')!;

  let ir: TemplateIR | undefined;

  const builtin = BUILT_IN_TEMPLATES.find((t) => t.templateId === templateId);
  if (builtin) {
    ir = builtin;
  } else {
    const rows = await c
      .get('db')
      .db.select()
      .from(templates)
      .where(
        and(
          eq(templates.templateId, templateId),
          or(eq(templates.ownerId, userId), isNull(templates.ownerId))
        )
      )
      .limit(1);
    ir = rows[0]?.ir;
  }

  if (!ir) throw ApiError.notFound('模板不存在');

  const projectRows = await c
    .get('db')
    .db.select()
    .from(projects)
    .where(and(eq(projects.id, body.projectId), eq(projects.userId, userId)))
    .limit(1);

  const project = projectRows[0];
  if (!project) throw ApiError.notFound('项目不存在');

  const updated = await updateProject(c.get('db'), userId, project.id, { template: ir });

  return respond(c, { project: updated, template: ir });
});
