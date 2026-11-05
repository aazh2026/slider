/**
 * 「怎么找数据依赖」的规则 —— 主证据侧与注入侧**共用**这一份。
 * ---------------------------------------------------------------------------
 * 缺陷回放（实测 2026-11-05）：改了**一个**黄金快照基线之后，
 *   · 主证据侧（§2.1.1，`verdictFreshness.ts`）判 **stale** —— 它看得见数据依赖；
 *   · 注入侧（§2.4.1，`evidenceFreshness.ts`）判 **fresh** —— 它只比代码，看不见数据。
 *
 * 同一个改动，两个地方说两套话。而 `AC-GOV-002` 那条注入用例
 * **正是靠那 64 个基线抓住错误的** —— 基线被动过之后，
 * 「验证器抓得住这个错」可能已经不成立，注入侧却说「仍然成立」。
 *
 * 根因之一是「怎么找数据依赖」这件事**有两份实现** ——
 * 规则一旦分叉，两边就会各自漂走。所以规则住在 `dataDeps.ts`，
 * 这一组把它钉住：两边都必须从这里取。
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  dataDepsOf,
  dataDepsOfFile,
  expandDataDeps,
  listFilesUnder,
  parseDataDeps,
} from './dataDeps';

describe('数据依赖的声明 —— 解析', () => {
  test('行首注释里的声明能被认出来', () => {
    expect(parseDataDeps('// @verdict-deps: packages/core/tests/__snapshots__\n')).toEqual([
      'packages/core/tests/__snapshots__',
    ]);
  });

  test('块注释里的声明也能认出来', () => {
    expect(parseDataDeps(' * @verdict-deps: a/b.json\n')).toEqual(['a/b.json']);
  });

  test('一行可以写多个（逗号分隔）', () => {
    expect(parseDataDeps('// @verdict-deps: a/b.json, c/d.json\n')).toEqual([
      'a/b.json',
      'c/d.json',
    ]);
  });

  test('行尾挂着块注释的收尾符号也不影响', () => {
    expect(parseDataDeps(' * @verdict-deps: a/b.json */\n')).toEqual(['a/b.json']);
  });

  test('普通代码里提到这个字符串不算声明', () => {
    expect(parseDataDeps("import { x } from './helpers';\n")).toEqual([]);
    expect(parseDataDeps('const s = "@verdict-deps: x";\n')).toEqual([]);
  });
});

describe('数据依赖的声明 —— 展开', () => {
  test('目录展开成其下所有文件', () => {
    const out = expandDataDeps(
      ['dir'],
      () => true,
      (rel) => (rel === 'dir' ? ['dir/a.json', 'dir/b.json'] : [])
    );
    expect(out).toEqual(['dir/a.json', 'dir/b.json']);
  });

  test('文件就是它自己', () => {
    const out = expandDataDeps(['a/b.json'], () => true, () => []);
    expect(out).toEqual(['a/b.json']);
  });

  test('声明了、但树里没有 → 原样带出去（说清「声明了、但找不到」）', () => {
    const out = expandDataDeps(['missing/dir'], () => false, () => []);
    expect(out).toEqual(['missing/dir']);
  });
});

describe('数据依赖 —— 连 IO 的那一半', () => {
  test('读一个声明了数据依赖的验证器', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datadeps-'));
    try {
      mkdirSync(join(dir, 'snapshots'), { recursive: true });
      writeFileSync(join(dir, 'snapshots/a.json'), '{}', 'utf-8');
      writeFileSync(join(dir, 'snapshots/b.json'), '{}', 'utf-8');
      writeFileSync(
        join(dir, 'v.test.ts'),
        '// @verdict-deps: snapshots\nimport { x } from "./x";\n',
        'utf-8'
      );

      const deps = dataDepsOfFile(dir, 'v.test.ts');
      expect(deps.declared).toEqual(['snapshots']);
      expect(deps.files).toEqual(['snapshots/a.json', 'snapshots/b.json']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('没声明数据依赖的验证器 → 空', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datadeps-'));
    try {
      writeFileSync(join(dir, 'v.test.ts'), "import { x } from './x';\n", 'utf-8');
      const deps = dataDepsOfFile(dir, 'v.test.ts');
      expect(deps.declared).toEqual([]);
      expect(deps.files).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('验证器文件读不到 → 空（读不到是另一回事，由调用方自己判）', () => {
    const deps = dataDepsOfFile('/tmp', 'does-not-exist.test.ts');
    expect(deps.declared).toEqual([]);
    expect(deps.files).toEqual([]);
  });

  test('目录列举是递归的', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datadeps-'));
    try {
      mkdirSync(join(dir, 'a/b'), { recursive: true });
      writeFileSync(join(dir, 'a/x.json'), '{}', 'utf-8');
      writeFileSync(join(dir, 'a/b/y.json'), '{}', 'utf-8');
      expect(listFilesUnder(dir, 'a')).toEqual(['a/b/y.json', 'a/x.json']);
      expect(listFilesUnder(dir, 'nope')).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('纯逻辑那一半：注入读函数就能用', () => {
    const deps = dataDepsOf(
      'v.test.ts',
      (rel) => (rel === 'v.test.ts' ? '// @verdict-deps: d\n' : null),
      (rel) => rel === 'd',
      () => ['d/one.json']
    );
    expect(deps.declared).toEqual(['d']);
    expect(deps.files).toEqual(['d/one.json']);
  });
});
