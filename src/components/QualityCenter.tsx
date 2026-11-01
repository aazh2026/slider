/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ShieldCheck, AlertCircle, CheckCircle2, Wand2, Layers, ArrowRight } from 'lucide-react';
import { PresentationProject, QualityReport } from '../types/slide';
import { QualityEngine } from '../engine/qualityEngine';

interface QualityCenterProps {
  project: PresentationProject;
  onUpdateProject: (p: PresentationProject) => void;
  onOpenWorkbench: () => void;
}

export const QualityCenter: React.FC<QualityCenterProps> = ({
  project,
  onUpdateProject,
  onOpenWorkbench,
}) => {
  const report: QualityReport = project.qualityReport || QualityEngine.evaluatePresentation(project);

  const handleAutoFix = () => {
    const fixed = QualityEngine.autoFixProject(project);
    onUpdateProject(fixed);
  };

  const getScoreColor = (score: number) => {
    if (score >= 90) return 'text-emerald-600 dark:text-emerald-400';
    if (score >= 75) return 'text-blue-600 dark:text-blue-400';
    if (score >= 60) return 'text-amber-600 dark:text-amber-400';
    return 'text-rose-600 dark:text-rose-400';
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950 p-6 md:p-10 flex flex-col items-center transition-colors">
      <div className="w-full max-w-5xl space-y-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-6 border-b border-slate-200 dark:border-slate-800">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 text-xs font-semibold tracking-wide mb-2">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>4-Layer Quality Assurance · 四层质量保障体系</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              演示文稿全局一致性与设计质量体检报告
            </h1>
            <p className="text-xs md:text-sm text-slate-600 dark:text-slate-400 mt-1">
              综合评估结构合法性 (Qs)、视觉与几何碰撞 (Qv)、内容论据密度 (Qc) 与全局叙事风格一致性 (Qg)。
            </p>
          </div>

          <button
            onClick={handleAutoFix}
            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 active:scale-98 text-white rounded-lg font-bold text-xs shadow-md shadow-indigo-900/30 transition-all cursor-pointer"
          >
            <Wand2 className="w-3.5 h-3.5" />
            <span>一键应用智能合规修复</span>
          </button>
        </div>

        {/* 4 Dimension Score Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Overall Q */}
          <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-1 shadow-xs">
            <div className={`text-4xl font-extrabold font-mono ${getScoreColor(report.overallScore)}`}>
              {report.overallScore}
            </div>
            <div className="text-xs font-bold text-slate-900 dark:text-white">综合质量指数 (Q)</div>
            <div className="text-[11px] text-slate-500 font-mono">
              Q = 0.3·Qs + 0.3·Qv + 0.2·Qc + 0.2·Qg
            </div>
          </div>

          {/* Qs Structure */}
          <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-1 shadow-xs">
            <div className={`text-4xl font-extrabold font-mono ${getScoreColor(report.structureScore)}`}>
              {report.structureScore}
            </div>
            <div className="text-xs font-bold text-slate-900 dark:text-white">第一层：结构合法性 (Qs)</div>
            <div className="text-[11px] text-slate-500">IR Schema / 节点与ID合法率</div>
          </div>

          {/* Qv Visual */}
          <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-1 shadow-xs">
            <div className={`text-4xl font-extrabold font-mono ${getScoreColor(report.visualScore)}`}>
              {report.visualScore}
            </div>
            <div className="text-xs font-bold text-slate-900 dark:text-white">第二层：视觉与几何 (Qv)</div>
            <div className="text-[11px] text-slate-500">零碰撞 / 边距越界检测 / 留白</div>
          </div>

          {/* Qc Content */}
          <div className="p-5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-1 shadow-xs">
            <div className={`text-4xl font-extrabold font-mono ${getScoreColor(report.contentScore)}`}>
              {report.contentScore}
            </div>
            <div className="text-xs font-bold text-slate-900 dark:text-white">第三层：内容与论据 (Qc)</div>
            <div className="text-[11px] text-slate-500">论点去重 / 核心结论概括度</div>
          </div>
        </div>

        {/* Detailed Issues & Recommendations Checklist */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4 shadow-sm">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
            <span className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-500 dark:text-amber-400" />
              <span>检测诊断项明细清单 ({report.issues.length})</span>
            </span>
            <span className="text-xs text-slate-500">包含自动修复建议</span>
          </div>

          {report.issues.length === 0 ? (
            <div className="py-12 text-center text-slate-600 dark:text-slate-400 space-y-2">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 dark:text-emerald-400 mx-auto" />
              <div className="text-sm font-bold text-slate-900 dark:text-white">太棒了！所有质量检查项全部通过</div>
              <p className="text-xs text-slate-500">整份文稿符合企业级演示设计规范与导出标准。</p>
            </div>
          ) : (
            <div className="space-y-3">
              {report.issues.map((issue) => (
                <div
                  key={issue.id}
                  className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-start justify-between gap-4"
                >
                  <div className="flex items-start gap-3">
                    {issue.level === 'error' && (
                      <AlertCircle className="w-4 h-4 text-rose-500 dark:text-rose-400 shrink-0 mt-0.5" />
                    )}
                    {issue.level === 'warning' && (
                      <AlertCircle className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0 mt-0.5" />
                    )}
                    {issue.level === 'info' && (
                      <CheckCircle2 className="w-4 h-4 text-blue-500 dark:text-blue-400 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono font-bold px-1.5 py-0.2 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          {issue.dimension.toUpperCase()}
                        </span>
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{issue.message}</span>
                      </div>
                      {issue.fixAction && (
                        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                          系统修复建议：<span className="text-blue-600 dark:text-blue-400">{issue.fixAction}</span>
                        </p>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={handleAutoFix}
                    className="px-3 py-1 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    修复
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bottom CTA to Return to Workbench */}
        <div className="flex justify-end pt-2">
          <button
            onClick={onOpenWorkbench}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold text-xs transition-colors cursor-pointer"
          >
            <span>返回 PPT 工作台继续编辑</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
