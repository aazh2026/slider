/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SlideIR, TemplateTheme, SlideElement } from '../types/slide';

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
      @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&amp;family=Manrope:wght@400;500;600;700&amp;family=Plus+Jakarta+Sans:wght@600;700;800&amp;display=swap');
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
        return `<rect ${commonAttrs} x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" fill="${escapeXml(bg)}" />`;
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
        const textAnchor = align === 'right' ? 'end' : align === 'center' ? 'middle' : 'start';
        const textX = align === 'right' ? x + width : align === 'center' ? x + width / 2 : x;
        const textContent = typeof el.content === 'string' ? el.content : '';

        // If single line or small, render as <text>
        return `
    <text ${commonAttrs} x="${textX}" y="${y + fontSize}" text-anchor="${textAnchor}" fill="${escapeXml(color)}" font-size="${fontSize}" font-weight="${fontWeight}" class="${fontSize > 30 ? 'font-heading' : ''}">
      ${escapeXml(textContent)}
    </text>`;
      }

      case 'card': {
        const bg = style.backgroundColor || theme.surfaceColor;
        const border = style.borderColor || theme.surfaceBorder;
        const rx = style.borderRadius || 12;

        let innerContent = '';
        if (typeof el.content === 'string') {
          innerContent = `<div style="color: ${theme.textPrimary}; font-size: ${style.fontSize || 15}px; line-height: 1.6;">${escapeXml(el.content)}</div>`;
        } else if (typeof el.content === 'object' && el.content !== null) {
          const c = el.content;
          if (c.reporter || c.date) {
            // Cover metadata
            innerContent = `
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; color: ${theme.textSecondary}; font-size: 14px;">
                <div><strong style="color: ${theme.textPrimary};">${escapeXml(c.reporter)}</strong></div>
                <div><span style="color: ${theme.textPrimary};">${escapeXml(c.date)}</span></div>
                <div><span>${escapeXml(c.version)}</span></div>
                <div><span>${escapeXml(c.scope)}</span></div>
              </div>`;
          } else if (c.title && c.items) {
            // Problem/Solution items
            const isProblem = el.id.includes('problem');
            const iconBadge = isProblem ? '❌ 瓶颈痛点' : '⚡ 架构对策';
            const badgeColor = isProblem ? (theme.isDark ? '#ef4444' : '#dc2626') : theme.primaryColor;
            innerContent = `
              <div style="font-family: ${theme.fontFamily};">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid ${border};">
                  <span style="font-size: 13px; font-weight: 700; color: ${badgeColor}; letter-spacing: 0.08em;">${iconBadge}</span>
                </div>
                <h3 style="font-size: 22px; font-weight: 700; color: ${theme.textPrimary}; margin: 0 0 24px 0; font-family: ${theme.fontHeading};">
                  ${escapeXml(c.title)}
                </h3>
                <div style="display: flex; flex-direction: column; gap: 18px;">
                  ${c.items
                    .map(
                      (item: string, idx: number) => `
                    <div style="display: flex; gap: 14px; align-items: flex-start;">
                      <span style="display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 6px; background: ${badgeColor}${theme.isDark ? '20' : '15'}; color: ${badgeColor}; font-size: 12px; font-weight: 700; flex-shrink: 0; margin-top: 2px;">
                        ${idx + 1}
                      </span>
                      <p style="margin: 0; font-size: 15px; color: ${theme.textSecondary}; line-height: 1.65;">
                        ${escapeXml(item)}
                      </p>
                    </div>
                  `
                    )
                    .join('')}
                </div>
              </div>`;
          } else if (c.tag && c.title) {
            // Standard Grid Card
            innerContent = `
              <div style="font-family: ${theme.fontFamily}; height: 100%; display: flex; flex-direction: column;">
                <div style="font-size: 12px; font-weight: 700; color: ${theme.accentColor}; letter-spacing: 0.08em; margin-bottom: 12px;">
                  ${escapeXml(c.tag)}
                </div>
                <h4 style="font-size: 20px; font-weight: 700; color: ${theme.textPrimary}; margin: 0 0 16px 0; font-family: ${theme.fontHeading};">
                  ${escapeXml(c.title)}
                </h4>
                <p style="margin: 0; font-size: 15px; color: ${theme.textSecondary}; line-height: 1.65; flex-grow: 1;">
                  ${escapeXml(c.desc)}
                </p>
              </div>`;
          } else if (c.phase && c.title) {
            // Timeline Phase Card
            innerContent = `
              <div style="font-family: ${theme.fontFamily};">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                  <span style="font-size: 12px; font-weight: 700; color: ${theme.primaryColor};">${escapeXml(c.phase)}</span>
                  <span style="font-size: 12px; color: ${theme.textSecondary};" class="tabular-nums">${escapeXml(c.time)}</span>
                </div>
                <h4 style="font-size: 18px; font-weight: 700; color: ${theme.textPrimary}; margin: 0 0 18px 0;">
                  ${escapeXml(c.title)}
                </h4>
                <div style="display: flex; flex-direction: column; gap: 10px;">
                  ${(c.deliverables || [])
                    .map(
                      (d: string) => `
                    <div style="display: flex; gap: 8px; font-size: 14px; color: ${theme.textSecondary}; line-height: 1.5;">
                      <span style="color: ${theme.primaryColor};">▹</span>
                      <span>${escapeXml(d)}</span>
                    </div>
                  `
                    )
                    .join('')}
                </div>
              </div>`;
          } else if (c.headline && c.points) {
            // Summary takeaways
            innerContent = `
              <div style="font-family: ${theme.fontFamily};">
                <h3 style="font-size: 24px; font-weight: 700; color: ${theme.textPrimary}; margin: 0 0 24px 0; font-family: ${theme.fontHeading};">
                  ${escapeXml(c.headline)}
                </h3>
                <div style="display: flex; flex-direction: column; gap: 18px;">
                  ${c.points
                    .map(
                      (p: string, i: number) => `
                    <div style="display: flex; gap: 14px; align-items: flex-start;">
                      <span style="display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 8px; background: ${theme.primaryColor}${theme.isDark ? '25' : '15'}; color: ${theme.primaryColor}; font-weight: 700; font-size: 14px; flex-shrink: 0;">
                        0${i + 1}
                      </span>
                      <p style="margin: 0; font-size: 16px; color: ${theme.textSecondary}; line-height: 1.6;">
                        ${escapeXml(p)}
                      </p>
                    </div>
                  `
                    )
                    .join('')}
                </div>
              </div>`;
          } else if (c.actions) {
            // Action plan
            const actionBg = theme.isDark ? `${theme.backgroundColor}80` : '#ffffff';
            innerContent = `
              <div style="font-family: ${theme.fontFamily};">
                <h4 style="font-size: 18px; font-weight: 700; color: ${theme.accentColor}; margin: 0 0 16px 0;">
                  ${escapeXml(c.title)}
                </h4>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;">
                  ${c.actions
                    .map(
                      (act: string) => `
                    <div style="background: ${actionBg}; padding: 16px; border-radius: 8px; border: 1px solid ${border}; font-size: 14px; color: ${theme.textPrimary}; line-height: 1.5;">
                      ${escapeXml(act)}
                    </div>
                  `
                    )
                    .join('')}
                </div>
              </div>`;
          }
        }

        return `
    <g ${commonAttrs}>
      <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" fill="${escapeXml(bg)}" stroke="${escapeXml(border)}" stroke-width="1" filter="url(#card-shadow)"/>
      <foreignObject x="${x + (style.padding || 24)}" y="${y + (style.padding || 24)}" width="${width - (style.padding || 24) * 2}" height="${height - (style.padding || 24) * 2}">
        <div xmlns="http://www.w3.org/1999/xhtml" style="width: 100%; height: 100%; overflow: hidden;">
          ${innerContent}
        </div>
      </foreignObject>
    </g>`;
      }

      case 'architecture_layer': {
        const bg = style.backgroundColor || theme.surfaceColor;
        const border = style.borderColor || theme.surfaceBorder;
        const rx = style.borderRadius || 12;
        return `
    <g ${commonAttrs}>
      <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" fill="${escapeXml(bg)}" stroke="${escapeXml(border)}" stroke-width="1" filter="url(#card-shadow)"/>
    </g>`;
      }

      case 'metric': {
        const bg = style.backgroundColor || theme.surfaceColor;
        const border = style.borderColor || theme.surfaceBorder;
        const rx = style.borderRadius || 14;
        const s = typeof el.content === 'object' ? el.content : {};

        return `
    <g ${commonAttrs}>
      <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" fill="${escapeXml(bg)}" stroke="${escapeXml(border)}" stroke-width="1" filter="url(#card-shadow)"/>
      <foreignObject x="${x + 28}" y="${y + 28}" width="${width - 56}" height="${height - 56}">
        <div xmlns="http://www.w3.org/1999/xhtml" style="height: 100%; display: flex; flex-direction: column; font-family: ${theme.fontFamily};">
          <div style="font-size: 58px; font-weight: 800; color: ${theme.primaryColor}; font-family: ${theme.fontHeading}; margin-bottom: 8px;" class="tabular-nums">
            ${escapeXml(s.value)}
          </div>
          <div style="font-size: 13px; font-weight: 700; color: ${theme.accentColor}; margin-bottom: 24px; letter-spacing: 0.04em;">
            ${escapeXml(s.trend)}
          </div>
          <h4 style="font-size: 20px; font-weight: 700; color: ${theme.textPrimary}; margin: 0 0 16px 0;">
            ${escapeXml(s.title)}
          </h4>
          <p style="margin: 0; font-size: 15px; color: ${theme.textSecondary}; line-height: 1.65; flex-grow: 1;">
            ${escapeXml(s.desc)}
          </p>
        </div>
      </foreignObject>
    </g>`;
      }

      default: {
        return `<g ${commonAttrs}><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="transparent"/></g>`;
      }
    }
  }
}
