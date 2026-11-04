/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 设计画布 → 幻灯片的排版常量
 * ---------------------------------------------------------------------------
 * 设计画布固定 1920×1080（`svgRenderer` 的 viewBox），PPTX 幻灯片固定 16:9
 * = 13.333in × 7.5in = 12192000 × 6858000 EMU。
 *
 * 于是：
 *
 *   1 设计 px = 12192000 / 1920 = **6350 EMU = 0.5pt**（1pt = 12700 EMU）
 *
 * 字号**必须**乘这个系数。把设计 px 当成 pt 直接用，字会大出一倍 ——
 * 那不是风格差异，是同一个 IR 导出了两种样子（预览 vs PPTX 对不上）。
 */

/** 设计画布宽（px） */
export const DESIGN_CANVAS_WIDTH = 1920;

/** 设计画布高（px） */
export const DESIGN_CANVAS_HEIGHT = 1080;

/** 幻灯片宽（EMU）—— 13.333in */
export const SLIDE_WIDTH_EMU = 12_192_000;

/** 幻灯片高（EMU）—— 7.5in */
export const SLIDE_HEIGHT_EMU = 6_858_000;

/** 1 英寸 = 914400 EMU */
export const EMU_PER_INCH = 914_400;

/** 1 磅 = 12700 EMU */
export const EMU_PER_POINT = 12_700;

/** 1 设计 px = 多少 EMU（= 6350） */
export const DESIGN_PX_TO_EMU = SLIDE_WIDTH_EMU / DESIGN_CANVAS_WIDTH;

/** 1 设计 px = 多少磅（= 0.5） */
export const DESIGN_PX_TO_PT = DESIGN_PX_TO_EMU / EMU_PER_POINT;

/**
 * 结构化 content 的字号表（设计 px）
 * ---------------------------------------------------------------------------
 * SVG 渲染与 PPTX 导出**共用这一份**。
 *
 * 曾经两边各写各的：SVG 记 58、导出记 32（指标值），差了近一半 ——
 * 导出出来的 PPT 和预览根本不是一张图。字号只在这里定义一次，
 * 改版式时两边一起变。
 */
export const CONTENT_TYPE_SCALE = {
  /** 纯字符串正文 */
  plain: 15,

  /** 时间轴：阶段号 */
  phase: 12,
  /** 时间轴：时间 */
  time: 12,
  /** 时间轴：阶段标题 */
  phaseTitle: 18,
  /** 时间轴：交付项 */
  deliverable: 14,

  /** 总结卡：主标题 */
  headline: 24,
  /** 总结卡：要点 */
  point: 16,

  /** 指标卡：数值 */
  value: 58,
  /** 指标卡：趋势 */
  trend: 13,
  /** 指标卡：标题 */
  metricTitle: 20,
  /** 指标卡：描述 */
  metricDesc: 15,

  /** 列表卡：标题 */
  itemsTitle: 22,
  /** 列表卡：条目 */
  item: 15,

  /** 通用卡：标签 */
  tag: 12,
  /** 通用卡：标题 */
  cardTitle: 20,
  /** 通用卡：描述 */
  cardDesc: 15,

  /** 兜底正文 */
  fallback: 15,
} as const;

/**
 * 字体 fallback 链
 * ---------------------------------------------------------------------------
 * EXP-06 要求「字体名 fallback 链保证中英混排」，但从未给出链的具体内容 ——
 * 这条歧义（AMB-003）在本 ADR/规则落地时被裁决为：
 *
 *   · **SVG（浏览器渲染）**：CSS 字体栈，主题的拉丁字体在前，**显式命名的
 *     CJK 字体族**居中，generic 兜底在后。CJK 族必须**排在 generic 之前** ——
 *     `sans-serif` 在多数系统上确实能显示中文，但那是「操作系统挑的」，
 *     不同机器挑的还不一样；显式命名才让同一份 SVG 在哪台机器上都长一样。
 *   · **PPTX（Office 渲染）**：**只有一个字体名**。DrawingML 没有 fallback 链，
 *     只能选一个同时覆盖中英的字体 —— `Microsoft YaHei` 在 Windows/Office 上
 *     最通用（PPTX 的主战场），且覆盖拉丁字母。
 *
 * 链本身写在**这里**（排版常量的单一真相源），SVG 渲染与 PPTX 导出共用 ——
 * 以前两边各写各的，SVG 里根本没有 CJK 字体，导出里写死一个名字却没说明
 * 为什么是它。
 */

/** CJK 字体族 —— 按「最可能装得上」排序 */
export const CJK_FALLBACK_FAMILIES: readonly string[] = [
  "'Microsoft YaHei'",
  "'PingFang SC'",
  "'Noto Sans CJK SC'",
  "'Source Han Sans SC'",
];

/** PPTX 字体名 —— PPTX 没有 fallback 链，只能单名 */
export const PPTX_FONT_NAME = 'Microsoft YaHei';

/** CSS 通用族 —— CJK 族必须排在它们之前 */
const GENERIC_FAMILIES = new Set([
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'sans-serif',
  'serif',
  'monospace',
  'cursive',
  'fantasy',
]);

/** 去掉引号并转小写，用于比较字体族名 */
function normalizeFamily(family: string): string {
  return family.replace(/['"]/g, '').trim().toLowerCase();
}

/**
 * 给 CSS 字体栈补上 CJK fallback
 * ---------------------------------------------------------------------------
 * 插入位置是**第一个通用族之前** —— 主题字体栈形如
 * `'Manrope, system-ui, sans-serif'`，补完变成
 * `'Manrope', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', system-ui, sans-serif`：
 * 拉丁字形走主题字体，中文字形走第一个装得上的 CJK 族，都装不上才落到 generic。
 *
 * 已经含 CJK 族时原样返回（幂等）—— 主题自己写好了就不插手。
 */
export function withCjkFallback(stack: string): string {
  const parts = stack
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return CJK_FALLBACK_FAMILIES.join(', ');

  const hasCjk = parts.some((p) =>
    CJK_FALLBACK_FAMILIES.some((c) => normalizeFamily(c) === normalizeFamily(p))
  );
  if (hasCjk) return parts.join(', ');

  const genericIndex = parts.findIndex((p) => GENERIC_FAMILIES.has(normalizeFamily(p)));
  const head = genericIndex === -1 ? parts : parts.slice(0, genericIndex);
  const tail = genericIndex === -1 ? [] : parts.slice(genericIndex);
  return [...head, ...CJK_FALLBACK_FAMILIES, ...tail].join(', ');
}
