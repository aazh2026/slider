/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 版式意图 —— 版式 → 内容槽位契约
 * ---------------------------------------------------------------------------
 * 这份文件回答两个问题：
 *
 *   1. **这个版式讲什么** —— `LAYOUT_VISUAL_INTENT` 给出页眉 kicker 上的
 *      语义标签（不是版式的机器代号 —— 早期实现把 `CARDS_GRID` 直接印到了
 *      版面上）。
 *   2. **这个版式要哪些内容槽位** —— `LAYOUT_SLOT_CONTRACTS`。这是波 2 ③
 *      的落点：内容槽位与版式的对应关系以前是 `contentBinding.ts` 里一个
 *      `switch` 的副产品，**没有表格、不能查、不能测**。于是「AI 给了
 *      layers，但版式是 cards_grid」这种不匹配既不会被发现，也不会被报告
 *      —— 那些 layers 会被原样带进 `SlideContent`，一路带到渲染层。
 *
 * 契约表把三件事变成**数据**：
 *
 *   · `consumes`   —— 这个版式消费哪些槽位。**不在表里的槽位不进这一页。**
 *   · `requires`   —— 槽位的最低要求（几个条目、条目里要有什么）。
 *   · `produces`   —— 这个版式会产出哪些元素变体（版式 → 槽位 → 元素的
 *                    中间层，让「这页为什么长这样」可查、可测）。
 *
 * 表是**唯一真相源**：`contentBinding` 按表绑定，`LayoutEngine` 按表降级，
 * 测试按表断言。三处各写一份就是波 0 修掉的那个病 —— 三份实现、三种行为。
 */

import type { ElementVariant, SlideLayoutType } from '../types/slide';

/**
 * 内容槽位键 —— 与 `SlideContent` 的字段一一对应
 * ---------------------------------------------------------------------------
 * 通用槽位（title / subtitle / keyMessage / bullets）任何版式都能用；
 * 专属槽位（layers / columns / phases / metrics / radial / summary / meta）
 * 只有对应的版式消费。
 */
export type ContentSlotKey =
  | 'title'
  | 'subtitle'
  | 'keyMessage'
  | 'bullets'
  | 'columns'
  | 'layers'
  | 'phases'
  | 'metrics'
  | 'radial'
  | 'summary'
  | 'meta';

/** 一个槽位的最低要求 */
export interface SlotRequirement {
  /** 槽位 */
  slot: ContentSlotKey;
  /** 最少条目数（0 = 不要求） */
  min: number;
  /**
   * 条目里至少要有一个「像样」的值 —— 用正则判定。
   *
   * 存在的理由：`stats_kpi` 的槽位是「指标」，但 AI 可能给出
   * `{value: '', title: '增长很快'}` —— 条目数够了，指标却是空的。
   * 「有 4 个指标」和「有 4 个带数字的指标」不是一回事。
   */
  pattern?: RegExp;
}

/** 版式 → 槽位契约 */
export interface LayoutSlotContract {
  /** 版式 */
  layout: SlideLayoutType;
  /** 这个版式消费的槽位 —— 不在表里的槽位不进这一页 */
  consumes: ContentSlotKey[];
  /** 专属槽位缺内容时，从这些通用槽位推导 */
  fallbackFrom: ContentSlotKey[];
  /** 槽位的最低要求 */
  requires: SlotRequirement[];
  /** 这个版式会产出的元素变体（可能产出，不是必然产出） */
  produces: ElementVariant[];
  /** 这个版式**必须**产出的元素变体（核心槽位，少了就是版式没生效） */
  requiresVariants: ElementVariant[];
  /** 专属槽位不满足要求时降级到的版式 */
  degradesTo?: SlideLayoutType;
}

/**
 * 母版槽位 —— 所有非封面版式都会产出
 * ---------------------------------------------------------------------------
 * 单独列出来是因为它们与版式无关：封面不产出页眉/页码/页脚，
 * 其余七种版式都产出。
 */
const MASTER_VARIANTS: ElementVariant[] = ['header', 'pagenum', 'footernote'];

/** 非封面版式的公共部分 —— 母版槽位 + 页面标题 + 核心结论 */
const NON_COVER_VARIANTS: ElementVariant[] = ['background', ...MASTER_VARIANTS, 'title', 'keymsg'];

/**
 * 版式 → 槽位契约表
 * ---------------------------------------------------------------------------
 * **每一行都必须有** —— 少一行就是一处「这个版式要什么」���隐式约定。
 */
export const LAYOUT_SLOT_CONTRACTS: Record<SlideLayoutType, LayoutSlotContract> = {
  title_cover: {
    layout: 'title_cover',
    consumes: ['title', 'subtitle', 'keyMessage', 'bullets', 'meta'],
    fallbackFrom: ['bullets'],
    requires: [],
    produces: ['background', 'kicker', 'maintitle', 'subtitle', 'accent_line', 'metacard'],
    requiresVariants: ['kicker', 'maintitle', 'accent_line', 'metacard'],
  },

  architecture_diagram: {
    layout: 'architecture_diagram',
    consumes: ['title', 'subtitle', 'keyMessage', 'bullets', 'layers'],
    fallbackFrom: ['bullets'],
    requires: [{ slot: 'layers', min: 1 }],
    produces: [...NON_COVER_VARIANTS, 'layer_box', 'layer_title', 'layer_body'],
    requiresVariants: ['layer_box', 'layer_title'],
  },

  cards_grid: {
    layout: 'cards_grid',
    consumes: ['title', 'subtitle', 'keyMessage', 'bullets'],
    fallbackFrom: ['bullets'],
    requires: [],
    produces: [...NON_COVER_VARIANTS, 'grid_card'],
    requiresVariants: ['grid_card'],
  },

  problem_solution: {
    layout: 'problem_solution',
    consumes: ['title', 'subtitle', 'keyMessage', 'bullets', 'columns'],
    fallbackFrom: ['bullets'],
    requires: [{ slot: 'columns', min: 2 }],
    produces: [...NON_COVER_VARIANTS, 'problem_box', 'solution_box'],
    requiresVariants: ['problem_box', 'solution_box'],
  },

  timeline_roadmap: {
    layout: 'timeline_roadmap',
    consumes: ['title', 'subtitle', 'keyMessage', 'bullets', 'phases'],
    fallbackFrom: ['bullets'],
    requires: [{ slot: 'phases', min: 1 }],
    produces: [...NON_COVER_VARIANTS, 'timeline_bar', 'timeline_node', 'timeline_card'],
    requiresVariants: ['timeline_bar', 'timeline_node', 'timeline_card'],
  },

  stats_kpi: {
    layout: 'stats_kpi',
    consumes: ['title', 'subtitle', 'keyMessage', 'bullets', 'metrics'],
    fallbackFrom: ['bullets'],
    // 指标必须带数字 —— 没有数字的「指标」不是指标，这一页也没有指标版式可言
    requires: [{ slot: 'metrics', min: 1, pattern: /\d/ }],
    produces: [...NON_COVER_VARIANTS, 'kpi_card'],
    requiresVariants: ['kpi_card'],
    // 整页没有数字时降级为 cards_grid（版式引擎唯一的一条降级规则）
    degradesTo: 'cards_grid',
  },

  radial_center: {
    layout: 'radial_center',
    consumes: ['title', 'subtitle', 'keyMessage', 'bullets', 'radial'],
    fallbackFrom: ['bullets'],
    requires: [{ slot: 'radial', min: 1 }],
    produces: [...NON_COVER_VARIANTS, 'radial_center_node', 'radial_sat'],
    requiresVariants: ['radial_center_node'],
  },

  summary_conclusion: {
    layout: 'summary_conclusion',
    consumes: ['title', 'subtitle', 'keyMessage', 'bullets', 'summary'],
    fallbackFrom: ['bullets'],
    requires: [{ slot: 'summary', min: 1 }],
    produces: [...NON_COVER_VARIANTS, 'summary_main_card'],
    requiresVariants: ['summary_main_card'],
  },
};

/** 取某个版式的槽位契约；未知版式回落到 cards_grid（最通用的一种） */
export function slotContractOf(layout: SlideLayoutType | undefined): LayoutSlotContract {
  if (!layout) return LAYOUT_SLOT_CONTRACTS.cards_grid;
  return LAYOUT_SLOT_CONTRACTS[layout] ?? LAYOUT_SLOT_CONTRACTS.cards_grid;
}

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
