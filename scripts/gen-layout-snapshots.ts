/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 生成黄金快照基线（8 版式 × 8 主题 = 64 组）
 * ---------------------------------------------------------------------------
 * docs/testing-strategy.md §1.2「Definition of Done」要求：
 *   > □ 黄金快照全部一致（64 组：8 版式 × 8 主题）
 *
 * **这是一次性基线生成器，不是测试。**
 * 正常使用方式是：跑测试 → 失败 → 人工确认改动是有意的 → 再跑本脚本刷新基线。
 * 因此脚本会先把新旧差异打到 stdout，要求显式传 `--force` 才会覆盖已有基线。
 *
 *   bun scripts/gen-layout-snapshots.ts --force
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ALL_COMBOS, makeSnapshot, serializeSnapshot } from '../packages/core/tests/fixtures';

const SNAPSHOT_DIR = join(import.meta.dir, '..', 'packages', 'core', 'tests', '__snapshots__');

function fileName(layout: string, themeId: string): string {
  return `${layout}__${themeId}.json`;
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  await mkdir(SNAPSHOT_DIR, { recursive: true });

  const changed: string[] = [];

  for (const { layout, themeId, theme } of ALL_COMBOS) {
    const name = fileName(layout, themeId);
    const path = join(SNAPSHOT_DIR, name);
    const next = serializeSnapshot(makeSnapshot(layout, theme));

    let previous: string | undefined;
    try {
      previous = await readFile(path, 'utf8');
    } catch {
      previous = undefined;
    }

    if (previous === next) continue;

    if (previous !== undefined && !force) {
      changed.push(name);
      continue;
    }

    await writeFile(path, next, 'utf8');
    if (previous !== undefined) changed.push(name);
  }

  if (changed.length > 0 && !force) {
    console.error('以下快照与当前实现不一致（未覆盖）：');
    for (const name of changed) console.error(`  - ${name}`);
    console.error('\n确认改动是有意的之后，重跑：bun scripts/gen-layout-snapshots.ts --force');
    process.exit(1);
  }

  const files = (await readdir(SNAPSHOT_DIR)).filter((f) => f.endsWith('.json'));
  console.log(`黄金快照：${files.length} 组，目录 ${SNAPSHOT_DIR}`);
  if (changed.length > 0) {
    console.log(`已刷新 ${changed.length} 组：`);
    for (const name of changed) console.log(`  - ${name}`);
  }
}

await main();
