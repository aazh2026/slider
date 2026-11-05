/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SPEC-GOV-005 领域层零依赖门禁的**可执行判据**
 * ---------------------------------------------------------------------------
 * docs/testing-strategy.md §3 L0 门禁表：
 *   > | 领域层零依赖检查 | 自定义脚本扫描 packages/core 不得 import 模型 SDK / IO | 违规即失败 |
 *
 * 验证目标（spec/spec.yaml）：
 *   scripts/check-domain-deps.check.ts::domain-layer-has-no-unregistered-host-dependency
 *
 * ---------------------------------------------------------------------------
 * **为什么门禁脚本外面还要再包一层测试**
 *
 * 门禁本体在 `scripts/check-domain-deps.ts`。但追溯矩阵的证据只认 junit ——
 * 一个「能跑但没跑过」的脚本在证据链里等于没跑过。
 * 包一层测试，门禁的执行结果就能落进 junit，判据才有可复核的证据。
 *
 * **这个用例断言的是什么**
 *
 * 断言两件事：
 *   ① 真仓库里领域层的宿主依赖，与欠账账本**逐条对得上** ——
 *      没有账本外的新违规、没有超出上限的违规、也没有已经还清却还留在账本里的条目；
 *   ② 判定逻辑本身在几个「容易判错」的地方判对 ——
 *      注释里的 import 不算、字符串里的 document 不算、
 *      **正则字面量里的引号不能把后面的真代码吞掉**。
 *
 * ② 里的最后一条是**漏报**那一侧：正则字面量 `/[\s/\\:*?"<>|]/g` 里带一个引号，
 * 朴素的字符串扫描会从那个引号一直扫到下一个引号，把中间的代码全吞进「字符串」里 ——
 * 于是真正的违规反而被藏起来。漏报比误报危险：误报会被看见，漏报不会。
 *
 * ---------------------------------------------------------------------------
 * **这些用例不依赖整棵树是否健康**
 *
 * 判据执行那一步把仓库里别的用例一起跑，任何一个红都会让整份 junit 变红。
 * 所以这里只测**判定逻辑本身**（用构造出来的源码），
 * 外加一条只读领域层目录的真实扫描 —— 不碰别的模块的行为。
 * 门禁自己坏了，红的是这一条；别的用例坏了，红的是那一条。责任不混。
 */

import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

import {
  compareToLedger,
  matchImportRule,
  scanSource,
  scanTree,
  readLedger,
  type Ledger,
  type Violation,
} from './check-domain-deps';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** 构造一份只含某条违规的账本 */
function ledgerOf(entries: Ledger['entries']): Ledger {
  return { scannedRoot: 'packages/core/src', entries };
}

/** 把违规压成「文件|类别|符号」的集合，便于断言 */
function keysOf(violations: Violation[]): string[] {
  return violations.map((v) => `${v.file}|${v.kind}|${v.symbol}`).sort();
}

describe('SPEC-GOV-005 领域层零依赖', () => {
  test('domain-layer-has-no-unregistered-host-dependency', () => {
    const ledger = readLedger(REPO_ROOT);
    const result = scanTree(REPO_ROOT, ledger);

    expect(
      result.comparison.added,
      '领域层出现了账本里没有的宿主依赖 —— 新债必须先还掉，或者有意识地登记进 spec/domain-deps-baseline.json'
    ).toEqual([]);
    expect(
      result.comparison.exceeded,
      '已登记的欠账在长大 —— 次数超过了账本记的上限'
    ).toEqual([]);
    expect(
      result.comparison.stale,
      '账本里有已经还清的债 —— 必须把对应条目删掉，账本只记「现在还欠着的」'
    ).toEqual([]);

    // 扫描不能是空的 —— 一个文件都没扫到时「没有违规」是没有意义的
    expect(result.filesScanned, '领域层一个源文件都没扫到 —— 无法判定，不等于通过').toBeGreaterThan(0);
  });

  test('domain-deps-comments-and-strings-are-not-violations', () => {
    const source = [
      "// import openai from 'openai';",
      "/* import fs from 'node:fs'; */",
      "const hint = \"请改成 document.createElement('div')\";",
      "const other = 'import jspdf from \\'jspdf\\'';';",
      'export const pure = 1;',
    ].join('\n');

    expect(keysOf(scanSource('fake.ts', source))).toEqual([]);
  });

  test('domain-deps-detects-imports-and-host-globals', () => {
    const source = [
      "import pptxgen from 'pptxgenjs';",
      "import { z } from 'zod';",
      "import { helper } from './helper';",
      "import fs from 'node:fs';",
      "import path from 'node:path';",
      'export function render() {',
      "  const el = document.createElement('div');",
      '  const img = new Image();',
      '  return fetch(url).then((r) => r.text());',
      '}',
    ].join('\n');

    const found = scanSource('fake.ts', source);
    expect(keysOf(found)).toEqual([
      'fake.ts|dom|Image',
      'fake.ts|dom|document',
      'fake.ts|io|pptxgenjs',
      'fake.ts|network|fetch',
      'fake.ts|node-runtime|node:fs',
    ]);
    // 相对路径与纯函数型的 node 内置模块不算依赖
    expect(keysOf(found).some((k) => k.includes('helper'))).toBe(false);
    expect(keysOf(found).some((k) => k.includes('node:path'))).toBe(false);
    expect(keysOf(found).some((k) => k.includes('zod'))).toBe(false);
  });

  test('domain-deps-regex-literal-does-not-hide-later-code', () => {
    // 正则字面量里带一个引号 —— 朴素的字符串扫描会从这里一路吞到下一个引号，
    // 把后面真正的 document.createElement 藏进「字符串」里（漏报）。
    const source = [
      "const bad = /[\\s/\\\\:*?\"<>|]/g;",
      "const el = document.createElement('div');",
    ].join('\n');

    expect(keysOf(scanSource('fake.ts', source))).toEqual(['fake.ts|dom|document']);
  });

  test('domain-deps-shadowed-name-is-not-a-host-global', () => {
    const source = [
      'export function f(document: unknown) {',
      '  return document;',
      '}',
      'const g = (window: unknown) => window;',
    ].join('\n');

    // 参数名叫 document —— 是局部绑定，不是宿主全局
    expect(keysOf(scanSource('fake.ts', source))).toEqual([]);
  });

  test('domain-deps-ledger-ratchet-fails-in-both-directions', () => {
    const violation = (symbol: string, count: number): Violation => ({
      file: 'a.ts',
      kind: 'io',
      symbol,
      count,
      lines: [1],
    });

    // ① 账本外的新违规 → 失败
    const added = compareToLedger([violation('pptxgenjs', 1)], ledgerOf([]));
    expect(added.passed).toBe(false);
    expect(added.added.map((v) => v.symbol)).toEqual(['pptxgenjs']);

    // ② 超出上限 → 失败
    const exceeded = compareToLedger(
      [violation('document', 3)],
      ledgerOf([{ file: 'a.ts', kind: 'io', symbol: 'document', maxCount: 2 }])
    );
    expect(exceeded.passed).toBe(false);
    expect(exceeded.exceeded).toHaveLength(1);

    // ③ 次数没超上限 → 通过
    const within = compareToLedger(
      [violation('document', 2)],
      ledgerOf([{ file: 'a.ts', kind: 'io', symbol: 'document', maxCount: 2 }])
    );
    expect(within.passed).toBe(true);

    // ④ 账本里有、现在没有的 → 失败（债还清了，必须删条目）
    const stale = compareToLedger(
      [],
      ledgerOf([{ file: 'a.ts', kind: 'io', symbol: 'document', maxCount: 2 }])
    );
    expect(stale.passed).toBe(false);
    expect(stale.stale).toHaveLength(1);
  });

  test('domain-deps-import-rule-table', () => {
    expect(matchImportRule('pptxgenjs')?.kind).toBe('io');
    expect(matchImportRule('node:fs')?.kind).toBe('node-runtime');
    expect(matchImportRule('@anthropic-ai/sdk')?.kind).toBe('model-sdk');
    expect(matchImportRule('axios')?.kind).toBe('network');
    expect(matchImportRule('jsdom')?.kind).toBe('dom');
    // 纯函数型的 node 内置模块放行
    expect(matchImportRule('node:path')).toBeNull();
    // 相对路径不是依赖
    expect(matchImportRule('./engine/svgRenderer')).toBeNull();
    expect(matchImportRule('@ppt/core')).toBeNull();
  });
});
