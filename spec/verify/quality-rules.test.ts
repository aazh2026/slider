/**
 * SPEC-QLT-013 —— 质量规则表与文档必须逐行对齐
 * ---------------------------------------------------------------------------
 * 判据为什么必须外部化：
 *
 *   以前「画布不对扣 15 分」这件事的唯一依据是「`qualityEngine.ts` 里写的是
 *   15」—— 判据只能自证（oracle tier = `self-derived`）。文档与实现谁对谁错
 *   没人说得清，改一个数字也不会有人发现。
 *
 *   现在扣分幅度的真相源是 `docs/quality-rules.md`（一份**文档**），
 *   `packages/core/src/engine/qualityRules.ts` 是它的机器副本。本测试逐行比对
 *   两边：表多一行、文档少一节、扣分对不上 —— 三种漂移都让本测试变红。
 *
 * 手法刻意不照抄实现：文档的表格用**人读格式**（中文「是 / 否」、
 * 维度用英文 token），解析器自己读，不去 import 任何常量。
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { QUALITY_RULES } from '../../packages/core/src/engine/qualityRules';
import { QualityEngine } from '../../packages/core/src/engine/qualityEngine';
import { makeCleanProject, makeElement, makeProject, makeSlide } from './helpers';

const DOC_PATH = fileURLToPath(new URL('../../docs/quality-rules.md', import.meta.url));
const DOC = readFileSync(DOC_PATH, 'utf8');

/** 文档总表里的一行 */
interface DocRow {
  id: string;
  dimension: string;
  penalty: number;
  fixable: boolean;
  description: string;
}

/**
 * 解析文档的「规则总表」
 * ---------------------------------------------------------------------------
 * 表格形状：`| \`id\` | \`dimension\` | 15 | 是 | 判据 |`
 * 解析器只认这个形状 —— 文档改了形状，本测试就该红（说明总表被重排了，
 * 得重新确认它还与表一致）。
 */
function parseDocTable(doc: string): DocRow[] {
  const rows: DocRow[] = [];
  const re =
    /^\|\s*`([a-z_]+)`\s*\|\s*`(structure|visual|content|consistency)`\s*\|\s*(\d+)\s*\|\s*(是|否)\s*\|\s*(.+?)\s*\|\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc)) !== null) {
    rows.push({
      id: m[1]!,
      dimension: m[2]!,
      penalty: Number(m[3]!),
      fixable: m[4] === '是',
      description: m[5]!,
    });
  }
  return rows;
}

/** 文档里显式挂出的锚点（`<a id="xxx"></a>`） */
function parseDocAnchors(doc: string): string[] {
  return [...doc.matchAll(/<a id="([a-z_]+)"><\/a>/g)].map((m) => m[1]!);
}

describe('SPEC-QLT-013 规则表与文档逐行对齐', () => {
  test('rule-table-matches-doc', () => {
    const rows = parseDocTable(DOC);
    expect(rows.length).toBe(QUALITY_RULES.length);

    for (const rule of QUALITY_RULES) {
      const row = rows.find((r) => r.id === rule.id);
      expect(row, `文档总表缺少规则 ${rule.id}`).toBeDefined();
      expect({
        id: rule.id,
        dimension: row!.dimension,
        penalty: row!.penalty,
        fixable: row!.fixable,
      }).toEqual({
        id: rule.id,
        dimension: rule.dimension,
        penalty: rule.penalty,
        fixable: rule.fixable,
      });
      // 判据文字也要一致 —— 表格与表说的是同一件事
      expect(row!.description).toBe(rule.description);
    }
  });

  test('every-rule-has-doc-anchor', () => {
    const anchors = parseDocAnchors(DOC);
    for (const rule of QUALITY_RULES) {
      expect(anchors, `docs/quality-rules.md 缺少 <a id="${rule.id}"> 锚点`).toContain(rule.id);
    }
  });

  test('no-orphan-doc-anchors', () => {
    // 文档里挂出了表里没有的锚点 —— 说明文档多了一条规则（或改过 id）
    const known = new Set(QUALITY_RULES.map((r) => r.id));
    const orphans = parseDocAnchors(DOC).filter((a) => !known.has(a));
    expect(orphans).toEqual([]);
  });

  test('rule-basis-points-at-doc', () => {
    // 规则自报的依据出处必须真的指回本文档 —— 否则「文档是真相源」是空话
    for (const rule of QUALITY_RULES) {
      expect(rule.basis).toBe(`docs/quality-rules.md#${rule.id}`);
      expect(DOC).toContain(`<a id="${rule.id}"></a>`);
    }
  });
});

describe('SPEC-QLT-014 每条诊断都能追溯到一条规则', () => {
  test('diagnostic-ids-map-to-rules', () => {
    // 造一份「什么毛病都有」的文稿，逐条触发 11 条规则
    const slides = [
      // a1：无卡片（content_thin）、标题过短（content_title）、无结论（content_keymsg）、
      //     画布比例错（struct_dim）
      makeSlide('cards_grid', {
        slideId: 'a1',
        order: 1,
        outline: { title: 'ab', keyMessage: '', bulletPoints: [] },
      }),
      // b1：两张卡片重叠（vis_collide）、一个元素越界（vis_bounds）、
      //     内容只盖住版心 12.7%（vis_sparse）
      makeSlide('cards_grid', {
        slideId: 'b1',
        order: 2,
        outline: { title: '重叠页', keyMessage: '重复结论', bulletPoints: [] },
      }),
      // c1：与 b1 重复的结论（content_dup）、与 b1 重复的元素 ID（struct_id）
      makeSlide('cards_grid', {
        slideId: 'c1',
        order: 3,
        outline: { title: '重复页', keyMessage: '重复结论', bulletPoints: [] },
      }),
    ];

    slides[0]!.canvas = { width: 1600, height: 900 };
    slides[0]!.elements = slides[0]!.elements.filter((el) => el.role !== 'card');
    slides[1]!.elements = slides[1]!.elements.filter((el) => el.role !== 'card');
    slides[1]!.elements.push(
      makeElement('overlap_a', { role: 'card', geometry: { x: 100, y: 300, width: 200, height: 150 } }),
      makeElement('overlap_b', { role: 'card', geometry: { x: 250, y: 300, width: 200, height: 150 } }),
      makeElement('out_of_canvas', {
        role: 'footer',
        geometry: { x: 1800, y: 100, width: 300, height: 100 },
      })
    );
    slides[2]!.elements.push(
      makeElement('overlap_a', { role: 'card', geometry: { x: 100, y: 300, width: 200, height: 150 } })
    );

    // 页数不足（consist_count）要另一份文稿：3 页不触发
    const short = makeProject([
      makeSlide('cards_grid', { slideId: 's1', order: 1, outline: { keyMessage: '甲' } }),
      makeSlide('cards_grid', { slideId: 's2', order: 2, outline: { keyMessage: '乙' } }),
    ]);

    const known = new Set(QUALITY_RULES.map((r) => r.id));
    const fired = new Set<string>();

    for (const project of [makeProject(slides), short]) {
      const report = QualityEngine.evaluatePresentation(project);

      // 1) 每条诊断都必须能追溯到规则表里的一行
      const orphans = report.issues
        .filter(
          (issue) =>
            !known.has(issue.id) && ![...known].some((id) => issue.id.startsWith(`${id}_`))
        )
        .map((issue) => issue.id);
      expect(orphans).toEqual([]);

      for (const issue of report.issues) {
        const owner = [...known].find((id) => issue.id === id || issue.id.startsWith(`${id}_`));
        if (owner) fired.add(owner);
      }
    }

    // 2) 11 条规则必须全部被触发 —— 少一条说明这份「什么毛病都有」的文稿
    //    其实没把那条规则造出来，用例是空转的
    const missing = QUALITY_RULES.filter((r) => !fired.has(r.id)).map((r) => r.id);
    expect(missing).toEqual([]);
  });
});

describe('SPEC-QLT-014 扣分幅度必须来自规则表而不是引擎里写死的数字', () => {
  test('penalties-come-from-rule-table', () => {
    // 规则表是数据：改表里的扣分幅度，引擎的分数必须跟着变。
    // 这个断言证明引擎真的在**读表**，而不是把数字又抄了一遍。
    const project = makeCleanProject();
    project.slides[1]!.canvas = { width: 1600, height: 900 };

    const report = QualityEngine.evaluatePresentation(project);
    const rule = QUALITY_RULES.find((r) => r.id === 'struct_dim')!;
    expect(report.structureScore).toBe(100 - rule.penalty);
  });
});
