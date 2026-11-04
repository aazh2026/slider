#!/usr/bin/env bun
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 只跑 E2E —— 自己拉起服务，跑 e2e/ 下的全部链，落一份 junit 证据
 * ---------------------------------------------------------------------------
 * 为什么单独留这个入口：
 *
 *   整条流水线（spec/verify/all.ts）里 E2E 前后还有单元证据集、覆盖率门禁、
 *   注入错误检查、追溯矩阵。改一条 E2E 用例就整套重跑一遍，
 *   迭代成本高得离谱 —— 而 E2E 恰恰是最容易失败、最需要反复调的一层。
 *
 *   这个入口跟 all.ts 的 E2E 步骤**跑的是同一套东西**（同一份 servers.ts、
 *   同样的链发现逻辑、同样的 junit 落盘位置），
 *   所以它跑出来的证据可以直接被追溯矩阵消费 —— 不是"另一套测试"。
 *
 * 运行：
 *     bun run spec/verify/e2e-only.ts
 *
 * 想**看见**浏览器在干什么（而不是只看一份 junit 报告）：
 *     bun run spec/verify/e2e-only.ts --visible
 *     bun run spec/verify/e2e-only.ts --visible --video --shots --slowmo=300
 *
 * 退出码：0 = 全部通过；1 = 有用例失败。
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startServers } from './servers.ts';
import { discoverChains, runE2eChains } from './run-e2e.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

const chains = await discoverChains();
if (chains.length === 0) {
  console.error('❌ e2e/ 下没有任何 *.e2e.ts —— 这一步等于没跑');
  process.exit(1);
}

// 可选：命令行给链名做过滤（子串匹配），只跑其中几条 —— 迭代时用。
// 不给参数就跑全部（这才是流水线里的行为，证据才是完整的）。
const flags = process.argv.slice(2);
const filters = flags.filter((a) => !a.startsWith('-'));
const selected = filters.length
  ? chains.filter((c) => filters.some((f) => c.includes(f)))
  : chains;
if (selected.length === 0) {
  console.error(`❌ 没有链匹配 ${filters.join(', ')}（现有：${chains.join('  ')}）`);
  process.exit(1);
}
if (filters.length) {
  console.log(`  （只跑：${selected.join('  ')}）`);
}

/* -------------------------------------------------------------------------- */
/* 可视化开关 —— 让人眼看见浏览器在干什么                                        */
/* -------------------------------------------------------------------------- */
/*
 * 默认**无头**：流水线里没有显示器，无头是唯一能跑的选择。
 * 但"无头跑过了"和"人眼看过它跑过"是两件事 ——
 * 前者只证明断言成立，后者才排除"页面其实白屏、断言恰好没查那里"这类假绿。
 *
 * 所以这里给一组开关，而不是二选一：
 *   --visible      弹真窗口（E2E_HEADFUL=1）
 *   --video        每个会话录一段 webm（E2E_VIDEO=1）
 *   --shots        每个会话结束时留一张整页截图（E2E_SHOTS=1）
 *   --trace        Playwright trace，可交互回放（E2E_TRACE=1）
 *   --slowmo=N     每个动作之间放慢 N 毫秒（E2E_SLOWMO=N）
 *   --hold=N       每个会话的页面在屏幕上多留 N 毫秒（E2E_HOLD_MS=N）
 *
 * 这些开关只影响**这一轮**的跑法，不改变任何断言 —— 看得见与跑得对是两件事。
 */
const visible = flags.includes('--visible') || flags.includes('--headful');
const extraEnv: Record<string, string> = {};
if (visible) extraEnv['E2E_HEADFUL'] = '1';
if (flags.includes('--video')) extraEnv['E2E_VIDEO'] = '1';
if (flags.includes('--shots')) extraEnv['E2E_SHOTS'] = '1';
if (flags.includes('--trace')) extraEnv['E2E_TRACE'] = '1';
const slowmo = flags.find((f) => f.startsWith('--slowmo='))?.split('=')[1];
if (slowmo) extraEnv['E2E_SLOWMO'] = slowmo;
const hold = flags.find((f) => f.startsWith('--hold='))?.split('=')[1];
if (hold) extraEnv['E2E_HOLD_MS'] = hold;

const mediaDir = process.env['E2E_MEDIA_DIR'] ?? './spec/evidence/e2e-media';
if (visible) {
  console.log('  ▶ 可见模式：浏览器窗口会真的弹出来');
  if (slowmo) console.log(`    动作放慢 ${slowmo}ms`);
  if (hold) console.log(`    每步之后页面多留 ${hold}ms`);
  if (extraEnv['E2E_VIDEO']) console.log(`    录像：${mediaDir}/<链>/video-*.webm`);
  if (extraEnv['E2E_SHOTS']) console.log(`    截图：${mediaDir}/<链>/shot-*.png`);
  if (extraEnv['E2E_TRACE']) console.log(`    trace：${mediaDir}/<链>/trace-*.zip`);
  console.log('');
}

const handle = await startServers();
console.log(`  后端：${handle.apiBase}　前端：${handle.webBase}`);
console.log(`  链：${selected.join('  ')}\n`);

// 一条链一个进程 —— 理由与实测见 spec/verify/run-e2e.ts 的文件头：
// 九条链塞进一个 bun test 进程时，第 5～6 条链开始页面就起不来，
// 浏览器死掉之后 bun test 永远不退出 —— 整轮流水线被一条链拖死。
const { code } = await runE2eChains(handle, { chains: selected, extraEnv });

await handle.stop();

if (extraEnv['E2E_VIDEO'] || extraEnv['E2E_SHOTS'] || extraEnv['E2E_TRACE']) {
  console.log(`\n  可视化产物：${mediaDir}/`);
}
if (code !== 0) {
  console.error('\n❌ E2E 有用例失败。');
  console.error('   浏览器侧证据：spec/evidence/e2e-browser.log');
  console.error(`   服务端日志：\n${handle.logs()}`);
}
process.exit(code);
