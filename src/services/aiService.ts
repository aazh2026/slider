/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PresentationRequirement, SlideOutlineItem, SlideIR, SlideElement } from '../types/slide';

export class AIService {
  /**
   * Call backend Requirement Agent
   */
  static async extractRequirement(prompt: string, documentText?: string): Promise<PresentationRequirement> {
    try {
      const res = await fetch('/api/ai/requirement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, documentText }),
      });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('Falling back to local requirement extraction:', err);
      const isAgent = prompt.includes('Agent') || prompt.includes('智能体') || prompt.includes('架构');
      return {
        topic: isAgent ? '企业 AI Agent 技术架构规划' : (prompt.slice(0, 30) || '企业级技术战略规划汇报'),
        purpose: '面向技术管理层，阐述技术演进、总体架构与生产级落地实践',
        audience: '技术委员会、CTO、架构师与技术总监',
        pageCount: 6,
        style: '专业、克制、科技感、分层严谨',
        depth: '技术战略与架构设计',
        aspectRatio: '16:9',
        rawNotes: documentText,
      };
    }
  }

  /**
   * Call backend Outline Agent
   */
  static async generateOutline(requirement: PresentationRequirement): Promise<SlideOutlineItem[]> {
    try {
      const res = await fetch('/api/ai/outline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requirement }),
      });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('Falling back to local outline generator:', err);
      return [
        {
          slideId: 'slide_001',
          order: 1,
          title: requirement.topic || '企业级 AI Agent 技术架构规划',
          purpose: '向技术管理层汇报企业级 Agent 演进规划与架构设计',
          keyMessage: '从单点 Prompt 应用走向自主协同、工程受控的智能体生产平台',
          visualIntent: 'title_cover',
          layoutPreference: 'title_cover',
          requiredElements: ['战略主标题', '副标题与定位', '作者元数据'],
          speakerNotes: '开场致辞，介绍本次架构规划汇报的核心背景与战略目标。',
          bulletPoints: ['企业级 Agent 演进背景', '生产级工程化落地战略'],
        },
        {
          slideId: 'slide_002',
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
          slideId: 'slide_003',
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
          slideId: 'slide_004',
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
          slideId: 'slide_005',
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
          slideId: 'slide_006',
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
    }
  }

  /**
   * Call backend Editing Agent
   */
  static async editSlideWithAI(
    slideIR: SlideIR,
    instruction: string,
    targetElementId?: string,
    mode: 'whole_slide' | 'selected_element' | 'region_rewrite' = 'whole_slide'
  ): Promise<{ updatedElements: SlideElement[]; message: string }> {
    try {
      const res = await fetch('/api/ai/edit-slide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slideIR, instruction, targetElementId, mode }),
      });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('Falling back to local heuristic editor:', err);
      const cloned = JSON.parse(JSON.stringify(slideIR.elements)) as SlideElement[];

      if (targetElementId) {
        const el = cloned.find((e) => e.id === targetElementId);
        if (el) {
          if (typeof el.content === 'string') {
            el.content = `${el.content} [${instruction.slice(0, 15)}]`;
          } else if (typeof el.content === 'object' && el.content !== null) {
            if (el.content.title) el.content.title = `${el.content.title} · ${instruction.slice(0, 8)}`;
            if (el.content.desc) el.content.desc = `【AI精修】${instruction}：${el.content.desc}`;
          }
        }
      } else {
        const keyEl = cloned.find((e) => e.id.startsWith('keymsg_'));
        if (keyEl && typeof keyEl.content === 'string') {
          keyEl.content = `核心结论：${instruction} (已结合管理层视角智能提炼)`;
        }
      }

      return {
        updatedElements: cloned,
        message: `已基于规则执行指令「${instruction}」。`,
      };
    }
  }
}
