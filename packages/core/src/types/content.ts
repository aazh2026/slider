/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SlideContent —— 排版槽位契约（docs/backend-design.md §4.2）
 * ---------------------------------------------------------------------------
 * IR 三层管线里，LLM 允许产出 Layer 1（需求）/ Layer 2（叙事 + 槽位），
 * **绝不允许产出 Layer 3（几何 + 样式）**。SlideContent 就是 Layer 2 的那一半：
 * 它描述「这一页要讲什么」，由确定性版式引擎翻译成「这一页长什么样」。
 *
 * 槽位与版式的对应关系写在 `engine/contentBinding.ts`。
 */

/** 内容槽位 —— 每个字段都对应一个可排版的内容位置 */
export interface SlideContent {
  /** 主标题（覆盖 outline.title 的排版化版本） */
  title?: string;
  /** 副标题 / 一句话结论 */
  subtitle?: string;
  /** 核心结论（对应 keymsg_ 元素） */
  keyMessage?: string;
  /** 通用要点，3-5 条。cards_grid / summary 直接消费 */
  bullets: string[];

  /** problem_solution：左右两栏 */
  columns?: Array<{ title: string; items: string[] }>;

  /** architecture_diagram：分层架构 */
  layers?: Array<{ title: string; items: string[] }>;

  /** timeline_roadmap：阶段 */
  phases?: Array<{ phase: string; time: string; title: string; deliverables: string[] }>;

  /** stats_kpi：指标卡 */
  metrics?: Array<{ value: string; trend: string; title: string; desc: string }>;

  /** radial_center：中心节点 + 卫星节点 */
  radial?: {
    center: { title: string; desc: string };
    satellites: Array<{ title: string; desc: string }>;
  };

  /** summary_conclusion：总结要点 + 行动计划 */
  summary?: { headline: string; points: string[]; actions: string[] };

  /** title_cover：封面元信息 */
  meta?: Record<string, string>;
}
