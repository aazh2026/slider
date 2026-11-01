/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 主题解析 —— 把一个自由文本主题拆成可复用的要素
 * ---------------------------------------------------------------------------
 * 本地降级实现的第一步。**降级不是"返回一份写死的示例"**，而是
 * "在用户给的主题上做确定性推导"（docs/architecture.md §7.2 硬约束）。
 *
 * 产出：
 *   subject   主体短语（「企业 AI Agent 技术架构」）
 *   goalType  目标类型（「规划」「方案」「建设」…）
 *   tokens    主题要素（用于把词汇真正嵌进文案）
 */

const LEADING_NOISE = /^(关于|面向|针对|基于|围绕|关于我们的?|有关)/;

const STOPWORDS = new Set([
  '的', '了', '与', '和', '及', '等', '在', '对', '为', '中', '上', '下', '个', '我们',
  'this', 'the', 'a', 'an', 'for', 'of', 'and', 'to', 'in', 'on',
]);

/** 目标类型后缀 —— 出现在主题末尾时拆出来 */
const GOAL_TYPES = [
  '技术架构规划', '架构规划', '技术规划', '发展规划', '战略规划', '商业规划', '产品规划',
  '增长规划', '运营规划', '建设方案', '落地方案', '实施方案', '解决方案', '转型方案',
  '规划', '方案', '建设', '实践', '体系', '框架', '蓝图', '路线图', '白皮书', '报告', '复盘',
];

export interface TopicTerms {
  /** 原始主题 */
  topic: string;
  /** 主体短语 */
  subject: string;
  /** 目标类型（未知时为空串） */
  goalType: string;
  /** 主题要素（2-6 个），用于把词汇嵌进文案 */
  tokens: string[];
}

/** 拆分主题为要素 */
export function tokenizeTopic(topic: string): string[] {
  const cleaned = (topic ?? '').trim().replace(LEADING_NOISE, '');
  if (!cleaned) return [];

  const raw = cleaned
    .split(/[,，、。;；:：!！?？/\\|＋+·•\-\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const tokens: string[] = [];
  for (const t of raw) {
    if (t.length < 2) continue;
    if (STOPWORDS.has(t.toLowerCase())) continue;
    tokens.push(t);
  }
  return tokens;
}

/** 拆分主体与目标类型 */
export function parseTopic(topic: string): TopicTerms {
  const original = (topic ?? '').trim();
  const cleaned = original.replace(LEADING_NOISE, '');

  let subject = cleaned;
  let goalType = '';

  for (const gt of GOAL_TYPES) {
    if (cleaned.length > gt.length && cleaned.endsWith(gt)) {
      subject = cleaned.slice(0, cleaned.length - gt.length).trim();
      goalType = gt;
      break;
    }
  }

  const tokens = tokenizeTopic(original);
  const effectiveTokens = tokens.length > 0 ? tokens : [subject || original];

  return {
    topic: original,
    subject: subject || original,
    goalType,
    tokens: effectiveTokens.slice(0, 6),
  };
}

/** 在模板里替换占位符 */
export function fill(template: string, terms: TopicTerms): string {
  return template
    .replace(/\{subject\}/g, terms.subject)
    .replace(/\{topic\}/g, terms.topic)
    .replace(/\{goalType\}/g, terms.goalType || '方案')
    .replace(/\{focus\}/g, terms.tokens[0] ?? terms.subject)
    .replace(/\{focus2\}/g, terms.tokens[1] ?? terms.subject);
}

/** 领域词典 —— 决定用哪套词汇描述「现状 / 问题 / 方案 / 层级 / 能力 / 阶段」 */
export interface Lexicon {
  key: string;
  label: string;
  /** 关键词 —— 命中即采用该词典 */
  keywords: string[];
  current: string[];
  problems: string[];
  solutions: string[];
  layerNames: string[];
  capabilities: string[];
  metricNames: string[];
  phaseNames: string[];
}

const LEXICONS: Lexicon[] = [
  {
    key: 'tech',
    label: '技术',
    keywords: ['技术', '架构', 'ai', 'agent', '智能体', '系统', '平台', '引擎', '算力', '模型', '工程', '研发', '代码', '软件', '云', '数据'],
    current: ['以人工串接为主，缺少统一编排', '工具链分散，数据口径难以对齐', '缺乏可复用的工程基线与度量体系'],
    problems: ['{subject}的落地链路长，需求到交付反复返工', '系统之间接口与数据未打通，复用率低', '缺少统一的性能与稳定性度量口径'],
    solutions: ['以统一平台收敛散落的能力，减少重复建设', '以标准化流水线固化交付过程，降低人力依赖', '以可观测体系保障质量，让问题可定位可追溯'],
    layerNames: ['接入层', '编排层', '能力层', '基础设施层'],
    capabilities: ['平台治理', '数据打通', '安全合规', '成本控制', '灰度发布', '容量规划', '故障自愈', '效果评估'],
    metricNames: ['需求交付周期', '能力复用率', '线上可用性', '单位请求成本'],
    phaseNames: ['诊断与规划', '试点验证', '规模推广', '持续运营'],
  },
  {
    key: 'product',
    label: '产品',
    keywords: ['产品', '用户', '需求', '场景', '功能', '体验', '增长', '转化', '留存', '设计', '运营', '会员', '电商', '零售'],
    current: ['核心场景依赖人工判断，缺少标准化支撑', '用户反馈分散，未形成闭环', '功能堆叠，缺少清晰的价值主线'],
    problems: ['用户旅程存在断点，转化在中途大量流失', '功能与真实场景脱节，投入产出难以衡量', '缺少统一的产品度量口径，决策依赖主观判断'],
    solutions: ['以场景为主线重构产品结构，先解决高频痛点', '以数据闭环驱动迭代，让每一步都有依据', '以分层运营承接不同阶段用户，提升留存'],
    layerNames: ['触点层', '场景层', '能力层', '数据层'],
    capabilities: ['场景洞察', '体验设计', '转化优化', '用户分层', '需求验证', '增长实验', '留存运营', '品牌表达'],
    metricNames: ['核心场景转化率', '功能采纳率', '用户留存率', '需求交付节奏'],
    phaseNames: ['机会识别', '方案验证', '规模上线', '迭代运营'],
  },
  {
    key: 'market',
    label: '市场',
    keywords: ['市场', '销售', '渠道', '客户', '品牌', '竞争', '营收', '收入', '商务', '出海', '定价', 'gtm', '增长'],
    current: ['获客依赖个人资源，难以复制', '客户分层模糊，投入产出比难以比较', '竞争应对偏被动，缺少定价话语权'],
    problems: ['渠道结构失衡，头部依赖度过高', '客户成功案例缺失，转化缺少说服力', '数据口径不统一，难以判断真实增长质量'],
    solutions: ['以分层渠道覆盖不同客群，降低单点依赖', '以可复用的案例与话术提升转化效率', '以统一指标体系支撑定价与资源配置'],
    layerNames: ['获客层', '转化层', '交付层', '复购层'],
    capabilities: ['市场洞察', '渠道建设', '品牌叙事', '销售赋能', '定价策略', '客户成功', '数据分析', '渠道管理'],
    metricNames: ['获客成本', '商机转化率', '客单价', '续约率'],
    phaseNames: ['市场盘点', '打法验证', '渠道扩张', '品牌沉淀'],
  },
  {
    key: 'ops',
    label: '运营',
    keywords: ['运营', '流程', '组织', '团队', '效率', '供应链', '物流', '风控', '合规', '客服', '人力', '财务', '制造'],
    current: ['流程跨部门流转，节点之间存在大量等待', '数据采集靠人工，口径与时效都不可控', '缺少端到端的责任划分，问题反复回流'],
    problems: ['流程冗长，交接环节损耗大量时间', '关键指标无法实时获取，决策滞后', '责任边界模糊，异常发生时难以追溯'],
    solutions: ['以端到端流程重构减少交接损耗', '以自动化采集保障数据口径统一与时效', '以明确的责任矩阵让异常有主可查'],
    layerNames: ['执行层', '协同层', '管控层', '决策层'],
    capabilities: ['流程编排', '资源调度', '风险预警', '质量巡检', '成本核算', '合规审计', '数据看板', '供应商管理'],
    metricNames: ['流程周期时长', '自动化覆盖率', '异常闭环率', '单位产出成本'],
    phaseNames: ['现状诊断', '标杆试点', '全面推广', '常态运营'],
  },
  {
    key: 'education',
    label: '教育',
    keywords: ['教育', '教学', '课程', '学员', '学校', '培训', '学习', '教研', '考试', '教师', '学生'],
    current: ['课程内容与实际需求脱节', '教学效果依赖教师个人经验，难以复制', '学习数据缺失，无法定位卡点'],
    problems: ['课程体系重复建设，学习路径不清晰', '评估依赖结果，无法定位学习卡点', '优质资源分布不均，触达成本高'],
    solutions: ['以能力模型重构课程体系与学习路径', '以过程数据驱动教学调整', '以资源分层触达，把优质内容送到最需要的人'],
    layerNames: ['内容层', '教学层', '评估层', '运营层'],
    capabilities: ['课程设计', '教学设计', '学习分析', '内容运营', '师资培养', '评价体系', '资源分发', '效果评估'],
    metricNames: ['课程完成率', '学习活跃度', '考核通过率', '单位课时产出'],
    phaseNames: ['需求调研', '课程试点', '规模化推广', '效果复盘'],
  },
  {
    key: 'general',
    label: '通用',
    keywords: [],
    current: ['关键环节仍依赖个人经验，缺少标准动作', '信息分散在多个地方，缺少统一视图', '缺少可量化的目标与验收口径'],
    problems: ['目标与动作脱节，投入难以转化为结果', '信息不对称，决策依赖个案判断', '缺少统一口径，跨角色协作成本高'],
    solutions: ['以目标为牵引拆解关键动作与责任人', '以统一视图打通信息，消除跨角色盲区', '以可量化的口径让进展与效果都可验证'],
    layerNames: ['目标层', '策略层', '执行层', '保障层'],
    capabilities: ['目标拆解', '方案设计', '资源协同', '过程管控', '风险识别', '效果评估', '知识沉淀', '机制建设'],
    metricNames: ['目标达成率', '关键动作完成率', '协作效率', '投入产出比'],
    phaseNames: ['现状梳理', '方案设计', '落地推进', '复盘优化'],
  },
];

/** 依据主题挑选领域词典 */
export function pickLexicon(topic: string): Lexicon {
  const haystack = (topic ?? '').toLowerCase();
  let best: Lexicon = LEXICONS[LEXICONS.length - 1]!;
  let bestScore = 0;

  for (const lex of LEXICONS) {
    let score = 0;
    for (const kw of lex.keywords) {
      if (haystack.includes(kw.toLowerCase())) score += kw.length;
    }
    if (score > bestScore) {
      bestScore = score;
      best = lex;
    }
  }
  return best;
}

export { LEXICONS };
