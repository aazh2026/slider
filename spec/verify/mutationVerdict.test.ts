/**
 * 注入用例结论的缺陷回放 —— **基线红不能报成「验证器弱」**
 * ---------------------------------------------------------------------------
 * 这里断言的是**结论怎么说**，不是「注入检查跑得好不好」。
 *
 * ---------------------------------------------------------------------------
 * **缺陷回放（实测 2026-11-05，第 14 轮那次流水线）**
 *
 * 注入用例走三步：基线 PASS → 注入必须 FAIL → 还原后重新 PASS。
 * 以前这三步只有两档结论：`!baseline || !caught || !restored` 一律算「不合格」，
 * 然后整轮报：
 *
 *   > ❌ 存在抓不到注入错误的验证器 —— 需要补强后才能声称这些判据有效。
 *
 * 那次流水线里 AC-GOV-001 那一行是：
 *
 *   | 判据 | 基线 | 抓到注入 | 还原后 |
 *   |---|---|---|---|
 *   | AC-GOV-001 | ✗ | ✓ | ✓ |
 *
 * 验证器**确实抓到了**注入，源文件**确实还原干净了**；
 * 只是**基线那一轮**里 `apps/api/tests` 有 19 条用例没过（抖的）——
 * 于是这条注入用例被判「不合格」，流水线退出码 1，
 * 终端上写着「需要补强验证器」。
 *
 * 同一份代码隔离复跑 → **91 个用例全过、不合格 0 个**。
 *
 * 也就是说：**基线红的时候，报告把「环境抖了」说成「验证器太弱」**。
 * 读的人（和下一轮的我）会去补强一个没毛病的验证器 ——
 * 而那正是「假结论最贵的地方」：它会把你带去修一个没问题的东西。
 *
 * ---------------------------------------------------------------------------
 * **这一组钉住的规则**
 *
 *   · 基线红 → **INCONCLUSIVE**（没跑出结论），不是 FAIL；
 *   · 基线红时，「抓到注入」那一栏**不可信**（注入后的那一轮本来也会红）；
 *   · 基线绿但没抓到 → 仍然是 FAIL（验证器弱，照旧要拦）；
 *   · 抓到但没还原干净 → 仍然是 FAIL（源文件被改坏了）；
 *   · 退出码：确定的坏结论优先报 1；只有「没跑出结论」才报 2。
 *
 * **不是弱化校验**：基线红的用例**照样挡住放行**（退出码 2 = 没跑出结论，
 * 流水线不放行）。变的只是**结论的说法**：从「验证器弱」改成「还不知道」。
 */

import { describe, expect, test } from 'bun:test';

import {
  mutationExitCode,
  mutationVerdictOf,
  mutationVerdictReason,
  summarizeMutationCases,
  type MutationCaseLike,
} from './mutationVerdict.ts';

/** 一条注入用例（只给判定用得上的字段） */
function mutationCase(over: Partial<MutationCaseLike> = {}): MutationCaseLike {
  return { baseline_pass: true, caught: true, restored_pass: true, ...over };
}

describe('注入用例的结论 —— 三档', () => {
  test('三步全过 → PASS', () => {
    expect(mutationVerdictOf(mutationCase())).toBe('PASS');
  });

  test('基线绿但没抓到注入 → FAIL（验证器弱）', () => {
    expect(mutationVerdictOf(mutationCase({ caught: false }))).toBe('FAIL');
  });

  test('抓到了但没还原干净 → FAIL（源文件被改坏了）', () => {
    expect(mutationVerdictOf(mutationCase({ restored_pass: false }))).toBe('FAIL');
  });

  test('基线红 → INCONCLUSIVE（不是 FAIL）', () => {
    expect(mutationVerdictOf(mutationCase({ baseline_pass: false }))).toBe('INCONCLUSIVE');
  });
});

describe('缺陷回放：第 14 轮那次流水线的 AC-GOV-001 那一行', () => {
  // 报告里原样的一行：基线 ✗ / 抓到 ✓ / 还原 ✓
  const observed = mutationCase({ baseline_pass: false, caught: true, restored_pass: true });

  test('结论是 INCONCLUSIVE —— 不是「抓不住」', () => {
    expect(mutationVerdictOf(observed)).toBe('INCONCLUSIVE');
  });

  test('说法里不许出现「验证器抓不住」', () => {
    const reason = mutationVerdictReason(observed);
    expect(reason).toContain('没跑出结论');
    expect(reason).not.toContain('抓不住');
  });

  test('基线红时「抓到注入」这一栏不可信 —— 注入后的那一轮本来也会红', () => {
    // 基线红 + 注入后红（caught=true 只是因为它也红了）
    const red = mutationCase({ baseline_pass: false, caught: true, restored_pass: true });
    // 基线红 + 注入后绿（这次抖动没赶上）
    const green = mutationCase({ baseline_pass: false, caught: false, restored_pass: true });
    // 两种情况**都不许**被判成 FAIL —— 抖的是环境，不是验证器
    expect(mutationVerdictOf(red)).toBe('INCONCLUSIVE');
    expect(mutationVerdictOf(green)).toBe('INCONCLUSIVE');
  });

  test('整批汇总：不计入「不合格」，单独计进「没跑出结论」', () => {
    const summary = summarizeMutationCases([
      mutationCase(),
      mutationCase(),
      observed,
    ]);
    expect(summary.total).toBe(3);
    expect(summary.pass).toBe(2);
    expect(summary.fail).toBe(0);
    expect(summary.inconclusive).toBe(1);
    expect(summary.verdict).toBe('INCONCLUSIVE');
  });
});

describe('汇总与退出码', () => {
  test('全过 → 退出码 0', () => {
    const summary = summarizeMutationCases([mutationCase(), mutationCase()]);
    expect(summary.verdict).toBe('PASS');
    expect(mutationExitCode(summary)).toBe(0);
  });

  test('有确定的坏结论 → 退出码 1（要修的东西不能被「没跑出结论」盖掉）', () => {
    const summary = summarizeMutationCases([mutationCase({ caught: false })]);
    expect(summary.verdict).toBe('FAIL');
    expect(mutationExitCode(summary)).toBe(1);
  });

  test('只有没跑出结论 → 退出码 2（这一层的结论一律不算数）', () => {
    const summary = summarizeMutationCases([mutationCase({ baseline_pass: false })]);
    expect(summary.verdict).toBe('INCONCLUSIVE');
    expect(mutationExitCode(summary)).toBe(2);
  });

  test('既有坏结论又有没跑出结论 → 退出码 1（确切的发现优先）', () => {
    const summary = summarizeMutationCases([
      mutationCase({ caught: false }),
      mutationCase({ baseline_pass: false }),
    ]);
    expect(summary.fail).toBe(1);
    expect(summary.inconclusive).toBe(1);
    expect(mutationExitCode(summary)).toBe(1);
  });

  test('一个用例都没有 → INCONCLUSIVE（「没验过」不是「验过了」）', () => {
    const summary = summarizeMutationCases([]);
    expect(summary.total).toBe(0);
    expect(summary.verdict).toBe('INCONCLUSIVE');
    expect(mutationExitCode(summary)).toBe(2);
  });
});

describe('说法 —— 三档各说各的话', () => {
  test('PASS：验证器抓得住，源文件也还原了', () => {
    expect(mutationVerdictReason(mutationCase())).toContain('抓得住');
  });

  test('FAIL（没抓到）：直说验证器抓不住', () => {
    expect(mutationVerdictReason(mutationCase({ caught: false }))).toContain('抓不住');
  });

  test('FAIL（没还原）：直说源文件被改坏了', () => {
    expect(mutationVerdictReason(mutationCase({ restored_pass: false }))).toContain('改坏');
  });

  test('INCONCLUSIVE：说「没跑出结论」，并且说清为什么不能算「抓不住」', () => {
    const reason = mutationVerdictReason(mutationCase({ baseline_pass: false }));
    expect(reason).toContain('基线');
    expect(reason).toContain('没跑出结论');
    expect(reason).toContain('本来也会');
  });
});
