/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SPEC-GOV-002 —— 64 组黄金快照必须逐字节一致
 * ---------------------------------------------------------------------------
 * docs/testing-strategy.md §1.2（Definition of Done）：
 *   > □ 黄金快照全部一致（64 组：8 版式 × 8 主题）
 *
 * 验证目标（spec/spec.yaml）：packages/core/tests/layoutEngine.snapshot.test.ts
 *
 * **快照基线是「独立 Oracle」的替代品** —— 它把当前实现某一时刻的输出固化下来，
 * 之后任何对版式引擎的改动都必须被显式承认。因此：
 *   - 基线文件在 `__snapshots__/` 下，随代码一起提交
 *   - 刷新基线必须人工显式执行 `bun scripts/gen-layout-snapshots.ts --force`
 *   - 序列化前剥离 versionId / lastModified（否则每次运行都不一样）
 */

import { describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ALL_COMBOS, makeSnapshot, serializeSnapshot } from './fixtures';

const SNAPSHOT_DIR = join(import.meta.dir, '__snapshots__');

describe('SPEC-GOV-002 黄金快照门禁', () => {
  // 64 组快照全部存在且全部匹配
  test('golden-snapshots-all-match', async () => {
    expect(ALL_COMBOS.length).toBe(64);

    const files = (await readdir(SNAPSHOT_DIR)).filter((f) => f.endsWith('.json'));
    expect(files.length).toBe(64);

    const mismatches: string[] = [];

    for (const { layout, themeId, theme } of ALL_COMBOS) {
      const name = `${layout}__${themeId}.json`;
      const path = join(SNAPSHOT_DIR, name);

      let golden: string;
      try {
        golden = await readFile(path, 'utf8');
      } catch {
        mismatches.push(`${name}: 快照文件不存在`);
        continue;
      }

      const actual = serializeSnapshot(makeSnapshot(layout, theme));

      // 逐字节一致（docs/testing-strategy.md §1.2 的原话）
      if (actual !== golden) {
        mismatches.push(`${name}: 内容不一致`);
        continue;
      }

      // 结构化再比一次 —— 字节一致已经蕴含结构一致，这一步只为让失败信息可读
      expect(JSON.parse(actual)).toEqual(JSON.parse(golden));
    }

    expect(mismatches).toEqual([]);
  });

  test('快照不含 versionId / lastModified', async () => {
    const files = (await readdir(SNAPSHOT_DIR)).filter((f) => f.endsWith('.json'));
    expect(files.length).toBe(64);

    for (const file of files) {
      const raw = await readFile(join(SNAPSHOT_DIR, file), 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      expect(parsed).not.toHaveProperty('versionId');
      expect(parsed).not.toHaveProperty('lastModified');
    }
  });

  test('版式引擎是纯函数 —— 同输入必得同输出', () => {
    for (const { layout, theme } of ALL_COMBOS.slice(0, 8)) {
      const a = serializeSnapshot(makeSnapshot(layout, theme));
      const b = serializeSnapshot(makeSnapshot(layout, theme));
      expect(a).toBe(b);
    }
  });
});
