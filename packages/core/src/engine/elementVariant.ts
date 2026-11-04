/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 元素变体（variant）的规格表与读取入口
 * ---------------------------------------------------------------------------
 * **语义住在字段里，不住在 ID 字符串里**（ADR-018）。
 *
 * 过去三处语义判断都在猜 ID：
 *
 *   · `svgRenderer`   `el.id.startsWith('header_')` → 走模板层还是内容层
 *   · 前端主题重映射  `el.id.includes('accent')`     → 颜色跟不跟 accent 色
 *   · 质量引擎 ID 修复 `semanticPrefix(id, …)`      → 从 ID 里抠语义前缀
 *
 * 「字符串即语义」意味着任何一次重命名都是事故 —— 波 0 的 ADR-014 就是被它
 * 坑的：一键修复把 `header_s1` 洗成 `text_s1_1`，元素当场掉出模板层，
 * 换模板时不再跟随 accent 色。
 *
 * 这里把变体的**全部语义收进一张表**（`ELEMENT_VARIANTS`）：层归属、是否跟随
 * accent 色、ID 语义前缀。渲染层、主题重映射、ID 修复一律**读表**，不再猜。
 *
 * `variantOf()` 的回退链（字段 → legacy ID 前缀 → role 兜底）是**唯一**一处
 * 还碰 ID 字符串的地方，且只在字段缺失时触发 —— 那是**兼容层**，不是语义依赖。
 */

import type { ElementRole, ElementVariant, SlideElement, SlideIR } from '../types/slide';

/** 元素在 SVG 里的层归属 */
export type ElementLayer = 'background' | 'template' | 'content';

/** 一个变体的全部语义 */
export interface ElementVariantSpec {
  /** ID 的语义前缀 —— ID 修复重命名时用它，绝不用元素类型洗 */
  idPrefix: string;
  /** SVG 层归属 */
  layer: ElementLayer;
  /** 颜色是否跟随主题的 accent 色 */
  followsAccent: boolean;
}

/**
 * 变体规格表
 * ---------------------------------------------------------------------------
 * 顺序即查表顺序，与语义无关。**每一行都必须有** —— 少一行就是一处
 * 「这里该怎么办」的隐式约定，那正是本 ADR 要消灭的东西。
 */
export const ELEMENT_VARIANTS: Record<ElementVariant, ElementVariantSpec> = {
  // ---- 通用桶 ----
  background: { idPrefix: 'bg', layer: 'background', followsAccent: false },
  title: { idPrefix: 'title', layer: 'content', followsAccent: false },
  subtitle: { idPrefix: 'subtitle', layer: 'content', followsAccent: false },
  footer: { idPrefix: 'footer', layer: 'template', followsAccent: false },
  card: { idPrefix: 'card', layer: 'content', followsAccent: false },
  metric: { idPrefix: 'metric', layer: 'content', followsAccent: false },
  badge: { idPrefix: 'badge', layer: 'content', followsAccent: true },
  divider: { idPrefix: 'divider', layer: 'content', followsAccent: false },
  layer: { idPrefix: 'layer', layer: 'content', followsAccent: false },
  connector: { idPrefix: 'connector', layer: 'content', followsAccent: false },
  chart: { idPrefix: 'chart', layer: 'content', followsAccent: false },
  icon: { idPrefix: 'icon', layer: 'content', followsAccent: false },
  annotation: { idPrefix: 'annotation', layer: 'content', followsAccent: false },

  // ---- 母版槽位（非封面页）----
  header: { idPrefix: 'header', layer: 'template', followsAccent: true },
  keymsg: { idPrefix: 'keymsg', layer: 'content', followsAccent: false },
  pagenum: { idPrefix: 'pagenum', layer: 'template', followsAccent: false },
  footernote: { idPrefix: 'footernote', layer: 'template', followsAccent: false },

  // ---- 封面槽位----
  kicker: { idPrefix: 'kicker', layer: 'content', followsAccent: true },
  maintitle: { idPrefix: 'maintitle', layer: 'content', followsAccent: false },
  accent_line: { idPrefix: 'accent_line', layer: 'content', followsAccent: true },
  metacard: { idPrefix: 'metacard', layer: 'content', followsAccent: false },

  // ---- 版式专属槽位----
  layer_box: { idPrefix: 'layer_box', layer: 'content', followsAccent: false },
  layer_title: { idPrefix: 'layer_title', layer: 'content', followsAccent: false },
  layer_body: { idPrefix: 'layer_body', layer: 'content', followsAccent: false },
  grid_card: { idPrefix: 'grid_card', layer: 'content', followsAccent: false },
  problem_box: { idPrefix: 'problem_box', layer: 'content', followsAccent: false },
  solution_box: { idPrefix: 'solution_box', layer: 'content', followsAccent: false },
  timeline_bar: { idPrefix: 'timeline_bar', layer: 'content', followsAccent: false },
  timeline_node: { idPrefix: 'timeline_node', layer: 'content', followsAccent: false },
  timeline_card: { idPrefix: 'timeline_card', layer: 'content', followsAccent: false },
  kpi_card: { idPrefix: 'kpi_card', layer: 'content', followsAccent: false },
  radial_center_node: { idPrefix: 'radial_center_node', layer: 'content', followsAccent: false },
  radial_sat: { idPrefix: 'radial_sat', layer: 'content', followsAccent: false },
  summary_main_card: { idPrefix: 'summary_main_card', layer: 'content', followsAccent: false },
};

/** 全部变体（顺序稳定，供文档与测试引用） */
export const ALL_ELEMENT_VARIANTS: readonly ElementVariant[] = Object.keys(
  ELEMENT_VARIANTS
) as ElementVariant[];

/**
 * 老数据的 ID 前缀 → 变体
 * ---------------------------------------------------------------------------
 * **兼容层**：只给「没有 variant 字段的已存 IR」用。旧 ID 形如
 * `{前缀}_{slideId}` 或 `{前缀}_{slideId}_{序号}`，前缀可能自带下划线
 * （`layer_box` / `summary_main_card` …），所以匹配的是
 * **`前缀 + '_'`** 而不是裸前缀 —— 否则 `maintitle_s1` 会被 `title` 命中。
 */
const LEGACY_VARIANT_BY_PREFIX: ReadonlyArray<readonly [string, ElementVariant]> = (
  Object.entries(ELEMENT_VARIANTS) as Array<[ElementVariant, ElementVariantSpec]>
)
  .map(([variant, spec]) => [spec.idPrefix, variant] as const)
  // 长前缀优先 —— 「前缀 + '_'」已经能区分大多数情况，长优先只是兜底
  .sort((a, b) => b[0].length - a[0].length);

/**
 * 从旧 ID 猜变体 —— **全仓唯一一处解析 ID 语义的地方**
 * ---------------------------------------------------------------------------
 * 猜不到就返回 `null`（交给 role 兜底），**不返回错的答案**。
 */
export function legacyVariantOf(id: string): ElementVariant | null {
  for (const [prefix, variant] of LEGACY_VARIANT_BY_PREFIX) {
    if (id.startsWith(`${prefix}_`)) return variant;
  }
  return null;
}

/** role → 通用桶（老数据猜不出槽位时的兜底） */
const VARIANT_BY_ROLE: Record<ElementRole, ElementVariant> = {
  background: 'background',
  title: 'title',
  subtitle: 'subtitle',
  footer: 'footer',
  card: 'card',
  metric: 'metric',
  badge: 'badge',
  divider: 'divider',
  layer: 'layer',
  connector: 'connector',
  chart: 'chart',
  icon: 'icon',
  annotation: 'annotation',
};

/**
 * 读一个元素的变体
 * ---------------------------------------------------------------------------
 * 回退链：**字段 → legacy ID 前缀 → role 兜底**。
 *
 * 字段在时**绝不**去看 ID —— 这是本 ADR 的全部意义。
 */
export function variantOf(el: SlideElement): ElementVariant {
  if (el.variant && ELEMENT_VARIANTS[el.variant]) return el.variant;
  const legacy = legacyVariantOf(el.id);
  if (legacy) return legacy;
  return VARIANT_BY_ROLE[el.role] ?? 'card';
}

/** 这个元素走 SVG 的哪一层 */
export function layerOf(el: SlideElement): ElementLayer {
  return ELEMENT_VARIANTS[variantOf(el)].layer;
}

/** 这个元素的颜色是否跟随主题 accent 色 */
export function followsAccentColor(el: SlideElement): boolean {
  return ELEMENT_VARIANTS[variantOf(el)].followsAccent;
}

/** 这个元素重命名时的语义前缀（绝不洗成元素类型） */
export function idPrefixOf(el: SlideElement): string {
  return ELEMENT_VARIANTS[variantOf(el)].idPrefix;
}

/**
 * 迁移：给一页里所有缺 `variant` 的元素补上
 * ---------------------------------------------------------------------------
 * **幂等**：已有 variant 的元素原样保留。返回新对象，不改入参。
 *
 * 这是**一次性迁移**的入口 —— 已存的旧 IR 在读出来的时候过一遍，
 * 之后的链路全程读字段，不再碰 ID。
 */
export function withVariants(slide: SlideIR): SlideIR {
  let changed = false;
  const elements = slide.elements.map((el) => {
    if (el.variant && ELEMENT_VARIANTS[el.variant]) return el;
    changed = true;
    return { ...el, variant: variantOf(el) };
  });
  return changed ? { ...slide, elements } : slide;
}
