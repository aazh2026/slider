/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SPEC-GOV-001 覆盖率门禁的**可执行判据**
 * ---------------------------------------------------------------------------
 * docs/testing-strategy.md §8 质量门禁指标：
 *   > | 领域层行覆盖率 | ≥ 90% | `bun test --coverage` | 阻断 |
 *
 * 验证目标（spec/spec.yaml）：
 *   scripts/check-coverage.check.ts::domain-coverage-threshold
 *
 * ---------------------------------------------------------------------------
 * **为什么门禁脚本外面还要再包一层测试**
 *
 * 门禁本体在 `scripts/check-coverage.ts`（它自己会跑一遍带覆盖率的测试并
 * 按目录聚合）。但追溯矩阵的证据只认 junit —— 一个"能跑但没跑过"的脚本
 * 在证据链里等于没跑过。包一层测试，门禁的执行结果就能落进 junit，
 * 判据才有可复核的证据，而不是一句"我跑过了"。
 *
 * **为什么默认 `bun test` 不会跑到这个文件**
 *
 * 文件名后缀是 `.check.ts` —— Bun 的默认测试匹配只认
 * `*.test.* / *_test.* / *.spec.* / *_spec.*`。所以：
 *   - 日常 `bun test` 不会因为它多花 30 秒（门禁要重跑一遍全套测试）
 *   - 但显式指定路径时照跑不误（`bun test scripts/check-coverage.check.ts`）
 * 这不是躲懒 —— 是把"慢的门禁"和"快的回归集"分开，让两者都能被明确地执行。
 *
 * **这个用例断言的是什么**
 *
 * 断言门禁脚本的**退出码为 0**。门禁自己会因为以下情况返回非 0：
 *   - 领域内核目录一个文件都没采到（无法判定 ≠ 通过）
 *   - 聚合行覆盖率 < 90%
 *   - 被统计的测试本身没跑过（覆盖率不予判定）
 * 所以"退出码 0"等价于"判据成立"，而不是"脚本跑完了"。
 */

import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main } from './check-coverage';

describe('SPEC-GOV-001 领域内核行覆盖率门槛', () => {
  test(
    'domain-coverage-threshold',
    async () => {
      // 1) 真仓库：覆盖率必须达标
      const exitCode = await main();
      expect(
        exitCode,
        '覆盖率门禁未通过 —— 领域内核（packages/core/src/engine）行覆盖率必须 ≥ 90%'
      ).toBe(0);

      // 2) 一个领域内核文件都没采到 → 必须判为**未通过**
      //
      //    这一段以前没有验证器覆盖 —— 判据原文写着"断言一个领域内核文件
      //    都没采到时按未通过处理"，但没有任何用例真的去构造那个场景。
      //    判据写了的、验证器没验的，等于没写。
      //    空集合的覆盖率在数学上无定义，门禁必须拒绝"无法判定"。
      const dir = await mkdtemp(join(tmpdir(), 'ppt-empty-lcov-'));
      try {
        const lcovPath = join(dir, 'lcov.info');
        await writeFile(
          lcovPath,
          // 一条与领域内核无关的记录 —— 采到的文件数为 0
          'SF:somewhere/else.ts\nDA:1,1\nLF:1\nLH:1\nend_of_record\n',
          'utf-8'
        );
        const emptyExitCode = await main({ lcov: lcovPath, baseDir: dir, writeEvidence: false });
        expect(
          emptyExitCode,
          '一个领域内核文件都没采到时，门禁必须判为未通过（无法判定 ≠ 通过）'
        ).not.toBe(0);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    // 门禁内部会重跑一遍全套测试（带覆盖率插桩），慢是正常的
    { timeout: 10 * 60 * 1000 }
  );
});
