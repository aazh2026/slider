/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SlideIR, SlideOutlineItem, SlideElement, TemplateTheme, SlideLayoutType } from '../types/slide';

export class LayoutEngine {
  /**
   * Generates a fully calculated SlideIR from an Outline item and Template Theme
   */
  static generateSlideIR(
    outline: SlideOutlineItem,
    theme: TemplateTheme,
    slideOrder: number,
    totalSlides: number
  ): SlideIR {
    const canvas = { width: 1920, height: 1080 };
    const elements: SlideElement[] = [];

    // 1. Background layer element
    elements.push({
      id: `bg_${outline.slideId}`,
      type: 'shape',
      role: 'background',
      content: '',
      geometry: { x: 0, y: 0, width: 1920, height: 1080 },
      style: {
        backgroundColor: theme.backgroundColor,
      },
      editable: false,
      zIndex: 0,
    });

    // 2. Master elements (Header / Footer / Page Number) if not cover
    const isCover = outline.layoutPreference === 'title_cover';
    if (!isCover) {
      // Header category / kicker
      elements.push({
        id: `header_${outline.slideId}`,
        type: 'text',
        role: 'subtitle',
        content: outline.visualIntent.toUpperCase() || 'TECHNICAL STRATEGY ARCHITECTURE',
        geometry: { x: 100, y: 55, width: 800, height: 30 },
        style: {
          fontSize: 14,
          fontWeight: 700,
          color: theme.accentColor,
          letterSpacing: '0.12em',
        },
        editable: true,
        zIndex: 5,
      });

      // Main slide title
      elements.push({
        id: `title_${outline.slideId}`,
        type: 'text',
        role: 'title',
        content: outline.title,
        geometry: { x: 100, y: 90, width: 1350, height: 60 },
        style: {
          fontSize: 38,
          fontWeight: 700,
          fontFamily: theme.fontHeading,
          color: theme.textPrimary,
        },
        editable: true,
        zIndex: 10,
      });

      // Key message / Takeaway subheader
      elements.push({
        id: `keymsg_${outline.slideId}`,
        type: 'text',
        role: 'subtitle',
        content: `核心结论：${outline.keyMessage}`,
        geometry: { x: 100, y: 155, width: 1450, height: 36 },
        style: {
          fontSize: 18,
          fontWeight: 500,
          color: theme.textSecondary,
        },
        editable: true,
        zIndex: 10,
      });

      // Footer Slide Counter
      elements.push({
        id: `pagenum_${outline.slideId}`,
        type: 'text',
        role: 'footer',
        content: `${String(slideOrder).padStart(2, '0')} / ${String(totalSlides).padStart(2, '0')}`,
        geometry: { x: 1760, y: 1015, width: 80, height: 30 },
        style: {
          fontSize: 14,
          fontWeight: 600,
          color: theme.textSecondary,
          textAlign: 'right',
        },
        editable: false,
        zIndex: 5,
      });

      // Footer Confidential note
      elements.push({
        id: `footernote_${outline.slideId}`,
        type: 'text',
        role: 'footer',
        content: 'AI PPT STUDIO · 企业级 AI Agent 架构体系汇报 · 机密文档',
        geometry: { x: 100, y: 1015, width: 600, height: 30 },
        style: {
          fontSize: 13,
          fontWeight: 400,
          color: theme.textSecondary,
          opacity: 0.7,
        },
        editable: false,
        zIndex: 5,
      });
    }

    // 3. Layout-specific Content Elements
    switch (outline.layoutPreference) {
      case 'title_cover':
        this.buildTitleCoverLayout(elements, outline, theme);
        break;

      case 'architecture_diagram':
        this.buildArchitectureDiagramLayout(elements, outline, theme);
        break;

      case 'cards_grid':
        this.buildCardsGridLayout(elements, outline, theme);
        break;

      case 'problem_solution':
        this.buildProblemSolutionLayout(elements, outline, theme);
        break;

      case 'timeline_roadmap':
        this.buildTimelineRoadmapLayout(elements, outline, theme);
        break;

      case 'stats_kpi':
        this.buildStatsKpiLayout(elements, outline, theme);
        break;

      case 'radial_center':
        this.buildRadialCenterLayout(elements, outline, theme);
        break;

      case 'summary_conclusion':
      default:
        this.buildSummaryLayout(elements, outline, theme);
        break;
    }

    return {
      slideId: outline.slideId,
      order: slideOrder,
      title: outline.title,
      purpose: outline.purpose,
      keyMessage: outline.keyMessage,
      speakerNotes: outline.speakerNotes,
      visualIntent: outline.visualIntent,
      layout: {
        type: outline.layoutPreference,
      },
      canvas,
      elements,
      versionId: `v_${Date.now()}`,
      lastModified: Date.now(),
    };
  }

  /**
   * Layout: Title Cover (封面)
   */
  private static buildTitleCoverLayout(
    elements: SlideElement[],
    outline: SlideOutlineItem,
    theme: TemplateTheme
  ) {
    // Top Kicker Badge
    elements.push({
      id: `kicker_${outline.slideId}`,
      type: 'badge',
      role: 'badge',
      content: 'ENTERPRISE AI STRATEGY & ARCHITECTURE 2026',
      geometry: { x: 160, y: 240, width: 440, height: 36 },
      style: {
        fontSize: 14,
        fontWeight: 700,
        color: theme.accentColor,
        backgroundColor: `${theme.accentColor}18`,
        borderColor: `${theme.accentColor}40`,
        borderWidth: 1,
        borderRadius: 6,
        padding: 8,
        letterSpacing: '0.08em',
      },
      editable: true,
      zIndex: 10,
    });

    // Giant Title
    elements.push({
      id: `maintitle_${outline.slideId}`,
      type: 'text',
      role: 'title',
      content: outline.title,
      geometry: { x: 160, y: 310, width: 1450, height: 180 },
      style: {
        fontSize: 66,
        fontWeight: 800,
        fontFamily: theme.fontHeading,
        color: theme.textPrimary,
        lineHeight: 1.15,
      },
      editable: true,
      zIndex: 10,
    });

    // Subtitle / Narrative
    elements.push({
      id: `subtitle_${outline.slideId}`,
      type: 'text',
      role: 'subtitle',
      content: outline.purpose || '面向技术管理层 · 从单体应用迈向自主协同的企业级智能体工程体系',
      geometry: { x: 160, y: 520, width: 1200, height: 80 },
      style: {
        fontSize: 26,
        fontWeight: 500,
        color: theme.textSecondary,
        lineHeight: 1.4,
      },
      editable: true,
      zIndex: 10,
    });

    // Accent line
    elements.push({
      id: `accent_line_${outline.slideId}`,
      type: 'shape',
      role: 'divider',
      content: '',
      geometry: { x: 160, y: 640, width: 120, height: 4 },
      style: {
        backgroundColor: theme.accentColor,
        borderRadius: 2,
      },
      editable: false,
      zIndex: 10,
    });

    // Metadata card
    elements.push({
      id: `metacard_${outline.slideId}`,
      type: 'card',
      role: 'card',
      content: {
        reporter: '主讲人：企业架构委员会 / AI 卓越中心 (CoE)',
        date: '日期：2026 年战略规划会议',
        version: '版本：V2.4 (架构审定版)',
        scope: '范围：企业生产级 Agent 运行时、安全治理与工程落地',
      },
      geometry: { x: 160, y: 720, width: 1100, height: 130 },
      style: {
        backgroundColor: theme.surfaceColor,
        borderColor: theme.surfaceBorder,
        borderWidth: 1,
        borderRadius: 12,
        padding: 24,
      },
      editable: true,
      zIndex: 10,
    });
  }

  /**
   * Layout: Layered Architecture Diagram (分层架构)
   */
  private static buildArchitectureDiagramLayout(
    elements: SlideElement[],
    outline: SlideOutlineItem,
    theme: TemplateTheme
  ) {
    const layers = [
      {
        title: '01 业务场景与智能体应用层 (Application Tier)',
        items: ['智能研发助手 (DevAgent)', '营销内容协同 Agent', '供应链决策 Agent', '合规与风控审计 Agent'],
        accent: theme.primaryColor,
      },
      {
        title: '02 Agent 编排与核心能力层 (Core Capabilities Tier)',
        items: ['多智能体编排 (LangGraph / Swarm)', '动态规划与自反思 (ReAct / CoT)', '混合工具调用系统 (MCP / APIs)', '分层记忆体系 (短期缓存 + 长期向量)'],
        accent: theme.secondaryColor,
      },
      {
        title: '03 运行时治理与安全守卫层 (Runtime & Guardrails Tier)',
        items: ['沙箱执行环境 (Code Sandbox)', '敏感内容过滤与合规守卫', '全链路分布式追踪 (Tracing)', 'Token 成本与预算熔断控制器'],
        accent: theme.accentColor,
      },
      {
        title: '04 基础模型与数据基础设施 (Foundation & Data Tier)',
        items: ['多模型路由引擎 (Gemini / Claude / Open)', '企业私有知识库 (Hybrid RAG)', '特征库与向量检索 (Milvus / pgvector)', '混合云与私有算力调度集群'],
        accent: theme.surfaceBorder,
      },
    ];

    const startY = 220;
    const layerHeight = 160;
    const gap = 20;
    const contentWidth = 1280;

    layers.forEach((layer, index) => {
      const y = startY + index * (layerHeight + gap);

      // Layer background container
      elements.push({
        id: `layer_box_${index}`,
        type: 'architecture_layer',
        role: 'layer',
        content: layer.title,
        geometry: { x: 100, y, width: contentWidth, height: layerHeight },
        style: {
          backgroundColor: theme.surfaceColor,
          borderColor: theme.surfaceBorder,
          borderWidth: 1,
          borderRadius: 12,
          padding: 20,
        },
        editable: true,
        zIndex: 5,
        metadata: { tierIndex: index },
      });

      // Layer Title
      elements.push({
        id: `layer_title_${index}`,
        type: 'text',
        role: 'title',
        content: layer.title,
        geometry: { x: 124, y: y + 16, width: 600, height: 28 },
        style: {
          fontSize: 16,
          fontWeight: 700,
          color: layer.accent,
        },
        editable: true,
        zIndex: 10,
      });

      // 4 Sub-boxes inside each layer
      const subBoxWidth = 280;
      const subGap = 16;
      layer.items.forEach((item, itemIdx) => {
        elements.push({
          id: `layer_item_${index}_${itemIdx}`,
          type: 'card',
          role: 'card',
          content: item,
          geometry: {
            x: 124 + itemIdx * (subBoxWidth + subGap),
            y: y + 54,
            width: subBoxWidth,
            height: 86,
          },
          style: {
            backgroundColor: `${theme.backgroundColor}90`,
            borderColor: `${theme.surfaceBorder}`,
            borderWidth: 1,
            borderRadius: 8,
            padding: 14,
            fontSize: 14,
            fontWeight: 600,
            color: theme.textPrimary,
          },
          editable: true,
          zIndex: 10,
        });
      });
    });

    // Right side strategic takeaway sidebar
    elements.push({
      id: `sidebar_card_${outline.slideId}`,
      type: 'card',
      role: 'card',
      content: {
        title: '架构设计原则',
        bullets: [
          '松耦合与协议标准化 (MCP)',
          '运行时确定性与沙箱安全隔离',
          '双循环自反思与动态重规划',
          '全链路低延迟与成本可控',
        ],
      },
      geometry: { x: 1420, y: startY, width: 400, height: 700 },
      style: {
        backgroundColor: `${theme.surfaceColor}cc`,
        borderColor: `${theme.accentColor}40`,
        borderWidth: 1,
        borderRadius: 14,
        padding: 28,
      },
      editable: true,
      zIndex: 10,
    });
  }

  /**
   * Layout: Cards Grid (3 or 4 Columns)
   */
  private static buildCardsGridLayout(
    elements: SlideElement[],
    outline: SlideOutlineItem,
    theme: TemplateTheme
  ) {
    const cards = outline.bulletPoints.length >= 3
      ? outline.bulletPoints.slice(0, 4).map((pt, i) => ({
          tag: `DIMENSION 0${i + 1}`,
          title: pt.split('：')[0] || `核心能力模块 0${i + 1}`,
          desc: pt.split('：')[1] || pt,
        }))
      : [
          {
            tag: 'ENGINEERING',
            title: '自主规划与意图分解',
            desc: '通过分层树状思考 (Tree of Thoughts) 与 ReAct 架构，将复杂商业目标拆解为数十步可执行的原子操作。',
          },
          {
            tag: 'TOOL INTEROP',
            title: '通用工具协议集成',
            desc: '标准化集成 MCP 协议与 OpenAPI，具备动态鉴权、参数校验、容错重试及跨系统数据管道整合能力。',
          },
          {
            tag: 'MEMORY HUB',
            title: '多维混合记忆机制',
            desc: '构建工作记忆（当前会话）、情境记忆（相似成功经验）与长期语义记忆（知识库）的协同调度检索。',
          },
          {
            tag: 'SAFETY & RISK',
            title: '确定性工程护栏',
            desc: '将非确定性 LLM 生成约束在确定性规则、代码执行沙箱、预算控制和双人复核门禁中。',
          },
        ];

    const cardCount = cards.length;
    const totalWidth = 1720;
    const gap = 24;
    const cardWidth = (totalWidth - (cardCount - 1) * gap) / cardCount;
    const startX = 100;
    const startY = 240;
    const cardHeight = 680;

    cards.forEach((c, i) => {
      const x = startX + i * (cardWidth + gap);

      // Card container
      elements.push({
        id: `grid_card_${i}`,
        type: 'card',
        role: 'card',
        content: c,
        geometry: { x, y: startY, width: cardWidth, height: cardHeight },
        style: {
          backgroundColor: theme.surfaceColor,
          borderColor: theme.surfaceBorder,
          borderWidth: 1,
          borderRadius: 14,
          padding: 32,
        },
        editable: true,
        zIndex: 5,
      });

      // Card Tag
      elements.push({
        id: `grid_tag_${i}`,
        type: 'text',
        role: 'badge',
        content: c.tag,
        geometry: { x: x + 28, y: startY + 32, width: cardWidth - 56, height: 26 },
        style: {
          fontSize: 13,
          fontWeight: 700,
          color: i === 0 ? theme.accentColor : theme.primaryColor,
          letterSpacing: '0.08em',
        },
        editable: true,
        zIndex: 10,
      });

      // Card Title
      elements.push({
        id: `grid_title_${i}`,
        type: 'text',
        role: 'title',
        content: c.title,
        geometry: { x: x + 28, y: startY + 70, width: cardWidth - 56, height: 60 },
        style: {
          fontSize: 22,
          fontWeight: 700,
          color: theme.textPrimary,
          fontFamily: theme.fontHeading,
          lineHeight: 1.3,
        },
        editable: true,
        zIndex: 10,
      });

      // Card Body
      elements.push({
        id: `grid_desc_${i}`,
        type: 'text',
        role: 'card',
        content: c.desc,
        geometry: { x: x + 28, y: startY + 144, width: cardWidth - 56, height: 380 },
        style: {
          fontSize: 15,
          fontWeight: 400,
          color: theme.textSecondary,
          lineHeight: 1.65,
        },
        editable: true,
        zIndex: 10,
      });
    });
  }

  /**
   * Layout: Problem vs Solution (左右对比)
   */
  private static buildProblemSolutionLayout(
    elements: SlideElement[],
    outline: SlideOutlineItem,
    theme: TemplateTheme
  ) {
    const colWidth = 830;
    const startY = 240;
    const height = 680;

    // Left Column: Challenges / Pain Points
    elements.push({
      id: `problem_box`,
      type: 'card',
      role: 'card',
      content: {
        title: '传统单体 / 浅层 AI 应用核心痛点',
        items: [
          '黑盒失控风险：Prompt 工程难以保证输出稳定性，幻觉难以从工程层面根除。',
          '孤岛与上下文丢失：缺乏统一状态管理与跨会话记忆，无法处理多步骤长链条任务。',
          '缺乏系统工具交互：大模型被孤立在对话框，无法直接操作底层 ERP / CRM / 内部 API。',
          '成本与安全失控：缺乏配额管理与审计日志，内部核心敏感数据面临泄露风险。',
        ],
      },
      geometry: { x: 100, y: startY, width: colWidth, height },
      style: {
        backgroundColor: `${theme.surfaceColor}`,
        borderColor: '#ef444433',
        borderWidth: 1,
        borderRadius: 14,
        padding: 36,
      },
      editable: true,
      zIndex: 5,
    });

    // Right Column: Target Solution
    elements.push({
      id: `solution_box`,
      type: 'card',
      role: 'card',
      content: {
        title: '企业级 Agent 架构体系化解法',
        items: [
          '分层规划与反思：引入 Planner-Executor 双层机制，执行前校验，执行后自检重试。',
          '混合持久化记忆：会话上下文、情景向量库与实体图谱紧密结合，沉淀企业专属认知。',
          '标准化 MCP 工具总线：安全沙箱内执行代码与 API 调用，支持精细化权限审批。',
          '全生命周期工程治理：可观测性 Tracing 监控、Token 熔断限流与安全合规防火墙。',
        ],
      },
      geometry: { x: 990, y: startY, width: colWidth, height },
      style: {
        backgroundColor: `${theme.surfaceColor}`,
        borderColor: `${theme.primaryColor}55`,
        borderWidth: 1,
        borderRadius: 14,
        padding: 36,
      },
      editable: true,
      zIndex: 5,
    });
  }

  /**
   * Layout: Timeline Roadmap (实施路线)
   */
  private static buildTimelineRoadmapLayout(
    elements: SlideElement[],
    outline: SlideOutlineItem,
    theme: TemplateTheme
  ) {
    const phases = [
      {
        phase: 'PHASE 01 · 探索验证',
        time: '第 1 - 2 个月',
        title: '场景试点与 PoC 闭环',
        deliverables: ['高频研发与客服场景试点', '基础 Prompt 模板与评估集', '模型评测与 ROI 核算报告'],
      },
      {
        phase: 'PHASE 02 · 底座构建',
        time: '第 3 - 5 个月',
        title: '统一运行时与工具总线',
        deliverables: ['企业 Agent 运行时平台上线', 'MCP 工具注册中心与沙箱', 'RAG 混合知识库与向量检索'],
      },
      {
        phase: 'PHASE 03 · 全面扩展',
        time: '第 6 - 9 个月',
        title: '多智能体协作与业务纵深',
        deliverables: ['跨部门复合 Agent 协同流', '长程规划与记忆持久化', '全链路 Tracing 与审计中心'],
      },
      {
        phase: 'PHASE 04 · 自主进化',
        time: '第 10 - 12 个月',
        title: '企业原生智能体生态',
        deliverables: ['业务人员自主搭编 Agent', '企业专属领域微调小模型', '自进化知识闭环与持续优化'],
      },
    ];

    const totalWidth = 1720;
    const stepWidth = 405;
    const gap = 33;
    const startX = 100;
    const startY = 280;

    // Timeline Connecting Bar
    elements.push({
      id: `timeline_bar`,
      type: 'shape',
      role: 'divider',
      content: '',
      geometry: { x: startX, y: startY + 40, width: totalWidth, height: 4 },
      style: {
        backgroundColor: theme.surfaceBorder,
      },
      editable: false,
      zIndex: 2,
    });

    phases.forEach((p, idx) => {
      const x = startX + idx * (stepWidth + gap);

      // Node Milestone Circle
      elements.push({
        id: `timeline_node_${idx}`,
        type: 'shape',
        role: 'badge',
        content: String(idx + 1),
        geometry: { x: x + 20, y: startY + 22, width: 40, height: 40 },
        style: {
          backgroundColor: idx === 0 ? theme.accentColor : theme.primaryColor,
          borderRadius: 20,
          color: '#ffffff',
          fontWeight: 700,
          fontSize: 16,
          textAlign: 'center',
          lineHeight: 40,
        },
        editable: false,
        zIndex: 5,
      });

      // Milestone Card
      elements.push({
        id: `timeline_card_${idx}`,
        type: 'card',
        role: 'card',
        content: p,
        geometry: { x, y: startY + 90, width: stepWidth, height: 550 },
        style: {
          backgroundColor: theme.surfaceColor,
          borderColor: theme.surfaceBorder,
          borderWidth: 1,
          borderRadius: 12,
          padding: 24,
        },
        editable: true,
        zIndex: 5,
      });
    });
  }

  /**
   * Layout: Stats & KPI (核心指标)
   */
  private static buildStatsKpiLayout(
    elements: SlideElement[],
    outline: SlideOutlineItem,
    theme: TemplateTheme
  ) {
    const stats = [
      {
        value: '78%',
        trend: '▼ 研发耗时下降',
        title: '研发协同效率提升',
        desc: '通过代码生成、单元测试与评审 Agent，端到端交付周期从 14 天缩短至 3 天。',
      },
      {
        value: '94.2%',
        trend: '▲ 意图理解准确率',
        title: '复杂意图识别与路由',
        desc: '引入两阶段语义分类与多模态反思，在业务复杂查询中达到行业领先水准。',
      },
      {
        value: '6.5x',
        trend: '▲ 投资回报率 (ROI)',
        title: '企业总体经济效益',
        desc: '第一财年落地即收回智能基础设施投资成本，人均业务吞吐量显著拉升。',
      },
      {
        value: '100%',
        trend: '✔ 生产安全零事故',
        title: '沙箱隔离与合规合规',
        desc: '严格贯彻输入过滤与确定性代码沙箱隔离，拦截各类非合规调用。',
      },
    ];

    const totalWidth = 1720;
    const cardWidth = 405;
    const gap = 33;
    const startX = 100;
    const startY = 250;

    stats.forEach((s, idx) => {
      const x = startX + idx * (cardWidth + gap);

      elements.push({
        id: `kpi_card_${idx}`,
        type: 'metric',
        role: 'metric',
        content: s,
        geometry: { x, y: startY, width: cardWidth, height: 650 },
        style: {
          backgroundColor: theme.surfaceColor,
          borderColor: theme.surfaceBorder,
          borderWidth: 1,
          borderRadius: 14,
          padding: 32,
        },
        editable: true,
        zIndex: 5,
      });
    });
  }

  /**
   * Layout: Radial / Center Framework (中心辐射)
   */
  private static buildRadialCenterLayout(
    elements: SlideElement[],
    outline: SlideOutlineItem,
    theme: TemplateTheme
  ) {
    const centerX = 960 - 200;
    const centerY = 580 - 100;

    // Center Core Card
    elements.push({
      id: `radial_center_node`,
      type: 'card',
      role: 'card',
      content: {
        tag: 'CORE ENGINE',
        title: '企业 Agent 核心能力中枢',
        desc: '统一状态机 · 上下文协调器 · 权限鉴权底座',
      },
      geometry: { x: centerX, y: centerY, width: 400, height: 200 },
      style: {
        backgroundColor: `${theme.primaryColor}22`,
        borderColor: theme.primaryColor,
        borderWidth: 2,
        borderRadius: 16,
        padding: 24,
        textAlign: 'center',
      },
      editable: true,
      zIndex: 10,
    });

    const satellites = [
      { x: 160, y: 260, title: '智能规划 (Planning)', desc: 'CoT/ReAct 分解与树状决策' },
      { x: 1260, y: 260, title: '混合工具 (Tool Mesh)', desc: '统一 MCP 协议与 API 网关' },
      { x: 160, y: 640, title: '全维记忆 (Memory Hub)', desc: '向量 RAG 与会话状态图谱' },
      { x: 1260, y: 640, title: '合规治理 (Guardrails)', desc: '隔离沙箱与预算限流熔断' },
    ];

    satellites.forEach((sat, i) => {
      elements.push({
        id: `radial_sat_${i}`,
        type: 'card',
        role: 'card',
        content: sat,
        geometry: { x: sat.x, y: sat.y, width: 500, height: 220 },
        style: {
          backgroundColor: theme.surfaceColor,
          borderColor: theme.surfaceBorder,
          borderWidth: 1,
          borderRadius: 14,
          padding: 24,
        },
        editable: true,
        zIndex: 5,
      });
    });
  }

  /**
   * Layout: Summary & Conclusion (总结展望)
   */
  private static buildSummaryLayout(
    elements: SlideElement[],
    outline: SlideOutlineItem,
    theme: TemplateTheme
  ) {
    elements.push({
      id: `summary_main_card`,
      type: 'card',
      role: 'card',
      content: {
        headline: '总结：企业走向 Agent-Native 智能体系的三大关键转变',
        points: [
          '从「问答工具」走向「生产力系统」：Agent 必须深度嵌入业务核心系统，具备直接操作和执行的能力。',
          '从「单点试水」走向「平台化工程」：需要统一标准化的运行时、工具注册中心、沙箱与可观测治理底座。',
          '从「人机对立」走向「人机协同共生」：构建人在回路 (Human-in-the-loop) 的权限审批与监督机制。',
        ],
      },
      geometry: { x: 100, y: 240, width: 1720, height: 420 },
      style: {
        backgroundColor: theme.surfaceColor,
        borderColor: theme.surfaceBorder,
        borderWidth: 1,
        borderRadius: 16,
        padding: 40,
      },
      editable: true,
      zIndex: 5,
    });

    // Action Checklist
    elements.push({
      id: `action_checklist`,
      type: 'card',
      role: 'card',
      content: {
        title: '下一步行动计划 (Next Steps)',
        actions: [
          '第 1 周：召开技术委员会研讨会，确立首批高价值 Agent 业务试点清单。',
          '第 3 周：搭建企业级开发沙箱与安全守卫规范，验证 MCP 标准对接。',
          '第 6 周：首个原型系统上线试点部门，完成首轮业务效果与成本评估。',
        ],
      },
      geometry: { x: 100, y: 690, width: 1720, height: 240 },
      style: {
        backgroundColor: `${theme.primaryColor}15`,
        borderColor: `${theme.primaryColor}35`,
        borderWidth: 1,
        borderRadius: 14,
        padding: 30,
      },
      editable: true,
      zIndex: 5,
    });
  }
}
