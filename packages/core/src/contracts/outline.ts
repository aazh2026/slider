/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Zod 契约 —— wire + LLM 结构化输出共用同一份 Schema
 * ---------------------------------------------------------------------------
 * docs/backend-design.md §4.4：一份 Schema，三处复用
 *   1. 服务端入参校验
 *   2. `z.toJSONSchema()` → 厂商结构化输出（Gemini responseSchema / Anthropic tool schema）
 *   3. 模型输出校验（§12：模型输出**永远经过 Zod 校验**后才进入系统）
 *
 * 契约放在 @ppt/core 而不是 apps/api —— 前端也要用它校验服务端返回的数据。
 */

import { z } from 'zod';

/** 8 种版式 */
export const SlideLayoutTypeSchema = z.enum([
  'title_cover',
  'architecture_diagram',
  'cards_grid',
  'problem_solution',
  'timeline_roadmap',
  'stats_kpi',
  'radial_center',
  'summary_conclusion',
]);

export const SLIDE_LAYOUT_TYPES = SlideLayoutTypeSchema.options;

/** 需求规格 —— Layer 1 */
export const PresentationRequirementSchema = z.object({
  topic: z.string().min(1),
  purpose: z.string().default(''),
  audience: z.string().default(''),
  pageCount: z.number().int().min(1).max(50),
  style: z.string().default(''),
  depth: z.string().default(''),
  aspectRatio: z.enum(['16:9', '4:3']).default('16:9'),
  rawNotes: z.string().optional(),
});

/** 内容槽位 —— Layer 2 的排版输入（§4.2） */
export const SlideContentSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  keyMessage: z.string().optional(),
  bullets: z.array(z.string()).max(6),
  columns: z.array(z.object({ title: z.string(), items: z.array(z.string()) })).optional(),
  layers: z.array(z.object({ title: z.string(), items: z.array(z.string()) })).optional(),
  phases: z
    .array(
      z.object({
        phase: z.string(),
        time: z.string(),
        title: z.string(),
        deliverables: z.array(z.string()),
      })
    )
    .optional(),
  metrics: z
    .array(
      z.object({
        value: z.string(),
        trend: z.string(),
        title: z.string(),
        desc: z.string(),
      })
    )
    .optional(),
  radial: z
    .object({
      center: z.object({ title: z.string(), desc: z.string() }),
      satellites: z.array(z.object({ title: z.string(), desc: z.string() })),
    })
    .optional(),
  summary: z
    .object({
      headline: z.string(),
      points: z.array(z.string()),
      actions: z.array(z.string()),
    })
    .optional(),
  meta: z.record(z.string(), z.string()).optional(),
});

/** 大纲项 —— Layer 2 */
export const SlideOutlineItemSchema = z.object({
  slideId: z.string().min(1),
  order: z.number().int().min(1),
  title: z.string().min(1),
  purpose: z.string().default(''),
  keyMessage: z.string().default(''),
  visualIntent: z.string().default(''),
  layoutPreference: SlideLayoutTypeSchema,
  requiredElements: z.array(z.string()).default([]),
  speakerNotes: z.string().default(''),
  bulletPoints: z.array(z.string()).default([]),
  /** 内容槽位 —— 由 AI 产出或人工编辑；缺省时由 contentBinding 从大纲确定性推导 */
  content: SlideContentSchema.optional(),
});

export const OutlineResponseSchema = z.object({
  outline: z.array(SlideOutlineItemSchema),
});

export type SlideContentInput = z.input<typeof SlideContentSchema>;
export type SlideOutlineItemInput = z.input<typeof SlideOutlineItemSchema>;
export type PresentationRequirementInput = z.input<typeof PresentationRequirementSchema>;

/** 入参契约 */
export const RequirementRequestSchema = z.object({
  prompt: z.string().min(1),
  documentText: z.string().optional(),
  audience: z.string().optional(),
  purpose: z.string().optional(),
  pageCount: z.number().int().min(1).max(50).optional(),
  style: z.string().optional(),
  depth: z.string().optional(),
});

export const OutlineRequestSchema = z.object({
  requirement: PresentationRequirementSchema,
  templateHint: z.string().optional(),
});
