/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 质量规则表 —— **扣分幅度的唯一真相源**
 * ---------------------------------------------------------------------------
 * 以前扣分幅度直接写死在 `qualityEngine.ts` 的 `totalXxxPenalties += 15`
 * 里，于是「画布不对扣 15 分」这件事唯一的依据就是「代码里写的是 15」。
 * 判据因此只能自证（oracle tier = `self-derived`），文档与实现谁对谁错
 * 没人说得清 —— 这正是 M1（判据外部化率）卡在 91.8% 的原因。
 *
 * 现在规则表是**数据**，评分器退化成它的解释器：
 *   · 表里的每一行都必须在 `docs/quality-rules.md` 里有对应说明；
 *   · `spec/verify/quality-rules.test.ts` 逐条比对表与文档，漂了就红；
 *   · 于是「扣 15 分」的依据从「代码这么说」变成「规则表这么写」——
 *     而规则表是**文档**，`authoritative`。
 *
 * 规则的 `id` 同时是**诊断 id 的前缀**（`struct_dim_${slideId}`、
 * `vis_bounds_${el.id}` …），保证「诊断」与「规则」一一对应。
 */

/** 质量维度 —— 与四维分一一对应 */
export type QualityDimension = 'structure' | 'visual' | 'content' | 'consistency';

export interface QualityRule {
  /** 规则族 id —— 也是诊断 id 的前缀 */
  id: string;
  /** 归入哪个维度 */
  dimension: QualityDimension;
  /** 每一次违例扣多少分 */
  penalty: number;
  /**
   * 能不能被「一键修复」自动处理
   * ---------------------------------------------------------------------------
   * 只有真做了自动修复的规则才为 true（ADR-014）。`fixAction` 是给人看的
   * 建议，不是「点一下就能修」的承诺。
   */
  fixable: boolean;
  /** 一句话说明这条规则在管什么 */
  description: string;
  /** 依据出处 —— 指向 `docs/quality-rules.md` 里的对应小节 */
  basis: string;
}

/**
 * 规则表
 * ---------------------------------------------------------------------------
 * 顺序即维度顺序（结构 → 视觉 → 内容 → 一致性），便于人读，也便于
 * `docs/quality-rules.md` 的表格与它逐行对齐。
 */
export const QUALITY_RULES: readonly QualityRule[] = [
  {
    id: 'struct_dim',
    dimension: 'structure',
    penalty: 15,
    fixable: true,
    description: '画布尺寸必须是 1920×1080',
    basis: 'docs/quality-rules.md#struct_dim',
  },
  {
    id: 'struct_id',
    dimension: 'structure',
    penalty: 5,
    fixable: true,
    description: '元素 ID 全局唯一',
    basis: 'docs/quality-rules.md#struct_id',
  },
  {
    id: 'vis_bounds',
    dimension: 'visual',
    penalty: 10,
    fixable: true,
    description: '元素不得越出画布边界',
    basis: 'docs/quality-rules.md#vis_bounds',
  },
  {
    id: 'vis_collide',
    dimension: 'visual',
    penalty: 8,
    fixable: false,
    description: '卡片 / 层之间不得 AABB 碰撞（10px 安全距）',
    basis: 'docs/quality-rules.md#vis_collide',
  },
  {
    id: 'vis_sparse',
    dimension: 'visual',
    penalty: 8,
    fixable: false,
    description: '承载信息的内容不得只盖住内容安全区面积的 20% 以下',
    basis: 'docs/quality-rules.md#vis_sparse',
  },
  {
    id: 'content_title',
    dimension: 'content',
    penalty: 15,
    fixable: false,
    description: '每页必须有明确的标题概括（≥ 3 字符）',
    basis: 'docs/quality-rules.md#content_title',
  },
  {
    id: 'content_keymsg',
    dimension: 'content',
    penalty: 8,
    fixable: false,
    description: '非封面页必须有一句话核心结论',
    basis: 'docs/quality-rules.md#content_keymsg',
  },
  {
    id: 'content_thin',
    dimension: 'content',
    penalty: 8,
    fixable: false,
    description: '非封面页必须至少有一个实质内容件（卡片 / 层 / 指标 …）',
    basis: 'docs/quality-rules.md#content_thin',
  },
  {
    id: 'content_dup',
    dimension: 'content',
    penalty: 10,
    fixable: false,
    description: '不同页的核心结论不得重复',
    basis: 'docs/quality-rules.md#content_dup',
  },
  {
    id: 'consist_count',
    dimension: 'consistency',
    penalty: 15,
    fixable: false,
    description: '整份文稿至少 3 页',
    basis: 'docs/quality-rules.md#consist_count',
  },
  {
    id: 'consist_cover',
    dimension: 'consistency',
    penalty: 10,
    fixable: false,
    description: '整份文稿必须有一页封面',
    basis: 'docs/quality-rules.md#consist_cover',
  },
];

/** 规则 id → 规则 */
const RULE_INDEX: ReadonlyMap<string, QualityRule> = new Map(
  QUALITY_RULES.map((r) => [r.id, r])
);

/**
 * 取一条规则
 * @throws 规则不存在时抛错 —— 规则 id 写错必须是**开发期崩溃**，
 *         不能悄悄退化成「扣 0 分」或「扣 10 分」。
 */
export function ruleById(id: string): QualityRule {
  const rule = RULE_INDEX.get(id);
  if (!rule) throw new Error(`未知质量规则：${id}`);
  return rule;
}

/** 规则的扣分幅度 */
export function penaltyOf(id: string): number {
  return ruleById(id).penalty;
}

/** 规则能不能被自动修复 */
export function fixableOf(id: string): boolean {
  return ruleById(id).fixable;
}

/** 某个维度下的全部规则 */
export function rulesOfDimension(dimension: QualityDimension): QualityRule[] {
  return QUALITY_RULES.filter((r) => r.dimension === dimension);
}
