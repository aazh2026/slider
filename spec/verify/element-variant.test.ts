/**
 * SPEC-CORE-010 —— 元素语义住在字段里，不住在 ID 字符串里（ADR-018）
 * ---------------------------------------------------------------------------
 * 手法：不测「字段存在」，测**语义与 ID 解耦**——
 * 把元素的 ID 洗成一个不含任何语义的字符串，行为必须一字不变。
 * 只要还有任何一处消费方在猜 ID，这组用例就必然挂。
 *
 * 这正是波 0 的 ADR-014 踩过的坑：一键修复把 `header_s1` 洗成 `text_s1_1`，
 * 元素当场掉出模板层，换模板时不再跟随 accent 色。
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { QualityEngine } from '../../packages/core/src/engine/qualityEngine';
import { SVGRenderer } from '../../packages/core/src/engine/svgRenderer';
import {
  ALL_ELEMENT_VARIANTS,
  ELEMENT_VARIANTS,
  legacyVariantOf,
  variantOf,
  withVariants,
} from '../../packages/core/src/engine/elementVariant';
import { remapElementsToTheme } from '../../packages/core/src/engine/themeRemap';
import { ALL_THEMES, makeProject, makeSlide } from './helpers';

const REPO_ROOT = join(import.meta.dir, '..', '..');

/** 去掉 SVG 里的 id 属性 —— 比的是结构与配色，不是标识符 */
function normalizeSvg(svg: string): string {
  return svg.replace(/\s(?:id|data-element-id)="[^"]*"/g, '');
}

/** 把所有元素的 ID 洗成不含任何语义的字符串 */
function renameAll(slide: ReturnType<typeof makeSlide>): typeof slide {
  return {
    ...slide,
    elements: slide.elements.map((el, idx) => ({ ...el, id: `zzz_${slide.slideId}_${idx}` })),
  };
}

describe('SPEC-CORE-010 版式引擎产出的每个元素都必须带 variant', () => {
  test('layout-engine-sets-variant-on-every-element', () => {
    for (const layout of [
      'title_cover',
      'architecture_diagram',
      'cards_grid',
      'problem_solution',
      'timeline_roadmap',
      'stats_kpi',
      'radial_center',
      'summary_conclusion',
    ] as const) {
      const slide = makeSlide(layout, { slideId: 'v1' });
      expect(slide.elements.length).toBeGreaterThan(0);
      for (const el of slide.elements) {
        const variant = el.variant;
        expect(variant).toBeDefined();
        expect(ALL_ELEMENT_VARIANTS).toContain(variant!);
        // ID 的语义前缀必须与 variant 对应 —— ID 是 variant 的派生结果，不是反过来
        expect(el.id.startsWith(`${ELEMENT_VARIANTS[variant!].idPrefix}_`)).toBe(true);
      }
    }
  });
});

describe('SPEC-CORE-010 ID 重排的语义前缀来自 variant 字段', () => {
  test('id-repair-derives-prefix-from-variant', () => {
    const slide = makeSlide('cards_grid', { slideId: 'v1' });
    // 把 ID 洗成不含语义的名字 —— 如果修复还在从 ID 里抠语义，结果就会是 'zzz'
    const washed = renameAll(slide);
    const fixed = QualityEngine.autoFixProject(makeProject([washed]));

    expect(fixed.slides[0].elements.length).toBe(washed.elements.length);
    fixed.slides[0].elements.forEach((el, idx) => {
      expect(el.variant).toBeDefined();
      expect(el.id).toBe(`${ELEMENT_VARIANTS[el.variant!].idPrefix}_v1_${idx}`);
    });
  });
});

describe('SPEC-CORE-010 渲染分层与主题重映射只读 variant 字段', () => {
  test('render-and-theme-follow-variant-not-id', () => {
    const slide = makeSlide('cards_grid', { slideId: 'v1' });
    const theme = ALL_THEMES[0]!;
    const other = ALL_THEMES[3]!;

    // ① 渲染：改 ID 不改分层（页眉仍在 template-layer，标题仍在 content-layer）
    const before = normalizeSvg(SVGRenderer.renderToString(slide, theme));
    const after = normalizeSvg(SVGRenderer.renderToString(renameAll(slide), theme));
    expect(after).toBe(before);

    // ② 主题重映射：改 ID 不改配色
    const stylesOf = (s: typeof slide) => remapElementsToTheme(s.elements, other).map((el) => el.style);
    expect(stylesOf(renameAll(slide))).toEqual(stylesOf(slide));
  });

  test('accent-divider-follows-accent-color-on-theme-change', () => {
    // 分隔线画的是 backgroundColor —— 曾经的 App 主题快切写的是 color，
    // 于是换主题后强调线**不换色**。这条把那个真 bug 钉住。
    const cover = makeSlide('title_cover', { slideId: 'v1' });
    const accentLine = cover.elements.find((el) => el.variant === 'accent_line');
    expect(accentLine).toBeDefined();

    const other = ALL_THEMES.find((t) => t.accentColor !== ALL_THEMES[0]!.accentColor)!;
    const remapped = remapElementsToTheme(cover.elements, other);
    const line = remapped.find((el) => el.variant === 'accent_line');
    expect(line!.style.backgroundColor).toBe(other.accentColor);
  });
});

describe('SPEC-CORE-010 旧数据缺 variant 时走唯一兼容层迁移', () => {
  test('legacy-slide-migrates-without-losing-semantics', () => {
    const fresh = makeSlide('cards_grid', { slideId: 'v1' });
    // 造一份「旧 IR」—— 元素没有 variant 字段
    const legacy = {
      ...fresh,
      elements: fresh.elements.map((el) => {
        const { variant: _drop, ...rest } = el;
        return rest;
      }),
    };

    const migrated = withVariants(legacy);
    expect(migrated.elements.map((el) => el.variant)).toEqual(fresh.elements.map((el) => el.variant));

    // 幂等：已有 variant 的元素原样保留，返回同一个对象
    expect(withVariants(migrated)).toBe(migrated);

    // 兼容层只在字段缺失时才生效 —— 字段在场时绝不看 ID
    const renamed = { ...migrated, elements: migrated.elements.map((el) => ({ ...el, id: 'zzz_0' })) };
    expect(variantOf(renamed.elements[0]!)).toBe(migrated.elements[0]!.variant!);
    expect(legacyVariantOf('zzz_0')).toBeNull();
  });
});

describe('SPEC-CORE-010 全仓不得有消费方解析元素 ID', () => {
  test('no-consumer-parses-element-ids', () => {
    // 「字符串即语义」是事故的温床：一次重命名就掉一层、掉一次配色。
    // 这条把「全仓零处解析 ID」钉成不变量 ——
    // 唯一被允许的解析点是 elementVariant.ts 里的 legacy 兼容层。
    const roots = ['src', join('packages', 'core', 'src'), join('apps', 'api', 'src')];
    const offenders: string[] = [];
    const PATTERN = /\.\s*id\s*\.\s*(startsWith|includes|endsWith|match|split|replace|search|indexOf)\s*\(/g;

    for (const root of roots) {
      for (const file of collectSourceFiles(join(REPO_ROOT, root))) {
        const raw = readFileSync(file, 'utf8');
        // 注释里的历史写法不算 —— 那是文档，不是消费方
        const code = stripComments(raw);
        const lines = code.split('\n');
        lines.forEach((line, idx) => {
          PATTERN.lastIndex = 0;
          if (PATTERN.test(line)) {
            offenders.push(`${file.slice(REPO_ROOT.length + 1)}:${idx + 1}`);
          }
        });
      }
    }

    expect(offenders).toEqual([]);
    // 兼容层必须存在 —— 「零处解析」不等于「不许解析」
    expect(legacyVariantOf('header_s1')).toBe('header');
  });
});

/** 递归列出源码文件（跳过 node_modules / 隐藏目录） */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectSourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** 去掉块注释与行注释 —— 注释里的历史写法不是消费方 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    // 块注释已去掉，剩下的 `*` 开头的行是悬空的 JSDoc 续行
    .replace(/^\s*\*.*$/gm, ' ')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}
