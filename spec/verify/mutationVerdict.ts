/**
 * 注入用例的结论 —— **纯逻辑，无 IO**
 * ---------------------------------------------------------------------------
 * 一个注入用例走三步：**基线 PASS → 注入必须 FAIL → 还原后重新 PASS**。
 * 三步的结果摆在一起，本来该有**三档**结论：
 *
 *   · 全过            → PASS        （验证器抓得住这个错）
 *   · 没抓到 / 没还原 → FAIL        （验证器弱，或源文件被改坏了）
 *   · **基线没过**    → INCONCLUSIVE（这一轮**什么都没证明**）
 *
 * ---------------------------------------------------------------------------
 * **本轮钉住的那条规则：基线红 ≠ 验证器弱**
 *
 * 以前只有两档：`if (!baseline || !caught || !restored) broken++` ——
 * **基线没过也算「验证器抓不住」**，然后整轮报：
 *
 *   > ❌ 存在抓不到注入错误的验证器 —— 需要补强后才能声称这些判据有效。
 *
 * 这句话在基线红的时候是**假的**，而且假得很贵：
 * 它把「环境抖了」说成「验证器太弱」，下一步就会去**补强一个没毛病的验证器**。
 *
 * 实测（2026-11-05，第 14 轮那次流水线）：
 *   AC-GOV-001 那一行是 `基线 ✗ / 抓到 ✓ / 还原 ✓` ——
 *   验证器**确实抓到了**注入，源文件**确实还原干净了**；
 *   只是基线那一轮里 `apps/api/tests` 有 19 条用例没过（抖的），
 *   于是整条注入用例被判「不合格」，流水线退出码 1，
 *   终端上写着「需要补强验证器」。
 *   同一份代码隔离复跑 → 91 个用例全过、不合格 0 个。
 *
 * 也就是说：**基线没过的时候，「抓到注入」这一栏根本不可信** ——
 * 注入后的那一轮本来也会因为同样的抖动而红，它红了**证明不了**什么。
 *
 * 所以：**基线红 → INCONCLUSIVE（没跑出结论）**，不是 FAIL。
 *
 * **这不是弱化校验**：基线红的用例**照样挡住放行** ——
 * 退出码 2（= 有环节没跑出结论，工具链/环境坏了，这一层的结论一律不算数），
 * 流水线因此不放行（见 spec/verify/pipelineVerdict.ts 的退出码契约）。
 * 变的只是**结论的说法**：从「验证器抓不住」改成「还不知道」。
 *
 * （与第 14 轮同源：那时钉的是「超时 ≠ 断言不通过」，
 *   这一轮钉的是「基线红 ≠ 验证器弱」—— 同一个病：**把不确定说成了确定**。）
 */

import { worstOf, type Verdict } from './verdict.ts';

/** 一条注入用例的结论 —— 与判据侧共用一套词（PASS / FAIL / INCONCLUSIVE） */
export type MutationVerdict = Verdict;

/**
 * 判定一条注入用例需要的那部分字段。
 *
 * 刻意只声明**用到的**字段（结构化类型）——
 * 这样这个模块既不依赖报告文件的整体结构，也不依赖 mutation-check.ts。
 */
export interface MutationCaseLike {
  /** 基线那轮过了吗 —— 没过就**什么都没证明** */
  baseline_pass: boolean;
  /** 注入之后验证器报错了吗 */
  caught: boolean;
  /** 还原之后又过了吗 */
  restored_pass: boolean;
}

/**
 * 一条注入用例的结论。
 *
 * 判定顺序（顺序不能换）：
 *   ① 基线没过            → INCONCLUSIVE（没跑出结论，不是验证器弱）
 *   ② 基线过了但没抓到    → FAIL（验证器抓不住这个错）
 *   ③ 抓到了但没还原干净  → FAIL（源文件被改坏了 —— 更严重）
 *   ④ 全过                → PASS
 */
export function mutationVerdictOf(c: MutationCaseLike): MutationVerdict {
  if (!c.baseline_pass) return 'INCONCLUSIVE';
  if (!c.caught) return 'FAIL';
  if (!c.restored_pass) return 'FAIL';
  return 'PASS';
}

/**
 * 这一条为什么是这一档 —— 报告与终端要说同一句话。
 *
 * 措辞的规矩：**不许把「没跑出结论」说成「验证器弱」**。
 */
export function mutationVerdictReason(c: MutationCaseLike): string {
  const v = mutationVerdictOf(c);
  if (v === 'PASS') return '验证器抓得住这个错，源文件也已还原';
  if (v === 'INCONCLUSIVE') {
    return (
      '基线那一轮自己就没过 —— **这一轮没跑出结论**（注入后的那一轮本来也会' +
      '因为同样的原因红，验证器的强弱这轮判不了）'
    );
  }
  if (!c.caught) return '注入之后验证器**仍然通过** —— 验证器抓不住这个错';
  return '注入抓到了，但**还原之后仍然没过** —— 源文件被改坏了';
}

/** 一批注入用例的汇总 */
export interface MutationSummary {
  /** 一共跑了多少个注入用例 */
  total: number;
  /** 结论是通过的个数 */
  pass: number;
  /** 结论是不通过的个数（验证器弱 / 源文件被改坏） */
  fail: number;
  /** 没跑出结论的个数（基线没过） */
  inconclusive: number;
  /** 整批的最坏一档 */
  verdict: MutationVerdict;
}

/**
 * 汇总一批注入用例。
 *
 * 坏的顺序：FAIL > INCONCLUSIVE > PASS（与判据侧同一套，
 * 见 spec/verify/verdict.ts 的 worstOf）。
 *
 * 一个用例都没有 → INCONCLUSIVE（「没验过」不是「验过了」）。
 */
export function summarizeMutationCases(cases: readonly MutationCaseLike[]): MutationSummary {
  const verdicts = cases.map(mutationVerdictOf);
  const pass = verdicts.filter((v) => v === 'PASS').length;
  const fail = verdicts.filter((v) => v === 'FAIL').length;
  const inconclusive = verdicts.filter((v) => v === 'INCONCLUSIVE').length;
  return {
    total: cases.length,
    pass,
    fail,
    inconclusive,
    verdict: cases.length === 0 ? 'INCONCLUSIVE' : worstOf(verdicts),
  };
}

/**
 * 整批注入检查的**退出码**。
 *
 *   0 = 全过
 *   1 = 有结论，结论是不通过（验证器抓不住 / 源文件被改坏）
 *   2 = 没跑出结论（基线没过 —— 环境或工具链抖了）
 *
 * 为什么不把「有 FAIL」也算成 2：退出码 2 的含义是
 * 「**这一层的结论一律不算数**」（见 pipelineVerdict.ts 的 EXIT_CODE_MEANING）。
 * 明明有一条**确定的**坏结论（验证器抓不住），却把整批结论作废，
 * 那个确切的发现就被藏起来了 —— 比「少报一个结论」更糟。
 * 所以：**确切的坏结论优先报 1；只有「没跑出结论」才报 2。**
 */
export function mutationExitCode(summary: MutationSummary): 0 | 1 | 2 {
  if (summary.fail > 0) return 1;
  // 一个用例都没有 = 什么都没验过 —— 与「没跑出结论」同一档
  if (summary.inconclusive > 0 || summary.total === 0) return 2;
  return 0;
}
