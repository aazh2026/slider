/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AI 路由（docs/backend-design.md §5.2）
 * ---------------------------------------------------------------------------
 *   POST /api/ai/requirement   需求结构化
 *   POST /api/ai/outline       大纲 + 内容槽位生成
 *   POST /api/ai/edit-slide    单页 AI 编辑（补丁协议）
 *   POST /api/ai/slides/:slideId/suggest  单页内容重写（不含几何）
 *
 * **模型输出永远经过 Zod 校验后才进入系统**（§12 安全）——
 * 校验在 ModelRouter 里统一做（`parse` 参数），Agent 不再各自 JSON.parse。
 */

import { Hono } from 'hono';
import { z } from 'zod';

import {
  OutlineRequestSchema,
  RequirementRequestSchema,
  SlideContentSchema,
} from '@ppt/core';

import { ApiError } from '../errors';
import { rateLimit } from '../middleware/rateLimit';
import { RequirementAgent } from '../services/agents/requirementAgent';
import { OutlineAgent } from '../services/agents/outlineAgent';
import { EditAgent } from '../services/agents/editAgent';
import { respond } from './_helpers';
import type { AppEnv } from '../types';

export const aiRoutes = new Hono<AppEnv>();

/** AI 端点单独限流 —— 成本敏感 */
const aiLimiter = rateLimit({ limit: 30, windowMs: 60_000, name: 'ai' });

aiRoutes.post('/requirement', aiLimiter, async (c) => {
  const body = RequirementRequestSchema.parse(await c.req.json().catch(() => null));

  const agent = new RequirementAgent({ router: c.get('modelRouter') });
  const result = await agent.generate({
    prompt: body.prompt,
    documentText: body.documentText,
    audience: body.audience,
    purpose: body.purpose,
    pageCount: body.pageCount,
    style: body.style,
    depth: body.depth,
  });

  return respond(c, {
    requirement: result.requirement,
    source: result.source,
    degraded: result.degraded,
  });
});

aiRoutes.post('/outline', aiLimiter, async (c) => {
  const body = OutlineRequestSchema.parse(await c.req.json().catch(() => null));

  const agent = new OutlineAgent({ router: c.get('modelRouter') });
  const result = await agent.generate(body.requirement);

  return respond(c, {
    outline: result.outline,
    source: result.source,
    degraded: result.degraded,
  });
});

const EditRequestSchema = z.object({
  slideId: z.string().min(1),
  instruction: z.string().min(1).max(4000),
  layout: z
    .enum([
      'title_cover',
      'architecture_diagram',
      'cards_grid',
      'problem_solution',
      'timeline_roadmap',
      'stats_kpi',
      'radial_center',
      'summary_conclusion',
    ])
    .default('cards_grid'),
  currentContent: SlideContentSchema.default({ bullets: [] }),
  elementDigest: z
    .array(z.object({ id: z.string(), role: z.string(), text: z.string() }))
    .default([]),
  mode: z.enum(['content', 'style', 'layout']).optional(),
});

aiRoutes.post('/edit-slide', aiLimiter, async (c) => {
  const body = EditRequestSchema.parse(await c.req.json().catch(() => null));

  const agent = new EditAgent({ router: c.get('modelRouter') });
  const result = await agent.generate({
    slideId: body.slideId,
    instruction: body.instruction,
    layout: body.layout,
    currentContent: body.currentContent,
    elementDigest: body.elementDigest,
    mode: body.mode,
  });

  return respond(c, {
    patches: result.patches,
    message: result.message,
    source: result.source,
    degraded: result.degraded,
  });
});

const SuggestSchema = z.object({
  slideId: z.string().min(1),
  instruction: z.string().min(1).max(4000),
  currentContent: SlideContentSchema,
  /** 元素摘要 —— 前端已经持有该页元素，传上来让本地降级也能定位目标 */
  elementDigest: z
    .array(z.object({ id: z.string(), role: z.string(), text: z.string() }))
    .default([]),
  layout: z
    .enum([
      'title_cover',
      'architecture_diagram',
      'cards_grid',
      'problem_solution',
      'timeline_roadmap',
      'stats_kpi',
      'radial_center',
      'summary_conclusion',
    ])
    .default('cards_grid'),
});

/** 单页内容重写 —— 只改内容槽位，不含几何 */
aiRoutes.post('/slides/:slideId/suggest', aiLimiter, async (c) => {
  const body = SuggestSchema.parse(await c.req.json().catch(() => null));

  const agent = new EditAgent({ router: c.get('modelRouter') });
  const result = await agent.generate({
    slideId: body.slideId,
    instruction: body.instruction,
    layout: body.layout,
    currentContent: body.currentContent,
    elementDigest: body.elementDigest,
  });

  if (result.patches.length === 0) {
    throw ApiError.modelOutputInvalid('模型未产出任何可用补丁');
  }

  return respond(c, {
    patches: result.patches,
    message: result.message,
    source: result.source,
    degraded: result.degraded,
  });
});
