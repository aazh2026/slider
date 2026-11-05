/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 版式不变量 —— 64 组（8 版式 × 8 主题）的性质断言
 * ---------------------------------------------------------------------------
 * 64 组黄金快照（`layoutEngine.snapshot.test.ts`）保证的是「**没变**」，
 * 这组用例保证的是「**对**」。
 *
 * 两者不能互相替代：快照只会说「输出与基线一致」，基线本身错了它也一样绿。
 * 而版式侧真正要守住的性质是五条：
 *
 *   1. **层归属正确** —— 元素落在哪一层由 `variant` 说了算（ADR-018）；
 *   2. **accent 色正确跟随** —— 标了 `followsAccent` 的槽位必须跟着主题走；
 *   3. **无越界** —— 元素不越出画布；
 *   4. **无截断** —— 元素内容里的每一段文字都完整出现在渲染产物里；
 *   5. **无碰撞** —— 卡片 / 层之间留得住 10px 安全距（DEC-014）。
 *
 * 这五条正是波 1 的质量规则表在**版式侧**的对应物 —— 质量引擎是「事后扣分」，
 * 这里是「产物本身就必须成立」。事后扣分可以修版式，不变量挂了说明
 * **生成器**坏了，那不是修复能掩盖的。
 *
 * **手法**：不变量在**渲染产物**上判定，不在 IR 上自我复读。
 * 「层归属正确」查的是 SVG 里元素落在哪一层 `<g>`，「无截断」查的是
 * SVG 的文本节点里有没有那段原文 —— 查 IR 只会把实现抄一遍。
 *
 * 断言一律**收集违例后一次比对**：一个版式坏了要能一次看到全部 8 个主题的
 * 问题，而不是修一个报一个。
 */

import { describe, expect, test } from 'bun:test';

import { LayoutEngine } from '../src/engine/layoutEngine';
import { QualityEngine } from '../src/engine/qualityEngine';
import { SVGRenderer } from '../src/engine/svgRenderer';
import { ELEMENT_VARIANTS, layerOf, variantOf } from '../src/engine/elementVariant';
import { remapElementsToTheme } from '../src/engine/themeRemap';
import { LAYOUT_SLOT_CONTRACTS } from '../src/data/layoutIntents';
import type {
  ElementVariant,
  Geometry,
  PresentationProject,
  SlideElement,
  SlideIR,
  SlideLayoutType,
  TemplateTheme,
} from '../src/types/slide';
import { ALL_COMBOS, ALL_LAYOUTS, bulletsFor, makeOutline } from './fixtures';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

/** 64 组 —— 每组一页，slideId 唯一（否则整份文稿的元素 ID 会互相撞） */
interface Combo {
  layout: SlideLayoutType;
  theme: TemplateTheme;
  slide: SlideIR;
}

function buildAllCombos(): Combo[] {
  return ALL_COMBOS.map((combo, idx) => {
    const outline = makeOutline({
      slideId: `s${idx + 1}`,
      layoutPreference: combo.layout,
      bulletPoints: bulletsFor(combo.layout),
      title: `第 ${idx + 1} 页的标题`,
      keyMessage: `第 ${idx + 1} 页独有的核心结论`,
      purpose: `第 ${idx + 1} 页的目的`,
    });
    return {
      layout: combo.layout,
      theme: combo.theme,
      slide: LayoutEngine.generateSlideIR(outline, combo.theme, 1, 64),
    };
  });
}

// ---------------------------------------------------------------------------
// 局部工具
// ---------------------------------------------------------------------------

/** XML 反转义 —— 与 svgRenderer.escapeXml 对称 */
function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** SVG 里所有 `<text>` 的文本内容（去掉 tspan 标签，只留字） */
function svgTextContent(svg: string): string {
  const parts: string[] = [];
  for (const m of svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)) {
    parts.push(unescapeXml((m[1] ?? '').replace(/<[^>]*>/g, '')));
  }
  return parts.join(' ');
}

/** 去掉全部空白 —— 折行会吞掉行末空格，比对时不能被空格干扰 */
function squeeze(s: string): string {
  return s.replace(/\s+/g, '');
}

/** content 里的全部字符串叶子 */
function contentStrings(content: unknown, out: string[] = []): string[] {
  if (typeof content === 'string') {
    if (content.trim().length > 0) out.push(content);
    return out;
  }
  if (Array.isArray(content)) {
    content.forEach((c) => contentStrings(c, out));
    return out;
  }
  if (content && typeof content === 'object') {
    Object.values(content as Record<string, unknown>).forEach((c) => contentStrings(c, out));
  }
  return out;
}

/**
 * 两个矩形之间的间隙 —— 负值表示重叠
 * ---------------------------------------------------------------------------
 * DEC-014：separation = max(dx, dy)，10px 是**安全距**（恰好 10px 不算碰撞）。
 * 这里**独立**于质量引擎实现一遍 —— 引擎是解释规则表的，测试若照抄引擎的
 * 公式，两边一起错时就没人知道了。
 */
function separation(a: Geometry, b: Geometry): number {
  const dx = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));
  const dy = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height));
  return Math.max(dx, dy);
}

/** 元素在渲染产物里落进了哪一层 `<g>` */
function layerGroupOf(svg: string, elementId: string): string | null {
  const markers: Array<[string, string]> = [
    ['<g id="background-layer"', 'background'],
    ['<g id="template-layer"', 'template'],
    ['<g id="content-layer"', 'content'],
  ];
  const positions = markers
    .map(([marker, name]) => ({ name, at: svg.indexOf(marker) }))
    .filter((m) => m.at >= 0)
    .sort((a, b) => a.at - b.at);

  const hit = svg.indexOf(`data-element-id="${elementId}"`);
  if (hit < 0) return null;

  let current: string | null = null;
  for (const m of positions) {
    if (m.at < hit) current = m.name;
    else break;
  }
  return current;
}

/** 跟随 accent 色的槽位，把 accent 写在哪个属性上 */
function accentPropertyOf(el: SlideElement): 'color' | 'backgroundColor' {
  // 分隔线画的是 backgroundColor，其余（页眉 / 徽标 / 眉标）画的是 color
  return el.role === 'divider' ? 'backgroundColor' : 'color';
}

// ---------------------------------------------------------------------------
// 不变量
// ---------------------------------------------------------------------------

describe('版式不变量 · 每种版式渲染出来的就是它自己', () => {
  test('every-layout-renders-its-own-layout', () => {
    const wrong = buildAllCombos()
      .filter((c) => c.slide.layout.type !== c.layout)
      .map((c) => `${c.layout} → ${c.slide.layout.type}`);
    expect(wrong).toEqual([]);
  });

  test('every-layout-produces-its-declared-variants', () => {
    const missing: string[] = [];
    const extra: string[] = [];
    for (const combo of buildAllCombos()) {
      const contract = LAYOUT_SLOT_CONTRACTS[combo.layout];
      const produced = new Set(combo.slide.elements.map((el) => variantOf(el)));

      // 契约声明「必须产出」的槽位，一个都不能少
      for (const required of contract.requiresVariants) {
        if (!produced.has(required)) {
          missing.push(`${combo.layout} 缺少 ${required}（实际产出 ${[...produced].join('/')}）`);
        }
      }
      // 产出的槽位不得超过契约声明的范围 —— 多出来的就是「没在契约里的野生槽位」
      for (const v of produced) {
        if (!contract.produces.includes(v)) {
          extra.push(`${combo.layout} 产出了契约外的 ${v}`);
        }
      }
    }
    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
  });
});

describe('版式不变量 · 层归属由 variant 说了算', () => {
  test('elements-belong-to-declared-layers', () => {
    const mismatched: string[] = [];
    const missing: string[] = [];
    for (const combo of buildAllCombos()) {
      const svg = SVGRenderer.renderToString(combo.slide, combo.theme);
      for (const el of combo.slide.elements) {
        const declared = ELEMENT_VARIANTS[variantOf(el)].layer;
        // ① IR 里读出来的层归属必须与变体表一致
        if (layerOf(el) !== declared) {
          mismatched.push(`${el.id}：读到 ${layerOf(el)}，变体表写的是 ${declared}`);
        }
        // ② 渲染产物里元素必须真的落在那一层 `<g>` 里
        const actual = layerGroupOf(svg, el.id);
        if (actual === null) missing.push(`${combo.layout}/${el.id} 在 SVG 里找不到`);
        else if (actual !== declared) {
          mismatched.push(`${el.id}：SVG 里落在 ${actual} 层，变体表写的是 ${declared}`);
        }
      }
    }
    expect(mismatched).toEqual([]);
    expect(missing).toEqual([]);
  });

  test('every-element-declares-a-known-variant', () => {
    const bad: string[] = [];
    for (const combo of buildAllCombos()) {
      for (const el of combo.slide.elements) {
        // 版式引擎产出的元素一定带 variant 字段（不靠 ID 兜底）
        if (!el.variant) bad.push(`${el.id} 缺 variant 字段`);
        else if (!ELEMENT_VARIANTS[el.variant as ElementVariant]) {
          bad.push(`${el.id} 的 variant ${el.variant} 不在变体表里`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('版式不变量 · accent 色正确跟随主题', () => {
  test('accent-color-follows-the-theme', () => {
    const wrong: string[] = [];
    for (const combo of buildAllCombos()) {
      const remapped = remapElementsToTheme(combo.slide.elements, combo.theme);
      for (const el of combo.slide.elements) {
        const variant = variantOf(el);
        if (!ELEMENT_VARIANTS[variant].followsAccent) continue;
        const prop = accentPropertyOf(el);
        const after = remapped.find((r) => r.id === el.id);
        if (!after) {
          wrong.push(`${combo.layout}/${el.id} 重映射后消失了`);
          continue;
        }
        if (after.style[prop] !== combo.theme.accentColor) {
          wrong.push(
            `${combo.layout}/${el.id} 的 style.${prop} 是 ${after.style[prop]}，应为 ${combo.theme.accentColor}`
          );
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  test('accent-color-moves-when-theme-changes', () => {
    // 「跟随」的意思是**换主题时跟着换**，不是「恰好是当前这个颜色」
    const combo = ALL_COMBOS.find((c) => c.layout === 'cards_grid')!;
    const other = ALL_COMBOS.find(
      (c) => c.layout === 'cards_grid' && c.theme.accentColor !== combo.theme.accentColor
    )!;
    expect(other).toBeDefined();

    const slide = LayoutEngine.generateSlideIR(
      makeOutline({ slideId: 'sA', layoutPreference: 'cards_grid', bulletPoints: bulletsFor('cards_grid') }),
      combo.theme,
      1,
      64
    );
    const remapped = remapElementsToTheme(slide.elements, other.theme);
    const header = remapped.find((el) => variantOf(el) === 'header')!;
    expect(header.style.color).toBe(other.theme.accentColor);
  });
});

describe('版式不变量 · 几何不越界、不碰撞', () => {
  test('no-element-outside-canvas', () => {
    const out: string[] = [];
    for (const combo of buildAllCombos()) {
      const { width, height } = combo.slide.canvas;
      for (const el of combo.slide.elements) {
        const g = el.geometry;
        if (g.x < 0 || g.y < 0 || g.x + g.width > width || g.y + g.height > height) {
          out.push(
            `${combo.layout}/${el.id} 越界：x=${g.x} y=${g.y} w=${g.width} h=${g.height}（画布 ${width}×${height}）`
          );
        }
      }
    }
    expect(out).toEqual([]);
  });

  test('no-card-collision', () => {
    const hits: string[] = [];
    for (const combo of buildAllCombos()) {
      const boxes = combo.slide.elements.filter((el) => el.role === 'card' || el.role === 'layer');
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          const gap = separation(a.geometry, b.geometry);
          // DEC-014：10px 是安全距 —— 恰好 10px 不算碰撞
          if (gap < 10) {
            hits.push(`${combo.layout}/${a.id} 与 ${b.id} 间距 ${gap}px（< 10px 安全距）`);
          }
        }
      }
    }
    expect(hits).toEqual([]);
  });
});

describe('版式不变量 · 文字不被截断、不被丢弃', () => {
  test('no-text-is-truncated', () => {
    const lost: string[] = [];
    for (const combo of buildAllCombos()) {
      const svg = SVGRenderer.renderToString(combo.slide, combo.theme);
      const rendered = squeeze(svgTextContent(svg));
      for (const el of combo.slide.elements) {
        for (const s of contentStrings(el.content)) {
          if (!rendered.includes(squeeze(s))) {
            lost.push(`${combo.layout}/${el.id} 的「${s}」没有完整出现在渲染产物里`);
          }
        }
      }
    }
    expect(lost).toEqual([]);
  });
});

describe('版式不变量 · 质量引擎对 64 组零命中', () => {
  test('no-quality-issue-in-any-combo', () => {
    // 整份 64 页文稿一起评 —— 跨页规则（结论重复）也要一起过
    const combos = buildAllCombos();
    const slides = combos.map((c) => c.slide);
    const project: PresentationProject = {
      id: 'proj_invariants',
      name: '不变量夹具',
      requirement: {
        topic: '不变量',
        purpose: '不变量',
        audience: '不变量',
        pageCount: slides.length,
        style: '不变量',
        depth: '不变量',
        aspectRatio: '16:9',
      },
      template: {
        templateId: 'tpl_invariants',
        name: '不变量模板',
        category: 'fixture',
        description: '不变量夹具模板',
        theme: combos[0]!.theme,
        canvas: { width: 1920, height: 1080 },
        master: { showHeader: true, showFooter: true, showSlideNumber: true },
      },
      outline: [],
      slides,
      versions: {},
      createdAt: 0,
      updatedAt: 0,
    };

    const report = QualityEngine.evaluatePresentation(project);
    expect(report.issues.map((i) => `${i.id}：${i.message}`)).toEqual([]);
    expect(report.overallScore).toBe(100);
  });
});

describe('版式不变量 · 契约表覆盖全部版式', () => {
  test('every-layout-has-a-slot-contract', () => {
    const bad: string[] = [];
    for (const layout of ALL_LAYOUTS) {
      const contract = LAYOUT_SLOT_CONTRACTS[layout];
      if (!contract) {
        bad.push(`${layout} 没有槽位契约`);
        continue;
      }
      if (contract.layout !== layout) bad.push(`${layout} 的契约里 layout 写成了 ${contract.layout}`);
      if (contract.consumes.length === 0) bad.push(`${layout} 的契约没有消费任何槽位`);
      // 通用槽位永远是降级链的源头 —— 没有它这一页就排不出来
      if (!contract.consumes.includes('bullets')) bad.push(`${layout} 的契约没有消费 bullets`);
    }
    expect(bad).toEqual([]);
  });
});
