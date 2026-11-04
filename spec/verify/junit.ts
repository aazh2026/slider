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
  /** 这条证据来自哪个 junit 文件 */
  evidence: string;
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
 * 块内出现 `<failure>` 即视为失败。
 */
export function parseJunitCases(xml: string, label: string): JunitCase[] {
  const cases: JunitCase[] = [];
  for (const m of xml.matchAll(/<testcase\b([\s\S]*?)(?:\/>|<\/testcase>)/g)) {
    const attrs = m[1] ?? '';
    const name = decodeXmlEntities(attrs.match(/name="([^"]*)"/)?.[1] ?? '');
    const file = decodeXmlEntities(attrs.match(/file="([^"]*)"/)?.[1] ?? '').replace(
      /^.*\/spec\//,
      'spec/'
    );
    const failed = /<failure\b/.test(m[0]);
    cases.push({ name, file, failed, evidence: label });
  }
  return cases;
}
