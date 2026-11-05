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

import { decodeXmlEntities, failureBreakdown, isTimeout, parseJunitCases } from './junit.ts';

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

// ---------------------------------------------------------------------------
// 失败类型 —— 「超时」与「断言不通过」是两种结论
// ---------------------------------------------------------------------------

describe('junit 解析 —— 失败类型', () => {
  test('timeout-keeps-its-failure-type', () => {
    // 实测产出（bun test --reporter=junit，2026-11-05）：
    //   <testcase ...><failure type="TimeoutError" /></testcase>
    const xml =
      '<testcase name="慢" file="/x/y.ts" time="906.903"><failure type="TimeoutError" /></testcase>';
    const c = parseJunitCases(xml, 'spec/evidence/junit.xml')[0]!;
    expect(c.failed).toBe(true);
    expect(c.failureType).toBe('TimeoutError');
    expect(isTimeout(c)).toBe(true);
  });

  test('assertion-failure-keeps-its-failure-type', () => {
    const xml =
      '<testcase name="错" file="/x/y.ts" time="0.1"><failure type="AssertionError" /></testcase>';
    const c = parseJunitCases(xml, 'spec/evidence/junit.xml')[0]!;
    expect(c.failed).toBe(true);
    expect(c.failureType).toBe('AssertionError');
    // 断言不通过**不是**超时 —— 它是「实现不满足判据」
    expect(isTimeout(c)).toBe(false);
  });

  test('duration-is-kept', () => {
    const xml = '<testcase name="x" file="/x/y.ts" time="12.5" />';
    expect(parseJunitCases(xml, 'spec/evidence/junit.xml')[0]!.durationSeconds).toBe(12.5);
  });

  test('a-passing-case-has-no-failure-type', () => {
    const c = parseJunitCases('<testcase name="x" file="/x/y.ts" time="0.1" />', 'j')[0]!;
    expect(c.failed).toBe(false);
    expect(c.failureType).toBeUndefined();
    expect(isTimeout(c)).toBe(false);
  });

  test('attributes-are-read-from-the-start-tag-only', () => {
    // 解析用的正则会把 <failure .../> 一并吃进「属性」那部分 ——
    // 属性必须只在开始标签里取，否则 name/file/time 会取到子元素的头上。
    const xml =
      '<testcase name="真名字" file="/x/y.ts" time="0.25"><failure type="TimeoutError" /></testcase>';
    const c = parseJunitCases(xml, 'j')[0]!;
    expect(c.name).toBe('真名字');
    expect(c.file).toBe('/x/y.ts');
    expect(c.durationSeconds).toBe(0.25);
  });
});

describe('失败的构成 —— 两种红分开数', () => {
  test('timeouts-and-assertions-are-counted-apart', () => {
    const xml =
      '<testcase name="a" file="/x/y.ts"><failure type="TimeoutError" /></testcase>' +
      '<testcase name="b" file="/x/y.ts"><failure type="TimeoutError" /></testcase>' +
      '<testcase name="c" file="/x/y.ts"><failure type="AssertionError" /></testcase>' +
      '<testcase name="d" file="/x/y.ts" />';
    expect(failureBreakdown(parseJunitCases(xml, 'j'))).toEqual({ asserted: 1, timedOut: 2 });
  });

  test('all-green-has-no-breakdown', () => {
    const xml = '<testcase name="d" file="/x/y.ts" />';
    expect(failureBreakdown(parseJunitCases(xml, 'j'))).toEqual({ asserted: 0, timedOut: 0 });
  });
});

// ---------------------------------------------------------------------------
// 跳过的用例 —— **不算跑过**
// ---------------------------------------------------------------------------

describe('junit 解析 —— 跳过的用例不算跑过', () => {
  // 实测产出（`bun test a.test.ts -t "不存在的名字"`，2026-11-05）：
  //   退出码 **1**，而 junit 里每一条都是 `<skipped/>`。
  //
  // 这跟「有东西坏了」长得一模一样（都是退出码 1），
  // 但它其实**什么都没跑** —— 只看退出码就会把
  // 「一条都没跑」当成「验证器扛住了注入」。
  const ALL_SKIPPED =
    '<testcase name="a" file="/x/y.ts" assertions="0"><skipped /></testcase>' +
    '<testcase name="b" file="/x/y.ts" assertions="0"><skipped /></testcase>';

  test('skipped-is-marked', () => {
    const cases = parseJunitCases(ALL_SKIPPED, 'j');
    expect(cases.every((c) => c.skipped)).toBe(true);
  });

  test('skipped-cases-are-not-failures', () => {
    // 跳过的用例**既没失败也没通过** —— 它压根没跑
    const cases = parseJunitCases(ALL_SKIPPED, 'j');
    expect(cases.every((c) => c.failed)).toBe(false);
  });

  test('a-run-case-is-not-skipped', () => {
    const xml =
      '<testcase name="跑了的" file="/x/y.ts" assertions="1" />' +
      '<testcase name="被过滤的" file="/x/y.ts" assertions="0"><skipped /></testcase>';
    const cases = parseJunitCases(xml, 'j');
    expect(cases[0]!.skipped).toBe(false);
    expect(cases[1]!.skipped).toBe(true);
  });
});
