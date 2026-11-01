/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SlideIR, TemplateTheme, SlideElement } from '../types/slide';
import { wrapText } from './textMetrics';

/**
 * Escapes characters for safe inclusion in SVG / XML
 */
function escapeXml(unsafe: string | null | undefined): string {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 一个排版块
 * ---------------------------------------------------------------------------
 * 原生 SVG 没有 flex/grid，也不替我们折行 —— 每一段文字的字号、颜色、间距、
 * 行首标记都在这里显式声明，由渲染层自己排（ADR-011）。
 */
interface TextBlock {
  text: string;
  fontSize: number;
  fontWeight?: number | string;
  color: string;
  /** 行高倍数 */
  lineHeight?: number;
  /** 块前间距（px） */
  gapBefore?: number;
  /** 行首标记（序号 / 项目符号） */
  marker?: { text: string; color: string; width: number };
  /** 等宽数字 */
  tabular?: boolean;
  /** 使用标题字体 */
  heading?: boolean;
}

/** 排版盒 */
interface TextBox {
  x: number;
  y: number;
  width: number;
  /** 盒子高度 —— 用来截断放不下的行 */
  height?: number;
  align?: 'left' | 'center' | 'right';
}

/**
 * 把一段文本排成若干行
 * ---------------------------------------------------------------------------
 * 显式换行（\n）先拆段，段内再按可用宽度折行。
 */
function layoutLines(text: string, maxWidth: number, fontSize: number): string[] {
  const raw = (text ?? '').replace(/\r\n/g, '\n');
  const lines: string[] = [];
  for (const paragraph of raw.split('\n')) {
    const wrapped = wrapText(paragraph, maxWidth, fontSize);
    if (wrapped.length > 0) lines.push(...wrapped);
    else lines.push('');
  }
  return lines.length > 0 ? lines : [''];
}

/**
 * 按可用高度截断行
 * ---------------------------------------------------------------------------
 * 盒子装不下的行直接丢掉，最后一行补省略号。
 * ADR-011 把「换行与截断」都划给了渲染层 —— 不截断就会溢出版心。
 */
function truncateLines(lines: string[], maxHeight: number, lineHeight: number): string[] {
  if (!Number.isFinite(maxHeight)) return lines.slice();
  const maxLines = Math.max(1, Math.floor(maxHeight / lineHeight));
  if (lines.length <= maxLines) return lines.slice();
  const visible = lines.slice(0, maxLines);
  visible[visible.length - 1] = `${visible[visible.length - 1]!}…`;
  return visible;
}

/**
 * 渲染一个排版块
 * ---------------------------------------------------------------------------
 * 单行文本直接放在 <text> 里（不套 tspan）—— 多套一层就等于把一段话拆成两段，
 * 机器比对时无法再确认「这段文字完整地出现在产物里」。
 *
 * @param lines 已经排好、并且按盒子高度截断过的行
 */
function renderBlock(block: TextBlock, box: TextBox, lines: string[]): string {
  const fontSize = block.fontSize;
  const lineHeight = Math.round(fontSize * (block.lineHeight ?? 1.35));
  const indent = block.marker ? block.marker.width : 0;

  const align = box.align ?? 'left';
  const anchor = align === 'right' ? 'end' : align === 'center' ? 'middle' : 'start';
  const textX = align === 'right' ? box.x + box.width : align === 'center' ? box.x + box.width / 2 : box.x + indent;

  const classes = [block.tabular ? 'tabular-nums' : '', block.heading ? 'font-heading' : '']
    .filter(Boolean)
    .join(' ');

  const attrs = [
    `x="${textX}"`,
    `y="${box.y + fontSize}"`,
    `font-size="${fontSize}"`,
    `font-weight="${block.fontWeight ?? 500}"`,
    `fill="${escapeXml(block.color)}"`,
    `text-anchor="${anchor}"`,
    `class="${classes}"`,
  ].join(' ');

  const single = lines.length === 1 && !/[\r\n]/.test(block.text);
  let inner = '';
  lines.forEach((line, i) => {
    if (i === 0) {
      inner += escapeXml(single ? block.text : line);
    } else {
      inner += `\n        <tspan x="${textX}" dy="${lineHeight}">${escapeXml(line)}</tspan>`;
    }
  });

  const marker = block.marker
    ? `\n      <text x="${box.x}" y="${box.y + fontSize}" font-size="${fontSize}" font-weight="700" fill="${escapeXml(block.marker.color)}">${escapeXml(block.marker.text)}</text>`
    : '';

  return `${marker}\n      <text ${attrs}>${inner}\n      </text>`;
}

/** 渲染一组排版块，返回 SVG 片段与消耗掉的高度 */
function renderBlocks(
  blocks: TextBlock[],
  box: TextBox
): { markup: string; height: number } {
  let cursorY = box.y;
  const parts: string[] = [];

  for (const block of blocks) {
    if (!block.text || block.text.trim().length === 0) continue;

    const gap = block.gapBefore ?? 0;
    const lineHeight = Math.round(block.fontSize * (block.lineHeight ?? 1.35));
    const indent = block.marker ? block.marker.width : 0;
    const lines = layoutLines(block.text, Math.max(20, box.width - indent), block.fontSize);

    // 本块（含块前间距）还剩多少高度可用
    const remaining =
      box.height === undefined ? Infinity : box.height - (cursorY - box.y) - gap;
    if (remaining < lineHeight) break; // 这块放不下了，后面的更放不下

    const visible = truncateLines(lines, remaining, lineHeight);
    parts.push(renderBlock(block, { ...box, y: cursorY + gap }, visible));
    cursorY += gap + visible.length * lineHeight;
  }

  return { markup: parts.join('\n    '), height: cursorY - box.y };
}

/** 把任意结构化 content 摊平成字符串条目（兜底用） */
function flattenStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (value.trim().length > 0) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => flattenStrings(item, out));
    return out;
  }
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((item) => flattenStrings(item, out));
  }
  return out;
}

/**
 * 结构化 content → 排版块
 * ---------------------------------------------------------------------------
 * 按**字段形态**分派，而不是按元素 ID 里的字符串猜语义
 * （ADR-012：基于 ID 的语义判断必须去掉）。
 */
function contentBlocks(el: SlideElement, theme: TemplateTheme): TextBlock[] {
  const content = el.content;
  const primary = theme.primaryColor;
  const accent = theme.accentColor;
  const textPrimary = theme.textPrimary;
  const textSecondary = theme.textSecondary;

  if (typeof content === 'string') {
    return content.trim().length > 0
      ? [{ text: content, fontSize: 15, color: textSecondary, lineHeight: 1.6 }]
      : [];
  }
  if (!content || typeof content !== 'object') return [];

  const c = content as Record<string, unknown>;
  const blocks: TextBlock[] = [];

  // 时间轴阶段卡 { phase, time, title, deliverables[] }
  if ('phase' in c || Array.isArray(c.deliverables)) {
    if (typeof c.phase === 'string') blocks.push({ text: c.phase, fontSize: 12, fontWeight: 700, color: primary });
    if (typeof c.time === 'string') blocks.push({ text: c.time, fontSize: 12, color: textSecondary, gapBefore: 6 });
    if (typeof c.title === 'string') blocks.push({ text: c.title, fontSize: 18, fontWeight: 700, color: textPrimary, gapBefore: 14, heading: true });
    (Array.isArray(c.deliverables) ? c.deliverables : []).forEach((d) => {
      if (typeof d === 'string') {
        blocks.push({
          text: d,
          fontSize: 14,
          color: textSecondary,
          lineHeight: 1.5,
          gapBefore: 10,
          marker: { text: '▹', color: primary, width: 22 },
        });
      }
    });
    return blocks;
  }

  // 总结卡 { headline, points[] }
  if ('headline' in c || Array.isArray(c.points)) {
    if (typeof c.headline === 'string') blocks.push({ text: c.headline, fontSize: 24, fontWeight: 700, color: textPrimary, heading: true });
    (Array.isArray(c.points) ? c.points : []).forEach((p, i) => {
      if (typeof p === 'string') {
        blocks.push({
          text: p,
          fontSize: 16,
          color: textSecondary,
          lineHeight: 1.6,
          gapBefore: 16,
          marker: { text: `0${i + 1}`, color: primary, width: 38 },
        });
      }
    });
    return blocks;
  }

  // 指标卡 { value, trend, title, desc }
  if ('value' in c) {
    if (typeof c.value === 'string') blocks.push({ text: c.value, fontSize: 58, fontWeight: 800, color: primary, heading: true, tabular: true });
    if (typeof c.trend === 'string') blocks.push({ text: c.trend, fontSize: 13, fontWeight: 700, color: accent, gapBefore: 8 });
    if (typeof c.title === 'string') blocks.push({ text: c.title, fontSize: 20, fontWeight: 700, color: textPrimary, gapBefore: 18, heading: true });
    if (typeof c.desc === 'string') blocks.push({ text: c.desc, fontSize: 15, color: textSecondary, lineHeight: 1.65, gapBefore: 12 });
    return blocks;
  }

  // 问题/方案卡与封面元信息卡 { title, items[] }
  if (Array.isArray(c.items)) {
    if (typeof c.title === 'string') blocks.push({ text: c.title, fontSize: 22, fontWeight: 700, color: textPrimary, heading: true });
    c.items.forEach((item, i) => {
      if (typeof item === 'string') {
        blocks.push({
          text: item,
          fontSize: 15,
          color: textSecondary,
          lineHeight: 1.65,
          gapBefore: 16,
          marker: { text: `${i + 1}`, color: primary, width: 34 },
        });
      }
    });
    return blocks;
  }

  // 通用卡片 { tag, title, desc }
  if ('tag' in c || 'desc' in c) {
    if (typeof c.tag === 'string') blocks.push({ text: c.tag, fontSize: 12, fontWeight: 700, color: accent });
    if (typeof c.title === 'string') blocks.push({ text: c.title, fontSize: 20, fontWeight: 700, color: textPrimary, gapBefore: 12, heading: true });
    if (typeof c.desc === 'string') blocks.push({ text: c.desc, fontSize: 15, color: textSecondary, lineHeight: 1.65, gapBefore: 14 });
    return blocks;
  }

  // 兜底：任何没见过的结构，都要把里面的字符串渲染出来 —— 不允许静默丢内容
  flattenStrings(content).forEach((text) => {
    blocks.push({ text, fontSize: 15, color: textSecondary, lineHeight: 1.6, gapBefore: 8 });
  });
  return blocks;
}

export class SVGRenderer {
  /**
   * Generates a scrollbar-free inline SVG string designed for HTML embedding (without XML prolog, with 100% width/height and overflow hidden)
   */
  static renderInlineSvg(slide: SlideIR, theme: TemplateTheme): string {
    const raw = this.renderToString(slide, theme);
    return raw
      .replace(/<\?xml[\s\S]*?\?>\s*/, '')
      .replace(
        /width="\d+" height="\d+"/,
        'width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;height:100%;overflow:hidden;pointer-events:none;user-select:none;"'
      );
  }

  /**
   * Generates a pristine, standalone SVG XML string for a given SlideIR and Theme
   */
  static renderToString(slide: SlideIR, theme: TemplateTheme): string {
    const { width, height } = slide.canvas;

    // Group elements by architectural SVG layers
    const bgElements = slide.elements.filter((el) => el.role === 'background');
    const templateElements = slide.elements.filter(
      (el) => el.role === 'footer' || (el.role === 'subtitle' && el.id.startsWith('header_'))
    );
    const contentElements = slide.elements.filter(
      (el) => el.role !== 'background' && el.role !== 'footer' && !el.id.startsWith('header_')
    );

    const shadowOpacity = theme.isDark ? '0.35' : '0.07';
    const shadowDeviation = theme.isDark ? '12' : '8';
    const shadowDy = theme.isDark ? '6' : '4';

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" data-slide-id="${escapeXml(slide.slideId)}">
  <defs>
    <style>
      text {
        font-family: ${theme.fontFamily};
        user-select: none;
      }
      .font-heading {
        font-family: ${theme.fontHeading};
      }
      .tabular-nums {
        font-variant-numeric: tabular-nums;
        font-family: 'JetBrains Mono', monospace;
      }
    </style>
    <!-- Card and surface drop shadow filter -->
    <filter id="card-shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="${shadowDy}" stdDeviation="${shadowDeviation}" flood-color="#000000" flood-opacity="${shadowOpacity}"/>
    </filter>
    <!-- Subtle glow filter for active accent items -->
    <filter id="accent-glow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="0" stdDeviation="8" flood-color="${escapeXml(theme.accentColor)}" flood-opacity="${theme.isDark ? '0.4' : '0.2'}"/>
    </filter>
  </defs>

  <!-- LAYER 1: Background Layer -->
  <g id="background-layer" data-layer-name="background">
    ${bgElements.map((el) => this.renderElement(el, theme)).join('\n    ')}
    <!-- Subtle technical grid dots/lines -->
    <g opacity="${theme.isDark ? '0.07' : '0.05'}" stroke="${theme.isDark ? '#ffffff' : '#475569'}" stroke-width="1">
      <line x1="100" y1="0" x2="100" y2="${height}" stroke-dasharray="4 8"/>
      <line x1="${width - 100}" y1="0" x2="${width - 100}" y2="${height}" stroke-dasharray="4 8"/>
      <line x1="0" y1="200" x2="${width}" y2="200" stroke-dasharray="4 8"/>
      <line x1="0" y1="${height - 80}" x2="${width}" y2="${height - 80}" stroke-dasharray="4 8"/>
    </g>
  </g>

  <!-- LAYER 2: Template & Master Layer -->
  <g id="template-layer" data-layer-name="template">
    ${templateElements.map((el) => this.renderElement(el, theme)).join('\n    ')}
  </g>

  <!-- LAYER 3: Content Layer -->
  <g id="content-layer" data-layer-name="content">
    ${contentElements.map((el) => this.renderElement(el, theme)).join('\n    ')}
  </g>

  <!-- LAYER 4: Decoration Layer -->
  <g id="decoration-layer" data-layer-name="decoration">
    <!-- Top accent indicator -->
    <rect x="100" y="44" width="48" height="3" rx="1.5" fill="${escapeXml(theme.primaryColor)}"/>
  </g>
</svg>`;
  }

  /**
   * Renders an individual SlideElement into pure SVG markup
   */
  static renderElement(el: SlideElement, theme: TemplateTheme): string {
    const { x, y, width, height } = el.geometry;
    const style = el.style || {};
    const editableAttr = el.editable ? 'data-editable="true"' : 'data-editable="false"';
    const commonAttrs = `id="${escapeXml(el.id)}" data-element-id="${escapeXml(el.id)}" data-role="${escapeXml(el.role)}" data-type="${escapeXml(el.type)}" ${editableAttr}`;

    switch (el.type) {
      case 'shape': {
        const bg = style.backgroundColor || (el.role === 'background' ? theme.backgroundColor : 'transparent');
        const rx = style.borderRadius || 0;
        const rectAttrs = `x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" fill="${escapeXml(bg)}"`;

        // 带文本的形状（时间轴节点）不能只画框 —— 否则服务端出图里只剩一个空圆
        const shapeText = typeof el.content === 'string' ? el.content : '';
        if (!shapeText.trim()) {
          return `<rect ${commonAttrs} ${rectAttrs} />`;
        }

        const fontSize = style.fontSize || 16;
        const color = style.color || '#ffffff';
        return `
    <g ${commonAttrs}>
      <rect ${rectAttrs} />
      <text x="${x + width / 2}" y="${y + height / 2 + fontSize * 0.36}" text-anchor="middle" font-size="${fontSize}" font-weight="${style.fontWeight || 700}" fill="${escapeXml(color)}">${escapeXml(shapeText)}</text>
    </g>`;
      }

      case 'badge': {
        const bg = style.backgroundColor || (theme.isDark ? `${theme.accentColor}20` : `${theme.accentColor}15`);
        const border = style.borderColor || theme.accentColor;
        const color = style.color || theme.accentColor;
        const text = typeof el.content === 'string' ? el.content : '';
        const rx = style.borderRadius || 6;
        return `
    <g ${commonAttrs} transform="translate(${x}, ${y})">
      <rect x="0" y="0" width="${width}" height="${height}" rx="${rx}" fill="${escapeXml(bg)}" stroke="${escapeXml(border)}" stroke-width="1"/>
      <text x="${width / 2}" y="${height / 2 + 5}" text-anchor="middle" fill="${escapeXml(color)}" font-size="${style.fontSize || 13}" font-weight="700" letter-spacing="0.06em">
        ${escapeXml(text)}
      </text>
    </g>`;
      }

      case 'text': {
        let color = style.color || theme.textPrimary;
        // Compensate for dark-to-light theme changes if color was white
        if (!theme.isDark && (color === '#ffffff' || color === '#f8fafc' || color === '#fff1f2')) {
          color = theme.textPrimary;
        } else if (theme.isDark && (color === '#0f172a' || color === '#002060' || color === '#292524')) {
          color = theme.textPrimary;
        }

        const fontSize = style.fontSize || 16;
        const fontWeight = style.fontWeight || 500;
        const align = style.textAlign || 'left';
        const textContent = typeof el.content === 'string' ? el.content : '';

        const { markup } = renderBlocks(
          [
            {
              text: textContent,
              fontSize,
              fontWeight,
              color,
              lineHeight: style.lineHeight ?? 1.35,
              heading: fontSize > 30,
            },
          ],
          { x, y, width, height, align }
        );

        return `
    <g ${commonAttrs}>
      ${markup}
    </g>`;
      }

      case 'card':
      case 'metric':
      case 'architecture_layer': {
        const bg = style.backgroundColor || theme.surfaceColor;
        const border = style.borderColor || theme.surfaceBorder;
        const rx = style.borderRadius || 12;
        const padding = style.padding ?? 24;

        const blocks = contentBlocks(el, theme);
        const { markup } = renderBlocks(
          blocks,
          {
            x: x + padding,
            y: y + padding,
            width: Math.max(20, width - padding * 2),
            // 内边距以内的净高 —— 装不下的块整块丢弃，不允许溢出版心
            height: Math.max(0, height - padding * 2),
          }
        );

        return `
    <g ${commonAttrs}>
      <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" fill="${escapeXml(bg)}" stroke="${escapeXml(border)}" stroke-width="1" filter="url(#card-shadow)"/>
      ${markup}
    </g>`;
      }

      default: {
        return `<g ${commonAttrs}><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="transparent"/></g>`;
      }
    }
  }
}
