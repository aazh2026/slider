/**
 * 发布闸门的**缺陷回放**
 * ---------------------------------------------------------------------------
 * 这里断言的是**放行判定**，不是「某个工具好不好用」。
 *
 * 缺陷回放（实测 2026-11-05）：一轮跑批里，追溯矩阵写着
 * 「PASS 64　FAIL 2　INCONCLUSIVE 1」，而流水线末尾那一步仍然显示
 * **✅ 通过　生成追溯矩阵** —— 矩阵里的坏结论**没有出口**。
 * 读的人只看见一行绿。
 *
 * 这一组把那个洞钉住：
 *   · FAIL 一律挡住放行（登记成 known_gaps 也不行 —— 那是回归，不是债）；
 *   · INCONCLUSIVE 挡住放行，**除非**它已登记为已知欠账；
 *   · 连判据都没有的条款：已降级就放过，还 active 又没登记就是悬空条款 → 挡住；
 *   · 放行时要说清楚**为什么**放行（明账，不是「没人看见」）。
 */

import { describe, expect, test } from 'bun:test';

import {
  evaluateReleaseGate,
  renderGateSection,
  type GateClause,
  type GateInput,
} from './releaseGate';

function clause(over: Partial<GateClause> & { id: string }): GateClause {
  return {
    verdict: 'PASS',
    hasCriteria: true,
    status: 'active',
    ...over,
  };
}

function gate(clauses: GateClause[], knownGapClauses: string[] = []): GateInput {
  return { clauses, knownGapClauses };
}

describe('发布闸门 —— 判定', () => {
  test('全 PASS → 放行', () => {
    const r = evaluateReleaseGate(
      gate([clause({ id: 'SPEC-A' }), clause({ id: 'SPEC-B' })])
    );
    expect(r.canRelease).toBe(true);
    expect(r.blocking).toEqual([]);
  });

  test('FAIL → 挡住放行', () => {
    const r = evaluateReleaseGate(gate([clause({ id: 'SPEC-A', verdict: 'FAIL' })]));
    expect(r.canRelease).toBe(false);
    expect(r.blocking.map((b) => b.id)).toEqual(['SPEC-A']);
  });

  test('FAIL **即使登记成已知欠账**也照样挡住 —— 那是回归，不是债', () => {
    const r = evaluateReleaseGate(
      gate([clause({ id: 'SPEC-A', verdict: 'FAIL' })], ['SPEC-A'])
    );
    expect(r.canRelease).toBe(false);
    expect(r.blocking[0]?.reason).toContain('回归');
  });

  test('INCONCLUSIVE（没登记欠账）→ 挡住放行', () => {
    const r = evaluateReleaseGate(
      gate([clause({ id: 'SPEC-A', verdict: 'INCONCLUSIVE' })])
    );
    expect(r.canRelease).toBe(false);
    expect(r.blocking.map((b) => b.id)).toEqual(['SPEC-A']);
    expect(r.blocking[0]?.reason).toContain('没跑过的验证不是通过');
  });

  test('INCONCLUSIVE + 已登记为已知欠账 → 放行，但要说清是明账', () => {
    const r = evaluateReleaseGate(
      gate([clause({ id: 'SPEC-A', verdict: 'INCONCLUSIVE' })], ['SPEC-A'])
    );
    expect(r.canRelease).toBe(true);
    expect(r.tolerated.map((t) => t.id)).toEqual(['SPEC-A']);
    expect(r.tolerated[0]?.why).toContain('明账');
  });

  test('没有判据 + 条款已降级（status 不是 active）→ 放行', () => {
    const r = evaluateReleaseGate(
      gate([clause({ id: 'SPEC-A', verdict: 'INCONCLUSIVE', hasCriteria: false, status: 'blocked' })])
    );
    expect(r.canRelease).toBe(true);
    expect(r.tolerated[0]?.why).toContain('暂时不做');
  });

  test('没有判据 + 还是 active + 没登记 → 悬空条款，挡住放行', () => {
    const r = evaluateReleaseGate(
      gate([clause({ id: 'SPEC-A', verdict: 'INCONCLUSIVE', hasCriteria: false })])
    );
    expect(r.canRelease).toBe(false);
    expect(r.blocking[0]?.reason).toContain('悬空条款');
  });

  test('没有判据 + 还是 active + 已登记为已知欠账 → 放行', () => {
    const r = evaluateReleaseGate(
      gate([clause({ id: 'SPEC-A', verdict: 'INCONCLUSIVE', hasCriteria: false })], ['SPEC-A'])
    );
    expect(r.canRelease).toBe(true);
  });

  test('多条坏结论 → 全部列出，按 ID 排序', () => {
    const r = evaluateReleaseGate(
      gate([
        clause({ id: 'SPEC-Z', verdict: 'FAIL' }),
        clause({ id: 'SPEC-A', verdict: 'INCONCLUSIVE' }),
        clause({ id: 'SPEC-M', verdict: 'PASS' }),
      ])
    );
    expect(r.canRelease).toBe(false);
    expect(r.blocking.map((b) => b.id)).toEqual(['SPEC-A', 'SPEC-Z']);
  });
});

describe('发布闸门 —— 缺陷回放', () => {
  test('今天那轮跑批的形状：矩阵 FAIL 2 / INCONCLUSIVE 1，欠账只登记了 INCONCLUSIVE 那一族', () => {
    // 实测（2026-11-05）：矩阵写着 PASS 64 / FAIL 2 / INCONCLUSIVE 1，
    // 而流水线的最后一步显示「✅ 通过」—— 矩阵里的坏结论没有出口。
    const r = evaluateReleaseGate(
      gate(
        [
          clause({ id: 'SPEC-PASS-1' }),
          clause({ id: 'SPEC-PASS-2' }),
          clause({ id: 'SPEC-FAIL-1', verdict: 'FAIL' }),
          clause({ id: 'SPEC-FAIL-2', verdict: 'FAIL' }),
          clause({ id: 'SPEC-GOV-003', verdict: 'INCONCLUSIVE', hasCriteria: false }),
        ],
        ['SPEC-GOV-003']
      )
    );

    // 闸门必须挡住：两条 FAIL 挡得住，那条已登记的欠账不挡
    expect(r.canRelease).toBe(false);
    expect(r.blocking.map((b) => b.id)).toEqual(['SPEC-FAIL-1', 'SPEC-FAIL-2']);
    expect(r.tolerated.map((t) => t.id)).toEqual(['SPEC-GOV-003']);
  });

  test('矩阵全绿 → 放行（闸门不能把正常跑批卡住）', () => {
    const r = evaluateReleaseGate(
      gate([clause({ id: 'SPEC-A' }), clause({ id: 'SPEC-B' })], [])
    );
    expect(r.canRelease).toBe(true);
  });
});

describe('发布闸门 —— 措辞', () => {
  test('放行时不能说「不放行」', () => {
    const r = evaluateReleaseGate(gate([clause({ id: 'SPEC-A' })]));
    const text = renderGateSection(r).join('\n');
    expect(text).toContain('可以放行');
    expect(text).not.toContain('不放行');
  });

  test('挡住时必须报出是哪几条、为什么', () => {
    const r = evaluateReleaseGate(
      gate([clause({ id: 'SPEC-A', verdict: 'FAIL' }), clause({ id: 'SPEC-B', verdict: 'INCONCLUSIVE' })])
    );
    const text = renderGateSection(r).join('\n');
    expect(text).toContain('不放行');
    expect(text).toContain('SPEC-A');
    expect(text).toContain('SPEC-B');
    expect(text).toContain('FAIL');
    expect(text).toContain('INCONCLUSIVE');
  });

  test('放行但有欠账时，欠账要出现在纸面上（明账，不是「没人看见」）', () => {
    const r = evaluateReleaseGate(
      gate([clause({ id: 'SPEC-A', verdict: 'INCONCLUSIVE' })], ['SPEC-A'])
    );
    const text = renderGateSection(r).join('\n');
    expect(text).toContain('SPEC-A');
    expect(text).toContain('明账');
  });
});
