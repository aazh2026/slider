/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PresentationProject, SlideOutlineItem, SlideIR } from '../types/slide';
import { BUILT_IN_TEMPLATES } from './templates';
import { LayoutEngine } from '../engine/layoutEngine';
import { QualityEngine } from '../engine/qualityEngine';

// Project 1: Enterprise AI Agent Architecture (Tech Blue)
const outline1: SlideOutlineItem[] = [
  {
    slideId: 'slide_1_01',
    order: 1,
    title: '企业级 AI Agent 技术架构规划',
    purpose: '向技术管理层汇报企业级 Agent 演进规划与架构设计',
    keyMessage: '从单点 Prompt 应用走向自主协同、工程受控的智能体生产平台',
    visualIntent: 'title_cover',
    layoutPreference: 'title_cover',
    requiredElements: ['战略主标题', '副标题与定位', '作者元数据'],
    speakerNotes: '开场致辞，介绍本次架构规划汇报的核心背景与战略目标。',
    bulletPoints: ['企业级 Agent 演进背景', '生产级工程化落地战略'],
  },
  {
    slideId: 'slide_1_02',
    order: 2,
    title: '为什么需要 Agent 架构升级：传统 AI 应用瓶颈',
    purpose: '深入剖析传统单体 Prompt 方案在企业生产环境下的三大核心痛点',
    keyMessage: '黑盒不可控、上下文孤岛与工具调用割裂是现有系统规模化落地的主要掣肘',
    visualIntent: 'problem_solution',
    layoutPreference: 'problem_solution',
    requiredElements: ['传统方案痛点对比', '架构对策与突破点'],
    speakerNotes: '指出当前业务试点中遇到的实际难题，建立升级架构的迫切性。',
    bulletPoints: [
      '黑盒失控与幻觉风险：Prompt 工程无法保障企业核心业务输出的确定性。',
      '上下文孤岛与长链条割裂：缺乏跨会话记忆与复杂任务状态调度机。',
      '生产环境隔离与安全风险：缺乏标准化 MCP 工具总线与执行沙箱。',
    ],
  },
  {
    slideId: 'slide_1_03',
    order: 3,
    title: '企业 Agent 核心能力支柱与维度规划',
    purpose: '定义支撑企业级 Agent 运作的四大支柱能力',
    keyMessage: '以自主规划、统一工具协议、混合记忆与确定性护栏构筑企业护城河',
    visualIntent: 'cards_grid',
    layoutPreference: 'cards_grid',
    requiredElements: ['四大能力维度卡片', '技术指标与实现方式'],
    speakerNotes: '重点阐述四大支柱在企业架构中的定位和相互协同方式。',
    bulletPoints: [
      '分层自主规划：基于 Tree of Thoughts 与 ReAct 架构，实现长程复杂任务分解。',
      '统一工具互操作：基于 MCP 标准协议规范，实现微服务与企业 ERP/CRM 无缝打通。',
      '多维持久记忆：整合会话短期工作记忆、向量情境记忆与企业知识图谱。',
      '确定性工程护栏：结合模型反思与代码沙箱执行，构筑 100% 安全合规底线。',
    ],
  },
  {
    slideId: 'slide_1_04',
    order: 4,
    title: '企业 Agent 四层总体技术架构',
    purpose: '展示应用层、能力层、运行时治理层与底座模型层的全景分层架构图',
    keyMessage: '分层解耦与标准化接口设计，保障系统高可用、弹性扩展与低成本迭代',
    visualIntent: 'architecture_diagram',
    layoutPreference: 'architecture_diagram',
    requiredElements: ['四层水平架构条', '模块微单元', '右侧核心架构准则'],
    speakerNotes: '这是本次汇报的技术核心大图，逐层分析系统交互与数据流转。',
    bulletPoints: [
      '业务应用层：场景化智能体与多智能体群组协同。',
      '核心能力层：编排引擎、工具调用与上下文分发。',
      '治理运行时层：沙箱隔离、Tracing 追踪与成本限流。',
      '基础设施层：多模型路由、私有知识库与算力调度。',
    ],
  },
  {
    slideId: 'slide_1_05',
    order: 5,
    title: '四阶段分步实施路线与里程碑交付物',
    purpose: '规划为期 12 个月的落地实施路径，明确各阶段时间表与验收标准',
    keyMessage: '小步快跑、以验证驱动底座构建，在稳健试点中持续释放商业价值',
    visualIntent: 'timeline_roadmap',
    layoutPreference: 'timeline_roadmap',
    requiredElements: ['四大实施阶段', '时间节点与关键里程碑'],
    speakerNotes: '向管理层汇报具体实施步骤、人员投入需求及预期商业产出。',
    bulletPoints: [
      '阶段一 (1-2月)：高频研发与客服场景 PoC 闭环验证。',
      '阶段二 (3-5月)：统一 Agent 运行时平台与 MCP 工具总线上线。',
      '阶段三 (6-9月)：跨部门多智能体群组协同与全链路治理。',
      '阶段四 (10-12月)：企业原生 Agent 生态形成与自主持续微调。',
    ],
  },
  {
    slideId: 'slide_1_06',
    order: 6,
    title: '战略总结与下一阶段重点行动计划',
    purpose: '凝聚共识，发布技术委员会未来数周的关键执行决议',
    keyMessage: '从问答工具迈向生产级系统，人在回路，构建可持续进化的智能基座',
    visualIntent: 'summary_conclusion',
    layoutPreference: 'summary_conclusion',
    requiredElements: ['战略共识大卡片', '近期 1-6 周执行清单'],
    speakerNotes: '总结陈词，号召各部门通力配合，开启问答与讨论环节。',
    bulletPoints: [
      '确立首批高价值 Agent 业务试点清单与跨部门责任人。',
      '启动企业级沙箱环境搭建与统一 MCP 工具接口联调。',
      '建立全流程数据安全与隐私合规准入评估机制。',
    ],
  },
];

// Project 2: McKinsey Consulting Strategic Review (Light Pure White)
const tplMckinsey = BUILT_IN_TEMPLATES.find((t) => t.templateId === 'tpl_mckinsey_white') || BUILT_IN_TEMPLATES[1];
const outline2: SlideOutlineItem[] = [
  {
    slideId: 'slide_2_01',
    order: 1,
    title: '2026 企业数字化战略转型与突破规划',
    purpose: '面向集团管理层，呈现数字化转型诊断结论与三级跃迁路径',
    keyMessage: '从流程支撑走向数据驱动，以客户价值重塑核心盈利模式',
    visualIntent: 'title_cover',
    layoutPreference: 'title_cover',
    requiredElements: ['咨询标题', '副标题', '报告人信息'],
    speakerNotes: '汇报开篇，阐述全球产业转型大势及集团当前所处竞争周期。',
    bulletPoints: ['行业格局演进剖析', '集团转型战略要务'],
  },
  {
    slideId: 'slide_2_02',
    order: 2,
    title: '数字化转型核心业务成效与商业指标',
    purpose: '量化呈现战略落地带来的降本增效成果与未来预测',
    keyMessage: '关键业务指标实现跨越式增长，净资产收益率与周转效率显著拉升',
    visualIntent: 'stats_kpi',
    layoutPreference: 'stats_kpi',
    requiredElements: ['4组核心数据指标', '环比同比趋势'],
    speakerNotes: '重点关注毛利率改善与客户全生命周期价值。',
    bulletPoints: ['78% 业务流程自动化率', '94.2% 客户满意度', '6.5x 投入产出比', '100% 审计合规'],
  },
  {
    slideId: 'slide_2_03',
    order: 3,
    title: '四大业务板块破局策略与核心支柱',
    purpose: '梳理业务前台、中台底座、组织敏捷度与生态协同四大抓手',
    keyMessage: '聚焦高利润业务板块，通过精细化数字化运营建立竞争壁垒',
    visualIntent: 'cards_grid',
    layoutPreference: 'cards_grid',
    requiredElements: ['四大业务卡片', '策略要点'],
    speakerNotes: '逐一分析四大板块的落地打法与资源匹配。',
    bulletPoints: [
      '全渠道客户体验升级：重构线上线下一体化触点。',
      '智能供应链动态调度：基于预测实现零库存流转。',
      '数据资产化中台：打破各业务线数据孤岛与标准割裂。',
      '敏捷敏锐组织文化：以业务结果为导向的跨职能作战小队。',
    ],
  },
  {
    slideId: 'slide_2_04',
    order: 4,
    title: '转型阶段路线图与关键里程碑',
    purpose: '明确 18 个月内的路线演进与考核节点',
    keyMessage: '以季度为迭代单元，筑牢底座后全面推行生态协同',
    visualIntent: 'timeline_roadmap',
    layoutPreference: 'timeline_roadmap',
    requiredElements: ['四阶段实施时间轴', '阶段交付物'],
    speakerNotes: '对齐各业务线负责人的考核周期。',
    bulletPoints: ['Q1 业务梳理', 'Q2 中台试水', 'Q3 全面推广', 'Q4 生态开放'],
  },
];

// Project 3: B2B SaaS Pitch Deck (Modern Studio Light)
const tplModernLight = BUILT_IN_TEMPLATES.find((t) => t.templateId === 'tpl_modern_light') || BUILT_IN_TEMPLATES[0];
const outline3: SlideOutlineItem[] = [
  {
    slideId: 'slide_3_01',
    order: 1,
    title: 'NexusFlow: B2B 智能供应链协同平台',
    purpose: '商业计划书融资路演，面向顶级早期风险投资机构',
    keyMessage: '让全球跨国企业供应链运转如同流水线般精准透明',
    visualIntent: 'title_cover',
    layoutPreference: 'title_cover',
    requiredElements: ['产品名称', '价值主张', '创始人团队'],
    speakerNotes: '开场致辞，阐述为什么是现在以及我们独特的破局点。',
    bulletPoints: ['供应链万亿级市场痛点', '下一代 SaaS 平台'],
  },
  {
    slideId: 'slide_3_02',
    order: 2,
    title: '供应链协同三大痛点 vs NexusFlow 架构解法',
    purpose: '深刻揭示行业现有 ERP 的笨重与割裂，对照展示产品独创性',
    keyMessage: '化繁为简，将平均 48 小时的跨国订单确认缩短至 15 秒自动化闭环',
    visualIntent: 'problem_solution',
    layoutPreference: 'problem_solution',
    requiredElements: ['左右痛点对照', '核心技术突破'],
    speakerNotes: '展示我们给客户带来的实际 ROI。',
    bulletPoints: ['信息延迟与信息孤岛', '自动化协同网络与实时调度'],
  },
  {
    slideId: 'slide_3_03',
    order: 3,
    title: '核心商业模式与未来 12 个月财务预测',
    purpose: '展示订阅收入、客户留存率 (NDR) 与毛利结构',
    keyMessage: '高复购、高黏性与病毒式上下游企业协同网络效应',
    visualIntent: 'stats_kpi',
    layoutPreference: 'stats_kpi',
    requiredElements: ['关键 SaaS 指标'],
    speakerNotes: '向投资人展示我们健康的单位经济模型。',
    bulletPoints: ['135% NDR 留存', '82% 软件毛利率', '3.8x LTV/CAC', '120+ 标杆付费企业'],
  },
];

export function createStarterProjects(): PresentationProject[] {
  // Project 1: Default Light Theme (Modern Studio Light)
  const slides1: SlideIR[] = outline1.map((item, idx) =>
    LayoutEngine.generateSlideIR(item, tplModernLight.theme, idx + 1, outline1.length)
  );
  const proj1: PresentationProject = {
    id: 'proj_agent_arch_2026',
    name: '企业 AI Agent 技术架构规划',
    requirement: {
      topic: '企业 AI Agent 技术架构规划',
      purpose: '面向公司技术管理层，阐述从单点 Prompt 应用走向自主协同、工程受控的企业级智能体生产平台',
      audience: '技术管理层、CTO、架构委员会与技术总监',
      pageCount: 6,
      style: '现代极简明亮、专业严谨、高对比度',
      depth: '技术战略与架构设计',
      aspectRatio: '16:9',
    },
    template: tplModernLight,
    outline: outline1,
    slides: slides1,
    versions: {},
    createdAt: Date.now() - 86400000 * 2,
    updatedAt: Date.now() - 3600000 * 2,
  };
  proj1.qualityReport = QualityEngine.evaluatePresentation(proj1);

  // Project 2 (Light McKinsey)
  const slides2: SlideIR[] = outline2.map((item, idx) =>
    LayoutEngine.generateSlideIR(item, tplMckinsey.theme, idx + 1, outline2.length)
  );
  const proj2: PresentationProject = {
    id: 'proj_mckinsey_strategy_2026',
    name: '2026 企业数字化战略转型突破 (咨询纯白)',
    requirement: {
      topic: '企业数字化战略转型突破',
      purpose: '面向集团管理层，呈现数字化转型诊断结论与三级跃迁路径',
      audience: '集团董事会与高级管理层',
      pageCount: 4,
      style: '咨询纯白、极简克制、高对比度',
      depth: '业务战略与商业突破',
      aspectRatio: '16:9',
    },
    template: tplMckinsey,
    outline: outline2,
    slides: slides2,
    versions: {},
    createdAt: Date.now() - 86400000 * 5,
    updatedAt: Date.now() - 86400000 * 1,
  };
  proj2.qualityReport = QualityEngine.evaluatePresentation(proj2);

  // Project 3 (Modern Light)
  const slides3: SlideIR[] = outline3.map((item, idx) =>
    LayoutEngine.generateSlideIR(item, tplModernLight.theme, idx + 1, outline3.length)
  );
  const proj3: PresentationProject = {
    id: 'proj_nexus_saas_pitch',
    name: 'NexusFlow 智能供应链平台融资路演',
    requirement: {
      topic: 'NexusFlow B2B 智能供应链平台',
      purpose: '商业计划书融资路演',
      audience: 'VC 风险投资机构与合伙人',
      pageCount: 3,
      style: '现代商务明亮、清爽科技',
      depth: '商业模式与产品创新',
      aspectRatio: '16:9',
    },
    template: tplModernLight,
    outline: outline3,
    slides: slides3,
    versions: {},
    createdAt: Date.now() - 86400000 * 7,
    updatedAt: Date.now() - 86400000 * 3,
  };
  proj3.qualityReport = QualityEngine.evaluatePresentation(proj3);

  return [proj1, proj2, proj3];
}
