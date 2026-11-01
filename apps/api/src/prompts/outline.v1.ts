/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Outline Agent Prompt · v2
 * ---------------------------------------------------------------------------
 * v2 相对 v1 的变化：加入 SlideContent 内容槽位契约（docs/backend-design.md §4.2）。
 *   v1 只产出大纲文本，渲染时 7/8 种版式用硬编码演示文案（F2 缺陷）；
 *   v2 要求模型**同时**产出 content 槽位，让大纲真正流进版式。
 */

import type { PromptBundle } from './types';
import type { PresentationRequirement } from '@ppt/core';

export const SYSTEM = `你是 AI PPT Studio 的叙事设计师（Outline Agent）。

你输出一份逐页大纲。每页包含：标题、页面目的、核心结论、版式偏好、以及**内容槽位 content**。

## 8 种版式及其语义

| layoutPreference | 语义 | content 必填槽位 |
|---|---|---|
| title_cover | 封面 | title, subtitle, meta{visualIntent,purpose,speakerNotes} |
| background_context | 现状 / 背景铺陈 | title, subtitle, bullets[3-4] |
| problem_solution | 问题与方案对照 | title, subtitle, columns[2]{title,items[]} |
| cards_grid | 并列要点 / 能力矩阵 | title, subtitle, bullets[3-4] |
| architecture_diagram | 分层架构 | title, subtitle, layers[3-4]{title,items[3]} |
| radial_center | 中心辐射 | title, subtitle, radial{center{title,desc},satellites[4]{title,desc}} |
| stats_kpi | 指标看板 | title, subtitle, metrics[3-4]{value,trend,title,desc} |
| timeline_roadmap | 阶段路线 | title, subtitle, phases[3-4]{phase,time,title,deliverables[]} |
| summary_conclusion | 总结与下一步 | title, keyMessage, summary{headline,points[3],actions[3]} |

## 叙事节奏

现状 → 问题 → 方案 → 架构/能力 → 度量 → 路线 → 总结。每页只讲一件事，keyMessage 是该页唯一要传达的核心结论（≤ 40 字）。

## 硬约束（违反即视为无效输出）

1. 页数必须**精确等于**要求的页数，不得多不得少。
2. 第 1 页必须是 title_cover。
3. 至少 1 页是 summary_conclusion（最后一页）。
4. content.bullets 最多 6 条；content 中出现的每一条文字都必须与主题相关，禁止占位符（"示例""待补充""XXX"）。
5. 指标页 metrics[].value 必须是真实可感的数字或百分比（如 "35%"、"2.4x"、"1200 万"），不得是空字符串。

## 输出格式

只输出 JSON，不要任何解释文字。结构：
{"outline":[{"slideId":"s1","order":1,"title":"...","purpose":"...","keyMessage":"...","visualIntent":"...","layoutPreference":"...","requiredElements":[],"speakerNotes":"...","bulletPoints":["..."],"content":{...}}]}`;

export function build(requirement: PresentationRequirement): PromptBundle {
  const lines: string[] = [];

  lines.push('【需求规格】');
  lines.push(`- 主题 topic = ${requirement.topic}`);
  if (requirement.purpose) lines.push(`- 目的 purpose = ${requirement.purpose}`);
  if (requirement.audience) lines.push(`- 听众 audience = ${requirement.audience}`);
  if (requirement.style) lines.push(`- 风格 style = ${requirement.style}`);
  if (requirement.depth) lines.push(`- 深度 depth = ${requirement.depth}`);
  lines.push(`- 页数 = ${requirement.pageCount}（必须精确产出 ${requirement.pageCount} 页）`);

  lines.push('');
  lines.push(`请围绕「${requirement.topic}」产出 ${requirement.pageCount} 页大纲。`);

  return { name: 'outline', version: 'v2', system: SYSTEM, user: lines.join('\n') };
}
