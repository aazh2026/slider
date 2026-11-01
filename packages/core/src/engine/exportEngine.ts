/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import pptxgen from 'pptxgenjs';
import { jsPDF } from 'jspdf';
import { PresentationProject, SlideIR, TemplateTheme, SlideElement } from '../types/slide';
import { SVGRenderer } from './svgRenderer';

/**
 * 导出文件名清洗
 * ---------------------------------------------------------------------------
 * 空白与 / \ : * ? " < > | 在多数文件系统里都是非法或危险字符；
 * 控制字符同样必须剥掉。清洗只动**基名**，扩展名单独拼接 —— 扩展名不能被吃掉。
 */
const ILLEGAL_FILENAME_CHARS = /[\s/\\:*?"<>|]/g;

export function sanitizeFilename(name: string): string {
  const cleaned = (name ?? '')
    .replace(ILLEGAL_FILENAME_CHARS, '_')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : 'untitled';
}

/**
 * PPTX 字体名
 * ---------------------------------------------------------------------------
 * 主题里的 fontFamily 是 CSS 字体栈（'Manrope, system-ui, sans-serif'），
 * PPTX 只认单一字体名 —— 直接透传会得到一个不存在的字体。
 * 内容以中文为主，选用同时覆盖中英的字体。
 *
 * 注：EXP-06 要求的「字体名 fallback 链」在 spec 中仍是未定义项（AMB-003），
 * 这里按 proposed_default 取单一字体，不阻塞 EXP-001 的文本保真判定。
 */
const PPTX_FONT = 'Microsoft YaHei';

/** 一个 PPTX 文本运行 */
interface TextRun {
  text: string;
  options: Record<string, unknown>;
}

/**
 * 颜色规范化
 * ---------------------------------------------------------------------------
 * PPTX 的 srgbClr 只认 6 位十六进制。主题里存在 `#RRGGBBAA` 这类带透明度的写法
 * （如半透明描边），直接透传会生成非法 XML —— 这里统一取前 6 位。
 */
function hex6(color: string | undefined, fallback = '000000'): string {
  const raw = (color ?? '').replace('#', '').trim();
  const matched = raw.match(/^[0-9a-fA-F]{6}/);
  return matched ? matched[0].toLowerCase() : fallback;
}

/**
 * 把元素的 content 摊平成「一个 IR 字符串 = 一个文本运行」
 * ---------------------------------------------------------------------------
 * SPEC-EXP-001：IR 里出现的每个非空字符串，都必须能在导出产物里被完整找到。
 * 结构化 content 里的每个字符串字段各自成为一个运行 —— 既不丢内容，也不把
 * 不同字段糊进同一个运行里（糊进去就会让「完整包含」的判定变得不可判定）。
 *
 * 运行末尾带 breakLine，使每个字符串独占一段 —— 段落之间是排版间距，
 * 不会把两个 IR 字符串拼成一段而互相污染。
 */
function contentRuns(el: SlideElement, theme: TemplateTheme): TextRun[] {
  const primary = hex6(theme.primaryColor, 'f97316');
  const accent = hex6(theme.accentColor, 'f97316');
  const textPrimary = hex6(theme.textPrimary, 'ffffff');
  const textSecondary = hex6(theme.textSecondary, 'cbd5e1');

  const runs: TextRun[] = [];

  const push = (value: unknown, options: Record<string, unknown>) => {
    if (typeof value !== 'string') return;
    if (value.trim().length === 0) return;
    runs.push({ text: value, options: { ...options, breakLine: true } });
  };

  const pushAll = (list: unknown, options: Record<string, unknown>) => {
    if (!Array.isArray(list)) return;
    list.forEach((item) => push(item, options));
  };

  const content = el.content;

  if (typeof content === 'string') {
    push(content, { fontSize: 13, color: textPrimary });
    return runs;
  }
  if (!content || typeof content !== 'object') return runs;

  const c = content as Record<string, unknown>;

  // 时间轴阶段卡 { phase, time, title, deliverables[] }
  if ('phase' in c || Array.isArray(c.deliverables)) {
    push(c.phase, { fontSize: 12, bold: true, color: primary });
    push(c.time, { fontSize: 12, color: textSecondary });
    push(c.title, { fontSize: 18, bold: true, color: textPrimary });
    pushAll(c.deliverables, { fontSize: 14, color: textSecondary });
    return runs;
  }

  // 总结卡 { headline, points[] }
  if ('headline' in c || Array.isArray(c.points)) {
    push(c.headline, { fontSize: 24, bold: true, color: textPrimary });
    pushAll(c.points, { fontSize: 16, color: textSecondary });
    return runs;
  }

  // 指标卡 { value, trend, title, desc }
  if ('value' in c) {
    push(c.value, { fontSize: 32, bold: true, color: primary });
    push(c.trend, { fontSize: 9, bold: true, color: accent });
    push(c.title, { fontSize: 12, bold: true, color: textPrimary });
    push(c.desc, { fontSize: 9.5, color: textSecondary });
    return runs;
  }

  // 问题/方案卡与封面元信息卡 { title, items[] }
  if (Array.isArray(c.items)) {
    push(c.title, { fontSize: 22, bold: true, color: textPrimary });
    pushAll(c.items, { fontSize: 15, color: textSecondary });
    return runs;
  }

  // 通用卡片 { tag, title, desc }
  push(c.tag, { fontSize: 12, bold: true, color: accent });
  push(c.title, { fontSize: 20, bold: true, color: textPrimary });
  push(c.desc, { fontSize: 15, color: textSecondary });
  return runs;
}

export class ExportEngine {
  /**
   * 1. Export as clean SVG vector file for a single slide or zipped
   */
  static exportSlideAsSvg(slide: SlideIR, theme: TemplateTheme, filename?: string) {
    const svgContent = SVGRenderer.renderToString(slide, theme);
    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    this.triggerDownload(
      blob,
      filename || `${sanitizeFilename(slide.title)}_${sanitizeFilename(slide.slideId)}.svg`
    );
  }

  /**
   * 2. Export Slide as High-Resolution PNG (using Offscreen Canvas 2x 3840x2160)
   */
  static async exportSlideAsPng(slide: SlideIR, theme: TemplateTheme, filename?: string): Promise<void> {
    const dataUrl = await this.renderSvgToCanvasDataUrl(slide, theme, 'image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download =
      filename || `${sanitizeFilename(slide.title)}_slide${slide.order}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /**
   * 3. Export Slide as JPG
   */
  static async exportSlideAsJpg(slide: SlideIR, theme: TemplateTheme, filename?: string): Promise<void> {
    const dataUrl = await this.renderSvgToCanvasDataUrl(slide, theme, 'image/jpeg', 0.95);
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download =
      filename || `${sanitizeFilename(slide.title)}_slide${slide.order}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /**
   * 4. Export Entire Presentation as PDF (16:9 Landscape)
   */
  static async exportPresentationAsPdf(
    project: PresentationProject,
    onProgress?: (current: number, total: number) => void
  ): Promise<void> {
    // 16:9 standard PDF (1920x1080 pt or scaled mm)
    const pdf = new jsPDF({
      orientation: 'landscape',
      unit: 'px',
      format: [1920, 1080],
    });

    const total = project.slides.length;
    for (let i = 0; i < total; i++) {
      if (onProgress) onProgress(i + 1, total);
      const slide = project.slides[i];
      const imgDataUrl = await this.renderSvgToCanvasDataUrl(slide, project.template.theme, 'image/jpeg', 0.92);

      if (i > 0) {
        pdf.addPage([1920, 1080], 'landscape');
      }
      pdf.addImage(imgDataUrl, 'JPEG', 0, 0, 1920, 1080);
    }

    pdf.save(`${sanitizeFilename(project.name)}_presentation.pdf`);
  }

  /**
   * 5. Export Entire Presentation as Native Editable PPTX (using pptxgenjs)
   * Converts Slide IR into native PowerPoint shapes, text boxes, and background colors!
   */
  static async exportPresentationAsPptx(
    project: PresentationProject,
    onProgress?: (current: number, total: number) => void
  ): Promise<void> {
    const pptx = await this.buildPresentationPptx(project, onProgress);
    await pptx.writeFile({ fileName: `${sanitizeFilename(project.name)}.pptx` });
  }

  /**
   * 构建 PPTX 并返回字节流 —— **服务端导出入口**
   * ---------------------------------------------------------------------------
   * 浏览器侧用 `exportPresentationAsPptx`（触发下载）；
   * 服务端不能触发浏览器下载，所以需要拿到字节流自己落盘或走对象存储。
   * 两条路径共用 `buildPresentationPptx` —— **只有一份 IR→PPTX 映射实现**。
   */
  static async exportPresentationAsPptxBuffer(
    project: PresentationProject,
    onProgress?: (current: number, total: number) => void
  ): Promise<Uint8Array> {
    const pptx = await this.buildPresentationPptx(project, onProgress);
    const out = await pptx.write({ outputType: 'arraybuffer' });
    return new Uint8Array(out as ArrayBuffer);
  }

  /** IR → pptxgenjs 实例（浏览器与服务端共用的唯一实现） */
  private static async buildPresentationPptx(
    project: PresentationProject,
    onProgress?: (current: number, total: number) => void
  ): Promise<pptxgen> {
    const pptx = new pptxgen();
    pptx.layout = 'LAYOUT_16x9';
    pptx.title = project.name;
    pptx.author = 'AI PPT Studio';

    const theme = project.template.theme;
    const total = project.slides.length;

    // Convert pixels to inches (1920px -> 13.33 inches, 1080px -> 7.5 inches)
    const scaleX = 13.33 / 1920;
    const scaleY = 7.5 / 1080;

    for (let i = 0; i < total; i++) {
      if (onProgress) onProgress(i + 1, total);
      const slideIR = project.slides[i];
      const pptSlide = pptx.addSlide();

      // Background color
      const bgColorHex = hex6(theme.backgroundColor || '#090e1a', '090e1a');
      pptSlide.background = { color: bgColorHex };

      // Map elements to native PPTX objects
      for (const el of slideIR.elements) {
        if (el.role === 'background') continue;

        const x = el.geometry.x * scaleX;
        const y = el.geometry.y * scaleY;
        const w = el.geometry.width * scaleX;
        const h = el.geometry.height * scaleY;

        if (el.type === 'text') {
          const textContent = typeof el.content === 'string' ? el.content : '';
          if (textContent.trim().length === 0) continue;

          const textColor = hex6(el.style.color || theme.textPrimary, 'ffffff');
          const fontSize = Math.round((el.style.fontSize || 16) * 0.72); // pt conversion

          pptSlide.addText(textContent, {
            x,
            y,
            w,
            h,
            fontSize,
            fontFace: PPTX_FONT,
            color: textColor,
            bold: (Number(el.style.fontWeight) || 500) >= 700,
            align: el.style.textAlign || 'left',
            valign: 'middle',
          });
        } else if (el.type === 'badge') {
          const badgeText = typeof el.content === 'string' ? el.content : '';
          const accentColor = hex6(theme.accentColor || '#f97316', 'f97316');
          pptSlide.addShape(pptx.ShapeType.roundRect, {
            x,
            y,
            w,
            h,
            fill: { color: `${accentColor}`, transparency: 85 },
            line: { color: accentColor, width: 1 },
            rectRadius: 0.1,
          });
          pptSlide.addText(badgeText, {
            x,
            y,
            w,
            h,
            fontSize: 10,
            fontFace: PPTX_FONT,
            bold: true,
            color: accentColor,
            align: 'center',
            valign: 'middle',
          });
        } else if (el.type === 'shape') {
          // 装饰形状（分隔线、时间轴节点等）。带文本内容时把文本一并画上去，
          // 否则时间轴节点会退化成「只剩空形状」（SPEC-EXP-001 明确禁止）。
          const fill = el.style.backgroundColor;
          if (fill && fill !== 'transparent') {
            pptSlide.addShape(
              el.style.borderRadius ? pptx.ShapeType.roundRect : pptx.ShapeType.rect,
              {
                x,
                y,
                w,
                h,
                fill: { color: hex6(fill, 'ffffff') },
                line: { type: 'none' },
                rectRadius: 0.05,
              }
            );
          }

          const shapeText = typeof el.content === 'string' ? el.content : '';
          if (shapeText.trim().length > 0) {
            pptSlide.addText(shapeText, {
              x,
              y,
              w,
              h,
              fontSize: Math.round((el.style.fontSize || 16) * 0.72),
              fontFace: PPTX_FONT,
              color: hex6(el.style.color || '#ffffff', 'ffffff'),
              bold: (Number(el.style.fontWeight) || 500) >= 700,
              align: el.style.textAlign || 'center',
              valign: 'middle',
            });
          }
        } else if (el.type === 'card' || el.type === 'metric' || el.type === 'architecture_layer') {
          const surfaceColor = hex6(el.style.backgroundColor || theme.surfaceColor, '111b2e');
          const borderColor = hex6(el.style.borderColor || theme.surfaceBorder, '1e293b');

          pptSlide.addShape(pptx.ShapeType.roundRect, {
            x,
            y,
            w,
            h,
            fill: { color: surfaceColor },
            line: { color: borderColor, width: 1 },
            rectRadius: 0.1,
          });

          // 文本内容映射 —— 结构化 content 的每个字符串字段各占一个运行
          const runs = contentRuns(el, theme);
          if (runs.length > 0) {
            pptSlide.addText(runs, {
              x: x + 0.2,
              y: y + 0.2,
              w: Math.max(0.1, w - 0.4),
              h: Math.max(0.1, h - 0.4),
              valign: 'top',
              fontFace: PPTX_FONT,
            });
          }
        }
      }

      // Presenter speaker notes
      if (slideIR.speakerNotes) {
        pptSlide.addNotes(slideIR.speakerNotes);
      }
    }

    return pptx;
  }

  /**
   * 6. Export as JSON IR format (for developer and version storage)
   */
  static exportProjectAsJson(project: PresentationProject) {
    const jsonStr = JSON.stringify(project, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    this.triggerDownload(blob, `${sanitizeFilename(project.name)}_slide_ir.json`);
  }

  /**
   * Rasterizes an SVG string onto a canvas at 2x resolution and returns data URL
   */
  private static renderSvgToCanvasDataUrl(
    slide: SlideIR,
    theme: TemplateTheme,
    mimeType: string = 'image/png',
    quality?: number
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const svgStr = SVGRenderer.renderToString(slide, theme);
      const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();

      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1920 * 2; // 2x retina
        canvas.height = 1080 * 2;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error('Failed to get 2D canvas context'));
          return;
        }

        ctx.fillStyle = theme.backgroundColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);

        const dataUrl = canvas.toDataURL(mimeType, quality);
        resolve(dataUrl);
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load SVG into image buffer'));
      };

      img.src = url;
    });
  }

  private static triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
