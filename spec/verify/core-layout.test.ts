/**
 * SPEC-CORE-001 .. SPEC-CORE-007 —— 版式引擎契约
 * ---------------------------------------------------------------------------
 * 每个 test 名字与 spec/spec.yaml 里 acceptance[].verification.target 的
 * `文件::用例名` 一一对应，追溯矩阵靠这个对应关系建立。
 */

import { describe, expect, test } from 'bun:test';
import { LayoutEngine } from '../../packages/core/src/engine/layoutEngine';
import {
  ALL_COMBOS,
  ALL_LAYOUTS,
  ALL_THEMES,
  makeOutline,
  makeSlide,
  stripVolatile,
} from './helpers';

describe('SPEC-CORE-001 画布尺寸恒为 1920×1080', () => {
  test('canvas-is-always-1920x1080', () => {
    const bad: string[] = [];
    for (const { layout, theme } of ALL_COMBOS) {
      const slide = LayoutEngine.generateSlideIR(
        makeOutline({ layoutPreference: layout }),
        theme,
        1,
        12
      );
      if (slide.canvas.width !== 1920 || slide.canvas.height !== 1080) {
        bad.push(`${layout}/${theme.primaryColor} → ${slide.canvas.width}x${slide.canvas.height}`);
      }
    }
    expect(bad).toEqual([]);
    expect(ALL_COMBOS.length).toBe(64);
  });
});

describe('SPEC-CORE-002 版式元素不得越出画布', () => {
  test('no-element-out-of-canvas', () => {
    const violations: string[] = [];
    for (const { layout, theme } of ALL_COMBOS) {
      const slide = LayoutEngine.generateSlideIR(
        makeOutline({ layoutPreference: layout }),
        theme,
        1,
        12
      );
      for (const el of slide.elements) {
        if (el.role === 'background') continue;
        const { x, y, width, height } = el.geometry;
        if (x < 0 || y < 0 || x + width > 1920 || y + height > 1080) {
          violations.push(
            `${layout}/${el.id} → x=${x} y=${y} w=${width} h=${height} ` +
              `(right=${x + width}, bottom=${y + height})`
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('SPEC-CORE-003 元素 ID 在整个项目内全局唯一', () => {
  test('element-ids-unique-across-slides', () => {
    // 6 页，其中 2 页同为 cards_grid
    const slides = [
      makeSlide('title_cover', { slideId: 'p1', order: 1 }),
      makeSlide('cards_grid', { slideId: 'p2', order: 2 }),
      makeSlide('cards_grid', { slideId: 'p3', order: 3 }),
      makeSlide('problem_solution', { slideId: 'p4', order: 4 }),
      makeSlide('timeline_roadmap', { slideId: 'p5', order: 5 }),
      makeSlide('summary_conclusion', { slideId: 'p6', order: 6 }),
    ];
    const ids = slides.flatMap((s) => s.elements.map((e) => e.id));

    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) duplicates.add(id);
      seen.add(id);
    }

    expect([...duplicates].sort()).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('SPEC-CORE-004 版式专属元素 ID 必须携带 slideId', () => {
  test('layout-element-ids-contain-slide-id', () => {
    const offenders: string[] = [];
    for (const layout of ALL_LAYOUTS) {
      const slideId = `SLIDEID_${layout}`;
      const slide = makeSlide(layout, { slideId });
      for (const el of slide.elements) {
        if (!el.id.includes(slideId)) {
          offenders.push(`${layout} → ${el.id}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('SPEC-CORE-005 版式引擎是纯函数', () => {
  test('layout-engine-is-pure', () => {
    const diffs: string[] = [];
    for (const { layout, theme } of ALL_COMBOS) {
      const outline = makeOutline({ layoutPreference: layout });
      const a = stripVolatile(LayoutEngine.generateSlideIR(outline, theme, 1, 12));
      const b = stripVolatile(LayoutEngine.generateSlideIR(outline, theme, 1, 12));
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        diffs.push(`${layout}/${theme.primaryColor}`);
      }
    }
    expect(diffs).toEqual([]);
  });
});

describe('SPEC-CORE-006 封面页不渲染母版元素', () => {
  test('cover-page-has-no-master-elements', () => {
    const slide = makeSlide('title_cover', { slideId: 'cover1' });
    // 按 variant 认母版槽位，不按 ID 前缀（ADR-018：语义住在字段里）
    const masterVariants = slide.elements
      .map((e) => e.variant)
      .filter((v) => v === 'header' || v === 'pagenum' || v === 'footernote');
    expect(masterVariants).toEqual([]);
    expect(slide.elements.length).toBeGreaterThan(0);
  });
});

describe('SPEC-CORE-007 页码格式为 NN / TT', () => {
  test('page-number-format', () => {
    const slide = makeSlide('cards_grid', { slideId: 'num1', order: 3, total: 12 });
    const pageNum = slide.elements.find((e) => e.variant === 'pagenum');
    expect(pageNum).toBeDefined();
    expect(pageNum!.content).toBe('03 / 12');
  });
});

describe('夹具自检 —— 确认 8 种版式 / 8 套主题确实被枚举', () => {
  test('fixture-surface-is-complete', () => {
    expect(ALL_LAYOUTS.length).toBe(8);
    expect(ALL_THEMES.length).toBe(8);
    expect(ALL_COMBOS.length).toBe(64);
  });
});
