/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 导出服务（docs/backend-design.md §7）
 * ---------------------------------------------------------------------------
 * 服务端渲染管线：
 *
 *   SlideIR ──► @ppt/core/svgRenderer ──► SVG string
 *                                             │
 *              ┌──────────────────────────────┼──────────────────────────┐
 *              ▼                              ▼                          ▼
 *       resvg（Rust）                  pptxgenjs（IR→形状）        jspdf（位图嵌页）
 *       → PNG                          → .pptx 原生可编辑          → .pdf
 *
 * **为什么 PDF 走位图而不是矢量**：前端 jspdf 的根本问题是 CJK 字体缺失。
 * 服务端用 resvg 把带字体的 SVG 渲染成位图再嵌入，等于绕开"阅读器有没有中文字体"
 * 这个不可控变量。代价是 PDF 文字不可选中 —— 这是刻意的取舍（§7.2）。
 *
 * 复用 `@ppt/core` 的同一份渲染器 —— 前端预览与后端导出**不可能不一致**。
 */

import JSZip from 'jszip';
import { Resvg } from '@resvg/resvg-js';
import { jsPDF } from 'jspdf';

import { ExportEngine, SVGRenderer, type PresentationProject, type SlideIR } from '@ppt/core';

export type ExportFormat = 'pptx' | 'pdf' | 'png' | 'svg' | 'json';

export interface ExportScope {
  /** 只导出这些页；不传表示全部 */
  slideIds?: string[];
}

export interface RenderedExport {
  bytes: Uint8Array;
  filename: string;
  mime: string;
}

const MIME: Record<ExportFormat, string> = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
  png: 'image/png',
  svg: 'image/svg+xml',
  json: 'application/json',
};

function safeName(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 80) || 'presentation'
  );
}

/** 取范围内的页 */
function selectSlides(project: PresentationProject, scope?: ExportScope): SlideIR[] {
  if (!scope?.slideIds || scope.slideIds.length === 0) return project.slides;
  const wanted = new Set(scope.slideIds);
  return project.slides.filter((s) => wanted.has(s.slideId));
}

/**
 * PNG 光栅化宽度 —— **2 倍**。
 * ---------------------------------------------------------------------------
 * docs/backend-features.md §J EXP-02 原文：「`@resvg/resvg-js` 3840×2160，无需浏览器」。
 * 画布是 1920×1080，导出要的是它的两倍。
 *
 * 这里以前写的是 1920 —— 与画布同宽，于是产品导出的 PNG 是 **1 倍**，
 * 而界面上那个按钮明明写着「2x 超清光栅化图片」「3840×2160」
 * （src/components/ExportModal.tsx）。规格一直没抓到这件事，
 * 因为当时验的是核心库里那条**产品不走**的浏览器 canvas 路径 —— 见 spec.yaml DEC-015。
 */
const PNG_RASTER_WIDTH = 3840;

/**
 * PDF 位图宽度 —— **1 倍**。
 * ---------------------------------------------------------------------------
 * PDF 页面本身就是 1920×1080（`format: [1920, 1080]`），位图按 1:1 嵌入即像素对齐；
 * EXP-02 的「2 倍」只约束 PNG 导出，不牵连 PDF。
 */
const PDF_RASTER_WIDTH = 1920;

/** SVG → PNG 位图 */
function svgToPng(svg: string, width: number): Uint8Array {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: {
      loadSystemFonts: true,
      defaultFontFamily: 'sans-serif',
    },
  });
  const png = resvg.render();
  return new Uint8Array(png.asPng());
}

/** 多文件打包 */
async function zipFiles(
  files: Array<{ name: string; bytes: Uint8Array }>
): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.bytes);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/**
 * 渲染导出产物
 * ---------------------------------------------------------------------------
 * `scope` 限定页数；多页的 png/svg 会打成 zip。
 */
export async function renderExport(
  project: PresentationProject,
  format: ExportFormat,
  scope?: ExportScope
): Promise<RenderedExport> {
  const slides = selectSlides(project, scope);
  if (slides.length === 0) {
    throw new Error('没有可导出的幻灯片');
  }
  const base = safeName(project.name);

  switch (format) {
    case 'pptx': {
      const bytes = await ExportEngine.exportPresentationAsPptxBuffer(project, undefined);
      return { bytes, filename: `${base}.pptx`, mime: MIME.pptx };
    }

    case 'pdf': {
      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'px',
        format: [1920, 1080],
      });
      for (const [i, slide] of slides.entries()) {
        if (i > 0) pdf.addPage([1920, 1080], 'landscape');
        const svg = SVGRenderer.renderToString(slide, project.template.theme);
        const png = svgToPng(svg, PDF_RASTER_WIDTH);
        pdf.addImage(png, 'PNG', 0, 0, 1920, 1080);
      }
      const out = pdf.output('arraybuffer');
      return {
        bytes: new Uint8Array(out),
        filename: `${base}.pdf`,
        mime: MIME.pdf,
      };
    }

    case 'svg': {
      if (slides.length === 1) {
        const svg = SVGRenderer.renderToString(slides[0]!, project.template.theme);
        return {
          bytes: new TextEncoder().encode(svg),
          filename: `${base}_${safeName(slides[0]!.slideId)}.svg`,
          mime: MIME.svg,
        };
      }
      const files = slides.map((s) => ({
        name: `${String(s.order).padStart(2, '0')}_${safeName(s.slideId)}.svg`,
        bytes: new TextEncoder().encode(SVGRenderer.renderToString(s, project.template.theme)),
      }));
      return { bytes: await zipFiles(files), filename: `${base}_svg.zip`, mime: 'application/zip' };
    }

    case 'png': {
      const files = slides.map((s) => {
        const svg = SVGRenderer.renderToString(s, project.template.theme);
        return {
          name: `${String(s.order).padStart(2, '0')}_${safeName(s.slideId)}.png`,
          bytes: svgToPng(svg, PNG_RASTER_WIDTH),
        };
      });
      if (files.length === 1) {
        return { bytes: files[0]!.bytes, filename: files[0]!.name, mime: MIME.png };
      }
      return { bytes: await zipFiles(files), filename: `${base}_png.zip`, mime: 'application/zip' };
    }

    case 'json':
    default: {
      const json = JSON.stringify(
        {
          id: project.id,
          name: project.name,
          requirement: project.requirement,
          template: project.template,
          outline: project.outline,
          slides: project.slides,
        },
        null,
        2
      );
      return {
        bytes: new TextEncoder().encode(json),
        filename: `${base}_slide_ir.json`,
        mime: MIME.json,
      };
    }
  }
}
