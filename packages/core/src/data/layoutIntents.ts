/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SlideLayoutType } from '../types/slide';

/**
 * 版式 → 默认视觉意图
 * ---------------------------------------------------------------------------
 * visualIntent 是渲染到页眉 kicker 上的**语义标签**，不是版式的机器代号。
 *
 * 早期实现把版式枚举名直接塞进 visualIntent，页眉就渲染成
 * 「CARDS_GRID」「PROBLEM_SOLUTION」—— 机器标识符漏到了版面上。
 * 这里给每种版式一个可读的中文标签作为**缺省值**；
 * 具体页面（大纲、AI 生成、用户新建）应当给出更贴切的意图，
 * 缺省值只在拿不到更具体的意图时兜底。
 */
export const LAYOUT_VISUAL_INTENT: Record<SlideLayoutType, string> = {
  title_cover: '汇报主题',
  architecture_diagram: '技术架构',
  cards_grid: '能力矩阵',
  problem_solution: '问题与方案',
  timeline_roadmap: '实施路线',
  stats_kpi: '核心指标',
  radial_center: '核心能力',
  summary_conclusion: '总结与下一步',
};

/** 取某版式的缺省视觉意图；版式未知时回落到「汇报主题」 */
export function defaultVisualIntent(layout: SlideLayoutType | undefined): string {
  if (!layout) return LAYOUT_VISUAL_INTENT.title_cover;
  return LAYOUT_VISUAL_INTENT[layout] ?? LAYOUT_VISUAL_INTENT.title_cover;
}
