/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Template Extractor Prompt · v1
 * ---------------------------------------------------------------------------
 * docs/backend-design.md §10：视觉 LLM 归纳版式语义与视觉规范。
 */

import type { PromptBundle } from './types';

export interface ExtractPromptContext {
  /** 已解析出的客观特征（色板 / 字体 / 画布尺寸 / 主导色） */
  parsed: {
    canvas?: { width: number; height: number };
    palette?: Record<string, string>;
    fonts?: string[];
    sourceKind: 'pptx' | 'pdf' | 'image';
  };
  /** 预览图（可选）—— 有图时走 vision */
  previewImageBase64?: string;
}

export const SYSTEM = `你是 AI PPT Studio 的模板分析助手（Template Extractor）。

你根据给定的一份演示文稿的客观特征（色板、字体、画布尺寸），归纳出它的设计系统（TemplateIR）。

只输出 JSON，不要任何解释文字。结构：
{
  "templateId": "tpl_extracted_<短标识>",
  "name": "模板名称",
  "category": "分类（如 商务 / 科技 / 教育 / 简约）",
  "description": "一句话描述这个模板的视觉风格",
  "canvas": { "width": 1920, "height": 1080 },
  "theme": {
    "primaryColor": "#RRGGBB",
    "secondaryColor": "#RRGGBB",
    "accentColor": "#RRGGBB",
    "backgroundColor": "#RRGGBB",
    "surfaceColor": "#RRGGBB",
    "surfaceBorder": "#RRGGBB",
    "textPrimary": "#RRGGBB",
    "textSecondary": "#RRGGBB",
    "fontFamily": "字体名",
    "fontHeading": "标题字体名",
    "isDark": false
  },
  "master": { "showHeader": true, "headerText": "", "showFooter": true, "footerText": "", "showSlideNumber": true, "logoText": "" }
}

规则：
1. 所有颜色必须是 #RRGGBB 形式，且来自给定特征或由其推导 —— 不要凭空捏造色值。
2. textPrimary 与 backgroundColor 的对比度必须达到 WCAG AA（≥ 4.5:1）；深色背景要配浅色文字，反之亦然。
3. isDark 必须与 backgroundColor 的亮度一致。
4. canvas 必须沿用给定的画布尺寸。`;

export function build(ctx: ExtractPromptContext): PromptBundle {
  const lines: string[] = [];

  lines.push('## 客观特征');
  lines.push(JSON.stringify(ctx.parsed, null, 2));

  if (ctx.previewImageBase64) {
    lines.push('');
    lines.push('## 预览图（视觉参考，分析布局留白与层级）');
    lines.push(`data:image/png;base64,${ctx.previewImageBase64}`);
  }

  return { name: 'extract', version: 'v1', system: SYSTEM, user: lines.join('\n') };
}
