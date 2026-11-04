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

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startServers } from './servers';
import { discoverChains, runE2eChains } from './run-e2e';

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
  /**
   * 这一步的 stderr 落盘到哪儿（相对 spec/evidence/）。
   *
   * **为什么要单独存 stderr**：
   *
   * Bun 的 junit reporter 在 `<failure>` 里**只写 type，一个字的信息都不写** ——
   * 实测 `expect(1, '自定义消息').toBe(0)` 失败时产出的就是
   * `<failure type="AssertionError" />`。
   *
   * 而 Bun 在 junit 模式下**仍然把失败详情打到 stderr**
   * （源码片段、错误信息、期望值与实际值、调用栈）。
   * 于是 stderr 就是那份"到底为什么失败"的诊断材料 ——
   * 不存下来，失败原因就随着终端滚动消失了，
   * 事后只剩一句"某某用例失败"，连根因的方向都没有。
   */
  stderrFile?: string;
}

const STEPS: Step[] = [
  {
    name: 'Spec 结构校验（JSON Schema 2020-12）',
    cmd: ['python3', 'spec/verify/spec-schema.py'],
    tolerateFailure: false,
    stderrFile: 'step-schema.txt',
  },
  {
    name: '类型检查（验证器代码自身）',
    cmd: ['npx', 'tsc', '--noEmit'],
    tolerateFailure: false,
    stderrFile: 'step-typecheck.txt',
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
    stderrFile: 'junit-output.txt',
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
    stderrFile: 'step-mutation.txt',
  },
  {
    name: '生成追溯矩阵',
    cmd: ['bun', 'run', 'spec/verify/traceability.ts'],
    tolerateFailure: false,
    stderrFile: 'step-traceability.txt',
  },
];

/**
 * 跑一个命令式步骤，并把 stderr 落盘。
 *
 * **为什么用异步 spawn 而不是 spawnSync**：
 * spawnSync 会把父进程的事件循环堵死。父进程里有一件必须一直跑的活 ——
 * E2E 那一步要从后端/前端子进程的 stdout 里持续抽走日志
 * （servers.ts 的 collect()）。管道缓冲区有限（macOS 上约 64KB），
 * 父进程一堵死，抽日志就停了，后端写日志写满管道 → **后端自己被写日志卡住** →
 * HTTP 响应发不出去 → 页面等一个永远不会来的响应。
 *
 * 这是一条与浏览器无关的挂死路径，症状和 E2E 那条一模一样。
 * 用异步 spawn 把它从根上排掉。
 */
async function runCmd(cmd: string[], stderrFile?: string): Promise<number> {
  const proc = spawn(cmd[0]!, cmd.slice(1), {
    cwd: ROOT,
    // stdout 直接继承（应用的日志照常流式打屏），
    // stderr 接出来 —— 见 Step.stderrFile 的说明
    stdio: ['inherit', 'inherit', 'pipe'],
    env: process.env,
  });

  const chunks: Buffer[] = [];
  proc.stderr?.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
    try {
      process.stderr.write(chunk);
    } catch {
      /* 自己的 stderr 已经关了 —— 不影响结论 */
    }
  });

  const code = await new Promise<number>((res) => {
    proc.on('exit', (c, signal) => res(signal ? 128 : (c ?? 1)));
    proc.on('error', () => res(1));
  });

  if (stderrFile) {
    writeFileSync(join(EVIDENCE_DIR, stderrFile), Buffer.concat(chunks));
  }
  return code;
}

/**
 * 拉起后端 + 前端，跑 E2E，产出 junit-e2e.xml
 *
 * 服务没起来时**明确失败** —— 静默跳过等于把"没验证"说成"验证通过"。
 */
async function runE2e(): Promise<number> {
  const handle = await startServers();
  console.log(`  后端：${handle.apiBase}　前端：${handle.webBase}`);

  // 每条链是一个独立文件 —— 各自完备、互不依赖。
  //
  // 必须用 `./` 前缀点名：*.e2e.ts 不匹配 Bun 的默认测试规则，
  // 不带前缀会被当成**过滤器**，一个用例都跑不到（静默通过 = 没验证）。
  const chains = await discoverChains();
  if (chains.length === 0) {
    console.error('❌ e2e/ 下没有任何 *.e2e.ts —— 这一步等于没跑');
    await handle.stop();
    return 1;
  }
  console.log(`  链：${chains.join('  ')}\n`);

  try {
    // **一条链一个进程** —— 理由与实测见 spec/verify/run-e2e.ts 的文件头。
    //
    // 九条链塞进一个 bun test 进程时，第 5～6 条链开始页面就起不来，
    // 浏览器死掉之后 bun test 永远不退出 —— 整轮流水线被一条链拖死。
    // 拆开之后九条链全过，证据合并成同一份 junit-e2e.xml。
    const { code, results } = await runE2eChains(handle, { chains });

    // 失败时把服务端日志倒出来 —— "用例没过"本身没有诊断价值，
    // 要知道是请求没发出去、服务端报了什么，得看日志。
    if (code !== 0) {
      const bad = results.filter((r) => r.code !== 0).map((r) => r.chain);
      console.error(`\n--- E2E 失败链：${bad.join('  ')} —— 服务端日志 ---`);
      console.error(handle.logs());
    }
    return code;
  } finally {
    await handle.stop();
  }
}

/**
 * e2e/ 下现存的链 —— 从 run-e2e.ts 导入。
 *
 * **只有一份实现**：链的发现逻辑写两遍，早晚有一份会漏掉新链 ——
 * 而"漏掉一条链"意味着"新用例没跑但报告说全绿"。
 */

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

      code = await runCmd(args, step.stderrFile);
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

const exitCode = await main();

// 显式等输出落盘再退 —— process.exit 不会等 stdout/stderr 的异步写完。
// 管道场景下（`bun run spec/verify/all.ts > log.txt`）末尾的汇总会丢，
// 而汇总恰恰是整轮跑批最该被看到的那几行。
await new Promise<void>((resolve) => {
  process.stdout.write('', () => {
    process.stderr.write('', () => resolve());
  });
});
process.exit(exitCode);
