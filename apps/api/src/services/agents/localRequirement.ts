/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 本地确定性需求解析 —— Requirement Agent 的降级实现
 * ---------------------------------------------------------------------------
 * docs/backend-design.md §6.2：
 *   > 降级：确定性解析（正则抽取页数/受众关键词）+ 现有 fallback。
 *
 * 与旧实现的区别：旧 fallback **对所有主题返回同一份**「企业 AI Agent 技术架构规划」。
 * 这里的主题词从用户输入中抽取（`parseTopic`），不是写死的。
 */

import type { PresentationRequirement } from '@ppt/core';

import { parseTopic } from './topicTerms';

export interface LocalRequirementContext {
  prompt: string;
  documentText?: string;
  audience?: string;
  purpose?: string;
  pageCount?: number;
  style?: string;
  depth?: string;
}

/** 从文本里抽页数：「12 页」「12页」「做 12 页 PPT」「8 张」 */
export function extractPageCount(text: string): number | undefined {
  const m =
    text.match(/(\d{1,2})\s*(?:页|张|slides?|pages?)/i) ??
    text.match(/(?:共|大约|约)?\s*(\d{1,2})\s*(?:页|张)/);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1 || n > 50) return undefined;
  return n;
}

/** 从文本里抽听众关键词 */
export function extractAudience(text: string): string | undefined {
  const patterns = [
    /面向\s*([^，。；\n]{2,20}?)(?:，|。|；|$)/,
    /受众(?:是|为|：)?\s*([^，。；\n]{2,20}?)(?:，|。|；|$)/,
    /给\s*([^，。；\n]{2,20}?)\s*(?:讲|汇报|看)/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const v = m[1].trim();
      if (v.length >= 2) return v;
    }
  }
  return undefined;
}

/** 从文本里抽风格关键词 */
export function extractStyle(text: string): string | undefined {
  const vocab = ['科技感', '专业', '简约', '商务', '学术', '活泼', '稳重', '极简', '科技', '现代', '简洁', '克制'];
  const hit = vocab.filter((w) => text.includes(w));
  if (hit.length > 0) return hit.join('、');
  const m = text.match(/(?:风格|调性)(?:是|为|：)?\s*([^，。；\n]{2,20})/);
  return m?.[1]?.trim();
}

/* -------------------------------------------------------------------------- */
/* 主题抽取                                                                     */
/* -------------------------------------------------------------------------- */

/** 请求外壳：「帮我做一个关于…的汇报」 */
const REQUEST_PREFIX =
  /^(请|帮我|帮忙|麻烦|替我|我要|我想|我需要|需要|给我)?\s*(做|写|生成|制作|创建|设计|出|弄|整|来|讲|聊|介绍|讲解|分析)(一)?(个|份|套|篇|张|版|下|个)?\s*/;

/** 纯元信息分句（页数 / 受众 / 风格 / 用途）—— 不属于主题 */
const META_CLAUSE =
  /^\d+\s*(页|张|slides?|pages?)|面向|受众|听众|风格|调性|用途|用于|场合|时长|预算|语言|色调|色系/;

/**
 * 从自由文本里抽出主题短语。
 * ---------------------------------------------------------------------------
 * 「做一个关于新能源汽车电池回收体系的汇报，10页，面向投资人」
 *   → 「新能源汽车电池回收体系」
 *
 * 只做确定性的外壳剥离，不猜测、不改写用户的词。
 */
export function extractTopic(prompt: string): string {
  let text = (prompt ?? '').trim();
  if (!text) return '';

  // 1) 剥掉请求外壳
  let prev = '';
  while (prev !== text) {
    prev = text;
    text = text.replace(REQUEST_PREFIX, '').trim();
  }

  // 2) 「关于X的Y」→ X
  const about = text.match(/关于\s*([^，,。；;]{2,60}?)\s*(?:的[^，,。；;]{0,24})?(?=[，,。；;]|$)/);
  if (about?.[1]) {
    text = about[1].trim();
  }

  // 2b) 「主题是X」→ X
  const subjectIs = text.match(/(?:主题|题目|内容|议题)\s*(?:是|为|：|:)\s*([^，,。；;]{2,60})/);
  if (subjectIs?.[1]) {
    text = subjectIs[1].trim();
  }

  // 3) 去掉纯元信息分句，剩下的第一个分句就是主题
  const clauses = text
    .split(/[，,。；;！!？?\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const meaningful = clauses.filter((s) => !META_CLAUSE.test(s));
  const picked = (meaningful.length > 0 ? meaningful : clauses)[0] ?? '';

  // 4) 去掉尾部残留的「的汇报 / 的方案 / 的报告」等壳
  const cleaned = picked.replace(/的(?:汇报|报告|方案|计划|PPT|ppt|演示文稿|材料|内容)$/u, '').trim();

  return cleaned || picked || text;
}

/** 本地确定性需求解析 */
export function generateLocalRequirement(ctx: LocalRequirementContext): PresentationRequirement {
  const topicText = extractTopic(ctx.prompt) || parseTopic(ctx.documentText ?? '').topic || '未命名主题';
  const terms = parseTopic(topicText);

  const pageCount =
    ctx.pageCount ??
    extractPageCount(ctx.prompt) ??
    extractPageCount(ctx.documentText ?? '') ??
    6;

  const audience =
    ctx.audience?.trim() ||
    extractAudience(ctx.prompt) ||
    extractAudience(ctx.documentText ?? '') ||
    '管理层与核心干系人';

  const purpose =
    ctx.purpose?.trim() ||
    `围绕${terms.subject}达成共识并明确后续行动`;

  const style =
    ctx.style?.trim() ||
    extractStyle(ctx.prompt) ||
    extractStyle(ctx.documentText ?? '') ||
    '专业、克制、结构清晰';

  const depth =
    ctx.depth?.trim() ||
    (ctx.documentText && ctx.documentText.trim().length > 400
      ? '深入：结合参考资料展开，含论据与细节'
      : '标准：结论先行，论据支撑');

  return {
    topic: terms.topic || '未命名主题',
    purpose,
    audience,
    pageCount,
    style,
    depth,
    aspectRatio: '16:9',
    rawNotes: ctx.documentText ? ctx.documentText.slice(0, 2000) : undefined,
  };
}
