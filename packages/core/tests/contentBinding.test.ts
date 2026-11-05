/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 版式 → 槽位契约（波 2 ③）
 * ---------------------------------------------------------------------------
 * 以前「这个版式能放什么」是 `contentBinding.ts` 里一个 `switch` 的副产品：
 * 没有表格、不能查、也不能测。于是 AI 给 `cards_grid` 的页面附带了 `layers`，
 * 那份 layers 就被原样带进 `SlideContent`、一路带到渲染层，**没有任何一处
 * 会报告「这个槽位不属于这个版式」**。
 *
 * 现在内容绑定层是**绑定器 + 校验器**：
 *
 *   · 绑定按契约裁剪 —— 不属于这个版式的槽位不进这一页；
 *   · 校验给出结论 —— 缺什么报 error，多余的报 warning。
 *
 * 这组用例守的就是这两件事，外加**降级路径**：指标页没有数字时，
 * 版式引擎降级为 `cards_grid` —— 降级规则写在契约表（`degradesTo`）里，
 * 引擎只负责执行。
 */

import { describe, expect, test } from 'bun:test';

import { LayoutEngine } from '../src/engine/layoutEngine';
import { bindContent, validateContentForLayout } from '../src/engine/contentBinding';
import { LAYOUT_SLOT_CONTRACTS, slotContractOf } from '../src/data/layoutIntents';
import type { SlideContent } from '../src/types/content';
import { ALL_LAYOUTS, ALL_THEMES, makeOutline } from './fixtures';

/** 专属槽位（通用槽位 title/subtitle/keyMessage/bullets 任何版式都消费） */
const DEDICATED_SLOTS = [
  'columns',
  'layers',
  'phases',
  'metrics',
  'radial',
  'summary',
  'meta',
] as const;

/** 取槽位值 —— 槽位键是运行期字符串，索引要走一次窄化 */
function slotValue(content: SlideContent, slot: string): unknown {
  return (content as unknown as Record<string, unknown>)[slot];
}

/** 一份「什么槽位都带了」的内容 —— 用来验证裁剪 */
function overloadedContent(): SlideContent {
  return {
    title: '标题',
    subtitle: '副标题',
    keyMessage: '核心结论',
    bullets: ['要点一', '要点二'],
    columns: [{ title: '问题', items: ['a'] }],
    layers: [{ title: '层', items: ['b'] }],
    phases: [{ phase: 'PHASE 01', time: '', title: '', deliverables: ['c'] }],
    metrics: [{ value: '85%', trend: '', title: '转化率', desc: '提升' }],
    radial: { center: { title: '中心', desc: '' }, satellites: [{ title: '卫星', desc: '' }] },
    summary: { headline: '总结', points: ['d'], actions: [] },
    meta: { purpose: '目的' },
  };
}

describe('版式槽位契约 · 绑定按契约裁剪', () => {
  test('slots-not-consumed-by-layout-are-dropped', () => {
    for (const layout of ALL_LAYOUTS) {
      const contract = LAYOUT_SLOT_CONTRACTS[layout];
      const bound = bindContent(makeOutline({ layoutPreference: layout }), overloadedContent());

      for (const slot of contract.consumes) {
        // 被契约消费的槽位必须在
        expect(`${layout}:${slot}`).toBe(`${layout}:${slot}`);
        expect(slotValue(bound, slot)).toBeDefined();
      }
      for (const slot of DEDICATED_SLOTS) {
        if (contract.consumes.includes(slot)) continue;
        // 不被契约消费的槽位必须不在 —— 这正是以前「AI 给了 layers 就硬塞进去」
        expect(`${layout}:${slot}:${String(slotValue(bound, slot))}`).toBe(
          `${layout}:${slot}:undefined`
        );
        expect(slotValue(bound, slot)).toBeUndefined();
      }
    }
  });

  test('bullets-are-always-kept', () => {
    // bullets 是降级链的源头 —— 任何版式都从它出发，裁剪时也不能把它裁掉
    for (const layout of ALL_LAYOUTS) {
      const bound = bindContent(makeOutline({ layoutPreference: layout }), overloadedContent());
      expect(bound.bullets.length).toBeGreaterThan(0);
    }
  });
});

describe('版式槽位契约 · 校验器报告缺什么、多什么', () => {
  test('missing-required-slot-is-an-error', () => {
    // 架构图版式要求至少一层
    const result = validateContentForLayout('architecture_diagram', {
      bullets: ['要点一'],
    });
    expect(result.ok).toBe(false);
    const errors = result.issues.filter((i) => i.level === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((i) => i.slot === 'layers')).toBe(true);
  });

  test('extra-slot-is-a-warning-not-an-error', () => {
    // cards_grid 不消费 layers —— 给了 layers 是「多余」，不是「排不出来」
    const result = validateContentForLayout('cards_grid', overloadedContent());
    const errors = result.issues.filter((i) => i.level === 'error');
    const warnings = result.issues.filter((i) => i.level === 'warning');

    expect(errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.dropped).toContain('layers');
    expect(warnings.some((w) => w.slot === 'layers')).toBe(true);
    expect(warnings.every((w) => w.message.includes('丢弃'))).toBe(true);
  });

  test('metric-without-number-is-an-error', () => {
    // 「有 4 个指标」和「有 4 个带数字的指标」不是一回事
    const result = validateContentForLayout('stats_kpi', {
      bullets: ['增长很快', '规模很大'],
      metrics: [
        { value: '', trend: '', title: '增长很快', desc: '' },
        { value: '', trend: '', title: '规模很大', desc: '' },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.level === 'error' && i.slot === 'metrics')).toBe(true);
  });

  test('metric-with-number-is-valid', () => {
    const result = validateContentForLayout('stats_kpi', {
      bullets: ['85% 转化率提升'],
      metrics: [{ value: '85%', trend: '', title: '转化率提升', desc: '' }],
    });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  test('missing-content-is-an-error', () => {
    const result = validateContentForLayout('cards_grid', undefined);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.level).toBe('error');
  });
});

describe('版式槽位契约 · 降级规则写在契约表里', () => {
  test('stats-kpi-without-number-degrades-to-cards-grid', () => {
    // 整页没有数字时，「核心指标」页名不副实 —— 降级成能力矩阵页
    const outline = makeOutline({
      slideId: 'deg1',
      layoutPreference: 'stats_kpi',
      bulletPoints: ['增长很快', '规模很大'],
    });
    const slide = LayoutEngine.generateSlideIR(outline, ALL_THEMES[0]!, 1, 3);
    expect(slide.layout.type).toBe('cards_grid');
    expect(slide.elements.some((el) => el.variant === 'kpi_card')).toBe(false);
    expect(slide.elements.some((el) => el.variant === 'grid_card')).toBe(true);
  });

  test('stats-kpi-with-number-keeps-its-layout', () => {
    const outline = makeOutline({
      slideId: 'deg2',
      layoutPreference: 'stats_kpi',
      bulletPoints: ['85% 转化率提升', '1200 家客户接入'],
    });
    const slide = LayoutEngine.generateSlideIR(outline, ALL_THEMES[0]!, 1, 3);
    expect(slide.layout.type).toBe('stats_kpi');
    expect(slide.elements.some((el) => el.variant === 'kpi_card')).toBe(true);
  });

  test('only-stats-kpi-degrades', () => {
    // 契约表里只有 stats_kpi 声明了 degradesTo —— 别的版式不许悄悄换版式
    const degrading = ALL_LAYOUTS.filter((l) => slotContractOf(l).degradesTo);
    expect(degrading).toEqual(['stats_kpi']);
  });
});

describe('版式槽位契约 · 表本身是自洽的', () => {
  test('every-layout-has-a-contract', () => {
    for (const layout of ALL_LAYOUTS) {
      const contract = slotContractOf(layout);
      expect(contract.layout).toBe(layout);
      expect(contract.consumes.length).toBeGreaterThan(0);
    }
  });

  test('required-slots-are-consumed-slots', () => {
    // 契约要求一个槽位却不消费它 —— 那是永远满足不了的条款
    for (const layout of ALL_LAYOUTS) {
      const contract = slotContractOf(layout);
      for (const req of contract.requires) {
        expect(`${layout}:${req.slot}`).toBe(`${layout}:${req.slot}`);
        expect(contract.consumes).toContain(req.slot);
      }
    }
  });

  test('unknown-layout-falls-back-to-cards-grid', () => {
    const contract = slotContractOf(undefined);
    expect(contract.layout).toBe('cards_grid');
  });
});
