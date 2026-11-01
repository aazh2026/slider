/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Layout,
  Sparkles,
  ArrowRight,
  Edit3,
  Check,
  RotateCcw,
} from 'lucide-react';
import { SlideOutlineItem, SlideLayoutType } from '../types/slide';

interface OutlineEditorProps {
  outline: SlideOutlineItem[];
  onUpdateOutline: (outline: SlideOutlineItem[]) => void;
  onConfirmAndGenerateSlides: () => Promise<void>;
  isCompiling: boolean;
}

const LAYOUT_OPTIONS: Array<{ value: SlideLayoutType; label: string; desc: string }> = [
  { value: 'title_cover', label: '封面型 (Cover)', desc: '居中/居左大标题与汇报背景' },
  { value: 'architecture_diagram', label: '分层架构 (Architecture)', desc: '四层水平架构条与组件单元' },
  { value: 'cards_grid', label: '多卡片分析 (Cards Grid)', desc: '三/四列能力维度与技术柱' },
  { value: 'problem_solution', label: '问题与方案 (Comparison)', desc: '左侧痛点瓶颈 vs 右侧对策突破' },
  { value: 'timeline_roadmap', label: '实施路线 (Timeline)', desc: '分阶段时间轴与交付里程碑' },
  { value: 'stats_kpi', label: '核心指标 (KPI Dashboard)', desc: '超大关键数据指标与商业成效' },
  { value: 'radial_center', label: '中心辐射 (Center Core)', desc: '核心引擎与四大外围能力' },
  { value: 'summary_conclusion', label: '总结展望 (Summary)', desc: '核心共识与近期行动清单' },
];

export const OutlineEditor: React.FC<OutlineEditorProps> = ({
  outline,
  onUpdateOutline,
  onConfirmAndGenerateSlides,
  isCompiling,
}) => {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const handleFieldChange = (index: number, field: keyof SlideOutlineItem, value: any) => {
    const updated = [...outline];
    updated[index] = { ...updated[index], [field]: value };
    onUpdateOutline(updated);
  };

  const handleMove = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === outline.length - 1) return;
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    const updated = [...outline];
    const [moved] = updated.splice(index, 1);
    updated.splice(targetIdx, 0, moved);
    updated.forEach((item, i) => {
      item.order = i + 1;
    });
    onUpdateOutline(updated);
  };

  const handleDelete = (index: number) => {
    if (outline.length <= 1) return;
    const updated = outline.filter((_, i) => i !== index);
    updated.forEach((item, i) => {
      item.order = i + 1;
    });
    onUpdateOutline(updated);
  };

  const handleAddSlide = () => {
    const newSlide: SlideOutlineItem = {
      slideId: `slide_${Date.now()}`,
      order: outline.length + 1,
      title: '新页面主题：技术落地与保障措施',
      purpose: '阐述配套工程措施与技术风险防御方案',
      keyMessage: '以成熟的工程实践与全生命周期监控守护系统平稳运行',
      visualIntent: 'cards_grid',
      layoutPreference: 'cards_grid',
      requiredElements: ['保障维度', '核心策略'],
      speakerNotes: '介绍技术安全与容灾保障体系。',
      bulletPoints: [
        '自动化故障注入与混沌工程演练',
        '多机房双活与高可用容灾容错',
        '7x24 小时全链路指标告警监控',
      ],
    };
    onUpdateOutline([...outline, newSlide]);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950 p-6 md:p-10 flex flex-col items-center transition-colors">
      <div className="w-full max-w-5xl space-y-6">
        {/* Top Header & Action */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">AI 演示文稿结构化大纲</h2>
              <span className="text-xs px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 font-mono font-bold">
                共 {outline.length} 页
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
              大纲是页面生成的骨架约束。您可以微调标题、修改一句话核心结论或调整推荐版式。
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleAddSlide}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg transition-colors cursor-pointer shadow-xs"
            >
              <Plus className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>新增页面</span>
            </button>

            <button
              onClick={onConfirmAndGenerateSlides}
              disabled={isCompiling}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 active:scale-98 text-white rounded-lg font-bold text-xs shadow-md shadow-blue-900/30 transition-all cursor-pointer disabled:opacity-50"
            >
              {isCompiling ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>正在渲染全部页面...</span>
                </>
              ) : (
                <>
                  <span>确认大纲并进入 PPT 工作台</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </div>

        {/* Outline Slide Cards List */}
        <div className="space-y-4">
          {outline.map((item, index) => {
            const isEditing = editingIndex === index;
            const currentLayout = LAYOUT_OPTIONS.find((l) => l.value === item.layoutPreference);

            return (
              <div
                key={item.slideId || index}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700/80 rounded-xl p-5 transition-all shadow-sm group"
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Left: Slide Number & Header */}
                  <div className="flex items-start gap-3.5 flex-1">
                    <span className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-center font-mono font-bold text-xs text-blue-600 dark:text-blue-400 shrink-0">
                      {String(index + 1).padStart(2, '0')}
                    </span>

                    <div className="flex-1 space-y-2">
                      {/* Title */}
                      {isEditing ? (
                        <input
                          type="text"
                          value={item.title}
                          onChange={(e) => handleFieldChange(index, 'title', e.target.value)}
                          className="w-full bg-slate-50 dark:bg-slate-950 border border-blue-500 rounded px-2.5 py-1 text-sm font-bold text-slate-900 dark:text-white focus:outline-none"
                        />
                      ) : (
                        <h3 className="text-base font-bold text-slate-900 dark:text-white leading-snug">{item.title}</h3>
                      )}

                      {/* Purpose & Key message */}
                      <div className="text-xs space-y-1.5 text-slate-600 dark:text-slate-300">
                        <div className="flex items-start gap-2">
                          <span className="text-slate-400 dark:text-slate-500 shrink-0">页面目标:</span>
                          {isEditing ? (
                            <input
                              type="text"
                              value={item.purpose}
                              onChange={(e) => handleFieldChange(index, 'purpose', e.target.value)}
                              className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-2 py-0.5 text-xs text-slate-900 dark:text-slate-200"
                            />
                          ) : (
                            <span className="text-slate-600 dark:text-slate-400">{item.purpose}</span>
                          )}
                        </div>

                        <div className="flex items-start gap-2">
                          <span className="text-amber-600 dark:text-amber-400/90 font-medium shrink-0">核心结论:</span>
                          {isEditing ? (
                            <input
                              type="text"
                              value={item.keyMessage}
                              onChange={(e) => handleFieldChange(index, 'keyMessage', e.target.value)}
                              className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-2 py-0.5 text-xs text-slate-900 dark:text-slate-200"
                            />
                          ) : (
                            <span className="text-slate-800 dark:text-slate-300 font-medium">{item.keyMessage}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right: Layout Selector & Reorder Tools */}
                  <div className="flex flex-col items-end gap-3 shrink-0">
                    <div className="flex items-center gap-1.5">
                      {/* Layout badge selector */}
                      <select
                        value={item.layoutPreference}
                        onChange={(e) =>
                          handleFieldChange(index, 'layoutPreference', e.target.value as SlideLayoutType)
                        }
                        className="bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-xs px-2.5 py-1 rounded cursor-pointer focus:outline-none focus:border-blue-500 font-medium"
                      >
                        {LAYOUT_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>

                      {/* Edit toggle button */}
                      <button
                        onClick={() => setEditingIndex(isEditing ? null : index)}
                        className="p-1.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        title={isEditing ? '保存' : '编辑细节'}
                      >
                        {isEditing ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Edit3 className="w-3.5 h-3.5" />}
                      </button>

                      {/* Move controls */}
                      <div className="flex items-center gap-0.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded p-0.5">
                        <button
                          onClick={() => handleMove(index, 'up')}
                          disabled={index === 0}
                          className="p-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                          title="上移"
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleMove(index, 'down')}
                          disabled={index === outline.length - 1}
                          className="p-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                          title="下移"
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Delete */}
                      <button
                        onClick={() => handleDelete(index)}
                        disabled={outline.length <= 1}
                        className="p-1.5 text-slate-400 hover:text-rose-500 dark:text-slate-500 dark:hover:text-rose-400 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        title="删除本页"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="text-[11px] text-slate-500 font-mono">
                      {currentLayout?.desc}
                    </div>
                  </div>
                </div>

                {/* Expanded Bullets Details */}
                {item.bulletPoints && item.bulletPoints.length > 0 && (
                  <div className="mt-3.5 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap gap-2 text-xs">
                    {item.bulletPoints.map((pt, pIdx) => (
                      <span
                        key={pIdx}
                        className="text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800/80 px-2.5 py-1 rounded text-[11px]"
                      >
                        {pt}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Bottom CTA Bar */}
        <div className="flex items-center justify-between p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs">
          <div className="text-xs text-slate-600 dark:text-slate-400">
            全部大纲已校验结构完整性，点击右侧按钮生成高保真矢量 Slide IR。
          </div>
          <button
            onClick={onConfirmAndGenerateSlides}
            disabled={isCompiling}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 active:scale-98 text-white rounded-lg font-bold text-xs shadow-md shadow-blue-900/30 transition-all cursor-pointer disabled:opacity-50"
          >
            {isCompiling ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>正在生成页面...</span>
              </>
            ) : (
              <>
                <span>确认大纲并进入 PPT 工作台</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
