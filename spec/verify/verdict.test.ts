/**
 * 结论推导的缺陷回放 —— **超时不能报成「不通过」**
 * ---------------------------------------------------------------------------
 * 这里断言的是**结论怎么说**，不是「某个工具好不好用」。
 *
 * ---------------------------------------------------------------------------
 * **缺陷回放（实测 2026-11-05）**
 *
 * 结论只有三档：PASS / FAIL / INCONCLUSIVE。以前只有两档能用 ——
 * 「跑过」一律落进 PASS 或 FAIL，于是**超时也被报成 FAIL**，
 * 也就是「实现不满足判据」。
 *
 * 这条假结论真出现过两次：
 *
 *   ① `apps/api/tests/security/session-cookie.test.ts`
 *      在流水线里耗时 **906.903 秒**、用例超时（限 5 秒）；
 *      隔离复跑 **5 条用例 3.2 秒全过** —— 环境被抢，不是实现坏了。
 *   ② E2E 链的 180 秒超时一次性报成 **916 秒**
 *      —— 机器进了 Maintenance Sleep（计时器不跑），也不是实现坏了。
 *
 * 两次都被记成「实现不满足判据」——
 * 那是**假的确定结论**：读的人（和下一轮的我）会去修一个没毛病的验证器。
 *
 * ---------------------------------------------------------------------------
 * **这一组钉住的规则**
 *
 *   · 超时 → **INCONCLUSIVE**（没跑出结论），不是 FAIL；
 *   · 断言不通过 → 仍然是 FAIL（回归照旧要拦）；
 *   · 没跑过 / 不是 automated → 仍然是 INCONCLUSIVE；
 *   · 条款取最坏的一档：FAIL > INCONCLUSIVE > PASS。
 *
 * **不是弱化校验**：超时的条款照样挡住放行
 * —— 发布闸门对没登记的 INCONCLUSIVE 一律不放行（见 releaseGate.ts）。
 * 变的只是**结论的说法**：从「实现错了」改成「还不知道」。
 */

import { describe, expect, test } from 'bun:test';

import { isTimeout, type JunitCase } from './junit.ts';
import { timeoutHitOf, verdictOf, worstOf, type CriterionLike } from './verdict.ts';

/** 一条判据（只给判定用得上的字段） */
function criterion(target: string, maturity = 'automated'): CriterionLike {
  return { maturity, verification: { target } };
}

/** 一条证据集里的用例 */
function junitCase(over: Partial<JunitCase> & { name: string }): JunitCase {
  return {
    file: 'spec/verify/security.test.ts',
    failed: false,
    evidence: 'spec/evidence/junit.xml',
    ...over,
  };
}

describe('结论推导 —— 三档结论', () => {
  test('跑过且通过 → PASS', () => {
    const junit = [junitCase({ name: 'ok' })];
    expect(verdictOf(criterion('spec/verify/security.test.ts::ok'), junit)).toBe('PASS');
  });

  test('跑过且断言不通过 → FAIL（回归照旧要拦）', () => {
    const junit = [junitCase({ name: 'bad', failed: true, failureType: 'AssertionError' })];
    expect(verdictOf(criterion('spec/verify/security.test.ts::bad'), junit)).toBe('FAIL');
  });

  test('没跑过 → INCONCLUSIVE（没跑过的验证不是通过）', () => {
    expect(verdictOf(criterion('spec/verify/security.test.ts::never-ran'), [])).toBe(
      'INCONCLUSIVE'
    );
  });

  test('不是 automated → INCONCLUSIVE', () => {
    const junit = [junitCase({ name: 'ok' })];
    expect(verdictOf(criterion('spec/verify/security.test.ts::ok', 'none'), junit)).toBe(
      'INCONCLUSIVE'
    );
  });

  test('验证目标里没有用例名 → INCONCLUSIVE', () => {
    expect(verdictOf(criterion('spec/verify/security.test.ts'), [])).toBe('INCONCLUSIVE');
  });
});

describe('结论推导 —— 超时不是断言不通过', () => {
  test('超时 → INCONCLUSIVE（没跑出结论），不是 FAIL', () => {
    const junit = [
      junitCase({
        name: '慢',
        failed: true,
        failureType: 'TimeoutError',
        durationSeconds: 906.903,
      }),
    ];
    expect(verdictOf(criterion('spec/verify/security.test.ts::慢'), junit)).toBe('INCONCLUSIVE');
  });

  test('同样的用例，断言不通过仍然是 FAIL', () => {
    const junit = [
      junitCase({ name: '慢', failed: true, failureType: 'AssertionError', durationSeconds: 0.1 }),
    ];
    expect(verdictOf(criterion('spec/verify/security.test.ts::慢'), junit)).toBe('FAIL');
  });

  test('失败但没有类型 → 按断言不通过处理（不许靠「说不清」蒙混过关）', () => {
    // 没有类型 ⇒ 判不出是超时 ⇒ 按最保守的一档（FAIL）记账 —— 它照样挡放行
    const junit = [junitCase({ name: 'x', failed: true })];
    expect(verdictOf(criterion('spec/verify/security.test.ts::x'), junit)).toBe('FAIL');
  });

  test('超时的那条用例能被单独找出来（报告要说清用时多久）', () => {
    const junit = [
      junitCase({
        name: '慢',
        failed: true,
        failureType: 'TimeoutError',
        durationSeconds: 906.903,
      }),
    ];
    const hit = timeoutHitOf(criterion('spec/verify/security.test.ts::慢'), junit);
    expect(hit).toBeDefined();
    expect(hit!.durationSeconds).toBe(906.903);
    expect(isTimeout(hit!)).toBe(true);
  });

  test('没超时的用例不会被 timeoutHitOf 认领', () => {
    const junit = [junitCase({ name: 'ok' })];
    expect(timeoutHitOf(criterion('spec/verify/security.test.ts::ok'), junit)).toBeUndefined();
  });
});

describe('条款结论 —— 取最坏的一档', () => {
  test('PASS', () => {
    expect(worstOf(['PASS', 'PASS'])).toBe('PASS');
  });

  test('有 INCONCLUSIVE 就是 INCONCLUSIVE', () => {
    expect(worstOf(['PASS', 'INCONCLUSIVE'])).toBe('INCONCLUSIVE');
  });

  test('有 FAIL 就是 FAIL（FAIL 比 INCONCLUSIVE 坏）', () => {
    expect(worstOf(['INCONCLUSIVE', 'FAIL'])).toBe('FAIL');
  });

  test('一条判据都没有 → INCONCLUSIVE（不是通过）', () => {
    expect(worstOf([])).toBe('INCONCLUSIVE');
  });
});

describe('缺陷回放 —— 2026-11-05 的两起假超时', () => {
  test('session-cookie 用例：流水线里 906.903 秒超时 → 结论是「没跑出结论」', () => {
    // 实测：隔离复跑 5 条用例 3.2 秒全过 —— 环境被抢，不是实现坏了。
    // 报成 FAIL 的话，下一轮就会去修一个没毛病的验证器。
    const junit = [
      junitCase({
        name: '每次登录的 Session ID 都不同',
        file: 'apps/api/tests/security/session-cookie.test.ts',
        failed: true,
        failureType: 'TimeoutError',
        durationSeconds: 906.903,
      }),
    ];
    const v = verdictOf(
      criterion('apps/api/tests/security/session-cookie.test.ts::每次登录的 Session ID 都不同'),
      junit
    );
    expect(v).toBe('INCONCLUSIVE');
    // 而条款结论因此也是「没跑出结论」—— 它照样挡住放行（闸门对 INCONCLUSIVE 不放行）
    expect(worstOf([v])).toBe('INCONCLUSIVE');
  });

  test('E2E 链：180 秒的限被一次性报成 916 秒 → 同样是「没跑出结论」', () => {
    const junit = [
      junitCase({
        name: '打开工作台',
        file: 'e2e/workbench.e2e.ts',
        failed: true,
        failureType: 'TimeoutError',
        durationSeconds: 916,
      }),
    ];
    expect(
      verdictOf(criterion('e2e/workbench.e2e.ts::打开工作台'), junit)
    ).toBe('INCONCLUSIVE');
  });
});
