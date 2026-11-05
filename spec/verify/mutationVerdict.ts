/**
 * 注入用例的结论 —— **纯逻辑，无 IO**
 * ---------------------------------------------------------------------------
 * 一个注入用例走三步：**基线 → 注入 → 还原**。
 * 每一轮跑完，工具都知道**哪几条用例失败了**（见 spec/verify/junit.ts 的解析）。
 *
 * ---------------------------------------------------------------------------
 * **本轮钉住的那条规则：判定要「差分」，不能只看退出码**
 *
 * 以前的判定全是退出码：
 *
 *   baseline = 基线那轮退出码是不是 0
 *   caught   = 注入那轮退出码是不是**非** 0
 *   restored = 还原那轮退出码是不是 0
 *
 * 这三个量只有在「基线是绿的」时候才互相印证。**树本来就是红的时候，
 * 它们每一个都会说反话**：
 *
 *   · 基线红 → 整条被记成「验证器抓不住」——
 *     把「树本来就坏」说成「验证器太弱」，下一步就会去**修一个没毛病的验证器**。
 *   · 注入那轮红 → 被记成「**抓到了**」——
 *     可它红的原因跟注入毫无关系！这是**冤枉验证器**的反面：
 *     给一个什么都没证明的验证器**记了功**。
 *
 * 第 14 轮那次就踩中了第二种（2026-11-05）：
 *   AC-GOV-001 那一行是 `基线 ✗ / 抓到 ✓ / 还原 ✓` ——
 *   验证器**确实抓到了**注入，源文件**确实还原干净了**；
 *   只是基线那一轮里 `apps/api/tests` 有 19 条用例没过。
 *
 * **根因（2026-11-05 查实）**：AC-GOV-001 的验证器是
 * `scripts/check-coverage.check.ts`，它的用例调的是 `main()` ——
 * 而 `main()` 会**重跑整套测试**。于是这一条的「基线」量的是
 * **整棵树健康不健康**，不是那个验证器健康不健康。
 * 别人在 `apps/api` 上改到一半（当时是编译端点被质量闸门拒收），
 * 这一条的基线就红了 —— 而旧判定把它记成「验证器抓不住」。
 *
 * ---------------------------------------------------------------------------
 * **差分判定：只看「注入带来了哪些新的失败」**
 *
 *   B = 基线那轮失败的用例
 *   M = 注入那轮失败的用例
 *   R = 还原那轮失败的用例
 *
 *   · `M \ B` 非空 → 注入**造成了新的失败** → 归因于注入 → 判「抓到了」
 *   · `R \ B` 非空 → 还原之后还多出失败 → 源文件没还原干净（或树被别人改了）
 *   · `M \ B` 为空且 `B` 为空 → 树是绿的，注入后还是绿的 → **验证器抓不住**
 *   · `M \ B` 为空且 `B` 非空 → 树本来就红，注入也没带来新的失败 → **没跑出结论**
 *
 * **树本来就红，不再是「验证器弱」的证据** —— 它被**记下来**（报告里逐条列出），
 * 由**该管它的那一步**（判据执行）去挡住放行。
 *
 * ---------------------------------------------------------------------------
 * **这不是弱化校验**：在**树是绿的**情况下，新旧两套判定**逐条相同**
 * （见 mutationVerdict.test.ts 里的对照用例）。
 * 变的只是「树本来就不绿」时的说法：从「验证器抓不住」改成「**还不知道**」，
 * 而且**照样挡住放行**（退出码 2 —— 这一层的结论一律不算数，
 * 见 spec/verify/pipelineVerdict.ts 的退出码契约）。
 */

import { worstOf, type Verdict } from './verdict.ts';

/** 一条注入用例的结论 —— 与判据侧共用一套词（PASS / FAIL / INCONCLUSIVE） */
export type MutationVerdict = Verdict;

/**
 * 整轮失败的标记 —— 这一轮**没有逐条用例的结果**。
 *
 * 什么时候会这样：测试文件**加载不了**（注入把 import 改坏了）、
 * 或者进程崩了（栈溢出 / 被杀）。Bun 在这两种情况下**根本不写 junit 文件**。
 *
 * 它仍然是一条**结论**（这一轮确实失败了），不是「没跑出结论」——
 * 所以它进 `failed` 清单，差分照常算。
 */
export const RUN_LEVEL_FAILURE = '(整轮失败)';

/** 一轮跑批的观察 —— 失败的是**哪几条用例** */
export interface MutationRound {
  /** 失败的用例标识（`文件::用例名`）—— 空数组 = 这一轮全绿 */
  failed: readonly string[];
  /** 这一轮**没跑出结论**（进程被信号杀掉之类 —— 连失败都没能判定） */
  noVerdict?: boolean;
}

/** 差分判定需要的三轮观察 */
export interface MutationCaseLike {
  baseline: MutationRound;
  mutated: MutationRound;
  restored: MutationRound;
}

/** 报告里的一条注入用例（新格式） */
export interface MutationReportCase {
  criterion: string;
  description: string;
  mutated_file: string;
  verifier: string;
  /** 新格式：三轮各自的失败清单 */
  baseline?: MutationRound;
  mutated?: MutationRound;
  restored?: MutationRound;
  /** 旧格式（三轮整体绿不绿）—— 新报告不再写，老报告只有这三个 */
  baseline_pass?: boolean;
  caught?: boolean;
  restored_pass?: boolean;
  verdict?: string;
  note?: string;
}

/**
 * 差分判定 —— 本轮的主判定。
 *
 * 判定顺序（顺序不能换）：
 *   ① 有一轮**没跑出结论**        → INCONCLUSIVE（判不了）
 *   ② 注入带来了新的失败，且还原后没有多出失败 → PASS（验证器抓得住）
 *   ③ 注入带来了新的失败，但还原后仍多出失败   → FAIL（没还原干净 / 树被别人改了）
 *   ④ 注入没带来新的失败，且基线是绿的         → FAIL（验证器抓不住）
 *   ⑤ 注入没带来新的失败，且基线本来就红       → INCONCLUSIVE（没跑出结论）
 */
export function mutationVerdictOf(c: MutationCaseLike): MutationVerdict {
  // ① 有一轮压根没跑出结论 —— 这一轮判不了
  if (c.baseline.noVerdict || c.mutated.noVerdict || c.restored.noVerdict) return 'INCONCLUSIVE';

  const base = new Set(c.baseline.failed);
  /** 注入**造成**的失败 —— 归因于注入的证据 */
  const caused = c.mutated.failed.filter((n) => !base.has(n));
  /** 还原之后仍然多出来的失败 —— 还原没还原干净，或树在跑批期间被别人改了 */
  const leftover = c.restored.failed.filter((n) => !base.has(n));

  if (caused.length > 0) return leftover.length > 0 ? 'FAIL' : 'PASS';
  // 注入没有带来任何新失败 —— 要分清是「树本来就红」还是「验证器真的抓不住」
  if (base.size > 0) return 'INCONCLUSIVE';
  return 'FAIL';
}

/** 差分判定用到的三个中间量 —— 报告与矩阵要显示它们 */
export interface MutationDiff {
  /** 基线那轮就失败的用例 */
  baselineFailed: readonly string[];
  /** 注入**造成**的失败（`M \ B`） */
  caused: readonly string[];
  /** 还原之后仍然多出来的失败（`R \ B`） */
  leftover: readonly string[];
}

/** 把差分判定用到的中间量算出来 —— 显示与措辞都靠它 */
export function mutationDiffOf(c: MutationCaseLike): MutationDiff {
  const base = new Set(c.baseline.failed);
  return {
    baselineFailed: [...c.baseline.failed],
    caused: c.mutated.failed.filter((n) => !base.has(n)),
    leftover: c.restored.failed.filter((n) => !base.has(n)),
  };
}

/**
 * 这一条为什么是这一档 —— 报告与终端要说同一句话。
 *
 * 措辞的规矩：**不确定的时候不许说成「验证器弱」**。
 */
export function mutationVerdictReason(c: MutationCaseLike): string {
  const v = mutationVerdictOf(c);
  const d = mutationDiffOf(c);

  if (v === 'PASS') {
    return (
      `注入让原本不失败的用例失败了（多出 ${d.caused.length} 条），` +
      '还原后回到了基线状态 —— **验证器抓得住这个错**'
    );
  }
  if (c.baseline.noVerdict || c.mutated.noVerdict || c.restored.noVerdict) {
    return '有一轮**没跑出结论**（连每条用例的结果都没产出）—— 这一轮判不了';
  }
  if (d.caused.length === 0 && d.baselineFailed.length > 0) {
    return (
      `基线那一轮自己就有 ${d.baselineFailed.length} 条失败，注入也没带来新的失败 —— ` +
      '**这一轮没跑出结论**（判不了那批验证器的强弱）'
    );
  }
  if (d.leftover.length > 0) {
    return (
      `注入抓到了，但**还原之后仍然多出 ${d.leftover.length} 条失败** —— ` +
      '源文件没还原干净，或跑批期间树被别人改了'
    );
  }
  return '注入之后验证器**仍然全部通过** —— 验证器抓不住这个错';
}

/* -------------------------------------------------------------------------- */
/* 旧格式报告的兜底                                                            */
/* -------------------------------------------------------------------------- */

/** 旧格式：只有三个布尔量 */
export interface LegacyMutationCaseLike {
  baseline_pass: boolean;
  caught: boolean;
  restored_pass: boolean;
}

/**
 * 旧格式报告的判定 —— 第 15 轮那套（基线红 → 没跑出结论）。
 *
 * 只给**老报告**用；新报告一律走差分判定。
 */
export function legacyMutationVerdictOf(c: LegacyMutationCaseLike): MutationVerdict {
  if (!c.baseline_pass) return 'INCONCLUSIVE';
  if (!c.caught) return 'FAIL';
  if (!c.restored_pass) return 'FAIL';
  return 'PASS';
}

/**
 * 从报告里的一条用例里取出判定所需的三轮观察。
 *
 * 新报告有三轮失败清单 → 走差分；
 * 老报告只有三个布尔量 → 走旧判定（**不要把老报告说成「没跑出结论」** ——
 * 那会把一份好好跑过的报告误报成没结论）。
 */
export function mutationRoundsOf(c: MutationReportCase): MutationCaseLike | null {
  if (c.baseline && c.mutated && c.restored) {
    return { baseline: c.baseline, mutated: c.mutated, restored: c.restored };
  }
  return null;
}

/** 一条**报告里的**用例的结论 —— 新报告走差分，老报告走旧判定 */
export interface ReportCaseVerdict {
  verdict: MutationVerdict;
  /** 这一条为什么是这一档 —— 报告与终端要说同一句话 */
  reason: string;
  /** 差分的中间量 —— 老报告没有（null） */
  diff: MutationDiff | null;
  /** 这份报告是不是旧格式（只有三个布尔量） */
  legacy: boolean;
}

/**
 * 读一条**报告里的**用例，给出结论。
 *
 * 报告会有两种格式并存（老报告不会因为新代码上线而消失），
 * 所以读报告的人**两种都要能读**：
 *   · 新格式（三轮失败清单）→ 走**差分**
 *   · 老格式（三个布尔量）   → 走**旧判定**
 *
 * 而且**不能把老报告说成「没跑出结论」** ——
 * 那会把一份好好跑过的报告误报成没结论（老报告是**跑过**的，
 * 只是它记的是「整轮绿不绿」，不是「哪几条红了」）。
 */
export function reportCaseVerdict(c: MutationReportCase): ReportCaseVerdict {
  const rounds = mutationRoundsOf(c);
  if (rounds) {
    return {
      verdict: mutationVerdictOf(rounds),
      reason: mutationVerdictReason(rounds),
      diff: mutationDiffOf(rounds),
      legacy: false,
    };
  }
  if (
    c.baseline_pass === undefined ||
    c.caught === undefined ||
    c.restored_pass === undefined
  ) {
    // 既没有清单，也没有布尔量 —— 无从判定，不许猜
    return {
      verdict: 'INCONCLUSIVE',
      reason: '这条既没有三轮失败清单，也没有三个布尔量 —— 无从判定',
      diff: null,
      legacy: true,
    };
  }
  const verdict = legacyMutationVerdictOf({
    baseline_pass: c.baseline_pass,
    caught: c.caught,
    restored_pass: c.restored_pass,
  });
  const reason =
    verdict === 'PASS'
      ? '注入被抓到，且源文件已还原（旧格式报告：只有三个布尔量，没有失败清单）'
      : verdict === 'FAIL'
        ? '注入没被抓到，或源文件没还原干净（旧格式报告：只有三个布尔量）'
        : '基线自己就没过 —— 没跑出结论（旧格式报告：只有三个布尔量）';
  return { verdict, reason, diff: null, legacy: true };
}

/** 一批注入用例的汇总 */
export interface MutationSummary {
  /** 一共跑了多少个注入用例 */
  total: number;
  /** 结论是通过的个数 */
  pass: number;
  /** 结论是不通过的个数（验证器弱 / 源文件被改坏） */
  fail: number;
  /** 没跑出结论的个数 */
  inconclusive: number;
  /** 整批的最坏一档 */
  verdict: MutationVerdict;
}

/**
 * 汇总一批注入用例。
 *
 * 坏的顺序：FAIL > INCONCLUSIVE > PASS（与判据侧同一套，见 spec/verify/verdict.ts）。
 *
 * 一个用例都没有 → INCONCLUSIVE（「没验过」不是「验过了」）。
 */
export function summarizeMutationCases(cases: readonly MutationCaseLike[]): MutationSummary {
  return summarizeVerdicts(cases.map(mutationVerdictOf));
}

/**
 * 汇总一批**结论**。
 *
 * 与 `summarizeMutationCases` 的区别：这里直接吃结论，
 * 所以**混着两种格式的报告**也能汇总 ——
 * 老报告的每一条走旧判定，新报告的每一条走差分，
 * 两者的结论合起来才是这一批的总账（见 spec/verify/traceability.ts §2.4）。
 */
export function summarizeVerdicts(verdicts: readonly MutationVerdict[]): MutationSummary {
  const pass = verdicts.filter((v) => v === 'PASS').length;
  const fail = verdicts.filter((v) => v === 'FAIL').length;
  const inconclusive = verdicts.filter((v) => v === 'INCONCLUSIVE').length;
  return {
    total: verdicts.length,
    pass,
    fail,
    inconclusive,
    verdict: verdicts.length === 0 ? 'INCONCLUSIVE' : worstOf(verdicts),
  };
}

/**
 * 整批注入检查的**退出码**。
 *
 *   0 = 全过
 *   1 = 有结论，结论是不通过（验证器抓不住 / 源文件被改坏）
 *   2 = 没跑出结论（树本来就是红的 / 有一轮没跑出结论）
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
