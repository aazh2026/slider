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
