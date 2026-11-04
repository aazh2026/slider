#!/usr/bin/env bun
/**
 * 复现 E2E 间歇性失败 —— 连跑 N 轮，把失败那轮的完整输出留下来。
 *
 * 用法：bun run spec/verify/repro-flake.ts [轮数]
 * 产出：spec/evidence/flake-repro.log（失败轮的完整输出 + 后端日志 + 浏览器日志）
 *
 * ---------------------------------------------------------------------------
 * **编排必须复用 spec/verify/run-e2e.ts**
 *
 * 这个脚本早先自己 spawn 了一个 `bun test` 把九条链塞在一起，
 * 而且用的是 spawnSync —— 那正是 E2E 挂死的两条成因：
 *
 *   · 九条链在**同一个 bun test 进程**里 → 跨链累积，第 5～6 条链页面就起不来，
 *     浏览器死掉之后 bun test 永远不退出（实测：整轮永远卡住）
 *   · **spawnSync 堵死父进程事件循环** → 父进程没法抽后端日志，
 *     后端写日志写满 64KB 管道 → 后端自己卡住 → 响应发不出去
 *
 * 也就是说，用旧写法跑这个脚本，得到"抖动"结论其实是
 * **编排器的缺陷**，不是实现的问题 —— 一份假报告比没有报告更糟。
 *
 * 所以这里直接调用 runE2eChains：**一条链一个进程、异步 spawn、有硬超时**。
 * 它跑的是跟流水线完全一样的东西，结论可以互相印证。
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { startServers } from './servers.ts';
import { discoverChains, runE2eChains } from './run-e2e.ts';

const ROOT = new URL('../../', import.meta.url).pathname;
const ROUNDS = Number(process.argv[2] ?? 6);
const EVIDENCE = resolve(ROOT, 'spec/evidence');

const chunks: string[] = [];
const failures: number[] = [];

/**
 * 全部 E2E 链 —— 从磁盘上发现，不手写。
 *
 * 手写清单的话，新增一条链忘了改这里，复现脚本就漏掉那条链 ——
 * 而"复现抖动"这件事漏一条链，结论就是假的。
 */
const chains = await discoverChains();
if (chains.length === 0) {
  console.error('❌ e2e/ 下没有任何 *.e2e.ts —— 这个脚本无事可做');
  process.exit(1);
}

for (let i = 1; i <= ROUNDS; i++) {
  const handle = await startServers();
  const browserLogPath = resolve(EVIDENCE, `e2e-browser-${i}.log`);
  const outputFile = resolve(EVIDENCE, `.flake-round-${i}.txt`);
  try {
    // 浏览器日志按轮次分开 —— 失败那轮的现场不能被别的轮次冲掉
    const { code, results } = await runE2eChains(handle, {
      chains,
      outFile: resolve(EVIDENCE, `.flake-round-${i}.xml`),
      outputFile,
      chainTimeoutMs: 240_000,
      // 浏览器日志按轮次分开 —— 失败那轮的现场不能被别的轮次冲掉
      extraEnv: { E2E_LOG_FILE: browserLogPath },
    });

    let output = '';
    try {
      output = await Bun.file(outputFile).text();
    } catch {
      output = '（没有诊断输出文件）';
    }
    let browserLog = '';
    try {
      browserLog = await Bun.file(browserLogPath).text();
    } catch {
      browserLog = '（没有浏览器日志文件）';
    }

    const bad = results.filter((r) => r.code !== 0).map((r) => r.chain);
    const ok = code === 0;
    chunks.push(
      `\n${'='.repeat(70)}\n第 ${i} 轮 —— ${ok ? '✓ 通过' : `✗ 失败（${bad.join('  ')}）`}\n${'='.repeat(70)}\n` +
        `${output}\n${'-'.repeat(30)} 后端日志 ${'-'.repeat(30)}\n${handle.logs()}\n` +
        `${'-'.repeat(30)} 浏览器日志 ${'-'.repeat(30)}\n${browserLog}\n`
    );
    if (!ok) failures.push(i);
    console.log(`第 ${i} 轮 —— ${ok ? '✓ 通过' : `✗ 失败（${bad.join('  ')}）`}`);
  } finally {
    await handle.stop();
  }
}

writeFileSync(resolve(EVIDENCE, 'flake-repro.log'), chunks.join('\n'), 'utf-8');
console.log(`\n失败轮次：${failures.length ? failures.join(', ') : '无'}`);
console.log('完整输出：spec/evidence/flake-repro.log');
process.exit(failures.length > 0 ? 1 : 0);
