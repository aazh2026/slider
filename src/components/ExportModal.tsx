/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { X, Download, FileText, Image, FileCode, CheckCircle2, ShieldCheck } from 'lucide-react';
import { PresentationProject } from '../types/slide';
import { ExportEngine } from '../engine/exportEngine';

interface ExportModalProps {
  project: PresentationProject;
  currentSlideIndex: number;
  isOpen: boolean;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  project,
  currentSlideIndex,
  isOpen,
  onClose,
}) => {
  const [selectedFormat, setSelectedFormat] = useState<'pptx' | 'pdf' | 'png' | 'svg' | 'json'>('pptx');
  const [isExporting, setIsExporting] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [isDone, setIsDone] = useState(false);

  if (!isOpen) return null;

  const currentSlide = project.slides[currentSlideIndex] || project.slides[0];

  const handleExport = async () => {
    setIsExporting(true);
    setIsDone(false);
    setProgressText('正在初始化导出引擎...');

    try {
      if (selectedFormat === 'pptx') {
        setProgressText('正在将 Slide IR 元素映射为原生 PPTX 形状与文本框...');
        await ExportEngine.exportPresentationAsPptx(project, (cur, total) => {
          setProgressText(`正在转换第 ${cur} / ${total} 页原生 PPTX 对象...`);
        });
      } else if (selectedFormat === 'pdf') {
        setProgressText('正在光栅化并写入 16:9 矢量 PDF 文档...');
        await ExportEngine.exportPresentationAsPdf(project, (cur, total) => {
          setProgressText(`正在渲染第 ${cur} / ${total} 页 PDF 页面...`);
        });
      } else if (selectedFormat === 'png') {
        setProgressText('正在渲染 2x 超清 3840x2160 PNG 图片...');
        await ExportEngine.exportSlideAsPng(currentSlide, project.template.theme);
      } else if (selectedFormat === 'svg') {
        setProgressText('正在打包纯净矢量 SVG 源码...');
        ExportEngine.exportSlideAsSvg(currentSlide, project.template.theme);
      } else if (selectedFormat === 'json') {
        setProgressText('正在导出 Slide IR 结构化数据...');
        ExportEngine.exportProjectAsJson(project);
      }

      setIsDone(true);
      setProgressText('导出成功！已触发浏览器下载。');
      setTimeout(() => {
        setIsExporting(false);
      }, 1500);
    } catch (err: any) {
      console.error('Export error:', err);
      setProgressText(`导出失败: ${err.message || '未知错误'}`);
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-6">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">多格式导出中心 (Export Engine)</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Format Selector Cards */}
        <div className="space-y-2.5">
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">选择目标格式</span>

          {/* PPTX Option */}
          <div
            onClick={() => setSelectedFormat('pptx')}
            className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-start gap-3.5 ${
              selectedFormat === 'pptx'
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10 ring-1 ring-blue-500/40'
                : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-slate-50 dark:bg-slate-950/60'
            }`}
          >
            <div className="w-9 h-9 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-600 dark:text-orange-400 shrink-0 font-bold text-xs">
              PPTX
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 dark:text-white">PowerPoint 原生可编辑文件 (.pptx)</span>
                <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold bg-emerald-100 dark:bg-emerald-500/10 px-1.5 py-0.5 rounded">
                  推荐 · 原生元素
                </span>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                文本框、色块卡片与架构层转换为 Office 原生形状，下载后可在 PowerPoint / Keynote 中二次编辑。
              </p>
            </div>
          </div>

          {/* PDF Option */}
          <div
            onClick={() => setSelectedFormat('pdf')}
            className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-start gap-3.5 ${
              selectedFormat === 'pdf'
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10 ring-1 ring-blue-500/40'
                : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-slate-50 dark:bg-slate-950/60'
            }`}
          >
            <div className="w-9 h-9 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-600 dark:text-rose-400 shrink-0 font-bold text-xs">
              PDF
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 dark:text-white">16:9 高清矢量演示文档 (.pdf)</span>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                全部 {project.slides.length} 页完整打包，适合跨平台分发、高管阅读与高清打印。
              </p>
            </div>
          </div>

          {/* PNG Option */}
          <div
            onClick={() => setSelectedFormat('png')}
            className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-start gap-3.5 ${
              selectedFormat === 'png'
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10 ring-1 ring-blue-500/40'
                : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-slate-50 dark:bg-slate-950/60'
            }`}
          >
            <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0 font-bold text-xs">
              PNG
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 dark:text-white">2x 超清光栅化图片 (.png)</span>
                <span className="text-[10px] text-slate-400 font-mono">3840×2160</span>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                当前第 {currentSlideIndex + 1} 页超清渲染图，可用于飞书/钉钉分享或嵌入文档。
              </p>
            </div>
          </div>

          {/* SVG Option */}
          <div
            onClick={() => setSelectedFormat('svg')}
            className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-start gap-3.5 ${
              selectedFormat === 'svg'
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10 ring-1 ring-blue-500/40'
                : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-slate-50 dark:bg-slate-950/60'
            }`}
          >
            <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0 font-bold text-xs">
              SVG
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 dark:text-white">纯净矢量源文件 (.svg)</span>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                分层明确的 SVG DOM，保留元素唯一 ID 与编辑属性。
              </p>
            </div>
          </div>

          {/* JSON Option */}
          <div
            onClick={() => setSelectedFormat('json')}
            className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-start gap-3.5 ${
              selectedFormat === 'json'
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10 ring-1 ring-blue-500/40'
                : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-slate-50 dark:bg-slate-950/60'
            }`}
          >
            <div className="w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-600 dark:text-purple-400 shrink-0 font-bold text-xs">
              JSON
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 dark:text-white">Slide IR 结构化数据 (.json)</span>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                完整页面模型与版本快照，支持二次导入与工程化集成。
              </p>
            </div>
          </div>
        </div>

        {/* Status / Progress feedback */}
        {progressText && (
          <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg flex items-center gap-2 text-xs text-blue-600 dark:text-blue-300">
            {isDone ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <div className="w-3.5 h-3.5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin shrink-0" />
            )}
            <span className="truncate">{progressText}</span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 active:scale-98 text-white rounded-lg font-bold text-xs shadow-md shadow-blue-900/30 transition-all cursor-pointer disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>确认导出</span>
          </button>
        </div>
      </div>
    </div>
  );
};
