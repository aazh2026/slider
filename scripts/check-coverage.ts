#!/usr/bin/env bun
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SPEC-AC-GOV-001 —— 领域内核行覆盖率门槛
 * ---------------------------------------------------------------------------
 * docs/testing-strategy.md §8 质量门禁指标：
 *   > | 领域层行覆盖率 | ≥ 90% | `bun test --coverage` | 阻断 |
 *
 * 验证目标（spec/spec.yaml）：scripts/check-coverage.ts::domain-coverage-threshold
 *   判据：AC-GOV-001 ——「运行 bun test --coverage --coverage-reporter=text，
 *   断言领域内核目录（src/engine/）的行覆盖率 ≥ 90」
 *
 * ---------------------------------------------------------------------------
 * **为什么用 lcov 而不是 text 表格**
 *
 * 判据要的是"领域内核目录的行覆盖率 ≥ 90" —— 这是**目录级聚合值**。
 * Bun 的 text 报告只给每个文件的百分比，不给分子分母，
 * 于是"目录聚合"要么靠加权估算（各文件行数权重未知，结果不可复现），
 * 要么退化成"所有文件都 ≥ 90"（比判据更严，但换了判据）。
 *
 * lcov 报告给出标准的 `LF:`（可执行行总数）与 `LH:`（被命中行数），
 * 聚合就是 `ΣLH / ΣLF` —— 精确、可复现、和 text 报告同源同一次运行。
 *
 * 门槛是**写死的 90**，没有环境变量可以调低 —— 门禁能被人关掉就不叫门禁。
 *
 * ---------------------------------------------------------------------------
 * **"没测到" ≠ "测到了"**
 *
 * 如果覆盖率报告里**一个**领域内核文件都没有（例如测试路径写错了、
 * 或者引擎被改名），脚本必须**失败**而不是通过。
 * 空集合的覆盖率在数学上无定义，脚本把它当作"无法判定"处理。
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path';

/** 门槛 —— 写死，不可用环境变量调低 */
const THRESHOLD = 90;

/** 领域内核目录（相对仓库根） */
const CORE_ENGINE_DIR = 'packages/core/src/engine';

/** 参与覆盖率统计的测试根目录 */
const TEST_ROOTS = ['spec/verify', 'packages/core/tests', 'apps/api/tests'];

/** 覆盖率证据落盘位置 —— 让这个数字成为可复核的产物，而不是报告里手打的一行字 */
const COVERAGE_EVIDENCE_PATH = 'spec/evidence/coverage.json';

interface FileCoverage {
  /** 相对仓库根的路径 */
  file: string;
  /** 可执行行数（LF） */
  found: number;
  /** 被命中行数（LH） */
  hit: number;
}

/** 解析 lcov.info */
export function parseLcov(content: string, baseDir: string): FileCoverage[] {
  const files: FileCoverage[] = [];
  let current: FileCoverage | null = null;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('SF:')) {
      const raw = line.slice(3);
      // lcov 的 `SF:` 路径相对于**运行测试时的工作目录**（不是报告目录）。
      // 还原成绝对路径后再换算成仓库相对路径。
      const absolute = isAbsolute(raw) ? raw : resolve(baseDir, raw);
      current = {
        file: toRepoRelative(absolute),
        found: 0,
        hit: 0,
      };
      files.push(current);
      continue;
    }
    if (line.startsWith('LF:')) {
      if (current) current.found = Number(line.slice(3)) || 0;
      continue;
    }
    if (line.startsWith('LH:')) {
      if (current) current.hit = Number(line.slice(3)) || 0;
      continue;
    }
    if (line === 'end_of_record') {
      current = null;
    }
  }

  return files;
}

/** 把绝对路径转成相对仓库根的路径 */
function toRepoRelative(absolute: string): string {
  const repoRoot = resolve(import.meta.dir, '..');
  const rel = normalize(absolute).slice(repoRoot.length + 1);
  return rel.split(sep).join('/');
}

/** 取领域内核目录下���文件 */
export function selectCoreEngine(files: FileCoverage[]): FileCoverage[] {
  const prefix = `${CORE_ENGINE_DIR}/`;
  return files.filter((f) => f.file.startsWith(prefix));
}

/** 聚合行覆盖率 */
export function aggregate(files: FileCoverage[]): { found: number; hit: number; percent: number } {
  const found = files.reduce((a, f) => a + f.found, 0);
  const hit = files.reduce((a, f) => a + f.hit, 0);
  return { found, hit, percent: found === 0 ? 0 : (hit / found) * 100 };
}

interface Options {
  /** 直接读取已有的 lcov.info，不跑测试 */
  lcov?: string;
  /** lcov 报告所在目录（用于还原 SF 相对路径） */
  baseDir?: string;
  /**
   * 是否把结果写进 `spec/evidence/coverage.json`。
   *
   * 默认**只有本次自己跑的、真仓库的测量才写** ——
   * 拿外部 lcov 做反例验证时（"一个领域内核文件都没采到 → 必须判未通过"）
   * 如果也写，合成出来的 0/0 会把真证据覆盖掉，
   * 追溯矩阵读到的就成了"0.00% ≥ 90%" —— 一个比没有证据更糟的证据。
   */
  writeEvidence?: boolean;
}

/** 覆盖率证据文件的结构 */
interface CoverageEvidence {
  directory: string;
  threshold: number;
  found: number;
  hit: number;
  percent: number;
  passed: boolean;
  files: Array<{ file: string; found: number; hit: number; percent: number }>;
}

/** 把覆盖率结果写成 spec/evidence/coverage.json */
async function writeCoverageEvidence(repoRoot: string, data: CoverageEvidence): Promise<void> {
  const path = join(repoRoot, COVERAGE_EVIDENCE_PATH);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
  console.log(`[coverage] 证据已写入：${COVERAGE_EVIDENCE_PATH}`);
}

export async function main(opts: Options = {}): Promise<number> {
  const repoRoot = resolve(import.meta.dir, '..');
  let lcovPath = opts.lcov;
  // lcov 的 `SF:` 路径相对于运行测试时的工作目录
  let baseDir = opts.baseDir ?? repoRoot;
  let coverageDir: string | undefined;

  if (!lcovPath) {
    coverageDir = await mkdtemp(join(tmpdir(), 'ppt-coverage-'));

    console.log(`[coverage] 运行测试并采集覆盖率：${TEST_ROOTS.join(' ')}`);
    const proc = Bun.spawn(
      [
        'bun',
        'test',
        '--coverage',
        '--coverage-reporter=lcov',
        `--coverage-dir=${coverageDir}`,
        ...TEST_ROOTS,
      ],
      { cwd: repoRoot, stdout: 'pipe', stderr: 'pipe' }
    );

    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    // 测试没过就没必要谈覆盖率 —— 但要说清楚是测试没过，不是覆盖率不达标
    if (exitCode !== 0) {
      console.error(stdout);
      console.error(stderr);
      console.error('[coverage] ✗ 测试未全部通过，覆盖率门禁不予判定（退出码非 0）');
      await rm(coverageDir, { recursive: true, force: true });
      return 1;
    }

    lcovPath = join(coverageDir, 'lcov.info');
  }

  let content: string;
  try {
    content = await readFile(lcovPath, 'utf-8');
  } catch (err) {
    console.error(`[coverage] ✗ 读不到覆盖率报告 ${lcovPath}：${String(err)}`);
    if (coverageDir) await rm(coverageDir, { recursive: true, force: true });
    return 1;
  }

  const all = parseLcov(content, baseDir);
  const core = selectCoreEngine(all);
  const agg = aggregate(core);

  // 覆盖率数字落盘 —— 追溯矩阵引用的是这个产物，不是报告里手打的字。
  // 手打的数字会随代码变动悄悄过期，而过期的事实比没有事实更危险。
  //
  // 反例验证（外部 lcov）不落盘 —— 见 Options.writeEvidence 的说明。
  const writeEvidence = opts.writeEvidence ?? opts.lcov === undefined;
  if (writeEvidence) {
    await writeCoverageEvidence(repoRoot, {
      directory: CORE_ENGINE_DIR,
      threshold: THRESHOLD,
      found: agg.found,
      hit: agg.hit,
      percent: Number(agg.percent.toFixed(2)),
      passed: core.length > 0 && agg.percent >= THRESHOLD,
      files: core.map((f) => ({
        file: f.file,
        found: f.found,
        hit: f.hit,
        percent: Number((f.found === 0 ? 0 : (f.hit / f.found) * 100).toFixed(2)),
      })),
    });
  }

  console.log('');
  console.log(`[coverage] 领域内核目录：${CORE_ENGINE_DIR}`);
  console.log(
    `[coverage] ${'文件'.padEnd(34)}${'行数'.padStart(8)}${'命中'.padStart(8)}${'覆盖率'.padStart(10)}`
  );
  console.log(`[coverage] ${'-'.repeat(60)}`);
  for (const f of core.sort((a, b) => a.file.localeCompare(b.file))) {
    const pct = f.found === 0 ? 0 : (f.hit / f.found) * 100;
    console.log(
      `[coverage] ${f.file.padEnd(34)}${String(f.found).padStart(8)}${String(f.hit).padStart(8)}${`${pct.toFixed(2)}%`.padStart(10)}`
    );
  }
  console.log(`[coverage] ${'-'.repeat(60)}`);
  console.log(
    `[coverage] ${'合计'.padEnd(34)}${String(agg.found).padStart(8)}${String(agg.hit).padStart(8)}${`${agg.percent.toFixed(2)}%`.padStart(10)}`
  );
  console.log('');

  if (coverageDir) await rm(coverageDir, { recursive: true, force: true });

  // 一个引擎文件都没采到 —— 无法判定，不能当通过
  if (core.length === 0) {
    console.error(
      `[coverage] ✗ 覆盖率报告里没有任何 ${CORE_ENGINE_DIR}/ 下的文件 —— 无法判定覆盖率，按未通过处理`
    );
    console.error(`[coverage]   （采到的文件共 ${all.length} 个，示例：${all.slice(0, 5).map((f) => f.file).join(', ') || '无'}）`);
    return 1;
  }

  if (agg.percent < THRESHOLD) {
    console.error(
      `[coverage] ✗ 领域内核行覆盖率 ${agg.percent.toFixed(2)}% < ${THRESHOLD}% —— 阻断`
    );
    return 1;
  }

  console.log(`[coverage] ✓ 领域内核行覆盖率 ${agg.percent.toFixed(2)}% ≥ ${THRESHOLD}%`);
  return 0;
}

// 直接执行时跑 main；被 import 时不自动跑
if (import.meta.main) {
  const args = process.argv.slice(2);
  const lcovIdx = args.indexOf('--lcov');
  const lcov = lcovIdx >= 0 ? args[lcovIdx + 1] : undefined;
  const baseIdx = args.indexOf('--base-dir');
  const baseDir = baseIdx >= 0 ? args[baseIdx + 1] : undefined;

  const code = await main({ lcov, baseDir });
  process.exit(code);
}
