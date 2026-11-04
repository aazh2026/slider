/**
 * SPEC-QLT-001 .. SPEC-QLT-012 —— 质量引擎契约
 * ---------------------------------------------------------------------------
 * 手法：先造一份「零缺陷」演示文稿作为基线（四个分项都必须是 100），
 * 再每次只注入一种缺陷，断言扣分幅度。基线不干净的话，后面所有扣分断言都不可信。
 */

import { describe, expect, test } from 'bun:test';
import { QualityEngine } from '../../packages/core/src/engine/qualityEngine';
import { variantOf } from '../../packages/core/src/engine/elementVariant';
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
    /** 造一页：左边一张卡 + 右边一张卡，横向间距由 gap 决定 */
    function withTwoCards(secondX: number): ReturnType<typeof makeCleanProject> {
      const project = makeCleanProject();
      project.slides[1].elements.push(
        makeElement('aabb_a', { role: 'card', geometry: { x: 200, y: 300, width: 300, height: 200 } })
      );
      project.slides[1].elements.push(
        makeElement('aabb_b', { role: 'card', geometry: { x: secondX, y: 300, width: 300, height: 200 } })
      );
      return project;
    }

    // 重叠 15px —— 判碰撞
    const overlapReport = QualityEngine.evaluatePresentation(withTwoCards(485));
    expect(overlapReport.visualScore).toBe(92);
    expect(overlapReport.issues.some((i) => i.dimension === 'visual')).toBe(true);

    // 间隙 20px —— 判不碰撞
    expect(QualityEngine.evaluatePresentation(withTwoCards(520)).visualScore).toBe(100);

    // 重叠 5px —— **容差读法会放过，安全距读法判碰撞**（AMB-004 裁决的分水岭）
    expect(QualityEngine.evaluatePresentation(withTwoCards(495)).visualScore).toBe(92);

    // 间隙 5px —— 同上：容差读法（间隙一律放过）会放过，安全距读法判碰撞
    expect(QualityEngine.evaluatePresentation(withTwoCards(505)).visualScore).toBe(92);

    // 间隙恰好 10px —— 安全距取到即算分开，判不碰撞
    expect(QualityEngine.evaluatePresentation(withTwoCards(510)).visualScore).toBe(100);
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

/**
 * 版式引擎产出的元素 ID 前缀白名单
 * ---------------------------------------------------------------------------
 * 这些前缀在本项目里**承载语义**，不只是标识：
 *   · `header_` —— 决定 kicker 走哪个渲染层（svgRenderer），也决定换模板时
 *                  它是否跟随 accent 色
 *   · `accent_` —— 决定卡片底色用 accent 还是 surfaceBorder
 *   · `pagenum_` / `footernote_` —— 人类可读的语义标签
 * 所以 ID 重排**只能改后半截**，绝不能把前缀洗成元素类型。
 */
const SEMANTIC_PREFIXES = [
  'bg',
  'header',
  'title',
  'keymsg',
  'pagenum',
  'footernote',
  'grid_card',
  'kicker',
  'maintitle',
  'subtitle',
  'accent_line',
  'metacard',
];

/** 母版元素 —— 它们本来就贴着画布边缘，修复时不得挪动 */
const MASTER_VARIANTS = ['pagenum', 'footernote', 'header', 'kicker'];

/**
 * 元素 ID 的语义部分 —— 去掉末尾的页号段与序号段
 * ---------------------------------------------------------------------------
 * 写法刻意与实现不同（按段拆，而不是反复剥后缀）——
 * 测试若只是把实现抄一遍，实现与测试会一起错。
 */
function semanticOf(id: string, slideId: string): string {
  const segments = id.split('_');
  const isSlide = (s: string) => s === slideId;
  const isIndex = (s: string) => /^\d+$/.test(s);
  if (segments.length > 1 && isSlide(segments[segments.length - 1])) segments.pop();
  if (segments.length > 1 && isIndex(segments[segments.length - 1])) segments.pop();
  if (segments.length > 1 && isSlide(segments[segments.length - 1])) segments.pop();
  if (segments.length > 1 && isIndex(segments[segments.length - 1])) segments.pop();
  return segments.join('_');
}

describe('SPEC-QLT-009 自动修复只把真越出画布的元素挪回安全区', () => {
  test('autofix-restores-bounds', () => {
    // 用真实版式引擎的产物做夹具 —— 母版元素（页码/页脚）本来就贴着画布右下角
    const slides: SlideIR[] = [
      makeSlide('cards_grid', { slideId: 'fx1', order: 1 }),
      makeSlide('cards_grid', { slideId: 'fx2', order: 2 }),
      makeSlide('title_cover', { slideId: 'fx3', order: 3 }),
    ];
    // 注入越界元素与重复 ID
    slides[0].elements.push(
      makeElement('bad_geo', {
        role: 'footer',
        // 语义住进字段（ADR-018）—— 修复后的 ID 由 variant 派生，
        // 不再能从 ID 前缀认出它是哪个元素，所以这里按 variant 找。
        variant: 'footer',
        geometry: { x: 40, y: 40, width: 1900, height: 900 },
      })
    );
    slides[1].elements[0].id = slides[0].elements[0].id;

    const project = makeProject(slides);
    const fixed = QualityEngine.autoFixProject(project);

    // 1) 越出画布的元素必须被挪回内容安全区
    const bad = fixed.slides[0].elements.find((el) => el.variant === 'footer');
    expect(bad).toBeDefined();
    const g = bad!.geometry;
    expect(g.x).toBeGreaterThanOrEqual(100);
    expect(g.y).toBeGreaterThanOrEqual(60);
    expect(g.x + g.width).toBeLessThanOrEqual(1820);
    expect(g.y + g.height).toBeLessThanOrEqual(1020);

    // 2) **没越界的元素一个坐标都不许动** —— 旧实现会把母版页码/页脚
    //    也钳进安全区，每点一次「一键修复」它们就上移一次
    const moved: string[] = [];
    project.slides.forEach((slide, sIdx) => {
      slide.elements.forEach((el, elIdx) => {
        const before = el.geometry;
        const after = fixed.slides[sIdx].elements[elIdx].geometry;
        const outOfCanvas =
          before.x < 0 ||
          before.y < 0 ||
          before.x + before.width > 1920 ||
          before.y + before.height > 1080;
        if (!outOfCanvas && JSON.stringify(before) !== JSON.stringify(after)) {
          moved.push(
            `${slide.slideId}/${el.id} ${JSON.stringify(before)} → ${JSON.stringify(after)}`
          );
        }
      });
    });
    expect(moved).toEqual([]);
  });
});

describe('SPEC-QLT-010 自动修复重排 ID：保留语义前缀且全局唯一', () => {
  test('autofix-restores-id-uniqueness', () => {
    const project = makeProject([
      makeSlide('cards_grid', { slideId: 'fx1', order: 1 }),
      makeSlide('title_cover', { slideId: 'fx2', order: 2 }),
    ]);
    // 注入一个与本页已有元素同 ID 的元素（制造重复）
    project.slides[1].elements.push(
      makeElement('title_fx2', { role: 'footer', geometry: { x: 100, y: 400, width: 200, height: 60 } })
    );

    const fixed = QualityEngine.autoFixProject(project);

    // 1) 全局唯一
    const ids = fixed.slides.flatMap((s) => s.elements.map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);

    // 2) 每个 ID 都带本页页号与本页内序号
    const badShape: string[] = [];
    fixed.slides.forEach((slide) => {
      slide.elements.forEach((el, idx) => {
        if (!el.id.endsWith(`_${slide.slideId}_${idx}`)) {
          badShape.push(`${slide.slideId}/${el.id} 期望以 _${slide.slideId}_${idx} 结尾`);
        }
      });
    });
    expect(badShape).toEqual([]);

    // 3) 语义前缀原样保留 —— 白名单锚定，不靠实现自证
    const afterPrefixes = new Set<string>();
    fixed.slides.forEach((slide) => {
      slide.elements.forEach((el) => afterPrefixes.add(semanticOf(el.id, slide.slideId)));
    });
    const unknown = [...afterPrefixes].filter((p) => !SEMANTIC_PREFIXES.includes(p));
    expect(unknown).toEqual([]);

    // 4) 没有任何元素的语义身份被洗掉（修复前后前缀集合一致）
    const beforePrefixes = new Set<string>();
    project.slides.forEach((slide) => {
      slide.elements.forEach((el) => beforePrefixes.add(semanticOf(el.id, slide.slideId)));
    });
    expect([...afterPrefixes].sort()).toEqual([...beforePrefixes].sort());
  });
});

describe('SPEC-QLT-010 自动修复不得挪动母版元素', () => {
  test('autofix-leaves-master-elements-alone', () => {
    const project = makeProject([
      makeSlide('title_cover', { slideId: 'fx1', order: 1 }),
      makeSlide('cards_grid', { slideId: 'fx2', order: 2 }),
    ]);
    // 注入一个真越界元素 —— 修复确实要动手，母版元素却不能被牵连
    project.slides[1].elements.push(
      makeElement('bad_geo', { role: 'footer', geometry: { x: -50, y: 40, width: 1900, height: 900 } })
    );

    const fixed = QualityEngine.autoFixProject(project);

    const moved: string[] = [];
    project.slides.forEach((slide, sIdx) => {
      slide.elements.forEach((el, elIdx) => {
        // 按 variant 认母版槽位，不按 ID 前缀（ADR-018：语义住在字段里）
        if (!MASTER_VARIANTS.includes(variantOf(el))) return;
        const after = fixed.slides[sIdx].elements[elIdx].geometry;
        if (JSON.stringify(el.geometry) !== JSON.stringify(after)) {
          moved.push(
            `${slide.slideId}/${el.id} ${JSON.stringify(el.geometry)} → ${JSON.stringify(after)}`
          );
        }
      });
    });
    expect(moved).toEqual([]);
  });
});

describe('SPEC-QLT-011 自动修复不得让文稿变得更糟', () => {
  test('autofix-never-lowers-score', () => {
    const project = makeProject([
      makeSlide('title_cover', { slideId: 'fx1', order: 1 }),
      makeSlide('cards_grid', { slideId: 'fx2', order: 2 }),
      makeSlide('cards_grid', { slideId: 'fx3', order: 3 }),
    ]);
    // 三种可修缺陷：画布比例错、ID 重复、元素越界
    project.slides[1].canvas = { width: 1600, height: 900 };
    project.slides[2].elements[1].id = project.slides[2].elements[0].id;
    project.slides[0].elements.push(
      makeElement('bad_geo', { role: 'footer', geometry: { x: 1700, y: 1000, width: 400, height: 200 } })
    );

    const before = QualityEngine.evaluatePresentation(project);
    const fixed = QualityEngine.autoFixProject(project);
    const after = fixed.qualityReport!;

    expect(after.overallScore).toBeGreaterThanOrEqual(before.overallScore);
    // 结构分必须真的涨了 —— 缺陷确实被修掉了
    expect(after.structureScore).toBeGreaterThan(before.structureScore);
    // 视觉分不得下降
    expect(after.visualScore).toBeGreaterThanOrEqual(before.visualScore);
    // 越界与重复 ID 都不得再出现
    expect(after.issues.filter((i) => i.id.startsWith('vis_bounds_'))).toEqual([]);
    expect(after.issues.filter((i) => i.id.startsWith('struct_id_'))).toEqual([]);
  });
});

describe('SPEC-QLT-012 每条诊断必须声明可否自动修复', () => {
  test('issues-declare-fixability', () => {
    const project = makeCleanProject();
    // 注入可修缺陷（越界）与不可修缺陷（标题过短）
    project.slides[1].elements.push(
      makeElement('oob', { role: 'footer', geometry: { x: 1800, y: 100, width: 200, height: 100 } })
    );
    project.slides[1].title = 'ab';

    const report = QualityEngine.evaluatePresentation(project);
    expect(report.issues.length).toBeGreaterThan(0);

    // 每一条都必须显式声明 —— 不声明就没法在前端区分「能一键修」与「只能看建议」
    const undeclared = report.issues.filter((i) => typeof i.fixable !== 'boolean').map((i) => i.id);
    expect(undeclared).toEqual([]);

    // 越界能自动修；标题缺失不能自动修（要人来写）
    const bounds = report.issues.find((i) => i.id.startsWith('vis_bounds_'));
    expect(bounds?.fixable).toBe(true);
    const title = report.issues.find((i) => i.id.startsWith('content_title_'));
    expect(title?.fixable).toBe(false);
  });
});

describe('SPEC-QLT-015 非封面页没有实质内容件扣内容分 8', () => {
  test('thin-page-penalty', () => {
    const project = makeCleanProject();
    // 把第 2 页的实质内容件（卡片）删掉 —— 只剩标题与结论
    project.slides[1].elements = project.slides[1].elements.filter((el) => el.role !== 'card');

    const report = QualityEngine.evaluatePresentation(project);
    expect(report.contentScore).toBe(92);
    expect(report.visualScore).toBe(100); // 稀疏判定与「空页」互斥，不重复扣
    expect(report.issues.some((i) => i.id === 'content_thin_p2')).toBe(true);

    // 封面豁免 —— 封面本就不该有卡片
    const cover = makeCleanProject();
    cover.slides[0].elements = cover.slides[0].elements.filter((el) => el.role !== 'card');
    const coverReport = QualityEngine.evaluatePresentation(cover);
    expect(coverReport.issues.some((i) => i.id.startsWith('content_thin_'))).toBe(false);
  });
});

describe('SPEC-QLT-016 跨页核心结论重复扣内容分 10', () => {
  test('duplicate-keymessage-penalty', () => {
    const project = makeCleanProject();
    // 第 3 页的核心结论与第 2 页一字不差
    project.slides[2].keyMessage = project.slides[1].keyMessage;

    const report = QualityEngine.evaluatePresentation(project);
    expect(report.contentScore).toBe(90);
    expect(report.issues.some((i) => i.id === 'content_dup_p3')).toBe(true);

    // 归一化后算同一句 —— 标点与空格不算差异
    const normalized = makeCleanProject();
    normalized.slides[2].keyMessage = `${normalized.slides[1].keyMessage}。`;
    expect(QualityEngine.evaluatePresentation(normalized).contentScore).toBe(90);

    // 封面不参与重复判定
    const withCover = makeCleanProject();
    withCover.slides[0].keyMessage = withCover.slides[1].keyMessage;
    expect(
      QualityEngine.evaluatePresentation(withCover).issues.some((i) => i.id.startsWith('content_dup_'))
    ).toBe(false);
  });
});

describe('SPEC-QLT-017 内容只盖住版心 20% 以下扣视觉分 8', () => {
  test('sparse-page-penalty', () => {
    const project = makeCleanProject();
    // 把第 2 页的内容块缩到版心一角：标题 + 结论 + 一张小卡片 ≈ 11% 版心
    const card = project.slides[1].elements.find((el) => el.role === 'card')!;
    card.geometry = { x: 100, y: 300, width: 200, height: 150 };

    const report = QualityEngine.evaluatePresentation(project);
    expect(report.visualScore).toBe(92);
    expect(report.contentScore).toBe(100); // 有卡片 → 不是空页，不扣内容分
    expect(report.issues.some((i) => i.id === 'vis_sparse_p2')).toBe(true);
  });

  test('thin-page-not-double-charged', () => {
    // 「没有实质内容件」与「因此显得稀疏」是同一件事的两种说法 ——
    // 同一页不重复扣两次分
    const project = makeCleanProject();
    project.slides[1].elements = project.slides[1].elements.filter((el) => el.role !== 'card');

    const report = QualityEngine.evaluatePresentation(project);
    expect(report.visualScore).toBe(100);
    expect(report.contentScore).toBe(92);
    expect(report.issues.filter((i) => i.id.startsWith('vis_sparse_'))).toEqual([]);
  });
});
