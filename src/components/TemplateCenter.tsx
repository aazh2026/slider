/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Palette, Upload, CheckCircle2, Sparkles, Sliders, ArrowRight, Layers, FileCode, Sun, Moon } from 'lucide-react';
import { TemplateIR, PresentationProject } from '@ppt/core';
import { BUILT_IN_TEMPLATES } from '@ppt/core';

interface TemplateCenterProps {
  currentTemplate: TemplateIR;
  /**
   * 应用模板 —— **服务端权威**。
   *
   * 返回值是"服务端有没有接受"：失败时父组件**不会**改本地状态，
   * 这里也就不能继续往下改幻灯片样式 ——
   * 否则界面会显示"用上了"，而服务端还挂着旧模板。
   */
  onApplyTemplate: (t: TemplateIR) => Promise<boolean>;
  project: PresentationProject;
  onUpdateProject: (p: PresentationProject) => void;
}

export const TemplateCenter: React.FC<TemplateCenterProps> = ({
  currentTemplate,
  onApplyTemplate,
  project,
  onUpdateProject,
}) => {
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'light' | 'dark' | 'tech' | 'executive'>('all');
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedTemplate, setExtractedTemplate] = useState<TemplateIR | null>(null);

  const filteredTemplates = BUILT_IN_TEMPLATES.filter((t) => {
    if (selectedFilter === 'all') return true;
    if (selectedFilter === 'light') return !t.theme.isDark;
    if (selectedFilter === 'dark') return t.theme.isDark;
    if (selectedFilter === 'tech') return t.category.includes('技术') || t.category.includes('架构');
    if (selectedFilter === 'executive') return t.category.includes('高管') || t.category.includes('战略') || t.category.includes('咨询');
    return true;
  });

  const handleSimulateExtract = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsExtracting(true);
    try {
      const res = await fetch('/api/ai/extract-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name }),
      });
      const data = await res.json();
      setExtractedTemplate(data);
    } catch (err) {
      console.warn('Extraction fallback:', err);
    } finally {
      setIsExtracting(false);
    }
  };

  const applyTemplateToProject = async (t: TemplateIR) => {
    // 先落到服务端 —— 服务端不认（模板不存在 / 不属于当前用户）就到此为止。
    // 本地状态一个字都不改：界面不能显示一个服务端根本没存下来的模板。
    const applied = await onApplyTemplate(t);
    if (!applied) return;

    // Deep remap all slide elements for light/dark palette consistency
    const updatedSlides = project.slides.map((s) => {
      const newElements = s.elements.map((el) => {
        if (el.role === 'background') {
          return { ...el, style: { ...el.style, backgroundColor: t.theme.backgroundColor } };
        }
        if (el.id.startsWith('header_')) {
          return { ...el, style: { ...el.style, color: t.theme.accentColor } };
        }
        if (el.role === 'title') {
          return { ...el, style: { ...el.style, color: t.theme.textPrimary } };
        }
        if (el.role === 'subtitle' || el.role === 'footer') {
          return { ...el, style: { ...el.style, color: t.theme.textSecondary } };
        }
        if (el.role === 'card' || el.role === 'layer' || el.role === 'metric') {
          return {
            ...el,
            style: {
              ...el.style,
              backgroundColor: t.theme.surfaceColor,
              borderColor: t.theme.surfaceBorder,
              color: t.theme.textPrimary,
            },
          };
        }
        if (el.role === 'badge') {
          return {
            ...el,
            style: {
              ...el.style,
              color: t.theme.accentColor,
              backgroundColor: t.theme.isDark ? `${t.theme.accentColor}20` : `${t.theme.accentColor}15`,
              borderColor: t.theme.accentColor,
            },
          };
        }
        if (el.role === 'divider') {
          return {
            ...el,
            style: {
              ...el.style,
              backgroundColor: el.id.includes('accent') ? t.theme.accentColor : t.theme.surfaceBorder,
            },
          };
        }
        return el;
      });
      return { ...s, elements: newElements };
    });

    onUpdateProject({
      ...project,
      template: t,
      slides: updatedSlides,
      updatedAt: Date.now(),
    });
  };

  return (
    <div
      data-testid="template-center"
      className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950 p-6 md:p-10 flex flex-col items-center transition-colors"
    >
      <div className="w-full max-w-6xl space-y-8">
        {/* Title Header */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-6 border-b border-slate-200 dark:border-slate-800">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 text-xs font-semibold tracking-wide mb-2">
              <Palette className="w-3.5 h-3.5" />
              <span>Design System · 模板与设计资产中心</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              浅色与深色背景主题库 · 结构化设计系统
            </h1>
            <p className="text-xs md:text-sm text-slate-600 dark:text-slate-400 mt-1 max-w-2xl">
              提供经典浅色（麦肯锡白、北欧浅灰、现代极简白、暖沙象牙白）与沉浸深色主题，支持母版规范与元素级高保真映射。
            </p>
          </div>

          {/* PPT Upload Extractor Trigger */}
          <div className="relative">
            <input
              type="file"
              accept=".pptx,.pdf,.png,.jpg"
              onChange={handleSimulateExtract}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            />
            <button
              disabled={isExtracting}
              className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 active:scale-98 text-white rounded-lg font-bold text-xs shadow-md shadow-indigo-900/30 transition-all cursor-pointer disabled:opacity-50"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{isExtracting ? '正在解析 OOXML 与视觉规范...' : '从现有 PPTX 提取模板'}</span>
            </button>
          </div>
        </div>

        {/* Extracted Template Banner if available */}
        {extractedTemplate && (
          <div className="p-5 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-500/30 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span className="font-bold text-sm text-slate-900 dark:text-white">
                  已成功提取模板资产：{extractedTemplate.name}
                </span>
              </div>
              <button
                onClick={() => void applyTemplateToProject(extractedTemplate)}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
              >
                应用到当前项目
              </button>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              已完成母版色板、一级标题字阶 (48px) 与组件间距的结构化提取，可直接应用于全部页面生成。
            </p>
          </div>
        )}

        {/* Segmented Filter Control */}
        <div className="flex items-center gap-1.5 p-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg max-w-xl shadow-xs">
          <button
            onClick={() => setSelectedFilter('all')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
              selectedFilter === 'all' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            全部 ({BUILT_IN_TEMPLATES.length})
          </button>
          <button
            onClick={() => setSelectedFilter('light')}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
              selectedFilter === 'light' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Sun className="w-3.5 h-3.5" />
            <span>浅色背景主题</span>
          </button>
          <button
            onClick={() => setSelectedFilter('dark')}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
              selectedFilter === 'dark' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Moon className="w-3.5 h-3.5" />
            <span>深色背景主题</span>
          </button>
          <button
            onClick={() => setSelectedFilter('tech')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
              selectedFilter === 'tech' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            技术架构
          </button>
          <button
            onClick={() => setSelectedFilter('executive')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
              selectedFilter === 'executive' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            战略咨询
          </button>
        </div>

        {/* Template Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredTemplates.map((template) => {
            const isSelected = currentTemplate.templateId === template.templateId;

            return (
              <div
                key={template.templateId}
                className={`bg-white dark:bg-slate-900 rounded-xl border p-5 flex flex-col justify-between transition-all shadow-sm group ${
                  isSelected
                    ? 'border-blue-500 ring-2 ring-blue-500/30'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div>
                  {/* Miniature Presentation Cover Mockup */}
                  <div
                    className="w-full aspect-[16/9] rounded-lg p-4 mb-4 border relative overflow-hidden flex flex-col justify-between shadow-xs"
                    style={{
                      backgroundColor: template.theme.backgroundColor,
                      borderColor: template.theme.surfaceBorder,
                    }}
                  >
                    <div className="flex items-center justify-between text-[9px] font-mono" style={{ color: template.theme.textSecondary }}>
                      <span>{template.master.logoText}</span>
                      <span>01 / 06</span>
                    </div>

                    <div className="space-y-1.5 my-auto">
                      <div
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded inline-block"
                        style={{
                          backgroundColor: `${template.theme.accentColor}20`,
                          color: template.theme.accentColor,
                        }}
                      >
                        {template.theme.isDark ? 'DARK THEME' : 'LIGHT THEME'}
                      </div>
                      <div
                        className="text-sm font-extrabold leading-tight"
                        style={{ color: template.theme.textPrimary }}
                      >
                        企业级 AI Agent 技术架构规划
                      </div>
                      <div
                        className="text-[10px] leading-tight"
                        style={{ color: template.theme.textSecondary }}
                      >
                        面向技术管理层的生产级演进体系
                      </div>
                    </div>

                    {/* Color Palette Dots */}
                    <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: `${template.theme.surfaceBorder}80` }}>
                      <div className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded-full border border-slate-300 dark:border-white/20" style={{ backgroundColor: template.theme.primaryColor }} />
                        <span className="w-3 h-3 rounded-full border border-slate-300 dark:border-white/20" style={{ backgroundColor: template.theme.secondaryColor }} />
                        <span className="w-3 h-3 rounded-full border border-slate-300 dark:border-white/20" style={{ backgroundColor: template.theme.accentColor }} />
                        <span className="w-3 h-3 rounded-full border border-slate-300 dark:border-white/20" style={{ backgroundColor: template.theme.surfaceColor }} />
                      </div>
                      <span className="text-[10px] font-mono text-slate-400">
                        {template.theme.isDark ? '深色' : '浅色'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mb-1.5">
                    <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-1.5">
                      <span>{template.name}</span>
                    </h3>
                    {isSelected && (
                      <span className="text-blue-600 dark:text-blue-400 flex items-center gap-1 text-xs font-bold">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>当前使用</span>
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                    {template.description}
                  </p>
                </div>

                {/* Apply Button */}
                <button
                  onClick={() => void applyTemplateToProject(template)}
                  className={`w-full py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    isSelected
                      ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-500/40 cursor-default'
                      : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {isSelected ? '已应用到当前演示文稿' : '应用此模板规范'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
