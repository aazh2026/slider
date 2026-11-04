/**
 * 证据落盘位置的缺陷回放测试
 * ---------------------------------------------------------------------------
 * 为什么这个文件存在：
 *
 *   `junit-e2e.xml` 是追溯矩阵**唯一**的 E2E 证据来源。
 *   调试时只跑一条链（`e2e-only.ts auth`），编排脚本却把全量证据覆盖成了
 *   那一条链的结果 —— 于是下一轮追溯矩阵把**所有** E2E 判据判成
 *   INCONCLUSIVE。
 *
 *   判成 INCONCLUSIVE 本身是保守的（"没跑过的验证不是通过"），
 *   但方向反了：**明明跑过**，只是证据被一次调试冲掉了。
 *   更糟的是现场没人会发现 —— 报告看起来"很保守"，不像是被污染过。
 *
 *   这类缺陷和"测试挂了"是两种病：
 *     · 测试挂了会有人来修；
 *     · 证据被静默冲掉，读起来像"这条判据没人管"，**没有人会来查**。
 *
 *   所以这里把当时的现场**原样**重放，钉住编排器不许再退化。
 *
 * ---------------------------------------------------------------------------
 * **为什么断言写在 test 里，不写在 helper 里**：
 *   见 spec/README.md「验证器怎么写」第 1 条 —— 判定逻辑藏进 helper
 *   会导致失败时说不清是哪条判据挂了。
 */

import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';

import { evidenceFileNames, isFullChainRun, readJunitCounts } from './run-e2e.ts';

/**
 * 现场：e2e/ 下现存的链。
 *
 * 这里写死一份列表而不是去读目录 —— 这个测试验的是**命名规则**，
 * 不该因为仓库里多了一条链就跟着变。
 */
const ALL = [
  'auth',
  'errors',
  'exports',
  'library',
  'navigation',
  'offline',
  'presentation',
  'projects',
  'quality',
  'templates',
  'workbench',
  'workbench-editing',
  'workbench-pages',
];

describe('全量 vs 子集', () => {
  test('full-run-is-recognized', () => {
    expect(isFullChainRun(ALL, ALL)).toBe(true);
  });

  test('subset-is-not-a-full-run', () => {
    expect(isFullChainRun(['auth'], ALL)).toBe(false);
  });

  test('same-count-but-different-chain-is-not-a-full-run', () => {
    // 名字对不上、数量对得上 —— 也不能算全量
    expect(isFullChainRun(['auth', 'auth2'], ['auth', 'auth3'])).toBe(false);
  });

  test('empty-is-not-a-full-run', () => {
    expect(isFullChainRun([], ALL)).toBe(false);
  });
});

describe('证据落盘位置 —— 缺陷回放', () => {
  test('full-run-writes-the-canonical-file', () => {
    const names = evidenceFileNames(ALL, ALL);
    expect(names.partial).toBe(false);
    expect(names.junit).toBe('junit-e2e.xml');
    expect(names.output).toBe('junit-e2e-output.txt');
  });

  test('subset-run-does-not-touch-the-canonical-file', () => {
    // **这就是出事的那一步**：只跑一条链，不许覆盖全量证据。
    const names = evidenceFileNames(['auth'], ALL);
    expect(names.partial).toBe(true);
    expect(names.junit).not.toBe('junit-e2e.xml');
    expect(names.output).not.toBe('junit-e2e-output.txt');
  });

  test('partial-file-name-mentions-which-chains', () => {
    const one = evidenceFileNames(['auth'], ALL);
    expect(one.junit).toContain('auth');
    const two = evidenceFileNames(['auth', 'errors'], ALL);
    expect(two.junit).toContain('auth');
    expect(two.junit).toContain('errors');
  });

  test('many-chains-partial-name-stays-short', () => {
    const many = evidenceFileNames(ALL.slice(0, 9), ALL);
    // 九条链拼进文件名太长 —— 用条数代替
    expect(many.junit).toContain('9-chains');
    expect(many.junit.length).toBeLessThan(60);
  });

  test('the-canonical-name-never-appears-in-a-partial-run', () => {
    // 防止将来有人"优化"文件名规则时把全量证据的名字又漏回去
    for (const subset of [['auth'], ['auth', 'errors'], ALL.slice(0, 4)]) {
      const names = evidenceFileNames(subset, ALL);
      expect(names.junit.startsWith('junit-e2e.xml')).toBe(false);
    }
  });
});

describe('证据读不出来 vs 证据里没有用例 —— 缺陷回放', () => {
  const TMP = '/tmp/evidence-target-test';
  mkdirSync(TMP, { recursive: true });

  test('missing-file-is-null-not-zero', () => {
    // **必须区分**：文件不在（读不出来）与文件在但 0 条用例，
    // 是两件不同的事 —— 前者是环境坏了，后者是这一轮白跑了。
    expect(readJunitCounts(`${TMP}/definitely-not-here.xml`)).toBeNull();
  });

  test('empty-evidence-is-zero-not-null', () => {
    // 现场：合并出来的 junit 是 0 条用例，文件是在的。
    const file = `${TMP}/empty.xml`;
    writeFileSync(
      file,
      '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="bun test" tests="0" assertions="0" failures="0" skipped="0" time="0.000000">\n\n</testsuites>\n'
    );
    const counts = readJunitCounts(file);
    expect(counts).not.toBeNull();
    expect(counts!.tests).toBe(0);
    expect(counts!.failures).toBe(0);
  });

  test('a-real-report-counts-its-cases', () => {
    const file = `${TMP}/real.xml`;
    writeFileSync(
      file,
      '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="bun test" tests="5" assertions="18" failures="0" skipped="0" time="2.5">\n</testsuites>\n'
    );
    const counts = readJunitCounts(file);
    expect(counts!.tests).toBe(5);
    expect(counts!.failures).toBe(0);
  });

  test('garbage-file-is-null', () => {
    const file = `${TMP}/garbage.xml`;
    writeFileSync(file, '这不是 xml');
    expect(readJunitCounts(file)).toBeNull();
  });
});
