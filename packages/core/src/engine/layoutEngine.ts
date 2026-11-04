/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SlideIR, SlideOutlineItem, SlideElement, TemplateTheme, SlideLayoutType } from '../types/slide';
import { SlideContent } from '../types/content';
import { estimateTextWidth } from './textMetrics';
import {
  bindContent,
  contentBullets,
  distributeEvenly,
  splitBullet,
  validateContentForLayout,
} from './contentBinding';
import { slotContractOf } from '../data/layoutIntents';

export { splitBullet, contentBullets, distributeEvenly };

export class LayoutEngine {
  /**
   * Generates a fully calculated SlideIR from an Outline item and Template Theme
   *
   * @param content 内容槽位（可选）—— AI 产出 / 人工编辑的排版输入。
   *                缺省时由 contentBinding 从大纲确定性推导（降级链），
   *                **任何路径都不回落硬编码演示文案**。
   */
  static generateSlideIR(
    outline: SlideOutlineItem,
    theme: TemplateTheme,
    slideOrder: number,
    totalSlides: number,
    content?: SlideContent
  ): SlideIR {
    const canvas = { width: 1920, height: 1080 };
    const elements: SlideElement[] = [];
    const bound = bindContent(outline, content);

    // 1. Background layer element
    elements.push({
      id: `bg_${outline.slideId}`,
      variant: 'background',
      type: 'shape',
      role: 'background',
      content: '',
      geometry: { x: 0, y: 0, width: 1920, height: 1080 },
      style: {
        backgroundColor: theme.backgroundColor,
      },
      editable: false,
      zIndex: 0,
    });

    // 2. Master elements (Header / Footer / Page Number) if not cover
    const isCover = outline.layoutPreference === 'title_cover';
    if (!isCover) {
      // Header category / kicker —— 取自 outline.visualIntent，不再有固定演示文案
      elements.push({
        id: `header_${outline.slideId}`,
        variant: 'header',
        type: 'text',
        role: 'subtitle',
        content: outline.visualIntent.toUpperCase(),
        geometry: { x: 100, y: 55, width: 800, height: 30 },
        style: {
          fontSize: 14,
          fontWeight: 700,
          color: theme.accentColor,
          letterSpacing: '0.12em',
        },
        editable: true,
        zIndex: 5,
      });

      // Main slide title
      elements.push({
        id: `title_${outline.slideId}`,
        variant: 'title',
        type: 'text',
        role: 'title',
        content: outline.title,
        geometry: { x: 100, y: 90, width: 1350, height: 60 },
        style: {
          fontSize: 38,
          fontWeight: 700,
          fontFamily: theme.fontHeading,
          color: theme.textPrimary,
        },
        editable: true,
        zIndex: 10,
      });

      // Key message / Takeaway subheader
      elements.push({
        id: `keymsg_${outline.slideId}`,
        variant: 'keymsg',
        type: 'text',
        role: 'subtitle',
        content: `核心结论：${outline.keyMessage}`,
        geometry: { x: 100, y: 155, width: 1450, height: 36 },
        style: {
          fontSize: 18,
          fontWeight: 500,
          color: theme.textSecondary,
        },
        editable: true,
        zIndex: 10,
      });

      // Footer Slide Counter
      elements.push({
        id: `pagenum_${outline.slideId}`,
        variant: 'pagenum',
        type: 'text',
        role: 'footer',
        content: `${String(slideOrder).padStart(2, '0')} / ${String(totalSlides).padStart(2, '0')}`,
        geometry: { x: 1760, y: 1015, width: 80, height: 30 },
        style: {
          fontSize: 14,
          fontWeight: 600,
          color: theme.textSecondary,
          textAlign: 'right',
        },
        editable: false,
        zIndex: 5,
      });

      // Footer note —— 取自 outline.purpose（页脚不是演示文案的藏身处）
      elements.push({
        id: `footernote_${outline.slideId}`,
        variant: 'footernote',
        type: 'text',
        role: 'footer',
        content: outline.purpose,
        geometry: { x: 100, y: 1015, width: 600, height: 30 },
        style: {
          fontSize: 13,
          fontWeight: 400,
          color: theme.textSecondary,
          opacity: 0.7,
        },
        editable: false,
        zIndex: 5,
      });
    }

    // 3. Layout-specific Content Elements
    const layout = LayoutEngine.resolveLayout(outline, bound);
    switch (layout) {
      case 'title_cover':
        this.buildTitleCoverLayout(elements, outline, theme, bound);
        break;

      case 'architecture_diagram':
        this.buildArchitectureDiagramLayout(elements, outline, theme, bound);
        break;

      case 'cards_grid':
        this.buildCardsGridLayout(elements, outline, theme, bound);
        break;

      case 'problem_solution':
        this.buildProblemSolutionLayout(elements, outline, theme, bound);
        break;

      case 'timeline_roadmap':
        this.buildTimelineRoadmapLayout(elements, outline, theme, bound);
        break;

      case 'stats_kpi':
        this.buildStatsKpiLayout(elements, outline, theme, bound);
        break;

      case 'radial_center':
        this.buildRadialCenterLayout(elements, outline, theme, bound);
        break;

      case 'summary_conclusion':
      default:
        this.buildSummaryLayout(elements, outline, theme, bound);
        break;
    }

    return {
      slideId: outline.slideId,
      order: slideOrder,
      title: outline.title,
      purpose: outline.purpose,
      keyMessage: outline.keyMessage,
      speakerNotes: outline.speakerNotes,
      visualIntent: outline.visualIntent,
      layout: {
        type: layout,
      },
      canvas,
      elements,
      versionId: `v_${Date.now()}`,
      lastModified: Date.now(),
    };
  }

  /**
   * 版式降级裁决
   * ---------------------------------------------------------------------------
   * 降级规则写在**契约表**里（`data/layoutIntents.ts` 的 `degradesTo`），
   * 不写在这里 —— 引擎只负责执行，规则本身是数据。
   *
   * 契约表现在只声明了一条降级：`stats_kpi` 的指标里没有数字时降级为
   * `cards_grid`（一页没有数字的「核心指标」不是指标页）。
   */
  private static resolveLayout(outline: SlideOutlineItem, bound: SlideContent): SlideLayoutType {
    const preferred = outline.layoutPreference;
    const contract = slotContractOf(preferred);
    if (!contract.degradesTo) return preferred;

    // 契约要求的槽位都达标 → 保留首选版式
    if (validateContentForLayout(preferred, bound).ok) return preferred;

    // 不达标 → 降级到契约声明的兜底版式
    return contract.degradesTo;
  }

  /**
   * Layout: Title Cover (封面)
   * ---------------------------------------------------------------------------
   * 槽位：title / subtitle / meta。**不消费 bullets**（槽位映射表明确如此）。
   */
  private static buildTitleCoverLayout(
    elements: SlideElement[],
    outline: SlideOutlineItem,
    theme: TemplateTheme,
    bound: SlideContent
  ) {
    // Top Kicker Badge —— 核心结论
    const kickerWidth = Math.min(
      1600,
      Math.max(240, estimateTextWidth(bound.keyMessage ?? '', 14) + 48)
    );
    elements.push({
      id: `kicker_${outline.slideId}`,
      variant: 'kicker',
      type: 'badge',
      role: 'badge',
      content: bound.keyMessage,
      geometry: { x: 160, y: 240, width: kickerWidth, height: 36 },
      style: {
        fontSize: 14,
        fontWeight: 700,
        color: theme.accentColor,
        backgroundColor: `${theme.accentColor}18`,
        borderColor: `${theme.accentColor}40`,
        borderWidth: 1,
        borderRadius: 6,
        padding: 8,
        letterSpacing: '0.08em',
      },
      editable: true,
      zIndex: 10,
    });

    // Giant Title
    elements.push({
      id: `maintitle_${outline.slideId}`,
      variant: 'maintitle',
      type: 'text',
      role: 'title',
      content: bound.title,
      geometry: { x: 160, y: 310, width: 1450, height: 180 },
      style: {
        fontSize: 66,
        fontWeight: 800,
        fontFamily: theme.fontHeading,
        color: theme.textPrimary,
        lineHeight: 1.15,
      },
      editable: true,
      zIndex: 10,
    });

    // Subtitle / Narrative
    elements.push({
      id: `subtitle_${outline.slideId}`,
      variant: 'subtitle',
      type: 'text',
      role: 'subtitle',
      content: bound.subtitle,
      geometry: { x: 160, y: 520, width: 1200, height: 80 },
      style: {
        fontSize: 26,
        fontWeight: 500,
        color: theme.textSecondary,
        lineHeight: 1.4,
      },
      editable: true,
      zIndex: 10,
    });

    // Accent line
    elements.push({
      id: `accent_line_${outline.slideId}`,
      variant: 'accent_line',
      type: 'shape',
      role: 'divider',
      content: '',
      geometry: { x: 160, y: 640, width: 120, height: 4 },
      style: {
        backgroundColor: theme.accentColor,
        borderRadius: 2,
      },
      editable: false,
      zIndex: 10,
    });

    // Metadata card —— 视觉意图 + 演讲者备注
    elements.push({
      id: `metacard_${outline.slideId}`,
      variant: 'metacard',
      type: 'card',
      role: 'card',
      content: {
        title: bound.meta?.['visualIntent'] ?? outline.visualIntent,
        items: bound.meta?.['speakerNotes']
          ? [bound.meta['speakerNotes']]
          : outline.speakerNotes
            ? [outline.speakerNotes]
            : [],
      },
      geometry: { x: 160, y: 720, width: 1100, height: 130 },
      style: {
        backgroundColor: theme.surfaceColor,
        borderColor: theme.surfaceBorder,
        borderWidth: 1,
        borderRadius: 12,
        padding: 24,
      },
      editable: true,
      zIndex: 10,
    });
  }

  /**
   * Layout: Layered Architecture Diagram (分层架构)
   * ---------------------------------------------------------------------------
   * 槽位：layers[]。降级：bullets 按层级切分 —— 每条要点一层，
   * 要点的「标签」是层名，「正文」是层内容。
   */
  private static buildArchitectureDiagramLayout(
    elements: SlideElement[],
    outline: SlideOutlineItem,
    theme: TemplateTheme,
    bound: SlideContent
  ) {
    const layers = bound.layers ?? [];

    const accents = [theme.primaryColor, theme.secondaryColor, theme.accentColor, theme.surfaceBorder];
    const startX = 100;
    const contentWidth = 1720;
    const top = 220;
    const bottom = 980;
    const gap = 20;

    const count = layers.length;
    const layerHeight =
      count > 0 ? Math.max(72, Math.floor((bottom - top - gap * (count - 1)) / count)) : 0;

    layers.forEach((layer, index) => {
      const y = top + index * (layerHeight + gap);
      const accent = accents[index % accents.length];

      // Layer background container
      elements.push({
        id: `layer_box_${outline.slideId}_${index}`,
        variant: 'layer_box',
        type: 'architecture_layer',
        role: 'layer',
        content: '',
        geometry: { x: startX, y, width: contentWidth, height: layerHeight },
        style: {
          backgroundColor: theme.surfaceColor,
          borderColor: theme.surfaceBorder,
          borderWidth: 1,
          borderRadius: 12,
          padding: 20,
        },
        editable: true,
        zIndex: 5,
        metadata: { tierIndex: index },
      });

      // Layer Title —— 要点的标签
      elements.push({
        id: `layer_title_${outline.slideId}_${index}`,
        variant: 'layer_title',
        type: 'text',
        role: 'title',
        content: layer.title,
        geometry: { x: startX + 24, y: y + 16, width: contentWidth - 48, height: 28 },
        style: {
          fontSize: 17,
          fontWeight: 700,
          color: accent,
        },
        editable: true,
        zIndex: 10,
      });

      // Layer Body —— 要点的正文
      const layerBody = (layer.items ?? []).join('\n');
      if (layerBody) {
        elements.push({
          id: `layer_body_${outline.slideId}_${index}`,
          variant: 'layer_body',
          type: 'text',
          // role 不能是 'card'：它嵌套在 role='layer' 的容器里，
          // 而质量引擎的碰撞检测会拿所有 card/layer 元素两两比 AABB，
          // 嵌套容器与子元素必然相交 → 每次都被判碰撞扣分（TC-CORE-084）。
          // 容器本身已经是 'layer'，子元素只是层内的正文。
          role: 'annotation',
          content: layerBody,
          geometry: {
            x: startX + 24,
            y: y + 52,
            width: contentWidth - 48,
            height: Math.max(24, layerHeight - 66),
          },
          style: {
            fontSize: 15,
            fontWeight: 400,
            color: theme.textSecondary,
            lineHeight: 1.6,
          },
          editable: true,
          zIndex: 10,
        });
      }
    });
  }

  /**
   * Layout: Cards Grid (多卡片 / 能力矩阵)
   * ---------------------------------------------------------------------------
   * 槽位：bullets[]。一条要点一张卡片，卡片标题取要点标签、卡片正文取要点正文。
   */
  private static buildCardsGridLayout(
    elements: SlideElement[],
    outline: SlideOutlineItem,
    theme: TemplateTheme,
    bound: SlideContent
  ) {
    const cards = bound.bullets.map((b, i) => {
      const { label, body } = splitBullet(b);
      return { tag: `DIMENSION 0${i + 1}`, title: label, desc: body };
    });

    const totalWidth = 1720;
    const gap = 24;
    const startX = 100;
    const startY = 240;
    const areaHeight = 680;

    const columns = Math.min(Math.max(cards.length, 1), 4);
    const rows = Math.max(1, Math.ceil(cards.length / columns));
    const cardWidth = (totalWidth - (columns - 1) * gap) / columns;
    const cardHeight = (areaHeight - (rows - 1) * gap) / rows;

    cards.forEach((c, i) => {
      const col = i % columns;
      const row = Math.floor(i / columns);
      const x = startX + col * (cardWidth + gap);
      const y = startY + row * (cardHeight + gap);

      // Card container —— 卡片内容整体由卡片元素承载，文字不再重复一份
      elements.push({
        id: `grid_card_${outline.slideId}_${i}`,
        variant: 'grid_card',
        type: 'card',
        role: 'card',
        content: c,
        geometry: { x, y, width: cardWidth, height: cardHeight },
        style: {
          backgroundColor: theme.surfaceColor,
          borderColor: theme.surfaceBorder,
          borderWidth: 1,
          borderRadius: 14,
          padding: 32,
        },
        editable: true,
        zIndex: 5,
      });
    });
  }

  /**
   * Layout: Problem vs Solution (左右对比)
   * ---------------------------------------------------------------------------
   * 槽位：columns[2]。降级：bullets 前半 / 后半切分。
   */
  private static buildProblemSolutionLayout(
    elements: SlideElement[],
    outline: SlideOutlineItem,
    theme: TemplateTheme,
    bound: SlideContent
  ) {
    const columns = bound.columns ?? [];
    const left = columns[0] ?? { title: '核心问题', items: [] };
    const right = columns[1] ?? { title: '解决方案', items: [] };

    const colWidth = 830;
    const startY = 240;
    const height = 680;

    // Left Column: Challenges / Pain Points
    elements.push({
      id: `problem_box_${outline.slideId}`,
      variant: 'problem_box',
      type: 'card',
      role: 'card',
      content: {
        title: left.title,
        items: left.items,
      },
      geometry: { x: 100, y: startY, width: colWidth, height },
      style: {
        backgroundColor: `${theme.surfaceColor}`,
        borderColor: '#ef444433',
        borderWidth: 1,
        borderRadius: 14,
        padding: 36,
      },
      editable: true,
      zIndex: 5,
    });

    // Right Column: Target Solution
    elements.push({
      id: `solution_box_${outline.slideId}`,
      variant: 'solution_box',
      type: 'card',
      role: 'card',
      content: {
        title: right.title,
        items: right.items,
      },
      geometry: { x: 990, y: startY, width: colWidth, height },
      style: {
        backgroundColor: `${theme.surfaceColor}`,
        borderColor: `${theme.primaryColor}55`,
        borderWidth: 1,
        borderRadius: 14,
        padding: 36,
      },
      editable: true,
      zIndex: 5,
    });
  }

  /**
   * Layout: Timeline Roadmap (实施路线)
   * ---------------------------------------------------------------------------
   * 槽位：phases[]。降级：bullets 按数量均分阶段。
   */
  private static buildTimelineRoadmapLayout(
    elements: SlideElement[],
    outline: SlideOutlineItem,
    theme: TemplateTheme,
    bound: SlideContent
  ) {
    const phases = bound.phases ?? [];

    const totalWidth = 1720;
    const stepWidth = 405;
    const gap = 33;
    const startX = 100;
    const startY = 280;

    // Timeline Connecting Bar
    elements.push({
      id: `timeline_bar_${outline.slideId}`,
      variant: 'timeline_bar',
      type: 'shape',
      role: 'divider',
      content: '',
      geometry: { x: startX, y: startY + 40, width: totalWidth, height: 4 },
      style: {
        backgroundColor: theme.surfaceBorder,
      },
      editable: false,
      zIndex: 2,
    });

    phases.forEach((phase, idx) => {
      const x = startX + idx * (stepWidth + gap);

      // Node Milestone Circle
      elements.push({
        id: `timeline_node_${outline.slideId}_${idx}`,
        variant: 'timeline_node',
        type: 'shape',
        role: 'badge',
        content: String(idx + 1),
        geometry: { x: x + 20, y: startY + 22, width: 40, height: 40 },
        style: {
          backgroundColor: idx === 0 ? theme.accentColor : theme.primaryColor,
          borderRadius: 20,
          color: '#ffffff',
          fontWeight: 700,
          fontSize: 16,
          textAlign: 'center',
          lineHeight: 40,
        },
        editable: false,
        zIndex: 5,
      });

      // Milestone Card
      elements.push({
        id: `timeline_card_${outline.slideId}_${idx}`,
        variant: 'timeline_card',
        type: 'card',
        role: 'card',
        content: {
          phase: phase.phase,
          time: phase.time,
          title: phase.title,
          deliverables: phase.deliverables,
        },
        geometry: { x, y: startY + 90, width: stepWidth, height: 550 },
        style: {
          backgroundColor: theme.surfaceColor,
          borderColor: theme.surfaceBorder,
          borderWidth: 1,
          borderRadius: 12,
          padding: 24,
        },
        editable: true,
        zIndex: 5,
      });
    });
  }

  /**
   * Layout: Stats & KPI (核心指标)
   * ---------------------------------------------------------------------------
   * 槽位：metrics[]。降级：bullets 取数值前缀作指标值，其余作指标标题。
   * 整页没有任何数字时，resolveLayout 已把版式降级为 cards_grid。
   */
  private static buildStatsKpiLayout(
    elements: SlideElement[],
    outline: SlideOutlineItem,
    theme: TemplateTheme,
    bound: SlideContent
  ) {
    const metrics = bound.metrics ?? [];

    const totalWidth = 1720;
    const gap = 33;
    const startX = 100;
    const startY = 250;
    const columns = Math.min(Math.max(metrics.length, 1), 4);
    const rows = Math.max(1, Math.ceil(metrics.length / columns));
    const cardWidth = (totalWidth - (columns - 1) * gap) / columns;
    const cardHeight = (650 - (rows - 1) * gap) / rows;

    metrics.forEach((s, idx) => {
      const col = idx % columns;
      const row = Math.floor(idx / columns);
      const x = startX + col * (cardWidth + gap);
      const y = startY + row * (cardHeight + gap);

      elements.push({
        id: `kpi_card_${outline.slideId}_${idx}`,
        variant: 'kpi_card',
        type: 'metric',
        role: 'metric',
        content: s,
        geometry: { x, y, width: cardWidth, height: cardHeight },
        style: {
          backgroundColor: theme.surfaceColor,
          borderColor: theme.surfaceBorder,
          borderWidth: 1,
          borderRadius: 14,
          padding: 32,
        },
        editable: true,
        zIndex: 5,
      });
    });
  }

  /**
   * Layout: Radial / Center Framework (中心辐射)
   * ---------------------------------------------------------------------------
   * 槽位：radial。降级：bullets 取前 4 条作为卫星，中心取本页核心结论。
   */
  private static buildRadialCenterLayout(
    elements: SlideElement[],
    outline: SlideOutlineItem,
    theme: TemplateTheme,
    bound: SlideContent
  ) {
    const centerX = 960 - 200;
    const centerY = 580 - 100;
    const radial = bound.radial;
    const center = radial?.center ?? { title: '', desc: '' };

    // Center Core Card
    elements.push({
      id: `radial_center_node_${outline.slideId}`,
      variant: 'radial_center_node',
      type: 'card',
      role: 'card',
      content: {
        tag: '',
        title: center.title,
        desc: center.desc,
      },
      geometry: { x: centerX, y: centerY, width: 400, height: 200 },
      style: {
        backgroundColor: `${theme.primaryColor}22`,
        borderColor: theme.primaryColor,
        borderWidth: 2,
        borderRadius: 16,
        padding: 24,
        textAlign: 'center',
      },
      editable: true,
      zIndex: 10,
    });

    const satelliteSlots = [
      { x: 160, y: 260 },
      { x: 1260, y: 260 },
      { x: 160, y: 640 },
      { x: 1260, y: 640 },
    ];

    (radial?.satellites ?? [])
      .slice(0, satelliteSlots.length)
      .forEach((satellite, i) => {
        elements.push({
          id: `radial_sat_${outline.slideId}_${i}`,
          variant: 'radial_sat',
          type: 'card',
          role: 'card',
          content: {
            tag: '',
            title: satellite.title,
            desc: satellite.desc,
          },
          geometry: { x: satelliteSlots[i]!.x, y: satelliteSlots[i]!.y, width: 500, height: 220 },
          style: {
            backgroundColor: theme.surfaceColor,
            borderColor: theme.surfaceBorder,
            borderWidth: 1,
            borderRadius: 14,
            padding: 24,
          },
          editable: true,
          zIndex: 5,
        });
      });
  }

  /**
   * Layout: Summary & Conclusion (总结展望)
   * ---------------------------------------------------------------------------
   * 槽位：summary。降级：bullets → points，keyMessage → headline。
   */
  private static buildSummaryLayout(
    elements: SlideElement[],
    outline: SlideOutlineItem,
    theme: TemplateTheme,
    bound: SlideContent
  ) {
    elements.push({
      id: `summary_main_card_${outline.slideId}`,
      variant: 'summary_main_card',
      type: 'card',
      role: 'card',
      content: {
        headline: bound.summary?.headline ?? bound.keyMessage,
        points: bound.summary?.points ?? bound.bullets,
      },
      geometry: { x: 100, y: 240, width: 1720, height: 680 },
      style: {
        backgroundColor: theme.surfaceColor,
        borderColor: theme.surfaceBorder,
        borderWidth: 1,
        borderRadius: 16,
        padding: 40,
      },
      editable: true,
      zIndex: 5,
    });
  }
}
