/**
 * Spec 验证器公共工具
 * ---------------------------------------------------------------------------
 * 这些 helper 只做「搭台子」：造夹具、抽文本、抹掉非确定性字段。
 * 判定逻辑一律写在各自的 *.test.ts 里，避免把断言藏进 helper 导致
 * 「测试失败时说不清是哪条判据挂了」。
 */

import { LayoutEngine } from '../../packages/core/src/engine/layoutEngine';
import { BUILT_IN_TEMPLATES } from '../../packages/core/src/data/templates';
import type {
  ElementRole,
  ElementType,
  ElementVariant,
  Geometry,
  PresentationProject,
  SlideElement,
  SlideIR,
  SlideLayoutType,
  SlideOutlineItem,
  TemplateIR,
  TemplateTheme,
} from '../../packages/core/src/types/slide';

/** 全部 8 种版式 —— 版式全集来自 src/types/slide.ts 的 SlideLayoutType */
export const ALL_LAYOUTS: SlideLayoutType[] = [
  'title_cover',
  'architecture_diagram',
  'cards_grid',
  'problem_solution',
  'timeline_roadmap',
  'stats_kpi',
  'radial_center',
  'summary_conclusion',
];

/** 全部 8 套主题 —— 来自 src/data/templates.ts 的 BUILT_IN_TEMPLATES */
export const ALL_THEMES: TemplateTheme[] = BUILT_IN_TEMPLATES.map((t) => t.theme);

/** 消费 outline.bulletPoints 的 7 种版式（title_cover 按槽位表消费 title/subtitle/meta，不消费 bullets） */
export const BULLET_CONSUMING_LAYOUTS: SlideLayoutType[] = ALL_LAYOUTS.filter(
  (l) => l !== 'title_cover'
);

/** 版式 × 主题 = 64 组输入（LAY-08 快照基线的规模） */
export const ALL_COMBOS: Array<{ layout: SlideLayoutType; theme: TemplateTheme }> = ALL_LAYOUTS.flatMap(
  (layout) => ALL_THEMES.map((theme) => ({ layout, theme }))
);

/** 用作「要点可辨识标记」的前缀 —— 任何硬编码演示文案都不可能命中它 */
export const MARKER = 'ZQ7MARKER';

export function markerBullets(layout: SlideLayoutType, count = 4): string[] {
  return Array.from({ length: count }, (_, i) => `${MARKER}${layout}_P${i + 1}`);
}

/** 构造 SlideOutlineItem —— 只覆盖传入的字段，其余给确定性的默认值 */
export function makeOutline(partial: Partial<SlideOutlineItem> = {}): SlideOutlineItem {
  const base: SlideOutlineItem = {
    slideId: 's1',
    order: 1,
    title: '验证夹具标题',
    purpose: '验证夹具目的',
    keyMessage: '验证夹具核心结论',
    visualIntent: 'fixture visual intent',
    layoutPreference: 'cards_grid',
    requiredElements: [],
    speakerNotes: '夹具演讲者备注',
    bulletPoints: markerBullets('cards_grid'),
  };
  return { ...base, ...partial };
}

/** 调用被测版式引擎产出一页 SlideIR */
export function makeSlide(
  layout: SlideLayoutType,
  opts: {
    slideId?: string;
    order?: number;
    total?: number;
    theme?: TemplateTheme;
    outline?: Partial<SlideOutlineItem>;
  } = {}
): SlideIR {
  const outline = makeOutline({
    slideId: opts.slideId ?? 's1',
    layoutPreference: layout,
    ...opts.outline,
  });
  const theme = opts.theme ?? ALL_THEMES[0];
  return LayoutEngine.generateSlideIR(outline, theme, opts.order ?? 1, opts.total ?? 3);
}

function makeTemplate(theme: TemplateTheme): TemplateIR {
  return {
    templateId: 'tpl_fixture',
    name: 'Fixture Template',
    category: 'fixture',
    description: '验证夹具模板',
    theme,
    canvas: { width: 1920, height: 1080 },
    master: {
      showHeader: true,
      showFooter: true,
      showSlideNumber: true,
    },
  };
}

/** 组装一个 PresentationProject */
export function makeProject(
  slides: SlideIR[],
  opts: { name?: string; theme?: TemplateTheme } = {}
): PresentationProject {
  const theme = opts.theme ?? ALL_THEMES[0];
  return {
    id: 'proj_fixture',
    name: opts.name ?? '夹具项目',
    requirement: {
      topic: '夹具主题',
      purpose: '夹具目的',
      audience: '夹具受众',
      pageCount: slides.length,
      style: '夹具风格',
      depth: '夹具深度',
      aspectRatio: '16:9',
    },
    template: makeTemplate(theme),
    outline: [],
    slides,
    versions: {},
    createdAt: 0,
    updatedAt: 0,
  };
}

/** 抹掉时间戳类非确定性字段 —— SPEC-CORE-005 判定「纯函数」的前提 */
export function stripVolatile<T extends { versionId?: string; lastModified?: number }>(obj: T): T {
  const clone = { ...obj } as Record<string, unknown>;
  delete clone.versionId;
  delete clone.lastModified;
  return clone as T;
}

/**
 * 递归抽出 content 里的所有字符串。
 * content 可能是 string，也可能是 { tag, title, desc } / { items: [...] } 这类结构，
 * 判定「某段文本是否出现在页面上」时必须把它们全部摊平。
 */
export function collectStrings(content: unknown): string[] {
  if (typeof content === 'string') return content.length > 0 ? [content] : [];
  if (Array.isArray(content)) return content.flatMap(collectStrings);
  if (content && typeof content === 'object') {
    return Object.values(content as Record<string, unknown>).flatMap(collectStrings);
  }
  return [];
}

/** 同 collectStrings，但把数字也当作文本（PPTX 侧用模板串插值渲染数字） */
export function collectScalarTexts(content: unknown): string[] {
  if (typeof content === 'number') return [String(content)];
  if (typeof content === 'string') return content.length > 0 ? [content] : [];
  if (Array.isArray(content)) return content.flatMap(collectScalarTexts);
  if (content && typeof content === 'object') {
    return Object.values(content as Record<string, unknown>).flatMap(collectScalarTexts);
  }
  return [];
}

/** 一页内所有元素摊平后的文本集合 */
export function slideTexts(slide: SlideIR): string[] {
  return slide.elements.flatMap((el) => collectStrings(el.content));
}

/** 造一个最小、无缺陷的 SlideIR —— 用于质量引擎的扣分断言基线 */
export function makeCleanSlide(
  slideId: string,
  layout: SlideLayoutType = 'cards_grid',
  overrides: Partial<SlideIR> = {}
): SlideIR {
  const isCover = layout === 'title_cover';
  const elements: SlideElement[] = [
    {
      id: `bg_${slideId}`,
      type: 'shape',
      role: 'background',
      content: '',
      geometry: { x: 0, y: 0, width: 1920, height: 1080 },
      style: {},
      editable: false,
      zIndex: 0,
    },
  ];

  if (!isCover) {
    elements.push({
      id: `title_${slideId}`,
      type: 'text',
      role: 'title',
      content: '夹具页面标题',
      geometry: { x: 100, y: 90, width: 1350, height: 60 },
      style: {},
      editable: true,
      zIndex: 10,
    });
    elements.push({
      id: `keymsg_${slideId}`,
      type: 'text',
      role: 'subtitle',
      content: '核心结论：夹具核心结论',
      geometry: { x: 100, y: 155, width: 1450, height: 36 },
      style: {},
      editable: true,
      zIndex: 10,
    });
  }

  return {
    slideId,
    order: 1,
    title: '夹具页面标题',
    purpose: '夹具目的',
    keyMessage: '夹具核心结论',
    speakerNotes: '',
    visualIntent: 'fixture',
    layout: { type: layout },
    canvas: { width: 1920, height: 1080 },
    elements,
    ...overrides,
  };
}

/** 造一个元素（用于质量引擎的定向缺陷注入） */
export function makeElement(
  id: string,
  opts: {
    type?: ElementType;
    role?: ElementRole;
    /** 版式槽位（ADR-018）—— 不给就由 role/ID 兜底推断 */
    variant?: ElementVariant;
    geometry?: Geometry;
    content?: unknown;
  } = {}
): SlideElement {
  return {
    id,
    ...(opts.variant ? { variant: opts.variant } : {}),
    type: opts.type ?? 'text',
    // 默认用 footer —— 它既不参与 AABB 碰撞检测，也不像 background 那样被越界检查豁免
    role: opts.role ?? 'footer',
    content: opts.content ?? '',
    geometry: opts.geometry ?? { x: 100, y: 100, width: 200, height: 100 },
    style: {},
    editable: true,
    zIndex: 10,
  };
}

/**
 * 构造「无任何缺陷」的演示文稿：3 页、含 1 页封面、ID 唯一、几何在界内、标题与结论齐备。
 * 质量引擎的所有扣分断言都以此为基线，扣分幅度才能被单独隔离出来。
 */
export function makeCleanProject(opts: { name?: string } = {}): PresentationProject {
  const slides = [
    makeCleanSlide('p1', 'title_cover'),
    makeCleanSlide('p2', 'cards_grid'),
    makeCleanSlide('p3', 'cards_grid'),
  ];
  slides[1].order = 2;
  slides[2].order = 3;
  return makeProject(slides, opts);
}

/** XML 反转义（与 svgRenderer.escapeXml 对称），便于把 XML 里的文本与 IR 文本直接比对 */
export function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * 从 PPTX 的 slide/notes XML 中提取全部文本运行（<a:t>…</a:t>）。
 * 逐「运行」而不是逐「子串」比对 —— 否则 "3" 会被坐标里的数字误命中。
 */
export function extractTextRuns(xml: string): string[] {
  const runs: string[] = [];
  for (const m of xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)) {
    runs.push(unescapeXml(m[1] ?? '').replace(/\r\n/g, '\n').trim());
  }
  return runs;
}

/**
 * 最小 DOM 垫片 —— 只实现 ExportEngine 实际用到的三个浏览器原语：
 *   document.createElement('a'|'canvas') / URL.createObjectURL / Image
 * 目的不是伪造渲染结果，而是让**生产代码里的尺寸常量与文件名逻辑**真的跑起来。
 * 凡是被垫片替代掉的行为（真实像素、真实下载）都不在验收判据范围内。
 */
export function installDomShim(): { downloads: string[]; canvases: Array<{ width: number; height: number }> } {
  const downloads: string[] = [];
  const canvases: Array<{ width: number; height: number }> = [];

  const g = globalThis as Record<string, unknown>;

  g.document = {
    body: {
      appendChild() {},
      removeChild() {},
    },
    createElement(tag: string) {
      if (tag === 'canvas') {
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => ({
            fillStyle: '',
            fillRect() {},
            drawImage() {},
          }),
          toDataURL: () => 'data:image/png;base64,',
        };
        canvases.push(canvas);
        return canvas;
      }
      return {
        href: '',
        download: '',
        click() {
          downloads.push((this as { download: string }).download);
        },
      };
    },
  };

  g.Image = class {
    onload: (() => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    private _src = '';
    set src(v: string) {
      this._src = v;
      // 同步触发 onload —— 真实环境里是异步，这里只需要让 await 链能走完
      queueMicrotask(() => this.onload?.());
    }
    get src() {
      return this._src;
    }
  };

  const urlApi = g.URL as Record<string, unknown> | undefined;
  if (typeof urlApi?.createObjectURL !== 'function') {
    g.URL = {
      ...(urlApi ?? {}),
      createObjectURL: () => 'blob:fixture',
      revokeObjectURL: () => {},
    };
  }

  return { downloads, canvases };
}

/** 卸载 DOM 垫片 */
export function uninstallDomShim(): void {
  const g = globalThis as Record<string, unknown>;
  delete g.document;
  delete g.Image;
}
