#!/usr/bin/env bun
/**
 * 复现 E2E 间歇性失败 —— 连跑 N 轮，把失败那轮的完整输出留下来。
 *
 * 用法：bun run spec/verify/repro-flake.ts [轮数]
 * 产出：spec/evidence/flake-repro.log（失败轮的完整 bun test 输出 + 后端日志 + 浏览器日志）
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startServers } from './servers.ts';

const ROOT = new URL('../../', import.meta.url).pathname;
const ROUNDS = Number(process.argv[2] ?? 6);

const chunks: string[] = [];
const failures: number[] = [];

for (let i = 1; i <= ROUNDS; i++) {
  const handle = await startServers();
  const browserLogPath = resolve(ROOT, `spec/evidence/e2e-browser-${i}.log`);
  try {
    const proc = Bun.spawnSync({
      cmd: ['bun', 'test', './e2e/integration.e2e.ts'],
      cwd: ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, ...handle.env, E2E_LOG_FILE: browserLogPath },
    });
    const output = `${proc.stdout.toString()}\n${proc.stderr.toString()}`;
    const ok = proc.exitCode === 0;
    let browserLog = '';
    try {
      browserLog = await Bun.file(browserLogPath).text();
    } catch {
      browserLog = '（没有浏览器日志文件）';
    }
    chunks.push(
      `\n${'='.repeat(70)}\n第 ${i} 轮 —— ${ok ? '✓ 通过' : '✗ 失败'}\n${'='.repeat(70)}\n` +
        `${output}\n${'-'.repeat(30)} 后端日志 ${'-'.repeat(30)}\n${handle.logs()}\n` +
        `${'-'.repeat(30)} 浏览器日志 ${'-'.repeat(30)}\n${browserLog}\n`
    );
    if (!ok) failures.push(i);
    console.log(`第 ${i} 轮 —— ${ok ? '✓ 通过' : '✗ 失败'}`);
  } finally {
    await handle.stop();
  }
}

writeFileSync(resolve(ROOT, 'spec/evidence/flake-repro.log'), chunks.join('\n'), 'utf-8');
console.log(`\n失败轮次：${failures.length ? failures.join(', ') : '无'}`);
console.log('完整输出：spec/evidence/flake-repro.log');
