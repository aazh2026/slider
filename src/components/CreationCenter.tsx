/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Sparkles, FileText, Upload, Sliders, CheckCircle2, ArrowRight, Wand2, Sun, Moon } from 'lucide-react';
import { PresentationRequirement, TemplateIR } from '@ppt/core';
import { BUILT_IN_TEMPLATES } from '@ppt/core';

interface CreationCenterProps {
  requirement: PresentationRequirement;
  selectedTemplate: TemplateIR;
  onSelectTemplate: (t: TemplateIR) => void;
  onGenerateOutline: (req: PresentationRequirement) => Promise<void>;
  isGenerating: boolean;
}

const PRESET_TOPICS = [
  {
    label: '企业 AI Agent 技术架构规划 (深色商务)',
    prompt: '帮我制作一份企业 AI Agent 技术架构规划汇报，面向公司技术管理层，约 6-8 页，重点介绍 Agent 技术发展趋势、企业分层架构、工程体系、实施路线和组织能力建设。整体风格专业、简洁、科技感。',
    audience: '公司技术管理层、CTO、架构委员会',
    purpose: '技术战略与架构设计汇报',
    templateId: 'tpl_tech_blue',
  },
  {
    label: '麦肯锡咨询战略分析 (浅色纯白)',
    prompt: '面向企业集团董事会，制作一份战略数字化转型与核心竞争壁垒分析 PPT，约 6 页，涵盖市场演进格局、核心突破瓶颈、战略四大支柱与未来 12 个月实施路线。风格为高对比度麦肯锡经典纯白。',
    audience: '集团董事会与高级管理层',
    purpose: '战略转型评估与投资决策',
    templateId: 'tpl_mckinsey_white',
  },
  {
    label: 'B2B 现代产品商业计划书 (浅色明亮)',
    prompt: '面向中早期顶级投资人，制作一份智能供应链协同 SaaS 平台的商业融资路演 PPT，约 6 页，涵盖市场痛点、产品创新、核心指标、商业模式与未来路线。风格现代明亮白底。',
    audience: 'VC 投资机构与董事会合伙人',
    purpose: '商业融资路演与产品价值呈现',
    templateId: 'tpl_modern_light',
  },
];

export const CreationCenter: React.FC<CreationCenterProps> = ({
  requirement,
  selectedTemplate,
  onSelectTemplate,
  onGenerateOutline,
  isGenerating,
}) => {
  const [topicPrompt, setTopicPrompt] = useState(
    '帮我制作一份企业 AI Agent 技术架构规划汇报，面向公司技术管理层，约 6 页，重点介绍 Agent 技术发展趋势、企业架构、工程体系、实施路线和组织能力建设。整体风格专业、简洁、科技感。'
  );
  const [docContent, setDocContent] = useState('');
  const [audience, setAudience] = useState(requirement.audience || '公司技术管理层、CTO、架构委员会');
  const [purpose, setPurpose] = useState(requirement.purpose || '技术战略与架构演进规划汇报');
  const [pageCount, setPageCount] = useState(requirement.pageCount || 6);
  const [styleDesc, setStyleDesc] = useState(requirement.style || '专业、简洁、科技感、分层严谨');

  const applyPreset = (preset: typeof PRESET_TOPICS[0]) => {
    setTopicPrompt(preset.prompt);
    setAudience(preset.audience);
    setPurpose(preset.purpose);
    const matchedTpl = BUILT_IN_TEMPLATES.find((t) => t.templateId === preset.templateId);
    if (matchedTpl) onSelectTemplate(matchedTpl);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onGenerateOutline({
      topic: topicPrompt.length > 40 ? topicPrompt.slice(0, 30) : topicPrompt,
      purpose,
      audience,
      pageCount,
      style: styleDesc,
      depth: '技术战略与架构设计',
      aspectRatio: '16:9',
      rawNotes: docContent,
    });
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950 p-6 md:p-10 flex flex-col items-center transition-colors">
      <div className="w-full max-w-6xl space-y-8">
        {/* Header Kicker & Title */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 text-xs font-semibold tracking-wide">
            <Sparkles className="w-3.5 h-3.5" />
            AI-Native Presentation Studio · 智能全链路创作
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            从想法与资料直接生成专业级架构与商业演示文稿
          </h1>
          <p className="text-sm md:text-base text-slate-600 dark:text-slate-400 max-w-2xl mx-auto">
            支持原生浅色纯白与深色沉浸主题，基于结构化 Slide IR 页面模型与矢量渲染，告别低质幻觉与错位。
          </p>
        </div>

        {/* Quick Presets */}
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          <span className="text-xs text-slate-500 font-medium mr-1">推荐场景预设:</span>
          {PRESET_TOPICS.map((preset, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => applyPreset(preset)}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-800 transition-colors shadow-xs"
            >
              {preset.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Natural Language Input & Documents */}
          <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5 shadow-sm">
            <div>
              <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider mb-2 flex items-center justify-between">
                <span>01. 需求与主题输入 (Topic & Context)</span>
                <span className="text-slate-400 dark:text-slate-500 font-normal">支持直接描述或粘贴大纲</span>
              </label>
              <textarea
                rows={5}
                value={topicPrompt}
                onChange={(e) => setTopicPrompt(e.target.value)}
                data-testid="topic-prompt"
                placeholder="例如：帮我制作一份企业 AI Agent 技术架构规划汇报，重点阐述分层架构与实施路线..."
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-3.5 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors resize-none leading-relaxed"
                required
              />
            </div>

            {/* Document Material Uploader / Paste */}
            <div>
              <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  <span>02. 参考资料与已有文档 (可选补充)</span>
                </span>
                <span className="text-slate-400 dark:text-slate-500 font-normal">Word / Markdown / 会议纪要</span>
              </label>
              <textarea
                rows={4}
                value={docContent}
                onChange={(e) => setDocContent(e.target.value)}
                placeholder="粘贴技术白皮书、架构规范、产品 PRD 或关键数据要点，AI 将自动分析提取结构化内容..."
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-3.5 text-xs text-slate-900 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:border-blue-500 transition-colors resize-none font-mono"
              />
            </div>

            {/* Template Selector Strip (Showcasing both Light & Dark themes) */}
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                  03. 设计系统与模板规范 (Design Tokens)
                </label>
                <span className="text-[11px] text-blue-600 dark:text-blue-400 font-semibold">
                  {selectedTemplate.theme.isDark ? '🌙 当前选用深色底' : '☀️ 当前选用浅色底'}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {BUILT_IN_TEMPLATES.map((t) => {
                  const isSelected = selectedTemplate.templateId === t.templateId;
                  return (
                    <button
                      key={t.templateId}
                      type="button"
                      onClick={() => onSelectTemplate(t)}
                      className={`text-left p-3 rounded-lg border transition-all text-xs relative cursor-pointer ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10 shadow-xs'
                          : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-3.5 h-3.5 rounded-full border border-slate-300 dark:border-white/20"
                            style={{ backgroundColor: t.theme.primaryColor }}
                          />
                          <span
                            className="w-3.5 h-3.5 rounded-full border border-slate-300 dark:border-white/20"
                            style={{ backgroundColor: t.theme.accentColor }}
                          />
                        </div>
                        {isSelected ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                        ) : (
                          <span className="text-[10px] text-slate-400 font-mono">
                            {t.theme.isDark ? '深' : '浅'}
                          </span>
                        )}
                      </div>
                      <div className="font-bold text-slate-800 dark:text-slate-200 truncate">{t.name.split(' ')[0]}</div>
                      <div className="text-[11px] text-slate-500 truncate mt-0.5">{t.category.split('/')[0]}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Column: AI Extracted Parameters & Controls */}
          <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5 shadow-sm">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                <span>AI 需求结构化参数</span>
              </span>
              <span className="text-[11px] text-slate-400 dark:text-slate-500">生成前可自定义修改</span>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">汇报目标 (Purpose)</label>
                <input
                  type="text"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-3 py-2 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">目标受众 (Target Audience)</label>
                <input
                  type="text"
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-3 py-2 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-slate-600 dark:text-slate-400">预期页数 (Slide Count)</label>
                  <span className="font-mono font-bold text-blue-600 dark:text-blue-400">{pageCount} 页</span>
                </div>
                <input
                  type="range"
                  min={4}
                  max={12}
                  step={1}
                  value={pageCount}
                  onChange={(e) => setPageCount(Number(e.target.value))}
                  className="w-full accent-blue-600 cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-slate-400 dark:text-slate-500 mt-1 font-mono">
                  <span>精简 (4页)</span>
                  <span>标准架构汇报 (6-8页)</span>
                  <span>全面深度 (12页)</span>
                </div>
              </div>

              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">视觉调性要求 (Visual Style)</label>
                <input
                  type="text"
                  value={styleDesc}
                  onChange={(e) => setStyleDesc(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-3 py-2 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-600 dark:text-slate-400 space-y-1">
                <div className="text-slate-800 dark:text-slate-300 font-semibold flex items-center gap-1.5">
                  <Wand2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  <span>确定性工程质量守卫</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  系统将依据所选模板严格执行网格约束、防溢出排版及图文语义对齐，保证每一页具备独立可编辑性。
                </p>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isGenerating || !topicPrompt.trim()}
              data-testid="generate-outline"
              className="w-full py-3 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 active:scale-98 text-white rounded-lg font-bold text-sm shadow-md shadow-blue-900/30 flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isGenerating ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>AI Agent 正在分析需求并生成大纲...</span>
                </>
              ) : (
                <>
                  <span>生成结构化大纲 (Outline Agent)</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
