/**
 * 注入结论「新鲜度」的**缺陷回放**
 * ---------------------------------------------------------------------------
 * 这不是"测一个工具好不好用"，而是**钉住一个已经发生的失败模式**：
 *
 *   2026-11-05 实测：一份 88 条、全绿的注入报告，在生成后的 20 分钟里
 *   就有 21 个源文件、1 个验证器被改过 —— **67 条结论已经对不上当前代码**。
 *
 *   而报告里写着「不合格 0 个」，追溯矩阵里写着「88 个注入用例，不合格 0 个」。
 *   读的人完全看不出这批结论已经过期 —— 「跑过」被当成了「现在还成立」。
 *
 *   这跟本项目一直在治的病是同一个：
 *     · 「没跑过的验证不是通过」
 *     · 「跑过但已经不是当前代码的验证，也不能当成当前的结论」
 *
 * 所以这里断言的是**新鲜度语义**：
 *   指纹一致 → fresh；指纹不一致 → stale（说清是哪一边变了）；
 *   文件不见了 → file-missing；报告没记指纹 → unknown。
 *
 * 关键的一条：**unknown 不等于 fresh** —— 说不出新鲜度，就不能说它成立。
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assessCase,
  currentFingerprints,
  freshnessQualifier,
  renderFreshnessSection,
  sha256Of,
  summarize,
  type FingerprintedCase,
  type FreshnessSummary,
} from './evidenceFreshness';

const VERIFIER = 'spec/verify/render-svg.test.ts';
const SOURCE = 'packages/core/src/engine/svgRenderer.ts';

function makeCase(overrides: Partial<FingerprintedCase> = {}): FingerprintedCase {
  return {
    criterion: 'AC-RND-006',
    verifierFile: VERIFIER,
    sourceFile: SOURCE,
    verifierSha256: sha256Of('验证器内容'),
    sourceSha256: sha256Of('源文件内容'),
    ...overrides,
  };
}

function currentMap(entries: Record<string, string | null>): Map<string, string | null> {
  return new Map(Object.entries(entries));
}

describe('注入结论的新鲜度', () => {
  test('指纹一致 → 结论对当前代码仍然成立', () => {
    const current = currentMap({
      [VERIFIER]: sha256Of('验证器内容'),
      [SOURCE]: sha256Of('源文件内容'),
    });
    const f = assessCase(makeCase(), current);
    expect(f.verdict).toBe('fresh');
    expect(f.changed).toEqual([]);
  });

  test('验证器被改过 → 过期，并说清是哪一边变了', () => {
    const current = currentMap({
      [VERIFIER]: sha256Of('验证器内容（改过了）'),
      [SOURCE]: sha256Of('源文件内容'),
    });
    const f = assessCase(makeCase(), current);
    expect(f.verdict).toBe('stale');
    expect(f.changed).toEqual(['verifier']);
    expect(f.reason).toContain('验证器');
  });

  test('被改的源文件被改过 → 过期', () => {
    const current = currentMap({
      [VERIFIER]: sha256Of('验证器内容'),
      [SOURCE]: sha256Of('源文件内容（改过了）'),
    });
    const f = assessCase(makeCase(), current);
    expect(f.verdict).toBe('stale');
    expect(f.changed).toEqual(['source']);
  });

  test('两边都被改过 → 过期，两边都记下来', () => {
    const current = currentMap({
      [VERIFIER]: sha256Of('验证器内容（改过了）'),
      [SOURCE]: sha256Of('源文件内容（改过了）'),
    });
    const f = assessCase(makeCase(), current);
    expect(f.verdict).toBe('stale');
    expect(f.changed).toEqual(['verifier', 'source']);
  });

  test('文件不在树里了 → 说清是哪一份不见了', () => {
    const current = currentMap({ [VERIFIER]: null, [SOURCE]: sha256Of('源文件内容') });
    const f = assessCase(makeCase(), current);
    expect(f.verdict).toBe('file-missing');
    expect(f.reason).toContain(VERIFIER);
  });

  test('报告没记指纹 → unknown，**不能当成 fresh**', () => {
    const current = currentMap({
      [VERIFIER]: sha256Of('验证器内容'),
      [SOURCE]: sha256Of('源文件内容'),
    });
    const f = assessCase(
      makeCase({ verifierSha256: null, sourceSha256: null }),
      current
    );
    expect(f.verdict).toBe('unknown');
    expect(f.verdict).not.toBe('fresh');
  });
});

describe('新鲜度汇总', () => {
  test('计数与判据去重', () => {
    const current = currentMap({
      [VERIFIER]: sha256Of('验证器内容'),
      [SOURCE]: sha256Of('源文件内容'),
    });
    const cases: FingerprintedCase[] = [
      makeCase({ criterion: 'AC-A' }),
      // 同一条判据的另一个用例过期了 → 判据列表要去重
      makeCase({ criterion: 'AC-A', sourceSha256: sha256Of('旧的') }),
      makeCase({ criterion: 'AC-B' }),
      makeCase({ criterion: 'AC-C', verifierSha256: null, sourceSha256: null }),
    ];

    const s = summarize(cases, current);
    expect(s.total).toBe(4);
    expect(s.fresh).toBe(2);
    expect(s.stale).toBe(1);
    expect(s.unknown).toBe(1);
    expect(s.staleCriteria).toEqual(['AC-A']);
    expect(s.unknownCriteria).toEqual(['AC-C']);
    expect(s.staleDetails[0]?.criterion).toBe('AC-A');
  });

  test('全过期时，汇总额定一条都不成立', () => {
    const current = currentMap({
      [VERIFIER]: sha256Of('全变了'),
      [SOURCE]: sha256Of('全变了'),
    });
    const s = summarize([makeCase({ criterion: 'AC-A' })], current);
    expect(s.fresh).toBe(0);
    expect(s.stale).toBe(1);
  });
});

describe('当前文件指纹', () => {
  test('读得到文件 → 算出指纹；文件不在 → null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evidence-freshness-'));
    try {
      writeFileSync(join(dir, 'a.ts'), '内容', 'utf-8');
      const fps = currentFingerprints(dir, ['a.ts', 'missing.ts']);
      expect(fps.get('a.ts')).toBe(sha256Of('内容'));
      expect(fps.get('missing.ts')).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 措辞
// ---------------------------------------------------------------------------
//
// 判定对了但话说错了，等于没说。这一组断言的是**落到纸面上的那句话**：
// 说不清的时候不能写成「成立」，过期的时候必须说清是哪一边变了。

function summaryOf(overrides: Partial<FreshnessSummary>): FreshnessSummary {
  return {
    total: 0,
    fresh: 0,
    stale: 0,
    missing: 0,
    unknown: 0,
    staleCriteria: [],
    unknownCriteria: [],
    staleDetails: [],
    ...overrides,
  };
}

describe('新鲜度的措辞', () => {
  test('说清不了的时候，措辞里不能出现「仍然成立」', () => {
    const q = freshnessQualifier(summaryOf({ total: 88, unknown: 88 }));
    expect(q).toContain('说清不了');
    expect(q).not.toContain('仍然成立');
  });

  test('有过期的，限定语必须报出 fresh / stale 的条数', () => {
    const q = freshnessQualifier(summaryOf({ total: 88, fresh: 21, stale: 67 }));
    expect(q).toContain('21');
    expect(q).toContain('67');
    expect(q).toContain('过期');
  });

  test('没有用例 → 不加限定语', () => {
    expect(freshnessQualifier(summaryOf({}))).toBe('');
  });

  test('§2.4.1：全是 unknown → 明确说「说清不了，就不能说它成立」', () => {
    const lines = renderFreshnessSection(summaryOf({ total: 88, unknown: 88 }), '2026-11-05T00:00:00Z');
    const text = lines.join('\n');
    expect(text).toContain('说清不了');
    expect(text).toContain('不能说它成立');
    expect(text).not.toContain('全部仍然成立');
  });

  test('§2.4.1：有过期 → 列出过期明细，说清变了哪边', () => {
    const lines = renderFreshnessSection(
      summaryOf({
        total: 2,
        fresh: 1,
        stale: 1,
        staleCriteria: ['AC-A'],
        staleDetails: [
          {
            criterion: 'AC-A',
            verifierFile: 'spec/verify/x.test.ts',
            sourceFile: 'packages/core/src/y.ts',
            changed: ['source'],
            reason: '源文件在跑批之后被改过',
          },
        ],
      }),
      '2026-11-05T00:00:00Z'
    );
    const text = lines.join('\n');
    expect(text).toContain('1 条仍然成立');
    expect(text).toContain('1 条已过期');
    expect(text).toContain('AC-A');
    expect(text).toContain('源文件');
    expect(text).toContain('已过期的行不能当成对当前代码的证明');
  });

  test('§2.4.1：全都新鲜 → 直接说全部仍然成立', () => {
    const lines = renderFreshnessSection(summaryOf({ total: 3, fresh: 3 }), '2026-11-05T00:00:00Z');
    expect(lines.join('\n')).toContain('3 条全部仍然成立');
  });

  test('§2.4.1：一半说清不了 → 不能把它算进「仍然成立」', () => {
    const lines = renderFreshnessSection(
      summaryOf({ total: 4, fresh: 2, stale: 1, unknown: 1 }),
      '2026-11-05T00:00:00Z'
    );
    const text = lines.join('\n');
    expect(text).toContain('2 条仍然成立');
    expect(text).toContain('1 条已过期');
    expect(text).toContain('另有 1 条说清不了');
  });
});
