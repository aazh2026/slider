/**
 * junit 解析的缺陷回放测试
 * ---------------------------------------------------------------------------
 * 为什么这个文件存在：
 *
 *   追溯矩阵曾经把**一条真跑过、真通过的用例**判成「验证未执行」。
 *   根因不是实现坏了，也不是判据写错了 —— 是**解析器跟写证据的工具对不上账**：
 *
 *     Bun 把用例名里的 `"` 转义成 `&quot;` 写进 `name="..."` 属性；
 *     解析器用 `/name="([^"]*)"/` 取值，**不解实体**；
 *     取出来的 `界面显示&quot;导出失败&quot;` 与 spec.yaml 里的验证目标对不上；
 *     于是「这条判据跑过了吗」的查询返回「没跑过」→ PASS 掉成 INCONCLUSIVE。
 *
 *   这类缺陷比"测试挂了"危险得多：测试挂了会有人来修，
 *   而"报告说没验证过"读起来像"这条判据没人管"，**没有人会来查**。
 *
 *   所以这里把当时的现场**原样**重放一遍，钉住解析器不许再退化。
 *
 * ---------------------------------------------------------------------------
 * **为什么断言写在 test 里，不写在 helper 里**：
 *   见 spec/README.md「验证器怎么写」第 1 条 —— 判定逻辑藏进 helper
 *   会导致失败时说不清是哪条判据挂了。
 */

import { describe, expect, test } from 'bun:test';

import { decodeXmlEntities, parseJunitCases } from './junit.ts';

/** 当时真实产出的那一行 —— 逐字照抄，不做任何"更好看"的改写 */
const REAL_E2E_TESTCASE =
  '<testcase name="导出提交失败 → 界面显示&quot;导出失败&quot;，绝不显示&quot;导出成功&quot;" ' +
  'file="/Users/aaronzh/Documents/GitHub/slider/e2e/errors.e2e.ts" time="1.234" />';

const REAL_UNIT_TESTCASE =
  '<testcase name="软删除的项目：详情与子资源一律 404（不能&quot;列表没了、直链还在&quot;）" ' +
  'file="/Users/aaronzh/Documents/GitHub/slider/apps/api/tests/security/resource-lifecycle.test.ts" />';

describe('XML 实体解码', () => {
  test('quote-entities-are-decoded', () => {
    expect(decodeXmlEntities('&quot;导出失败&quot;')).toBe('"导出失败"');
  });

  test('amp-entity-is-decoded-last', () => {
    // &amp; 必须最后解 —— 否则 &amp;quot; 会被解成引号，
    // 而正确的语义是「一个字面的 & 后面跟着 quot 四个字」
    expect(decodeXmlEntities('&amp;quot;')).toBe('&quot;');
  });

  test('lt-gt-apos-are-decoded', () => {
    expect(decodeXmlEntities('a&lt;b&gt;c&apos;d')).toBe(`a<b>c'd`);
  });

  test('plain-text-is-untouched', () => {
    expect(decodeXmlEntities('没有实体的用例名')).toBe('没有实体的用例名');
  });
});

describe('junit 解析 —— 缺陷回放', () => {
  test('case-name-with-quotes-resolves-to-the-spec-target', () => {
    const cases = parseJunitCases(REAL_E2E_TESTCASE, 'spec/evidence/junit-e2e.xml');
    expect(cases).toHaveLength(1);
    // spec.yaml 里 AC-E2E-019 指向的验证目标就是这个字符串
    expect(cases[0]!.name).toBe('导出提交失败 → 界面显示"导出失败"，绝不显示"导出成功"');
    // 关键断言：**不能**留下实体
    expect(cases[0]!.name).not.toContain('&quot;');
  });

  test('unit-case-name-with-quotes-resolves-to-the-spec-target', () => {
    const cases = parseJunitCases(REAL_UNIT_TESTCASE, 'spec/evidence/junit.xml');
    expect(cases).toHaveLength(1);
    expect(cases[0]!.name).toBe('软删除的项目：详情与子资源一律 404（不能"列表没了、直链还在"）');
  });

  test('failure-element-marks-the-case-as-failed', () => {
    const xml =
      '<testcase name="ok" file="/x/y.ts" />' +
      '<testcase name="bad" file="/x/y.ts"><failure type="AssertionError" /></testcase>';
    const cases = parseJunitCases(xml, 'spec/evidence/junit.xml');
    expect(cases.map((c) => [c.name, c.failed])).toEqual([
      ['ok', false],
      ['bad', true],
    ]);
  });

  test('file-path-is-normalized-to-spec-relative', () => {
    // spec/ 下的文件：绝对路径 → 仓库相对路径
    const inSpec = parseJunitCases(
      '<testcase name="x" file="/Users/aaronzh/Documents/GitHub/slider/spec/verify/core-layout.test.ts" />',
      'spec/evidence/junit.xml'
    );
    expect(inSpec[0]!.file).toBe('spec/verify/core-layout.test.ts');

    // e2e/ 下的文件：落在仓库根，不带 spec/ 前缀 —— 原样保留
    const cases = parseJunitCases(REAL_E2E_TESTCASE, 'spec/evidence/junit-e2e.xml');
    expect(cases[0]!.file).toBe('/Users/aaronzh/Documents/GitHub/slider/e2e/errors.e2e.ts');
  });

  test('every-parsed-case-can-be-found-by-its-own-name', () => {
    // 这是**真正触发过事故的那一步**：按名字查一条判据跑没跑过。
    // 只要解析出来的名字与 spec 里写的对不上，查询就返回「没跑过」。
    const cases = parseJunitCases(REAL_E2E_TESTCASE, 'spec/evidence/junit-e2e.xml');
    const wanted = '导出提交失败 → 界面显示"导出失败"，绝不显示"导出成功"';
    expect(cases.find((c) => c.name === wanted)).toBeDefined();
  });
});
