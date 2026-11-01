/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 跑单条（或若干条）E2E 链 —— 自带服务编排
 * ---------------------------------------------------------------------------
 * 全链路入口（spec/verify/all.ts）会把结构校验、类型检查、判据执行、
 * 注入检查全跑一遍，迭代时太慢。这里只做一件事：
 * **把服务拉起来，跑指定的 E2E 文件，收尾**。
 *
 *   bun run scripts/run-e2e.ts                       # 跑全部链
 *   bun run scripts/run-e2e.ts auth                  # 只跑认证链
 *   bun run scripts/run-e2e.ts auth projects         # 跑两条链
 *
 * 每一轮换一组新端口 —— 复用旧进程会让"注入根本没进到被测系统里"。
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startServers } from '../spec/verify/servers';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 目录里现存的链 —— 文件名去掉 .e2e.ts */
async function discoverChains(): Promise<string[]> {
  const dir = resolve(ROOT, 'e2e');
  const glob = new Bun.Glob('*.e2e.ts');
  const found: string[] = [];
  for await (const name of glob.scan({ cwd: dir })) {
    found.push(name.replace(/\.e2e\.ts$/, ''));
  }
  return found.sort();
}

async function main(): Promise<number> {
  const requested = process.argv.slice(2);
  const chains = requested.length > 0 ? requested : await discoverChains();
  if (chains.length === 0) {
    console.error('❌ e2e/ 下没有任何 *.e2e.ts');
    return 1;
  }

  const files = chains.map((c) => `./e2e/${c}.e2e.ts`);
  for (const f of files) {
    const abs = resolve(ROOT, f.replace('./', ''));
    if (!(await Bun.file(abs).exists())) {
      console.error(`❌ 找不到 E2E 文件：${f}`);
      return 1;
    }
  }

  const handle = await startServers();
  console.log(`后端：${handle.apiBase}　前端：${handle.webBase}`);
  console.log(`跑：${files.join('  ')}\n`);

  try {
    const proc = Bun.spawn(['bun', 'test', ...files], {
      cwd: ROOT,
      stdout: 'inherit',
      stderr: 'inherit',
      env: { ...process.env, ...handle.env },
    });
    return await proc.exited;
  } finally {
    await handle.stop();
    const logs = handle.logs();
    if (logs.trim()) {
      console.log('\n--- 服务端日志（尾部）---');
      console.log(logs.split('\n').slice(-40).join('\n'));
    }
  }
}

process.exit(await main());
