/**
 * Spec 验证入口 —— 一条命令跑完整条链路
 * ---------------------------------------------------------------------------
 * 顺序是刻意的：
 *   1. 结构校验（Spec 本身合不合法）
 *   2. 类型检查（验证器代码本身能不能跑）
 *   3. 判据执行（实现满不满足判据）
 *   4. 注入错误检查（验证器抓不抓得住错）
 *   5. 生成追溯矩阵
 *
 * 反过来跑会分不清「实现的锅」还是「验证器的锅」——
 * 所以先确认 Spec 与验证器本身站得住，再去评判实现。
 *
 * 运行：
 *     bun run spec/verify/all.ts
 *
 * 退出码：0 = 全链路通过；1 = 有环节失败（具体哪一环看输出）。
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startServers } from './servers';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const EVIDENCE_DIR = resolve(ROOT, 'spec/evidence');

interface Step {
  name: string;
  /** 命令式步骤 —— 直接跑 */
  cmd?: string[];
  /** 需要自己编排的步骤（例如要拉起服务的 E2E） */
  run?: () => Promise<number>;
  /** 失败是否可接受 —— 实现缺陷导致的测试失败不算「工具链坏了」 */
  tolerateFailure: boolean;
}

const STEPS: Step[] = [
  {
    name: 'Spec 结构校验（JSON Schema 2020-12）',
    cmd: ['python3', 'spec/verify/spec-schema.py'],
    tolerateFailure: false,
  },
  {
    name: '类型检查（验证器代码自身）',
    cmd: ['npx', 'tsc', '--noEmit'],
    tolerateFailure: false,
  },
  {
    // 证据集 = 判据真正被执行到的全部测试。
    //
    // 两个文件必须用 `./` 路径形式点名（*.bench.ts / *.check.ts 不匹配 Bun 的
    // 默认测试规则，不带前缀会被当成**过滤器**，一个用例都跑不到）：
    //   · ./scripts/check-coverage.check.ts            —— SPEC-GOV-001 覆盖率门禁
    //   · ./apps/api/tests/perf/export-latency.bench.ts —— SPEC-NFR-002 导出延迟
    //
    // **大纲延迟基准刻意不在这里**（./apps/api/tests/perf/outline-latency.bench.ts）：
    // 它依赖真实模型，本轮只跑了降级模式 —— 降级模式下的通过**不构成**
    // AC-NFR-001 的通过证据。把它混进证据集会让追溯矩阵给出一条站不住的 PASS。
    // 该条的结论保持 INCONCLUSIVE，理由见 spec/spec.yaml 的 known_gaps。
    name: '判据执行（spec/verify + packages/core + apps/api + 前端 + 覆盖率门禁 + 导出基准）',
    cmd: [
      'bun',
      'test',
      'spec/verify/',
      'packages/core/tests/',
      'apps/api/tests/',
      './src/',
      './scripts/check-coverage.check.ts',
      './apps/api/tests/perf/export-latency.bench.ts',
    ],
    tolerateFailure: true,
  },
  {
    // 前后端集成 E2E —— 真实浏览器 + 真实服务端。
    //
    // 这一步要自己拉起服务（spec/verify/servers.ts），所以走 run 而不是 cmd。
    // 产出单独的 junit-e2e.xml，追溯矩阵会把两份证据合起来读 ——
    //   · 单元/集成集 → junit.xml
    //   · 浏览器 E2E   → junit-e2e.xml
    // 合成一份会让"这是哪一层的证据"变得不可辨，分开反而更诚实。
    name: '前后端集成 E2E（真实浏览器 + 真实服务端）',
    run: runE2e,
    tolerateFailure: true,
  },
  {
    name: '注入错误检查（验证器的元验证）',
    cmd: ['bun', 'run', 'spec/verify/mutation-check.ts'],
    tolerateFailure: false,
  },
  {
    name: '生成追溯矩阵',
    cmd: ['bun', 'run', 'spec/verify/traceability.ts'],
    tolerateFailure: false,
  },
];

/**
 * 拉起后端 + 前端，跑 E2E，产出 junit-e2e.xml
 *
 * 服务没起来时**明确失败** —— 静默跳过等于把"没验证"说成"验证通过"。
 */
async function runE2e(): Promise<number> {
  const handle = await startServers();
  console.log(`  后端：${handle.apiBase}　前端：${handle.webBase}`);
  try {
    const proc = Bun.spawn(
      [
        'bun',
        'test',
        './e2e/integration.e2e.ts',
        '--reporter=junit',
        `--reporter-outfile=${join(EVIDENCE_DIR, 'junit-e2e.xml')}`,
      ],
      {
        cwd: ROOT,
        stdout: 'inherit',
        stderr: 'inherit',
        env: { ...process.env, ...handle.env },
      }
    );
    return await proc.exited;
  } finally {
    await handle.stop();
  }
}

async function main(): Promise<number> {
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  const results: Array<{ name: string; code: number; ok: boolean; tolerated: boolean }> = [];

  for (const step of STEPS) {
    console.log(`\n${'='.repeat(72)}\n▶ ${step.name}\n${'='.repeat(72)}`);

    let code: number;
    if (step.run) {
      try {
        code = await step.run();
      } catch (err) {
        console.error(`  步骤自身出错：${err instanceof Error ? err.message : String(err)}`);
        code = 1;
      }
    } else {
      const cmd = step.cmd!;
      // 判据执行这一步要额外产出 junit 证据，供追溯矩阵消费
      const args =
        cmd[0] === 'bun' && cmd[1] === 'test'
          ? [...cmd, '--reporter=junit', `--reporter-outfile=${join(EVIDENCE_DIR, 'junit.xml')}`]
          : cmd;

      const proc = spawnSync(args[0]!, args.slice(1), {
        cwd: ROOT,
        stdio: 'inherit',
        env: process.env,
      });
      code = proc.status ?? 1;
    }

    const ok = code === 0;
    results.push({
      name: step.name,
      code,
      ok,
      tolerated: !ok && step.tolerateFailure,
    });
  }

  console.log(`\n${'='.repeat(72)}\n汇总\n${'='.repeat(72)}`);
  for (const r of results) {
    const tag = r.ok ? '✅ 通过' : r.tolerated ? '⚠️  失败（预期内：实现不满足判据）' : '❌ 失败';
    console.log(`${tag}  ${r.name}${r.ok ? '' : `  (exit ${r.code})`}`);
  }

  const hardFailures = results.filter((r) => !r.ok && !r.tolerated);
  if (hardFailures.length > 0) {
    console.log(
      `\n❌ ${hardFailures.length} 个环节失败：${hardFailures.map((r) => r.name).join('；')}`
    );
    console.log('   追溯矩阵已更新 —— 见 spec/traceability.md 的「失败明细」与「证据不足的结论」。');
    return 1;
  }

  const tolerated = results.filter((r) => r.tolerated);
  if (tolerated.length > 0) {
    console.log(
      `\n✅ 工具链全绿。判据执行中有 ${tolerated.length} 处失败 —— 那是**实现不满足判据**，不是工具坏了。`
    );
    console.log('   逐条根因见 spec/traceability.md §2.2。');
  } else {
    console.log('\n✅ 全链路通过。');
  }
  return 0;
}

process.exit(await main());
