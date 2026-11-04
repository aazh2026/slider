/**
 * SPEC-RND-001 .. SPEC-RND-006 —— SVG 渲染契约
 * ---------------------------------------------------------------------------
 * 渲染器没有导出 escapeXml，所以转义用例通过「注入 payload → 取回 <text> 内的实际文本」
 * 来间接验证，而不是去 import 内部函数。
 */

import { describe, expect, test } from 'bun:test';
import { SVGRenderer } from '../../packages/core/src/engine/svgRenderer';
import type { SlideIR } from '../../packages/core/src/types/slide';
import { ALL_COMBOS, ALL_THEMES, makeElement, makeSlide } from './helpers';

const PAYLOAD = `<script>alert(1)</script> & "x" 'y'`;
const PAYLOAD_ESCAPED = `&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot; &apos;y&apos;`;

/** 只含一个文本元素的最小页面 */
function payloadSlide(content: string): SlideIR {
  return {
    slideId: 'esc1',
    order: 1,
    title: '转义夹具',
    purpose: '转义夹具',
    keyMessage: '转义夹具',
    speakerNotes: '',
    visualIntent: 'fixture',
    layout: { type: 'cards_grid' },
    canvas: { width: 1920, height: 1080 },
    elements: [
      makeElement('payload', {
        type: 'text',
        role: 'title',
        content,
        geometry: { x: 100, y: 100, width: 800, height: 60 },
      }),
    ],
  };
}

describe('SPEC-RND-001 用户内容进入 SVG 必须转义', () => {
  test('user-content-is-xml-escaped', () => {
    const svg = SVGRenderer.renderToString(payloadSlide(PAYLOAD), ALL_THEMES[0]);

    // 取回该 <text> 元素的实际字符内容
    const match = svg.match(/<text\b[^>]*>([\s\S]*?)<\/text>/);
    expect(match).not.toBeNull();
    const inner = (match![1] ?? '').trim();

    // 五个字符全部被转义，且顺序与实现一致（& 最先）
    expect(inner).toBe(PAYLOAD_ESCAPED);
    for (const raw of ['<', '>', '"', "'"]) {
      expect(inner.includes(raw)).toBe(false);
    }
    expect(inner.includes('&amp;')).toBe(true);
    expect(inner.includes('&lt;')).toBe(true);
    expect(inner.includes('&gt;')).toBe(true);
    expect(inner.includes('&quot;')).toBe(true);
    expect(inner.includes('&apos;')).toBe(true);

    // 整份输出不得出现可执行的 script 标签
    expect(svg.includes('<script')).toBe(false);
    expect(svg.includes(PAYLOAD)).toBe(false);
  });
});

describe('SPEC-RND-002 SVG 输出不得包含 foreignObject', () => {
  test('svg-contains-no-foreignobject', () => {
    const offenders: string[] = [];
    for (const { layout, theme } of ALL_COMBOS) {
      const slide = makeSlide(layout, { theme, slideId: `fo_${layout}` });
      const svg = SVGRenderer.renderToString(slide, theme);
      if (svg.includes('<foreignObject')) {
        const count = (svg.match(/<foreignObject/g) ?? []).length;
        offenders.push(`${layout}/${theme.primaryColor} → ${count} 处`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('SPEC-RND-003 SVG 输出不得引用外部字体', () => {
  test('svg-contains-no-external-font-import', () => {
    const offenders: string[] = [];
    for (const { layout, theme } of ALL_COMBOS) {
      const slide = makeSlide(layout, { theme, slideId: `fi_${layout}` });
      const svg = SVGRenderer.renderToString(slide, theme);

      if (svg.includes('fonts.googleapis.com')) offenders.push(`${layout} → googleapis`);
      if (svg.includes('@import url(')) offenders.push(`${layout} → @import url(`);

      // 命名空间声明不是资源引用，剔除后再检查外链
      const withoutNs = svg
        .replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '')
        .replace(/xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '');
      if (withoutNs.includes('http://') || withoutNs.includes('https://')) {
        offenders.push(`${layout} → 外链资源引用`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * 判断 SVG 里是否存在**独立的** id 属性。
 * 直接用 `svg.includes('id="x"')` 是不够的 —— `data-element-id="x"` 里也含有这个子串，
 * 那样就等于允许用 data-element-id 顶替 id，注入「删掉 id 属性」时抓不到。
 */
function hasBareIdAttr(svg: string, id: string): boolean {
  const needle = `id="${id}"`;
  let idx = svg.indexOf(needle);
  while (idx !== -1) {
    const prev = idx > 0 ? svg[idx - 1]! : '';
    // 前一个字符不能是 '-'（data-element-id）或单词字符（xxxid）
    if (prev !== '-' && !/[A-Za-z0-9_]/.test(prev)) return true;
    idx = svg.indexOf(needle, idx + 1);
  }
  return false;
}

describe('SPEC-RND-004 SVG 保留元素 ID', () => {
  test('svg-preserves-element-ids', () => {
    const missing: string[] = [];
    const inconsistent: string[] = [];

    for (const { layout, theme } of ALL_COMBOS) {
      const slide = makeSlide(layout, { theme, slideId: `id_${layout}` });
      const svg = SVGRenderer.renderToString(slide, theme);
      const ids = new Set(slide.elements.map((el) => el.id));

      for (const el of slide.elements) {
        // 文档要求的是「保留原始 id」——必须是 id 属性本身，不能用 data-element-id 顶替
        if (!hasBareIdAttr(svg, el.id)) missing.push(`${layout}/${el.id}`);
      }

      // 若同时输出了 data-element-id，它的值必须是本页某个元素的 IR id
      for (const m of svg.matchAll(/data-element-id="([^"]*)"/g)) {
        const value = m[1] ?? '';
        if (!ids.has(value)) inconsistent.push(`${layout} → data-element-id="${value}"`);
      }
    }

    expect(missing).toEqual([]);
    expect(inconsistent).toEqual([]);
  });
});

describe('SPEC-RND-005 SVG 按四层渲染', () => {
  test('svg-has-four-layers', () => {
    const layers = ['background-layer', 'template-layer', 'content-layer', 'decoration-layer'];
    for (const { layout, theme } of ALL_COMBOS) {
      const slide = makeSlide(layout, { theme, slideId: `lay_${layout}` });
      const svg = SVGRenderer.renderToString(slide, theme);

      // 四个图层分组各出现且仅出现一次
      for (const layer of layers) {
        const count = (svg.match(new RegExp(`id="${layer}"`, 'g')) ?? []).length;
        expect({ layout, layer, count }).toEqual({ layout, layer, count: 1 });
      }

      // 不得存在第五个图层分组（元素自身的 <g id="..."> 不算图层；
      // 注意 architecture_diagram 的元素 id 形如 layer_box_0，用 -layer 后缀区分）
      const layerGroups = [...svg.matchAll(/<g id="([^"]*-layer)"/g)].map((m) => m[1]);
      expect({ layout, layerGroups }).toEqual({ layout, layerGroups: layers });
    }
  });
});

describe('SPEC-RND-006 装不下的文字必须截断并补省略号', () => {
  test('long-text-is-truncated-with-ellipsis', () => {
    // 盒高 40px、字号 16px（行高 22px）→ 只放得下 1 行；
    // 原文按 800px 宽折成 2 行 —— 第 2 行必须被截掉
    const LONG = '很长的标题'.repeat(20);
    const slide = payloadSlide(LONG);
    slide.elements[0].geometry = { x: 100, y: 100, width: 800, height: 40 };

    const svg = SVGRenderer.renderToString(slide, ALL_THEMES[0]);

    // 整段原文不得原样出现在 SVG 里 —— 那意味着截断被绕过了
    expect(svg.includes(LONG)).toBe(false);
    // 截断必须留下省略号
    expect(svg.includes('…')).toBe(true);

    // 可见文本必须是原文的**前缀**加省略号（不能打乱顺序，也不能凭空多字）
    const match = svg.match(/<text\b[^>]*>([\s\S]*?)<\/text>/);
    expect(match).not.toBeNull();
    const visible = (match![1] ?? '').trim();
    expect(visible.endsWith('…')).toBe(true);
    const body = visible.slice(0, -1);
    expect(LONG.startsWith(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(body.length).toBeLessThan(LONG.length);
  });
});
