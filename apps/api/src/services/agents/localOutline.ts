/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 本地确定性大纲生成 —— Outline Agent 的降级实现
 * ---------------------------------------------------------------------------
 * docs/architecture.md §7.2 的硬约束：
 *
 *   > **降级实现的硬约束**：本地实现必须按 `requirement.topic` **动态生成**，
 *   > 不能像现状那样对所有主题返回同一份"企业 AI Agent 技术架构规划"大纲。
 *
 * 所以这里做的是「在用户主题上做确定性推导」：
 *   主题 → 领域词典 → 叙事阶段 → 版式 + 内容槽位
 * 换成另一个主题，词典、标题、要点、层级、阶段全部随之改变（AC-NFR-003）。
 *
 * **不编造数字**：本地实现无法知道真实指标，因此"度量"页只列**指标口径**，
 * 不编造百分比 —— 编出来的数字会被用户当真实数据讲出去。
 */

import type { SlideContent, SlideLayoutType, SlideOutlineItem } from '@ppt/core';

import { fill, parseTopic, pickLexicon, type Lexicon, type TopicTerms } from './topicTerms';

export interface LocalOutlineContext {
  topic: string;
  purpose?: string;
  audience?: string;
  style?: string;
  depth?: string;
  pageCount: number;
}

/** 叙事阶段 —— 每一阶段对应一个版式与一组槽位 */
type StageKind =
  | 'cover'
  | 'background'
  | 'problem'
  | 'solution'
  | 'architecture'
  | 'capability'
  | 'metric'
  | 'roadmap'
  | 'deep_dive'
  | 'summary';

/**
 * 中间阶段的选择表 —— 阶段数 → 阶段序列
 * ---------------------------------------------------------------------------
 * 叙事骨架固定为「现状 → 问题 → 方案 → 架构 → 度量 → 路线 → 总结」，
 * 页数少时按优先级保留最关键的阶段。
 */
const MIDDLE_PLANS: Record<number, StageKind[]> = {
  1: ['problem'],
  2: ['problem', 'architecture'],
  3: ['problem', 'architecture', 'roadmap'],
  4: ['background', 'problem', 'architecture', 'roadmap'],
  5: ['background', 'problem', 'architecture', 'capability', 'roadmap'],
  6: ['background', 'problem', 'solution', 'architecture', 'capability', 'roadmap'],
  7: [
    'background',
    'problem',
    'solution',
    'architecture',
    'capability',
    'metric',
    'roadmap',
  ],
  8: [
    'background',
    'problem',
    'solution',
    'architecture',
    'capability',
    'metric',
    'roadmap',
    'deep_dive',
  ],
};

function planMiddle(count: number): StageKind[] {
  if (count <= 0) return [];
  if (count <= 8) return [...MIDDLE_PLANS[count]!];
  // 超长演示：在 8 段骨架后追加「深入分析」页
  const base = [...MIDDLE_PLANS[8]!];
  const extra = count - base.length;
  for (let i = 0; i < extra; i++) base.push('deep_dive');
  return base;
}

interface BuildCtx {
  ctx: LocalOutlineContext;
  terms: TopicTerms;
  lex: Lexicon;
}

interface Stage {
  layout: SlideLayoutType;
  title: string;
  purpose: string;
  keyMessage: string;
  visualIntent: string;
  bullets: string[];
  content: SlideContent;
}

function audienceOf(ctx: LocalOutlineContext): string {
  const a = (ctx.audience ?? '').trim();
  return a || '管理层与核心干系人';
}

function buildCover({ ctx, terms }: BuildCtx): Stage {
  const purpose = (ctx.purpose ?? '').trim() || `围绕${terms.subject}达成共识并明确行动路径`;
  const subtitle = `${purpose}｜面向${audienceOf(ctx)}`;

  return {
    layout: 'title_cover',
    title: terms.topic,
    purpose,
    keyMessage: `本次${terms.goalType || '汇报'}聚焦${terms.tokens.slice(0, 3).join('、')}`,
    visualIntent: '大标题封面，建立主题与场合适配感',
    bullets: [],
    content: {
      title: terms.topic,
      subtitle,
      keyMessage: `本次${terms.goalType || '汇报'}聚焦${terms.tokens.slice(0, 3).join('、')}`,
      bullets: [],
      meta: {
        visualIntent: '大标题封面，建立主题与场合适配感',
        purpose,
        speakerNotes: `开场用一句话交代「${terms.subject}」为什么现在要谈。`,
      },
    },
  };
}

function buildBackground({ ctx: _ctx, terms, lex }: BuildCtx): Stage {
  const bullets = lex.current.map((c) => fill(c, terms));
  return {
    layout: 'cards_grid',
    title: `${terms.subject}·现状盘点`,
    purpose: '先对齐共识：现状到底是什么',
    keyMessage: bullets[0] ?? `${terms.subject}的现状需要先被看清`,
    visualIntent: '三张现状卡片，快速建立共同认知',
    bullets,
    content: {
      title: `${terms.subject}·现状盘点`,
      subtitle: '对齐共识：我们今天站在哪里',
      keyMessage: bullets[0] ?? '',
      bullets,
    },
  };
}

function buildProblem({ terms, lex }: BuildCtx): Stage {
  const problems = lex.problems.map((c) => fill(c, terms));
  const solutions = lex.solutions.map((c) => fill(c, terms));
  return {
    layout: 'problem_solution',
    title: `${terms.subject}·核心问题与应对方向`,
    purpose: '把问题说透，并给出可被讨论的应对方向',
    keyMessage: problems[0] ?? '',
    visualIntent: '左右对照：左边是问题，右边是方向',
    bullets: problems,
    content: {
      title: `${terms.subject}·核心问题与应对方向`,
      subtitle: '问题与方向必须成对出现',
      keyMessage: problems[0] ?? '',
      bullets: problems,
      columns: [
        { title: '核心问题', items: problems },
        { title: '应对方向', items: solutions },
      ],
    },
  };
}

function buildSolution({ terms, lex }: BuildCtx): Stage {
  const bullets = lex.solutions.map((c) => fill(c, terms));
  return {
    layout: 'cards_grid',
    title: `${terms.subject}·解决路径`,
    purpose: '给出可以落地的做法，而不是口号',
    keyMessage: bullets[0] ?? '',
    visualIntent: '并列展示解决路径的三个组成部分',
    bullets,
    content: {
      title: `${terms.subject}·解决路径`,
      subtitle: '每条路径都要有对应的责任与度量',
      keyMessage: bullets[0] ?? '',
      bullets,
    },
  };
}

function buildArchitecture({ terms, lex }: BuildCtx): Stage {
  const caps = lex.capabilities;
  const layers = lex.layerNames.map((name, idx) => ({
    title: `0${idx + 1} ${name}`,
    items: [
      fill(caps[(idx * 2) % caps.length]!, terms),
      fill(caps[(idx * 2 + 1) % caps.length]!, terms),
      fill(caps[(idx * 2 + 2) % caps.length]!, terms),
    ],
  }));

  return {
    layout: 'architecture_diagram',
    title: `${terms.subject}·整体架构`,
    purpose: '讲清楚能力如何分层、各层承担什么',
    keyMessage: `${lex.layerNames[0]}承接入口，${lex.layerNames[lex.layerNames.length - 1]}提供底座`,
    visualIntent: '自上而下的分层架构图，突出层间关系',
    bullets: layers.map((l) => `${l.title}：${l.items.join('、')}`),
    content: {
      title: `${terms.subject}·整体架构`,
      subtitle: '每一层只做一件事，层与层之间只通过契约交互',
      keyMessage: `${lex.layerNames[0]}承接入口，${lex.layerNames[lex.layerNames.length - 1]}提供底座`,
      bullets: layers.map((l) => `${l.title}：${l.items.join('、')}`),
      layers,
    },
  };
}

function buildCapability({ terms, lex }: BuildCtx): Stage {
  const caps = lex.capabilities.slice(0, 4);
  const satellites = caps.map((c) => ({
    title: fill(c, terms),
    desc: `支撑${terms.subject}的${fill(c, terms)}`,
  }));

  return {
    layout: 'radial_center',
    title: `${terms.subject}·核心能力`,
    purpose: '说明这件事依赖哪几项核心能力',
    keyMessage: `${terms.subject}的成败取决于核心能力是否齐备`,
    visualIntent: '中心辐射：中心是主题，四周是支撑能力',
    bullets: satellites.map((s) => s.title),
    content: {
      title: `${terms.subject}·核心能力`,
      subtitle: '中心是主题，四周是支撑能力',
      keyMessage: `${terms.subject}的成败取决于核心能力是否齐备`,
      bullets: satellites.map((s) => s.title),
      radial: {
        center: { title: terms.subject, desc: `${terms.goalType || '方案'}的核心命题` },
        satellites,
      },
    },
  };
}

function buildMetric({ terms, lex }: BuildCtx): Stage {
  // **不编造数字** —— 只给出需要度量的口径，数值由用户填写
  const bullets = lex.metricNames.map((m) => `${m}：明确口径与基线`);
  return {
    layout: 'cards_grid',
    title: `${terms.subject}·度量口径`,
    purpose: '先约定怎么量，再谈目标值',
    keyMessage: `没有口径的指标等于没有指标：先定义${lex.metricNames[0]}`,
    visualIntent: '指标口径清单，明确每项指标的衡量方式',
    bullets,
    content: {
      title: `${terms.subject}·度量口径`,
      subtitle: '口径先于目标值',
      keyMessage: `没有口径的指标等于没有指标：先定义${lex.metricNames[0]}`,
      bullets,
    },
  };
}

function buildRoadmap({ terms, lex }: BuildCtx): Stage {
  const phases = lex.phaseNames.slice(0, 4).map((name, idx) => ({
    phase: `PHASE 0${idx + 1}`,
    time: idx === 0 ? '第 1 阶段' : idx === 1 ? '第 2 阶段' : idx === 2 ? '第 3 阶段' : '持续期',
    title: name,
    deliverables: [
      fill(lex.capabilities[idx % lex.capabilities.length]!, terms),
      fill(lex.capabilities[(idx + 3) % lex.capabilities.length]!, terms),
    ],
  }));

  return {
    layout: 'timeline_roadmap',
    title: `${terms.subject}·推进路线`,
    purpose: '给出分阶段推进的节奏与交付物',
    keyMessage: `先${phases[0]?.title ?? '起步'}，再${phases[1]?.title ?? '推广'}`,
    visualIntent: '横向时间轴，标出阶段与交付物',
    bullets: phases.map((p) => `${p.phase} ${p.title}：${p.deliverables.join('、')}`),
    content: {
      title: `${terms.subject}·推进路线`,
      subtitle: '每个阶段都有明确的交付物与验收口径',
      keyMessage: `先${phases[0]?.title ?? '起步'}，再${phases[1]?.title ?? '推广'}`,
      bullets: phases.map((p) => `${p.phase} ${p.title}：${p.deliverables.join('、')}`),
      phases,
    },
  };
}

function buildDeepDive({ terms, lex }: BuildCtx): Stage {
  const bullets = lex.capabilities.slice(4, 8).map((c) => fill(c, terms));
  const items = bullets.length > 0 ? bullets : lex.current.map((c) => fill(c, terms));
  return {
    layout: 'cards_grid',
    title: `${terms.subject}·关键议题拆解`,
    purpose: '把容易混淆的议题单独拎出来讲清楚',
    keyMessage: items[0] ?? '',
    visualIntent: '议题卡片，突出每一条的边界',
    bullets: items,
    content: {
      title: `${terms.subject}·关键议题拆解`,
      subtitle: '每条议题都要有明确的边界与归属',
      keyMessage: items[0] ?? '',
      bullets: items,
    },
  };
}

function buildSummary({ ctx, terms, lex }: BuildCtx): Stage {
  const points = lex.solutions.map((c) => fill(c, terms));
  const actions = [
    `确认${terms.subject}的第一阶段负责人与验收口径`,
    `两周内完成${lex.phaseNames[0] ?? '现状盘点'}并输出结论`,
    `按${lex.metricNames[0] ?? '核心指标'}建立可持续跟踪的度量看板`,
  ];

  return {
    layout: 'summary_conclusion',
    title: `${terms.subject}·结论与下一步`,
    purpose: '收束共识，把讨论转成动作',
    keyMessage: `${terms.subject}的关键在于${lex.capabilities[0] ?? '核心能力'}是否被真正建起来`,
    visualIntent: '结论页：上方一句结论，下方三条行动',
    bullets: points,
    content: {
      title: `${terms.subject}·结论与下一步`,
      subtitle: '结论先行，行动落地',
      keyMessage: `${terms.subject}的关键在于${lex.capabilities[0] ?? '核心能力'}是否被真正建起来`,
      bullets: points,
      summary: {
        headline: `${terms.subject}的关键在于${lex.capabilities[0] ?? '核心能力'}是否被真正建起来`,
        points,
        actions,
      },
    },
  };
}

function buildStage(kind: StageKind, bundle: BuildCtx): Stage {
  switch (kind) {
    case 'cover':
      return buildCover(bundle);
    case 'background':
      return buildBackground(bundle);
    case 'problem':
      return buildProblem(bundle);
    case 'solution':
      return buildSolution(bundle);
    case 'architecture':
      return buildArchitecture(bundle);
    case 'capability':
      return buildCapability(bundle);
    case 'metric':
      return buildMetric(bundle);
    case 'roadmap':
      return buildRoadmap(bundle);
    case 'deep_dive':
      return buildDeepDive(bundle);
    case 'summary':
    default:
      return buildSummary(bundle);
  }
}

/**
 * 生成大纲
 * ---------------------------------------------------------------------------
 * 硬约束（与 Outline Agent 的 Prompt 一致）：
 *   1. 页数精确等于 pageCount
 *   2. 第 1 页是 title_cover
 *   3. 至少 1 页 summary_conclusion
 */
export function generateLocalOutline(ctx: LocalOutlineContext): SlideOutlineItem[] {
  const pageCount = Math.max(1, Math.min(50, Math.floor(ctx.pageCount)));
  const terms = parseTopic(ctx.topic);
  const lex = pickLexicon(ctx.topic);

  const kinds: StageKind[] = ['cover'];
  if (pageCount >= 2) {
    kinds.push(...planMiddle(pageCount - 2));
    kinds.push('summary');
  } else {
    kinds.push('summary');
  }

  // 页数上限保护：超过 12 页时后面全是 deep_dive，保持结构稳定
  const finalKinds = kinds.slice(0, Math.max(1, pageCount));

  return finalKinds.map((kind, idx) => {
    const stage = buildStage(kind, { ctx, terms, lex });
    const order = idx + 1;
    return {
      slideId: `s${order}`,
      order,
      title: stage.title,
      purpose: stage.purpose,
      keyMessage: stage.keyMessage,
      visualIntent: stage.visualIntent,
      layoutPreference: stage.layout,
      requiredElements: [],
      speakerNotes: stage.purpose,
      bulletPoints: stage.bullets,
      content: stage.content,
    } satisfies SlideOutlineItem;
  });
}
