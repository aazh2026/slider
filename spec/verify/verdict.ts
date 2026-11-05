/**
 * 结论的推导 —— **纯逻辑，无 IO**
 * ---------------------------------------------------------------------------
 * 追溯矩阵把每条判据的结论算出来，靠的就是这里三个函数。
 *
 * **为什么单独抽一个文件**
 *
 * `traceability.ts` 在模块顶层就调 `main()` —— 一 import 就会跑整个生成器，
 * 于是它的判定逻辑**没法写测试**。而本轮要钉住的那条规则恰恰是
 * 「判定规则本身」：超时该报成什么。规则住在不能被测的地方，
 * 就等于没有规则。
 *
 * （`junit.ts` 当初也是同一个理由被抽出来的。）
 *
 * ---------------------------------------------------------------------------
 * **本轮钉住的那条规则：超时 ≠ 断言不通过**
 *
 * 结论只有三档：PASS / FAIL / INCONCLUSIVE。以前只有两档能用 ——
 * 「跑过」一律落到 PASS 或 FAIL，于是**超时也被报成 FAIL**，
 * 也就是「实现不满足判据」。
 *
 * 实测（2026-11-05）这是**假的确定结论**，而且假了两次：
 *   · `apps/api/tests/security/session-cookie.test.ts` 在流水线里耗时 **906.903 秒**、
 *     用例超时（限 5 秒）；隔离复跑 **5 条用例 3.2 秒全过** —— 环境被抢；
 *   · E2E 链的 180 秒超时一次性报成 **916 秒** —— 机器进了 Maintenance Sleep。
 *
 * 两次都不是实现缺陷，却都按「回归」记账 ——
 * 下一轮就会去修一个没毛病的验证器。
 *
 * 所以：**超时是「没跑出结论」，不是「做错了」**。
 * 它落进 INCONCLUSIVE（那一档本来就带着「没跑过的验证不是通过」的意思），
 * 而不是 FAIL。
 *
 * **这不是弱化校验**：超时的条款照样挡住放行
 * （发布闸门对 INCONCLUSIVE 一律不放行，除非已登记为已知欠账）——
 * 变的只是**结论的说法**：从「实现错了」改成「还不知道」。
 */

import { isTimeout, type JunitCase } from './junit.ts';

/** 一条判据的判定结果 */
export type Verdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';

/**
 * 判定一条判据需要的那部分字段。
 *
 * 刻意只声明**用到的**字段（结构化类型）——
 * 这样这个模块不依赖 spec.yaml 的类型定义，测起来也不用造整个 Clause。
 */
export interface CriterionLike {
  /** 成熟度：不是 `automated` 的判据没法自动判定 */
  maturity: string;
  /** 验证目标：`文件::用例名` */
  verification: { target: string };
}

/**
 * 判一条判据的结论。
 *
 * 判定顺序：
 *   ① 不是 automated            → INCONCLUSIVE（没有可执行的验证）
 *   ② 验证目标里没有用例名      → INCONCLUSIVE
 *   ③ 证据集里找不到这条用例    → INCONCLUSIVE（没跑过的验证不是通过）
 *   ④ 命中了，但**超时**        → INCONCLUSIVE（没跑出结论，不是做错了）
 *   ⑤ 命中了，且失败            → FAIL（断言不通过 = 实现不满足判据）
 *   ⑥ 命中了，且通过            → PASS
 */
export function verdictOf(a: CriterionLike, junit: readonly JunitCase[]): Verdict {
  if (a.maturity !== 'automated') return 'INCONCLUSIVE';
  const [file, caseName] = a.verification.target.split('::');
  if (!caseName) return 'INCONCLUSIVE';
  const hit = junit.find((c) => c.name === caseName && c.file === file);
  if (!hit) return 'INCONCLUSIVE'; // 验证未执行 —— 不能报 PASS
  if (isTimeout(hit)) return 'INCONCLUSIVE'; // 超时 = 没跑出结论，不是断言不通过
  return hit.failed ? 'FAIL' : 'PASS';
}

/**
 * 一条判据命中的那个用例 —— 报告要说清「用时多久」时要用它。
 *
 * 判据的验证目标形如 `文件::用例名`，两边都要对上才算命中。
 */
export function junitHitOf(
  a: CriterionLike,
  junit: readonly JunitCase[]
): JunitCase | undefined {
  const [file, caseName] = a.verification.target.split('::');
  if (!caseName) return undefined;
  return junit.find((c) => c.name === caseName && c.file === file);
}

/**
 * 这条判据是不是**超时**（而不是断言不通过）。
 *
 * 命中了用例、但那个用例超时了 —— 报告要能说清是哪一条、用了多久。
 */
export function timeoutHitOf(
  a: CriterionLike,
  junit: readonly JunitCase[]
): JunitCase | undefined {
  const hit = junitHitOf(a, junit);
  return hit && isTimeout(hit) ? hit : undefined;
}

/**
 * 一条条款的结论 —— 取它所有判据里最坏的那一档。
 *
 * 坏的顺序：FAIL > INCONCLUSIVE > PASS。
 * 没有判据 = 无法判定，不是通过。
 */
export function worstOf(verdicts: readonly Verdict[]): Verdict {
  if (verdicts.length === 0) return 'INCONCLUSIVE'; // 没有判据 = 无法判定，不是通过
  if (verdicts.includes('FAIL')) return 'FAIL';
  if (verdicts.includes('INCONCLUSIVE')) return 'INCONCLUSIVE';
  return 'PASS';
}
