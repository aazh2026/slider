/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SPEC-IRP-002 / SPEC-IRP-003 —— IRPatch 协议契约
 * ---------------------------------------------------------------------------
 * docs/backend-design.md §4.3：
 *   > - **幂等**：同一条 patch 施加两次结果相同，便于重试。
 *   > case 'remove_element':   /* 存在性校验，删不存在则报错而非静默 *\/
 *
 * 验证目标（spec/spec.yaml）：
 *   - packages/core/tests/patchApplier.test.ts::apply-is-idempotent
 *   - packages/core/tests/patchApplier.test.ts::remove-missing-element-throws
 *
 * **测试名称与 spec 的 verification.target 一一对应** —— 追溯矩阵靠这个对应关系建立。
 */

import { describe, expect, test } from 'bun:test';

import {
  applyPatches,
  deepEqual,
  PatchApplyError,
} from '../src/engine/patchApplier';
import type { IRPatch, SlideIR } from '../src/types/slide';

/* -------------------------------------------------------------------------- */
/* 夹具                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 一页带分组的幻灯片
 * ---------------------------------------------------------------------------
 * `card_a` / `card_b` 同属 `g1` 组 —— replace_group 需要真实的组内成员。
 */
function fixture(): SlideIR {
  return {
    slideId: 's1',
    order: 1,
    title: '幂等性夹具',
    purpose: '夹具目的',
    keyMessage: '夹具核心结论',
    speakerNotes: '',
    visualIntent: 'fixture',
    layout: { type: 'cards_grid' },
    canvas: { width: 1920, height: 1080 },
    elements: [
      {
        id: 'bg_s1',
        type: 'shape',
        role: 'background',
        content: '',
        geometry: { x: 0, y: 0, width: 1920, height: 1080 },
        style: {},
        editable: false,
        zIndex: 0,
      },
      {
        id: 'title_s1',
        type: 'text',
        role: 'title',
        content: '夹具标题',
        geometry: { x: 100, y: 90, width: 1350, height: 60 },
        style: {},
        editable: true,
        zIndex: 10,
      },
      {
        id: 'card_a',
        type: 'card',
        role: 'card',
        content: '要点 A',
        geometry: { x: 100, y: 200, width: 600, height: 200 },
        style: {},
        editable: true,
        zIndex: 20,
        groupId: 'g1',
      },
      {
        id: 'card_b',
        type: 'card',
        role: 'card',
        content: '要点 B',
        geometry: { x: 750, y: 200, width: 600, height: 200 },
        style: {},
        editable: true,
        zIndex: 21,
        groupId: 'g1',
      },
      {
        id: 'note_s1',
        type: 'text',
        role: 'annotation',
        content: '批注',
        geometry: { x: 100, y: 900, width: 800, height: 60 },
        style: {},
        editable: true,
        zIndex: 30,
      },
    ],
  };
}

/**
 * 六种 operation 各一条补丁
 * ---------------------------------------------------------------------------
 * **刻意不写 zIndex** —— AI 产出的补丁不会凭空指定 zIndex，
 * 若幂等性依赖「补丁恰好带了 zIndex」，那这条要求就没被真正验证。
 */
const PATCHES: Record<string, IRPatch> = {
  update_element: {
    operation: 'update_element',
    targetId: 'card_a',
    changes: { content: '要点 A（已改）' },
  },
  remove_element: {
    operation: 'remove_element',
    targetId: 'note_s1',
  },
  add_element: {
    operation: 'add_element',
    changes: {
      id: 'new_el',
      type: 'text',
      role: 'annotation',
      content: '新增元素',
      geometry: { x: 100, y: 960, width: 400, height: 50 },
      style: {},
      editable: true,
    },
  },
  replace_group: {
    operation: 'replace_group',
    targetId: 'g1',
    changes: {
      elements: [
        {
          id: 'card_c',
          type: 'card',
          role: 'card',
          content: '要点 C',
          geometry: { x: 100, y: 200, width: 600, height: 200 },
          style: {},
          editable: true,
        },
      ],
    },
  },
  restyle_slide: {
    operation: 'restyle_slide',
    changes: { style: { color: '#ff0000' } },
  },
  reorder_elements: {
    operation: 'reorder_elements',
    changes: { order: ['note_s1', 'card_b', 'card_a'] },
  },
};

/* -------------------------------------------------------------------------- */
/* SPEC-IRP-002 幂等                                                           */
/* -------------------------------------------------------------------------- */

describe('SPEC-IRP-002 同一条补丁施加两次结果相同', () => {
  test('apply-is-idempotent', () => {
    const failures: string[] = [];

    for (const [name, patch] of Object.entries(PATCHES)) {
      const once = applyPatches(fixture(), [patch]);
      const twice = applyPatches(once, [patch]);

      if (!deepEqual(once, twice)) {
        failures.push(
          `${name}: 一次=${JSON.stringify(once.elements.map((e) => [e.id, e.zIndex]))} ` +
            `两次=${JSON.stringify(twice.elements.map((e) => [e.id, e.zIndex]))}`
        );
      }
    }

    expect(failures).toEqual([]);
    expect(Object.keys(PATCHES)).toHaveLength(6);
  });

  // 逐 operation 的粒度用例 —— 失败时能直接看出是哪一种操作坏了
  for (const [name, patch] of Object.entries(PATCHES)) {
    test(`apply-is-idempotent:${name}`, () => {
      const once = applyPatches(fixture(), [patch]);
      const twice = applyPatches(once, [patch]);
      expect(deepEqual(once, twice)).toBe(true);
    });
  }

  test('applyPatches 不修改入参（原子性）', () => {
    const slide = fixture();
    const before = structuredClone(slide);
    applyPatches(slide, [PATCHES.remove_element!]);
    expect(deepEqual(slide, before)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* SPEC-IRP-003 删除不存在的元素必须报错                                        */
/* -------------------------------------------------------------------------- */

describe('SPEC-IRP-003 删除不存在的元素必须报错', () => {
  test('remove-missing-element-throws', () => {
    const slide = fixture();
    const before = structuredClone(slide);

    let caught: unknown;
    try {
      applyPatches(slide, [
        { operation: 'remove_element', targetId: 'never_existed_element' },
      ]);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(PatchApplyError);
    expect((caught as PatchApplyError).code).toBe('UNKNOWN_ELEMENT');
    // 原子性 —— 抛出前后 SlideIR 深度相等
    expect(deepEqual(slide, before)).toBe(true);
  });

  test('删除已删除的元素是幂等 no-op（墓碑机制）', () => {
    const once = applyPatches(fixture(), [PATCHES.remove_element!]);
    const twice = applyPatches(once, [PATCHES.remove_element!]);
    expect(deepEqual(once, twice)).toBe(true);
    expect(once.removedElementIds).toContain('note_s1');
  });
});
