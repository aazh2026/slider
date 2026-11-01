/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 导出中心 —— 走**服务端**导出任务
 * ---------------------------------------------------------------------------
 *   POST /api/exports             创建任务（立即返回 jobId）
 *   GET  /api/exports/:id         轮询任务状态
 *   GET  /api/exports/:id/download 下载产物
 *
 * 旧版在浏览器里用 ExportEngine 直接生成文件。改走服务端的理由：
 *
 *   1. **前端预览与导出产物必须是同一份渲染器**。服务端用 `@ppt/core`
 *      的同一份 SVGRenderer，客户端与服务端不可能出现"预览好看、导出走样"。
 *   2. PDF 的 CJK 字体问题只有服务端能绕开（resvg 位图化，见 exportService）。
 *   3. 导出是重活（12 页 PPTX 要上百毫秒），放服务端才不卡主线程。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Download, FileText, Image, FileCode, CheckCircle2, ShieldCheck } from 'lucide-react';
import { PresentationProject } from '@ppt/core';

import { api, ApiClientError } from '../services/apiClient';

interface ExportModalProps {
  project: PresentationProject;
  currentSlideIndex: number;
  isOpen: boolean;
  onClose: () => void;
}

type ExportFormat = 'pptx' | 'pdf' | 'png' | 'svg' | 'json';

interface ExportJob {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  progress: number;
  error?: string | null;
  result?: { artifactId: string | null; filename: string } | null;
}

const STATUS_TEXT: Record<ExportJob['status'], string> = {
  queued: '任务排队中',
  running: '正在生成产物',
  succeeded: '导出成功',
  failed: '导出失败',
  cancelled: '任务已取消',
};

/** 轮询间隔 */
const POLL_INTERVAL_MS = 400;
/** 轮询上限 —— 5 分钟；超过就判失败（不能无限等） */
const POLL_MAX_ATTEMPTS = 750;

export const ExportModal: React.FC<ExportModalProps> = ({
  project,
  currentSlideIndex,
  isOpen,
  onClose,
}) => {
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('pptx');
  const [isExporting, setIsExporting] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [isDone, setIsDone] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  // 关闭弹窗时停掉轮询
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  const currentSlide = project.slides[currentSlideIndex] || project.slides[0];

  const pollJob = useCallback(
    async (id: string, attempt: number): Promise<void> => {
      if (cancelledRef.current) return;
      if (attempt > POLL_MAX_ATTEMPTS) {
        setProgressText('导出超时：任务在预期时间内没有结束');
        setIsExporting(false);
        return;
      }

      let job: ExportJob;
      try {
        const data = await api.get<{ job: ExportJob }>(`/api/exports/${id}`);
        job = data.job;
      } catch (err) {
        setProgressText(
          `查询任务状态失败：${err instanceof ApiClientError ? err.message : String(err)}`
        );
        setIsExporting(false);
        return;
      }

      setJobId(job.id);
      setProgressText(`${STATUS_TEXT[job.status]}（${job.progress}%）`);

      if (job.status === 'failed' || job.status === 'cancelled') {
        setProgressText(`导出失败：${job.error ?? STATUS_TEXT[job.status]}`);
        setIsExporting(false);
        return;
      }

      if (job.status === 'succeeded') {
        await downloadArtifact(id, job.result?.filename ?? 'presentation');
        setIsDone(true);
        setProgressText('导出成功！文件已开始下载。');
        setIsExporting(false);
        return;
      }

      pollRef.current = setTimeout(() => void pollJob(id, attempt + 1), POLL_INTERVAL_MS);
    },
    []
  );

  const handleExport = async () => {
    if (isExporting) return;
    if (!currentSlide && (selectedFormat === 'png' || selectedFormat === 'svg')) {
      setProgressText('没有可导出的幻灯片');
      return;
    }

    setIsExporting(true);
    setIsDone(false);
    setJobId(null);
    cancelledRef.current = false;
    setProgressText('正在提交导出任务…');

    try {
      // PNG / SVG 只导出当前页（与旧版行为一致）；其余格式导出全部
      const scope =
        selectedFormat === 'png' || selectedFormat === 'svg'
          ? { slideIds: currentSlide ? [currentSlide.slideId] : [] }
          : undefined;

      const data = await api.post<{ job: ExportJob }>('/api/exports', {
        projectId: project.id,
        format: selectedFormat,
        scope,
      });

      setJobId(data.job.id);
      setProgressText(`${STATUS_TEXT[data.job.status]}（${data.job.progress}%）`);
      await pollJob(data.job.id, 0);
    } catch (err) {
      setProgressText(
        `导出失败：${err instanceof ApiClientError ? err.message : String(err)}`
      );
      setIsExporting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-6">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">多格式导出中心 (Export Engine)</h2>
          </div>
          <button
            onClick={onClose}
            data-testid="export-close"
            className="p-1 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Format Selector Cards */}
        <div className="space-y-2.5">
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">选择目标格式</span>

          {/* PPTX Option */}
          <div
            onClick={() => setSelectedFormat('pptx')}
            data-testid="export-format-pptx"
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
            data-testid="export-format-pdf"
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
            data-testid="export-format-png"
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
            data-testid="export-format-svg"
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
            data-testid="export-format-json"
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
          <div
            data-testid="export-progress"
            className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg flex items-center gap-2 text-xs text-blue-600 dark:text-blue-300"
          >
            {isDone ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <div className="w-3.5 h-3.5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin shrink-0" />
            )}
            <span className="truncate">{progressText}</span>
          </div>
        )}

        {jobId && (
          <div
            className="text-[10px] font-mono text-slate-400 dark:text-slate-500"
            data-testid="export-job-id"
            data-job-id={jobId}
          >
            jobId: {jobId}
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
            onClick={() => void handleExport()}
            disabled={isExporting}
            data-testid="export-submit"
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 active:scale-98 text-white rounded-lg font-bold text-xs shadow-md shadow-blue-900/30 transition-all cursor-pointer disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isExporting ? '导出中…' : '确认导出'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * 下载产物并触发浏览器保存
 * ---------------------------------------------------------------------------
 * 用 `fetch` 而不是 `api.blob` 是因为要读 `content-disposition` 拿真实文件名
 * （中文名经过 RFC 5987 编码），`api.blob` 只把 body 交出来。
 */
async function downloadArtifact(jobId: string, fallbackName: string): Promise<void> {
  const res = await fetch(`/api/exports/${jobId}/download`, { credentials: 'include' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`下载失败（HTTP ${res.status}）${text ? `：${text.slice(0, 200)}` : ''}`);
  }

  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const filename = match
    ? decodeURIComponent(match[1]!)
    : (/filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 立刻 revoke 会让部分浏览器拿不到内容 —— 延后释放
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
