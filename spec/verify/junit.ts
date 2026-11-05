/**
 * junit 报告解析 —— **纯函数，无副作用**
 * ---------------------------------------------------------------------------
 * 为什么单独抽一个文件：
 *
 *   `traceability.ts` 在模块顶层就调 `main()`，一 import 就会跑整个生成器。
 *   解析逻辑留在那里的话，就**没法给它写测试** ——
 *   而下面这个缺陷恰恰是"验证器自己出错"造成的，
 *   按缺陷回放的要求，必须有一条用例把它钉住。
 *
 * ---------------------------------------------------------------------------
 * **这里踩过的坑：XML 实体**
 *
 *   Bun 的 junit 报告把用例名写进 `name="..."` 属性。
 *   用例名里带引号（比如「界面显示"导出失败"，绝不显示"导出成功"」）
 *   就会被转义成 `&quot;`。
 *
 *   不解实体，取出来的就是 `界面显示&quot;导出失败&quot;`，
 *   与 spec.yaml 里写的验证目标对不上 —— 于是**一条真跑过、真通过的用例
 *   被判成「验证未执行」**，结论从 PASS 掉到 INCONCLUSIVE。
 *
 *   这个方向特别危险：报告说"没验证过"，读的人会以为那条判据没人管，
 *   而不是"这条其实过了"。实测踩到过：SPEC-E2E-011 / AC-E2E-019。
 *
 *   教训：**验证器读自己的证据时，必须和写证据的工具对得上账** ——
 *   否则不是"验证失败"，而是"验证根本没发生"，而后者更安静。
 */

export interface JunitCase {
  name: string;
  file: string;
  failed: boolean;
  /**
   * 这一条被**跳过**了（`-t` 过滤没匹配上，或用例本身标了 skip）。
   *
   * 「跳过的用例」**不算跑过** —— Bun 实测（2026-11-05）：
   * `bun test a.test.ts -t "不存在的名字"` 会写出 junit，里面**每一条**都是
   * `<skipped/>`，而**退出码是 1**。
   *
   * 只看退出码的话，「一条都没跑」与「有东西坏了」长得一模一样。
   * 差分判定要分清这两件事，所以这个标记不能丢。
   */
  skipped?: boolean;
  /**
   * Bun 的 junit 把失败类型写进 `<failure type="..."/>` —— 这里原样保留。
   *
   * 实测：`TimeoutError`（超时）/ `AssertionError`（断言不通过）。
   * **这个类型不能丢** —— 见 `isTimeout()`。
   */
  failureType?: string;
  /** 这条用例跑了多久（秒）—— 超时的时候要说清「用时多久」 */
  durationSeconds?: number;
  /** 这条证据来自哪个 junit 文件 */
  evidence: string;
}

/**
 * Bun 把「超时」写成这种 failure type。
 *
 * 实测（`bun test --reporter=junit`，2026-11-05）：
 *   超时       → `<failure type="TimeoutError" />`
 *   断言不通过 → `<failure type="AssertionError" />`
 */
export const TIMEOUT_FAILURE_TYPE = 'TimeoutError';

/**
 * 这条用例是不是「超时」。
 *
 * **超时不是断言不通过**：
 *   · 断言不通过 = 「实现不对」—— 那是一条**确定的**结论；
 *   · 超时       = 「没跑出结论」—— 可能是环境被抢（别的跑批在跑）、
 *                  机器进了睡眠、也可能是实现卡死。
 *
 * 实测（2026-11-05）这两件事都被当成「实现不满足判据」报了出去：
 *   · `apps/api/tests/security/session-cookie.test.ts` 在流水线里耗时 **906.903 秒**、
 *     用例超时（限 5 秒）；隔离复跑 **5 条用例 3.2 秒全过** —— 环境被抢；
 *   · E2E 链的 180 秒超时一次性报成 **916 秒** —— 机器进了 Maintenance Sleep。
 * 两起都不是实现缺陷，却都按「实现不满足判据」记账 ——
 * 下一轮就会去修一个没毛病的验证器。
 */
export function isTimeout(c: Pick<JunitCase, 'failed' | 'failureType'>): boolean {
  return c.failed && c.failureType === TIMEOUT_FAILURE_TYPE;
}

/**
 * 一份证据集里的失败是怎么构成的 —— **「断言不通过」与「超时」是两种红**。
 *
 * 流水线的措辞靠它分清「红的是实现」与「还没跑出结论」：
 * 以前这两种红都只体现为一个非零退出码，于是措辞一律写成
 * 「是实现不满足判据」—— 超时的时候那句话是**假的**
 * （实测：同一个文件在流水线里 906.903 秒超时，隔离复跑 3.2 秒全过）。
 */
export function failureBreakdown(cases: readonly JunitCase[]): {
  asserted: number;
  timedOut: number;
} {
  const failed = cases.filter((c) => c.failed);
  return {
    asserted: failed.filter((c) => !isTimeout(c)).length,
    timedOut: failed.filter((c) => isTimeout(c)).length,
  };
}

/**
 * 解开 XML 属性里的实体。
 *
 * `&amp;` 必须**最后**解 —— 否则 `&amp;quot;` 会被先解成 `&quot;` 再被解成引号，
 * 而正确的语义是「一个字面的 & 后面跟着 quot 四个字」。
 */
export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * 解析一段 junit XML，取出全部 `<testcase>`。
 *
 * 块内出现 `<failure>` 即视为失败；**失败类型与用时一并留下** ——
 * 「超时」与「断言不通过」是两种结论，报告要能分开说（见 `isTimeout()`）。
 */
export function parseJunitCases(xml: string, label: string): JunitCase[] {
  const cases: JunitCase[] = [];
  for (const m of xml.matchAll(/<testcase\b([\s\S]*?)(?:\/>|<\/testcase>)/g)) {
    // 属性只在**开始标签**里 —— 上面那个正则会把 `<failure .../>` 也吃进 m[1]，
    // 所以先把标签截出来，再从标签里取属性。
    const tag = m[0].slice(0, m[0].indexOf('>') + 1);
    const name = decodeXmlEntities(tag.match(/name="([^"]*)"/)?.[1] ?? '');
    const file = decodeXmlEntities(tag.match(/file="([^"]*)"/)?.[1] ?? '').replace(
      /^.*\/spec\//,
      'spec/'
    );
    const failed = /<failure\b/.test(m[0]);
    const skipped = /<skipped\b/.test(m[0]);
    const failureType = m[0].match(/<failure\b[^>]*\btype="([^"]*)"/)?.[1];
    const rawTime = tag.match(/\btime="([^"]*)"/)?.[1];
    const durationSeconds = rawTime === undefined ? undefined : Number(rawTime);
    cases.push({
      name,
      file,
      failed,
      skipped,
      failureType,
      durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : undefined,
      evidence: label,
    });
  }
  return cases;
}
