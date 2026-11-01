/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import pptxgen from 'pptxgenjs';
import { jsPDF } from 'jspdf';
import { PresentationProject, SlideIR, TemplateTheme, SlideElement } from '../types/slide';
import { SVGRenderer } from './svgRenderer';

export class ExportEngine {
  /**
   * 1. Export as clean SVG vector file for a single slide or zipped
   */
  static exportSlideAsSvg(slide: SlideIR, theme: TemplateTheme, filename?: string) {
    const svgContent = SVGRenderer.renderToString(slide, theme);
    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    this.triggerDownload(blob, filename || `${slide.title.replace(/\s+/g, '_')}_${slide.slideId}.svg`);
  }

  /**
   * 2. Export Slide as High-Resolution PNG (using Offscreen Canvas 2x 3840x2160)
   */
  static async exportSlideAsPng(slide: SlideIR, theme: TemplateTheme, filename?: string): Promise<void> {
    const dataUrl = await this.renderSvgToCanvasDataUrl(slide, theme, 'image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename || `${slide.title.replace(/\s+/g, '_')}_slide${slide.order}.png`;
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
    a.download = filename || `${slide.title.replace(/\s+/g, '_')}_slide${slide.order}.jpg`;
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

    pdf.save(`${project.name.replace(/\s+/g, '_')}_presentation.pdf`);
  }

  /**
   * 5. Export Entire Presentation as Native Editable PPTX (using pptxgenjs)
   * Converts Slide IR into native PowerPoint shapes, text boxes, and background colors!
   */
  static async exportPresentationAsPptx(
    project: PresentationProject,
    onProgress?: (current: number, total: number) => void
  ): Promise<void> {
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
      const bgColorHex = (theme.backgroundColor || '#090e1a').replace('#', '');
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
          const textColor = (el.style.color || theme.textPrimary).replace('#', '');
          const fontSize = Math.round((el.style.fontSize || 16) * 0.72); // pt conversion

          pptSlide.addText(textContent, {
            x,
            y,
            w,
            h,
            fontSize,
            fontFace: 'Arial',
            color: textColor,
            bold: (Number(el.style.fontWeight) || 500) >= 700,
            align: el.style.textAlign || 'left',
            valign: 'middle',
          });
        } else if (el.type === 'badge') {
          const badgeText = typeof el.content === 'string' ? el.content : '';
          const accentColor = (theme.accentColor || '#f97316').replace('#', '');
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
            bold: true,
            color: accentColor,
            align: 'center',
            valign: 'middle',
          });
        } else if (el.type === 'card' || el.type === 'metric' || el.type === 'architecture_layer') {
          const surfaceColor = (theme.surfaceColor || '#111b2e').replace('#', '');
          const borderColor = (theme.surfaceBorder || '#1e293b').replace('#', '');

          pptSlide.addShape(pptx.ShapeType.roundRect, {
            x,
            y,
            w,
            h,
            fill: { color: surfaceColor },
            line: { color: borderColor, width: 1 },
            rectRadius: 0.1,
          });

          // Text content mapping
          if (typeof el.content === 'object' && el.content !== null) {
            const c = el.content;
            if (c.title && c.desc) {
              pptSlide.addText(
                [
                  { text: `${c.tag || ''}\n`, options: { fontSize: 9, bold: true, color: theme.accentColor.replace('#', '') } },
                  { text: `${c.title}\n\n`, options: { fontSize: 13, bold: true, color: theme.textPrimary.replace('#', '') } },
                  { text: `${c.desc}`, options: { fontSize: 10, color: theme.textSecondary.replace('#', '') } },
                ],
                { x: x + 0.2, y: y + 0.2, w: w - 0.4, h: h - 0.4, valign: 'top' }
              );
            } else if (c.value && c.title) {
              pptSlide.addText(
                [
                  { text: `${c.value}\n`, options: { fontSize: 32, bold: true, color: theme.primaryColor.replace('#', '') } },
                  { text: `${c.trend}\n\n`, options: { fontSize: 9, bold: true, color: theme.accentColor.replace('#', '') } },
                  { text: `${c.title}\n\n`, options: { fontSize: 12, bold: true, color: theme.textPrimary.replace('#', '') } },
                  { text: `${c.desc}`, options: { fontSize: 9.5, color: theme.textSecondary.replace('#', '') } },
                ],
                { x: x + 0.2, y: y + 0.2, w: w - 0.4, h: h - 0.4, valign: 'top' }
              );
            }
          }
        }
      }

      // Presenter speaker notes
      if (slideIR.speakerNotes) {
        pptSlide.addNotes(slideIR.speakerNotes);
      }
    }

    await pptx.writeFile({ fileName: `${project.name.replace(/\s+/g, '_')}.pptx` });
  }

  /**
   * 6. Export as JSON IR format (for developer and version storage)
   */
  static exportProjectAsJson(project: PresentationProject) {
    const jsonStr = JSON.stringify(project, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    this.triggerDownload(blob, `${project.name.replace(/\s+/g, '_')}_slide_ir.json`);
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

      img.onerror = (e) => {
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
