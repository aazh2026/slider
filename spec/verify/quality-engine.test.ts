/**
 * SPEC-QLT-001 .. SPEC-QLT-010 —— 质量引擎契约
 * ---------------------------------------------------------------------------
 * 手法：先造一份「零缺陷」演示文稿作为基线（四个分项都必须是 100），
 * 再每次只注入一种缺陷，断言扣分幅度。基线不干净的话，后面所有扣分断言都不可信。
 */

import { describe, expect, test } from 'bun:test';
import { QualityEngine } from '../../packages/core/src/engine/qualityEngine';
import type { PresentationProject, SlideIR } from '../../packages/core/src/types/slide';
import {
  makeCleanProject,
  makeCleanSlide,
  makeElement,
  makeProject,
  makeSlide,
} from './helpers';

describe('夹具自检 —— 零缺陷基线必须是四维满分', () => {
  test('clean-baseline-scores-100', () => {
    const report = QualityEngine.evaluatePresentation(makeCleanProject());
    expect({
      structure: report.structureScore,
      visual: report.visualScore,
      content: report.contentScore,
      consistency: report.consistencyScore,
      overall: report.overallScore,
    }).toEqual({
      structure: 100,
      visual: 100,
      content: 100,
      consistency: 100,
      overall: 100,
    });
    expect(report.issues).toEqual([]);
  });
});

describe('SPEC-QLT-001 质量分公式', () => {
  test('quality-formula-weights', () => {
    const projects: PresentationProject[] = [];

    // 组合 1：零缺陷
    projects.push(makeCleanProject());

    // 组合 2：画布不符 → 结构分 -15
    {
      const p = makeCleanProject();
      p.slides[1].canvas = { width: 1600, height: 900 };
      projects.push(p);
    }

    // 组合 3：重复 ID → 结构分 -5
    {
      const p = makeCleanProject();
      p.slides[2].elements[1].id = p.slides[1].elements[1].id;
      projects.push(p);
    }

    // 组合 4：元素越界 → 视觉分 -10
    {
      const p = makeCleanProject();
      p.slides[1].elements.push(
        makeElement('oob_1', {
          role: 'footer',
          geometry: { x: 1800, y: 100, width: 200, height: 100 },
        })
      );
      projects.push(p);
    }

    // 组合 5：标题过短 + 核心结论缺失 + 卡片碰撞（多维同时扣分）
    {
      const p = makeCleanProject();
      p.slides[1].title = 'ab';
      p.slides[1].keyMessage = '';
      p.slides[2].elements.push(
        makeElement('col_a', { role: 'card', geometry: { x: 200, y: 300, width: 300, height: 200 } })
      );
      p.slides[2].elements.push(
        makeElement('col_b', { role: 'card', geometry: { x: 485, y: 300, width: 300, height: 200 } })
      );
      projects.push(p);
    }

    const formulas: number[] = [];
    const signatures: string[] = [];

    for (const project of projects) {
      const r = QualityEngine.evaluatePresentation(project);
      const expected = Math.round(
        0.3 * r.structureScore + 0.3 * r.visualScore + 0.2 * r.contentScore + 0.2 * r.consistencyScore
      );
      expect(r.overallScore).toBe(expected);
      formulas.push(expected);
      signatures.push(
        `${r.structureScore}/${r.visualScore}/${r.contentScore}/${r.consistencyScore}`
      );
    }

    // 5 组必须真的产生了不同的分数组合，否则本用例是空转
    expect(new Set(signatures).size).toBe(5);
  });
});

describe('SPEC-QLT-002 画布尺寸不符扣结构分 15', () => {
  test('canvas-mismatch-penalty', () => {
    const project = makeCleanProject();
    project.slides[1].canvas = { width: 1600, height: 900 };
    const r = QualityEngine.evaluatePresentation(project);
    expect(r.structureScore).toBe(85);
    expect(r.visualScore).toBe(100);
    expect(r.issues.some((i) => i.dimension === 'structure' && i.level === 'error')).toBe(true);
  });
});

describe('SPEC-QLT-003 元素 ID 重复扣结构分 5', () => {
  test('duplicate-id-penalty', () => {
    const one = makeCleanProject();
    one.slides[2].elements[1].id = one.slides[1].elements[1].id;
    expect(QualityEngine.evaluatePresentation(one).structureScore).toBe(95);

    const two = makeCleanProject();
    two.slides[2].elements[1].id = two.slides[1].elements[1].id;
    two.slides[2].elements[2].id = two.slides[1].elements[2].id;
    expect(QualityEngine.evaluatePresentation(two).structureScore).toBe(90);
  });
});

describe('SPEC-QLT-004 元素几何越界扣视觉分 10', () => {
  test('out-of-bounds-penalty', () => {
    const over = makeCleanProject();
    over.slides[1].elements.push(
      makeElement('oob_over', {
        role: 'footer',
        geometry: { x: 1721, y: 100, width: 200, height: 100 },
      })
    );
    const overReport = QualityEngine.evaluatePresentation(over);
    expect(overReport.visualScore).toBe(90);
    expect(overReport.structureScore).toBe(100);

    const exact = makeCleanProject();
    exact.slides[1].elements.push(
      makeElement('oob_exact', {
        role: 'footer',
        geometry: { x: 1720, y: 100, width: 200, height: 100 },
      })
    );
    expect(QualityEngine.evaluatePresentation(exact).visualScore).toBe(100);
  });
});

describe('SPEC-QLT-005 卡片 AABB 碰撞扣视觉分 8', () => {
  test('aabb-collision-penalty', () => {
    // 重叠 15px —— 文档与实现两种读法都判碰撞
    const overlapping = makeCleanProject();
    overlapping.slides[1].elements.push(
      makeElement('aabb_a', { role: 'card', geometry: { x: 200, y: 300, width: 300, height: 200 } })
    );
    overlapping.slides[1].elements.push(
      makeElement('aabb_b', { role: 'card', geometry: { x: 485, y: 300, width: 300, height: 200 } })
    );
    const overlapReport = QualityEngine.evaluatePresentation(overlapping);
    expect(overlapReport.visualScore).toBe(92);
    expect(overlapReport.issues.some((i) => i.dimension === 'visual')).toBe(true);

    // 间隙 20px —— 文档与实现两种读法都判不碰撞
    const separated = makeCleanProject();
    separated.slides[1].elements.push(
      makeElement('aabb_a', { role: 'card', geometry: { x: 200, y: 300, width: 300, height: 200 } })
    );
    separated.slides[1].elements.push(
      makeElement('aabb_b', { role: 'card', geometry: { x: 520, y: 300, width: 300, height: 200 } })
    );
    expect(QualityEngine.evaluatePresentation(separated).visualScore).toBe(100);
  });
});

describe('SPEC-QLT-006 标题缺失或过短扣内容分 15', () => {
  test('missing-title-penalty', () => {
    const short = makeCleanProject();
    short.slides[1].title = 'ab';
    expect(QualityEngine.evaluatePresentation(short).contentScore).toBe(85);

    const ok = makeCleanProject();
    ok.slides[1].title = 'abc';
    expect(QualityEngine.evaluatePresentation(ok).contentScore).toBe(100);
  });
});

describe('SPEC-QLT-007 核心结论缺失扣内容分 8', () => {
  test('missing-keymessage-penalty', () => {
    const missing = makeCleanProject();
    missing.slides[1].keyMessage = '';
    expect(QualityEngine.evaluatePresentation(missing).contentScore).toBe(92);

    const cover = makeCleanProject();
    cover.slides[0].keyMessage = '';
    expect(QualityEngine.evaluatePresentation(cover).contentScore).toBe(100);
  });
});

describe('SPEC-QLT-008 页数不足与缺封面各扣一致性分', () => {
  test('consistency-penalties', () => {
    // 2 页且含封面 → 只触发页数惩罚
    const twoWithCover = makeProject([
      makeCleanSlide('c1', 'title_cover'),
      makeCleanSlide('c2', 'cards_grid'),
    ]);
    expect(QualityEngine.evaluatePresentation(twoWithCover).consistencyScore).toBe(85);

    // 3 页但无封面 → 只触发缺封面惩罚
    const threeNoCover = makeProject([
      makeCleanSlide('n1', 'cards_grid'),
      makeCleanSlide('n2', 'cards_grid'),
      makeCleanSlide('n3', 'cards_grid'),
    ]);
    expect(QualityEngine.evaluatePresentation(threeNoCover).consistencyScore).toBe(90);

    // 3 页且含封面 → 无扣分
    const threeWithCover = makeProject([
      makeCleanSlide('k1', 'title_cover'),
      makeCleanSlide('k2', 'cards_grid'),
      makeCleanSlide('k3', 'cards_grid'),
    ]);
    expect(QualityEngine.evaluatePresentation(threeWithCover).consistencyScore).toBe(100);
  });
});

describe('SPEC-QLT-009 自动修复必须把几何钳回安全区', () => {
  test('autofix-restores-bounds', () => {
    // 用真实版式引擎的产物做夹具 —— 母版元素（页码/页脚）本来就贴着画布右下角
    const slides: SlideIR[] = [
      makeSlide('cards_grid', { slideId: 'fx1', order: 1 }),
      makeSlide('cards_grid', { slideId: 'fx2', order: 2 }),
      makeSlide('title_cover', { slideId: 'fx3', order: 3 }),
    ];
    // 注入越界元素与重复 ID
    slides[0].elements.push(
      makeElement('bad_geo', { role: 'footer', geometry: { x: 40, y: 40, width: 1900, height: 900 } })
    );
    slides[1].elements[0].id = slides[0].elements[0].id;

    const project = makeProject(slides);
    const fixed = QualityEngine.autoFixProject(project);

    const violations: string[] = [];
    for (const slide of fixed.slides) {
      for (const el of slide.elements) {
        if (el.role === 'background') continue;
        const { x, y, width, height } = el.geometry;
        if (x < 100 || y < 60 || x + width > 1820 || y + height > 1020) {
          violations.push(
            `${slide.slideId}/${el.id} → x=${x} y=${y} w=${width} h=${height} ` +
              `(right=${x + width}, bottom=${y + height})`
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('SPEC-QLT-010 自动修复必须重排 ID 使其全局唯一', () => {
  test('autofix-restores-id-uniqueness', () => {
    const slides: SlideIR[] = [
      makeSlide('cards_grid', { slideId: 'fx1', order: 1 }),
      makeSlide('cards_grid', { slideId: 'fx2', order: 2 }),
    ];
    slides[1].elements[0].id = slides[0].elements[0].id;

    const fixed = QualityEngine.autoFixProject(makeProject(slides));

    const ids: string[] = [];
    const malformed: string[] = [];
    for (const slide of fixed.slides) {
      slide.elements.forEach((el, idx) => {
        ids.push(el.id);
        if (el.id !== `${el.type}_${slide.slideId}_${idx}`) {
          malformed.push(`${slide.slideId}/${el.id} 期望 ${el.type}_${slide.slideId}_${idx}`);
        }
      });
    }
    expect(malformed).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
