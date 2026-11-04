/**
 * 注入证据「对账」的**缺陷回放**
 * ---------------------------------------------------------------------------
 * 这不是"测一个工具好不好用"，而是**钉住一个已经发生的失败模式**：
 *
 *   2026-11-05 实测：质量引擎把扣分幅度搬进规则表之后，
 *   8 条 AC-QLT-* 注入用例的锚点全部失配 —— 那 8 条用例**一条都跑不起来**。
 *   而全量报告里写着的仍然是「88 个注入用例，不合格 0 个」，
 *   追溯矩阵照抄这句话，整条证据链看上去毫无破绽。
 *
 *   报告说全绿，其中 8 条其实根本没跑过。
 *
 * 所以这里断言的是**对账语义**：
 *   锚点没了 → missing；锚点多处出现 → ambiguous；文件没了 → file-missing；
 *   定义里有而报告里没有 → notInReport；报告里有而定义里没有 → orphanInReport。
 *
 * 关键的一条：**报告里那条「不合格 0 个」的结论，在锚点失配时不能算数** ——
 * 跑不出来的东西，说它「抓得住错」是自证。
 */

import { describe, expect, test } from 'bun:test';

import {
  checkAnchors,
  countOccurrences,
  reconcile,
  reconciliationQualifier,
  renderReconciliationSection,
  type MutationDefinition,
  type ReadFile,
} from './anchorHealth';

const FILE = 'packages/core/src/engine/qualityEngine.ts';
const FIND = '        totalStructurePenalties += penaltyOf(\'struct_dim\');';

function def(overrides: Partial<MutationDefinition> = {}): MutationDefinition {
  return {
    criterion: 'AC-QLT-002',
    description: '画布尺寸不符不再扣 15 分',
    file: FILE,
    find: FIND,
    ...overrides,
  };
}

/** 一个内存里的「文件系统」 */
function reader(files: Record<string, string>): ReadFile {
  return (relPath: string) => files[relPath] ?? null;
}

describe('锚点计数', () => {
  test('出现 0 / 1 / 多次都要数对', () => {
    expect(countOccurrences('aaa', 'a')).toBe(3);
    expect(countOccurrences('aaa', 'b')).toBe(0);
    expect(countOccurrences('xaxa', 'a')).toBe(2);
    expect(countOccurrences('xax', 'a')).toBe(1);
  });

  test('空模式串不算出现（否则每个空串都会命中）', () => {
    expect(countOccurrences('abc', '')).toBe(0);
  });
});

describe('锚点健康状况', () => {
  test('锚点在、且只出现一次 → ok', () => {
    const c = checkAnchors(def(), reader({ [FILE]: `xxx\n${FIND}\nyyy` }));
    expect(c.status).toBe('ok');
    expect(c.anchor).toBeNull();
  });

  test('锚点找不到了 → missing（这条用例现在跑不起来）', () => {
    const c = checkAnchors(def(), reader({ [FILE]: '完全不一样的内容' }));
    expect(c.status).toBe('missing');
    expect(c.detail).toContain('跑不起来');
    expect(c.anchor).toBe(FIND);
  });

  test('锚点出现多次 → ambiguous（注入只会落到第一处）', () => {
    const c = checkAnchors(def(), reader({ [FILE]: `${FIND}\n${FIND}` }));
    expect(c.status).toBe('ambiguous');
    expect(c.detail).toContain('2 次');
  });

  test('文件不在树里了 → file-missing', () => {
    const c = checkAnchors(def(), reader({}));
    expect(c.status).toBe('file-missing');
    expect(c.detail).toContain(FILE);
  });

  test('附加锚点也要一起查 —— 漏一条就等于注入不完整', () => {
    const d = def({
      extraEdits: [{ file: FILE, find: 'SECOND', replace: 'x' }],
    });
    const c = checkAnchors(d, reader({ [FILE]: FIND }));
    expect(c.status).toBe('missing');
    expect(c.anchor).toBe('SECOND');
  });
});

describe('定义 ↔ 报告 ↔ 当前代码', () => {
  const reported = [
    { criterion: 'AC-QLT-002', description: '画布尺寸不符不再扣 15 分', mutated_file: FILE },
    { criterion: 'AC-RND-006', description: '不再截断 —— 装不下的行原样溢出', mutated_file: 'x.ts' },
  ];

  test('锚点全好 → 没有跑不起来的用例', () => {
    const rnd = {
      criterion: 'AC-RND-006',
      description: '不再截断 —— 装不下的行原样溢出',
      file: 'x.ts',
      find: 'RND',
    };
    const r = reconcile([def(), rnd], reported, reader({ [FILE]: FIND, 'x.ts': 'RND' }));
    expect(r.broken).toHaveLength(0);
    expect(r.notInReport).toHaveLength(0);
    expect(r.orphanInReport).toHaveLength(0);
  });

  test('锚点失配 → 点名，并且说清这条结论在报告里出现过', () => {
    const r = reconcile([def()], reported, reader({ [FILE]: '内容变了' }));
    expect(r.broken).toHaveLength(1);
    expect(r.broken[0]?.criterion).toBe('AC-QLT-002');
    // 报告里说它「不合格 0 个」—— 现在它根本跑不起来
    expect(r.brokenAndReported).toHaveLength(1);
  });

  test('定义里有、报告里没有 → 还没进过全量证据', () => {
    const r = reconcile(
      [
        def(),
        { criterion: 'AC-NEW', description: '新加的用例', file: 'y.ts', find: 'NEW' },
        { criterion: 'AC-RND-006', description: '不再截断 —— 装不下的行原样溢出', file: 'x.ts', find: 'RND' },
      ],
      reported,
      reader({ [FILE]: FIND, 'x.ts': 'RND', 'y.ts': 'NEW' })
    );
    expect(r.notInReport.map((c) => c.criterion)).toEqual(['AC-NEW']);
    expect(r.orphanInReport).toHaveLength(0);
  });

  test('报告里有、定义里没有 → 报告里的孤儿条目', () => {
    const r = reconcile([def()], reported, reader({ [FILE]: FIND }));
    expect(r.orphanInReport.map((c) => c.criterion)).toContain('AC-RND-006');
  });

  test('同一条判据的多条用例按「判据 + 描述」分别对账', () => {
    const d1 = { ...def(), description: '第一条' };
    const d2 = { ...def(), description: '第二条', find: 'SECOND' };
    const r = reconcile([d1, d2], [], reader({ [FILE]: FIND }));
    expect(r.notInReport).toHaveLength(2);
    expect(r.broken.map((c) => c.description)).toEqual(['第二条']);
  });
});

describe('对账结论怎么说出口', () => {
  const reported = [
    { criterion: 'AC-QLT-002', description: '画布尺寸不符不再扣 15 分', mutated_file: FILE },
  ];

  test('一切正常 → 说「现在重跑还跑得起来」', () => {
    const r = reconcile([def()], reported, reader({ [FILE]: FIND }));
    const text = renderReconciliationSection(r).join('\n');
    expect(text).toContain('命中且唯一');
    expect(text).not.toContain('跑不起来');
  });
  test('锚点失配 → 点名，并且明说报告里那条结论不能算数', () => {
    const r = reconcile([def()], reported, reader({ [FILE]: '内容变了' }));
    const text = renderReconciliationSection(r).join('\n');
    expect(text).toContain('AC-QLT-002');
    expect(text).toContain('1 条现在跑不起来');
    expect(text).toContain('不能算数');
    expect(text).toContain('连报都没报过');
  });

  test('还没进过全量证据的 → 单列出来', () => {
    const r = reconcile(
      [def(), { criterion: 'AC-NEW', description: '新加的用例', file: 'y.ts', find: 'NEW' }],
      reported,
      reader({ [FILE]: FIND, 'y.ts': 'NEW' })
    );
    const text = renderReconciliationSection(r).join('\n');
    expect(text).toContain('还没进过全量证据');
    expect(text).toContain('AC-NEW');
    expect(text).toContain('没人跑过它们');
  });

  test('汇总句的限定语：锚点全好时不啰嗦', () => {
    const r = reconcile([def()], reported, reader({ [FILE]: FIND }));
    expect(reconciliationQualifier(r)).toBe('');
  });

  test('汇总句的限定语：锚点失配时明说「不合格 0 个」不能算数', () => {
    const r = reconcile([def()], reported, reader({ [FILE]: '内容变了' }));
    const q = reconciliationQualifier(r);
    expect(q).toContain('不能算数');
    expect(q).toContain('1 条现在跑不起来');
  });

  test('报告里的孤儿 → 单列出来，并说清无从核对', () => {
    const r = reconcile(
      [def()],
      [...reported, { criterion: 'AC-GONE', description: '定义被删了', mutated_file: 'z.ts' }],
      reader({ [FILE]: FIND })
    );
    const text = renderReconciliationSection(r).join('\n');
    expect(text).toContain('孤儿');
    expect(text).toContain('无从核对');
    expect(text).toContain('AC-GONE');
  });

  test('既没定义也没报告 → 明说没有内容', () => {
    const r = reconcile([], [], reader({}));
    expect(renderReconciliationSection(r).join('\n')).toContain('没有内容');
  });
});
