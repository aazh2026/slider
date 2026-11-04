/**
 * 证据集对账的**缺陷回放**
 * ---------------------------------------------------------------------------
 * 钉住的是一个已经发生的失败模式：
 *
 *   追溯矩阵 §2.2「失败明细」只列**挂了判据**的失败。
 *   一次跑批 337 个用例里只有 98 个被某条判据点名 ——
 *   另外 239 个用例要是挂了，§2.2 会照常写「（无）」，
 *   而「是哪个用例挂了」全报告没有第二处提。
 *
 *   后果：流水线的退出码已经拦下来了（bun test 挂了 → 退出码 1），
 *   但**报告说绿**。报告是给人读的 —— 人不会去看退出码。
 *
 * 所以这里断言的是**报告的口径**：
 *   · 证据集里没挂判据的失败，一个都不许漏；
 *   · 一个都没有的时候，也要说得出「凭什么说没有」；
 *   · 用例名相同、文件不同，不能串账。
 */

import { describe, expect, test } from 'bun:test';

import {
  buildEvidenceLedger,
  caseKey,
  renderLedgerSummary,
  renderUnmappedFailures,
  type LedgerCase,
} from './evidenceLedger';

function c(
  file: string,
  name: string,
  failed = false,
  evidence = 'spec/evidence/junit.xml'
): LedgerCase {
  return { file, name, failed, evidence };
}

describe('证据集对账', () => {
  test('用例的唯一标识是「文件::用例名」', () => {
    expect(caseKey('a.test.ts', '红灯')).toBe('a.test.ts::红灯');
  });

  test('挂了判据 / 没挂判据，分别数清楚', () => {
    const l = buildEvidenceLedger(
      [
        c('a.test.ts', '甲'),
        c('a.test.ts', '乙'),
        c('b.test.ts', '丙'),
      ],
      ['a.test.ts::甲']
    );
    expect(l.total).toBe(3);
    expect(l.mapped).toBe(1);
    expect(l.unmapped).toBe(2);
    expect(l.failed).toBe(0);
  });

  test('两层证据分开计数 —— 说得清「N 个用例」是哪几层', () => {
    const l = buildEvidenceLedger(
      [
        c('a.test.ts', '甲', false, 'spec/evidence/junit.xml'),
        c('e2e/x.e2e.ts', '乙', false, 'spec/evidence/junit-e2e.xml'),
      ],
      []
    );
    expect(l.layers).toEqual([
      { evidence: 'spec/evidence/junit.xml', total: 1, failed: 0 },
      { evidence: 'spec/evidence/junit-e2e.xml', total: 1, failed: 0 },
    ]);
  });

  test('**缺陷回放**：没挂判据的失败必须被点名', () => {
    // 判据只认了「甲」，但「乙」挂了 —— 旧报告里「乙」是隐形的
    const l = buildEvidenceLedger(
      [c('a.test.ts', '甲'), c('a.test.ts', '乙', true)],
      ['a.test.ts::甲']
    );
    expect(l.unmappedFailures).toEqual([
      { file: 'a.test.ts', name: '乙', evidence: 'spec/evidence/junit.xml' },
    ]);
    expect(l.failed).toBe(1);
    expect(l.mappedFailed).toBe(0);
  });

  test('挂了判据的失败不会在「未挂判据」里重复出现', () => {
    const l = buildEvidenceLedger(
      [c('a.test.ts', '甲', true), c('a.test.ts', '乙', true)],
      ['a.test.ts::甲']
    );
    expect(l.mappedFailed).toBe(1);
    expect(l.unmappedFailures.map((f) => f.name)).toEqual(['乙']);
  });

  test('用例名相同、文件不同 —— 不串账', () => {
    // 两个文件里都有叫「红灯」的用例；判据只认了其中一个
    const l = buildEvidenceLedger(
      [c('a.test.ts', '红灯'), c('b.test.ts', '红灯', true)],
      ['a.test.ts::红灯']
    );
    expect(l.mapped).toBe(1);
    expect(l.unmappedFailures).toEqual([
      { file: 'b.test.ts', name: '红灯', evidence: 'spec/evidence/junit.xml' },
    ]);
  });

  test('判据点名的目标在证据集里找不到 —— 要单独点名', () => {
    const l = buildEvidenceLedger([c('a.test.ts', '甲')], ['a.test.ts::甲', 'a.test.ts::不存在']);
    expect(l.targetsTotal).toBe(2);
    expect(l.targetsNotFound).toEqual(['a.test.ts::不存在']);
  });
});

describe('§2.1 的对账那几行', () => {
  test('没有未挂判据的失败 —— 要说清「FAIL 0 不是漏报」', () => {
    const l = buildEvidenceLedger([c('a.test.ts', '甲'), c('b.test.ts', '乙')], ['a.test.ts::甲']);
    const text = renderLedgerSummary(l).join('\n');
    expect(text).toContain('证据集对账');
    expect(text).toContain('共 2 个用例');
    expect(text).toContain('1 个被某条判据点名');
    expect(text).toContain('不是漏报');
  });

  test('**缺陷回放**：有未挂判据的失败 —— 摘要必须说出来', () => {
    const l = buildEvidenceLedger(
      [c('a.test.ts', '甲'), c('b.test.ts', '乙', true)],
      ['a.test.ts::甲']
    );
    const text = renderLedgerSummary(l).join('\n');
    expect(text).toContain('1 个失败');
    expect(text).toContain('只数挂了判据的失败');
    expect(text).toContain('§2.2');
    // 旧口径：这行会写「FAIL 0」而不提有失败
    expect(text).not.toContain('不是漏报');
  });

  test('验证目标找不到时，摘要要点名', () => {
    const l = buildEvidenceLedger([c('a.test.ts', '甲')], ['a.test.ts::不存在']);
    const text = renderLedgerSummary(l).join('\n');
    expect(text).toContain('没找到');
    expect(text).toContain('a.test.ts::不存在');
    expect(text).toContain('INCONCLUSIVE');
  });

  test('引用的「FAIL N」要跟表里那个数一致 —— 表数的是判据，账本数的是失败用例', () => {
    // 两条判据共用同一个验证目标 → 一个失败用例，表里记 2 条判据
    const l = buildEvidenceLedger([c('a.test.ts', '甲', true)], ['a.test.ts::甲']);
    expect(l.mappedFailed).toBe(1);
    const text = renderLedgerSummary(l, 2).join('\n');
    expect(text).toContain('「FAIL 2」');
    expect(text).not.toContain('「FAIL 1」');
  });
});

describe('§2.2「未挂判据的失败」', () => {
  test('**缺陷回放**：有失败时，这一节不许写「（无）」', () => {
    const l = buildEvidenceLedger([c('b.test.ts', '乙', true)], []);
    const text = renderUnmappedFailures(l).join('\n');
    expect(text).not.toContain('（无）');
    expect(text).toContain('b.test.ts');
    expect(text).toContain('乙');
    expect(text).toContain('不挂在任何判据上');
  });

  test('一个失败都没有 —— 要说得出凭什么', () => {
    const l = buildEvidenceLedger([c('b.test.ts', '乙')], []);
    const text = renderUnmappedFailures(l).join('\n');
    expect(text).toContain('（无）');
    expect(text).toContain('全都过了');
    // 「没有失败」得说得出依据，不能靠「没列」来暗示
    expect(text).toContain('得说得出依据');
  });

  test('失败要写清楚来自哪一份证据', () => {
    const l = buildEvidenceLedger(
      [c('e2e/x.e2e.ts', '链上那条', true, 'spec/evidence/junit-e2e.xml')],
      []
    );
    const text = renderUnmappedFailures(l).join('\n');
    expect(text).toContain('spec/evidence/junit-e2e.xml');
    expect(text).toContain('junit-e2e-output.txt');
  });
});
