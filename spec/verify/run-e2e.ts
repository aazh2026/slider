/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * E2E 链的编排 —— **一条链一个进程**
 * ---------------------------------------------------------------------------
 * 为什么不能把九条链塞进一个 `bun test` 进程
 * ---------------------------------------------------------------------------
 *
 * 实测（同一套服务端、同一份代码、同一批链）：
 *
 *   · 九条链**一起**跑（一个 bun test 进程）
 *     → 第 5～6 条链开始，页面加载到一半就卡死：
 *       页面起来了、`/api/auth/me` 也回了 401，但登录表单永远不出现，
 *       渲染进程随后对 `page.evaluate` 彻底无应答；
 *     → 浏览器进程死掉，`bun test` 进程**永远不退出**（主线程空转在 kevent64）。
 *
 *   · 九条链**各自一个** bun test 进程
 *     → 全部通过（40 秒，0 失败）。
 *
 * 也就是说，卡死不是某条链的实现缺陷，而是**同进程跨文件的累积效应**：
 * 一个 `bun test` 进程里塞着九个文件的 Playwright 客户端、九个浏览器、
 * 十几份 Vite 页面，加上前一条链留下的浏览器还没退干净。
 * 症状落在后面的链上（所以看着像"随机的某条链坏了"），
 * 根因却在**进程边界之外**——单看任何一条链都复现不出来。
 *
 * 拆成独立进程同时解决三件事：
 *
 *   1. **不再有跨链污染** —— 一条链挂死只影响它自己。
 *   2. **挂死不再吞掉整条流水线** —— 每条链有硬超时，
 *      超时按"这条链失败"记账，而不是让整轮永远卡住。
 *   3. **证据依然完整** —— 九条链的 junit 会合并成一份，
 *      合并后与"一起跑"产出的证据等价（每条链本来就在自己的浏览器里跑）。
 *
 * ---------------------------------------------------------------------------
 * 为什么用**异步** spawn 而不是 spawnSync
 * ---------------------------------------------------------------------------
 *
 * spawnSync 会把父进程的事件循环**堵死**。而父进程里有一件必须一直跑的活：
 * 从后端/前端子进程的 stdout、stderr 里**持续抽走日志**（servers.ts 的 collect()）。
 *
 * 管道缓冲区是有限的（macOS 上通常 64KB）。父进程一堵死，抽日志的协程就停了，
 * 后端写日志写满了管道 → **后端自己被写日志这件事卡住** →
 * HTTP 响应发不出去 → 页面等一个永远不会来的响应。
 *
 * 这是一条**与浏览器无关的挂死路径**，而且症状和上面那条一模一样
 * （"页面起来了但拿不到东西"）。用异步 spawn 把它从根上排掉。
 *
 * ---------------------------------------------------------------------------
 * 每条链的浏览器必须真的退干净 —— 但**只能杀这条链自己的**
 * ---------------------------------------------------------------------------
 *
 * `browser.close()` 只等 3 秒；离线链里有一个**故意挂起 20 秒**的外部请求，
 * 浏览器要等它才有尊严地退出 —— 于是关不掉，浏览器进程留在机器上。
 * 一轮九条链，攒下三四个空转的渲染进程，机器就开始发飘。
 *
 * 所以每条链跑完要把它的浏览器收掉。**怎么认领自己的浏览器**是个坑：
 *
 *   最早的写法是「记下这条链启动前系统里已有的浏览器 pid，跑完做差集，
 *   把多出来的全杀掉」。这个写法**默认了"这个世界上只有我在跑"**。
 *   实测踩过：同时有另一个跑批在跑（`e2e-only.ts navigation`），
 *   它的浏览器是在我这条链启动**之后**才起来的 ——
 *   于是被我的差集当成"我这条链的残留"杀掉，
 *   我这条链的浏览器也被它用同样的逻辑杀掉。
 *   症状是 `newContext: Target page, context or browser has been closed`，
 *   失败点在 `helpers.ts` 的建上下文那一行，看着像**页面逻辑**炸了，
 *   其实是**编排器互踩**。
 *
 *   两边互踩是必然的：两个跑批各有各的"之前/之后"，谁都不认识谁。
 *
 * 所以改成**按进程树认领**：浏览器是这条链的 `bun test` 进程的子进程
 * （macOS 上实测 ppid 就是它），顺着 ppid 往上走能走回本链的 pid ——
 *   那才是"我这条链的浏览器"。别人的跑批的浏览器不在我的子树里，碰不到。
 *
 * 注意：父进程一死，浏览器会被 init 收养（ppid 变成 1），子树就断了 ——
 * 所以必须在**链还活着的时候**采样，不能等它退出后再查。
 */

import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ServerHandle } from './servers';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../..');
const EVIDENCE_DIR = resolve(ROOT, 'spec/evidence');

/** 每条链的硬超时（毫秒）—— 超了按失败记账，不让整轮永远卡住 */
const DEFAULT_CHAIN_TIMEOUT_MS = 240_000;

/** 这一轮跑批的时刻 —— 用来让临时目录名不重复 */
const runStamp = Date.now();

/**
 * 浏览器进程的匹配特征 —— 跟 Playwright 在 macOS 上的安装路径一致。
 *
 * 用**目录**而不是可执行文件名来匹配，因为两种模式下可执行文件不一样：
 *   · 无头：`ms-playwright/chromium_headless_shell/…`
 *   · 有头：`ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/…`
 * 只认无头的话，有头模式跑完残留的窗口就没人管了。
 */
const BROWSER_PATTERN = 'ms-playwright/chromium';

/**
 * 系统里现存的**所有**浏览器进程 pid。
 *
 * ⚠️ **只许用来数，不许用来杀。**
 * 「系统里多出来的都杀掉」这个思路正是本文件头记的那个缺陷 ——
 * 机器上可能同时有别的跑批，误杀别人的浏览器是不可接受的。
 * 要收浏览器，用 {@link ownBrowserPids}（按进程树认领本链的）。
 */
export function allBrowserPids(): number[] {
  const proc = Bun.spawnSync(['pgrep', '-f', BROWSER_PATTERN]);
  if (proc.exitCode !== 0) return [];
  return new TextDecoder()
    .decode(proc.stdout)
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .map(Number);
}

/**
 * 把 `ps -eo pid=,ppid=,command=` 的输出解析成「父 pid → 子 pid 列表」。
 *
 * 纯函数：只吃文本，不碰系统 —— 这样才能给它写测试。
 */
export function parsePsTree(psText: string): Map<number, number[]> {
  const children = new Map<number, number[]>();
  for (const line of psText.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)(?:\s|$)/);
    if (!m) continue;
    const pid = Number(m[1]);
    const ppid = Number(m[2]);
    const arr = children.get(ppid);
    if (arr) arr.push(pid);
    else children.set(ppid, [pid]);
  }
  return children;
}

/**
 * 从 `ps -eo pid=,ppid=,command=` 的输出里，挑出**属于 rootPid 子树**的浏览器进程。
 *
 * 判定两件事，缺一不可：
 *   1. 命令行里带 Playwright 的安装目录（是浏览器，不是别的进程）；
 *   2. 顺着 ppid 一路往上走，能走回 rootPid（是**我这条链**的，不是别人的）。
 *
 * 第 2 条才是关键 —— 少了它，机器上任何 Playwright 浏览器都会被当成我的。
 */
export function browserDescendants(psText: string, rootPid: number): number[] {
  const children = parsePsTree(psText);
  const commands = new Map<number, string>();
  for (const line of psText.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+\d+\s+(.*)$/);
    if (m) commands.set(Number(m[1]), m[2]!);
  }

  const isBrowser = (pid: number): boolean =>
    (commands.get(pid) ?? '').includes(BROWSER_PATTERN);

  const out: number[] = [];
  const stack = [...(children.get(rootPid) ?? [])];
  const seen = new Set<number>();
  while (stack.length > 0) {
    const pid = stack.pop()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    if (isBrowser(pid)) out.push(pid);
    for (const child of children.get(pid) ?? []) stack.push(child);
  }
  return out;
}

/**
 * 现场取一次：rootPid 这棵子树里现在活着的浏览器 pid。
 */
export function ownBrowserPids(rootPid: number): number[] {
  const proc = Bun.spawnSync(['ps', '-eo', 'pid=,ppid=,command=']);
  if (proc.exitCode !== 0) return [];
  return browserDescendants(new TextDecoder().decode(proc.stdout), rootPid);
}

/**
 * 杀掉给定的浏览器进程。
 *
 * 只杀**明确属于本链**的那些 —— 见文件头「只能杀这条链自己的」。
 */
export function killBrowsers(pids: number[]): number[] {
  const killed: number[] = [];
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
      killed.push(pid);
    } catch {
      /* 已经退了 */
    }
  }
  return killed;
}

export interface ChainResult {
  chain: string;
  /** 0 = 通过；非 0 = 失败；124 = 超时（自己定的约定） */
  code: number;
  ms: number;
  timedOut: boolean;
  /** 这条链的证据里有多少条用例 —— 0 = 证据没落盘 */
  junitTests?: number;
}

export interface RunE2eOptions {
  /** 只跑这些链（不给 = 全部） */
  chains?: string[];
  /** 每条链的硬超时 */
  chainTimeoutMs?: number;
  /** 合并后的 junit 落盘位置 */
  outFile?: string;
  /** 每条链自己的 junit 落在哪儿（临时目录） */
  workDir?: string;
  /** 失败详情落盘位置（见下面 runOneChain 的说明） */
  outputFile?: string;
  /** 额外注入给每条链进程的环境变量 */
  extraEnv?: Record<string, string>;
}

/** e2e/ 下现存的链 —— 文件名去掉 .e2e.ts */
export async function discoverChains(): Promise<string[]> {
  const dir = resolve(ROOT, 'e2e');
  const glob = new Bun.Glob('*.e2e.ts');
  const found: string[] = [];
  for await (const name of glob.scan({ cwd: dir })) {
    found.push(name.replace(/\.e2e\.ts$/, ''));
  }
  return found.sort();
}

/**
 * 这一轮是「全量」还是「子集」。
 *
 * 只有**全量**跑出来的证据才配写进 `junit-e2e.xml` ——
 * 那是追溯矩阵**唯一**的 E2E 证据来源。
 *
 * 为什么这条这么要紧（真踩过）：
 *   调试时只跑一条链（`e2e-only.ts auth`），脚本却把全量证据文件覆盖成了
 *   那一条链的结果 —— 于是追溯矩阵在下一轮把**所有** E2E 判据判成
 *   INCONCLUSIVE（"没跑过的验证不是通过"，判得保守，但方向反了：
 *   明明跑过，只是证据被冲掉了）。
 *   一次"看起来全绿"的调试，把上一轮的证据毁了。
 *
 * 所以：**子集跑就换一个文件名，绝不碰全量证据。**
 */
export function isFullChainRun(chains: string[], all: string[]): boolean {
  return chains.length === all.length && chains.every((c) => all.includes(c));
}

/**
 * 这一轮的证据该落到哪个文件名。
 *
 * 全量 → `junit-e2e.xml` / `junit-e2e-output.txt`（追溯矩阵读的就是这两个）。
 * 子集 → `junit-e2e-partial-<链>.xml`，**全量证据一个字节都不动**。
 */
export function evidenceFileNames(
  chains: string[],
  all: string[]
): { junit: string; output: string; partial: boolean } {
  if (isFullChainRun(chains, all)) {
    return { junit: 'junit-e2e.xml', output: 'junit-e2e-output.txt', partial: false };
  }
  const label = chains.length <= 3 ? chains.join('-') : `${chains.length}-chains`;
  return {
    junit: `junit-e2e-partial-${label}.xml`,
    output: `junit-e2e-partial-${label}-output.txt`,
    partial: true,
  };
}

/**
 * 跑一条链 —— 异步 spawn + 硬超时。
 *
 * 超时后**连同它的浏览器一起**收掉：浏览器是这条链的子进程，
 * 父进程被 SIGKILL 时它会变成孤儿继续占着内存。
 *
 * **stderr 要接出来**：Bun 的 junit reporter 在 `<failure>` 里**只写 type，
 * 一个字的信息都不写**（实测 `<failure type="AssertionError" />`）。
 * 但它在 junit 模式下**仍然把失败详情打到 stderr** ——
 * 源码片段、错误信息、期望值与实际值、调用栈，一样不少。
 * 所以 stderr 才是"这条链到底为什么挂"的诊断材料，
 * 接出来同时打屏和落盘，失败原因就不会随着终端滚动消失。
 */
async function runOneChain(
  chain: string,
  handle: ServerHandle,
  timeoutMs: number,
  junitFile: string,
  resetLog: boolean,
  outputFile?: string,
  extraEnv?: Record<string, string>
): Promise<ChainResult> {
  const t0 = Date.now();

  const proc = spawn(
    'bun',
    [
      'test',
      `./e2e/${chain}.e2e.ts`,
      '--reporter=junit',
      `--reporter-outfile=${junitFile}`,
    ],
    {
      cwd: ROOT,
      // stdout 直接继承（应用自己的日志照常流式打屏），
      // stderr 接出来 —— 见上面那段说明
      stdio: ['inherit', 'inherit', 'pipe'],
      env: {
        ...process.env,
        ...handle.env,
        ...extraEnv,
        // 链的名字 —— 录像 / 截图 / trace 的文件名靠它区分
        // （九条链的产物都落在同一个目录里，没有它就只剩一串随机名）
        E2E_CHAIN: chain,
        // 浏览器侧证据只有**第一条链**清空文件，之后各链追加 ——
        // 出问题的往往不是第一条链，前一条链留下的痕迹正是断线的现场。
        ...(resetLog ? { E2E_LOG_RESET: '1' } : {}),
      },
    }
  );

  // ---- 认领这条链自己的浏览器 ----
  //
  // 父进程一死，浏览器就被 init 收养（ppid 变成 1），子树就断了 ——
  // 所以必须在链还活着的时候采样。
  //
  // 采到的 pid 只属于**本链**：靠 ppid 一路走回 proc.pid 认领，
  // 别人跑批的浏览器不在我的子树里，碰不到（见文件头）。
  const ownBrowsers = new Set<number>();
  const sampleOwnBrowsers = (): void => {
    for (const pid of ownBrowserPids(proc.pid!)) ownBrowsers.add(pid);
  };
  sampleOwnBrowsers();
  const sampler = setInterval(sampleOwnBrowsers, 200);

  const errChunks: Buffer[] = [];
  proc.stderr?.on('data', (chunk: Buffer) => {
    errChunks.push(chunk);
    try {
      process.stderr.write(chunk);
    } catch {
      /* 父进程的 stderr 已经关了（自己被杀了）—— 不影响结论 */
    }
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    // 超时的那一刻浏览器还是链的子进程 —— 先认领再杀，
    // 否则浏览器会被 init 收养，pid 就再也认不出来了。
    sampleOwnBrowsers();
    proc.kill('SIGKILL');
  }, timeoutMs);

  const code = await new Promise<number>((resolvePromise) => {
    proc.on('exit', (c, signal) => {
      resolvePromise(signal ? 128 + (signal === 'SIGKILL' ? 9 : 0) : (c ?? 1));
    });
    proc.on('error', () => resolvePromise(1));
  });
  clearTimeout(timer);
  clearInterval(sampler);
  sampleOwnBrowsers();

  if (outputFile) {
    appendFileSync(
      outputFile,
      `\n${'='.repeat(70)}\n链 ${chain} —— ${timedOut ? '超时' : code === 0 ? '通过' : '失败'}\n${'='.repeat(70)}\n` +
        Buffer.concat(errChunks).toString('utf-8')
    );
  }

  // 浏览器必须退干净 —— 离线链有故意挂起的请求，浏览器常常关不掉。
  //
  // 只杀**这条链自己的**那些：靠进程树认领，不是"系统里多出来的都杀" ——
  // 后者在并发跑批时会杀掉别人的浏览器（实测踩过）。
  const killed = killBrowsers([...ownBrowsers]);

  // ---- 证据必须落盘 ----
  //
  // 链进程退出码 0 只说明**断言**过了，不说明**证据**写下来了。
  // 这两件事会分开：真踩过一次 ——
  //   证据目录被另一个并发跑批删掉了，Bun 的 junit 报告写不进去
  //   （stderr 里是 "JUnitReportFailed: ... ENOENT"），
  //   但 bun test 本身照样退出 0，于是链被判"通过"，
  //   最后合并出来的 junit 是**空的**，追溯矩阵据此把 12 条 E2E 判据
  //   全判成 INCONCLUSIVE —— 而报告上写着"全绿"。
  //
  // 证据没了，"跑过"这件事就无从证明 —— 那就不能算通过。
  const counts = readJunitCounts(junitFile);
  const evidenceOk = counts !== null && counts.tests > 0;
  if (!evidenceOk) {
    const why =
      counts === null
        ? `证据文件没写出来（${junitFile}）`
        : `证据文件里 0 条用例（${junitFile}）`;
    console.error(`  ⚠️ 链 ${chain}：${why} —— 这一链不算通过`);
    if (outputFile) {
      appendFileSync(
        outputFile,
        `\n[证据缺失] 链 ${chain}：${why}\n` + Buffer.concat(errChunks).toString('utf-8')
      );
    }
  }

  return {
    chain,
    code: timedOut ? 124 : evidenceOk ? code : code === 0 ? 1 : code,
    ms: Date.now() - t0,
    timedOut,
    junitTests: counts?.tests ?? 0,
    ...(killed.length > 0 ? { killedBrowsers: killed.length } : {}),
  } as ChainResult & { killedBrowsers?: number; junitTests?: number };
}

/**
 * 读一份 junit 的根属性计数。
 *
 * 纯函数：文件不在或格式不对就返回 null（**不猜**）。
 * 「证据读不出来」和「证据里 0 条用例」是两回事，调用方要分开处理。
 */
export function readJunitCounts(file: string): { tests: number; failures: number } | null {
  if (!existsSync(file)) return null;
  let xml: string;
  try {
    xml = readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
  const root = xml.match(/<testsuites\b([^>]*)>/);
  if (!root) return null;
  const attr = (name: string): number => {
    const m = root[1]!.match(new RegExp(`${name}="([^"]*)"`));
    return m ? Number(m[1]) : 0;
  };
  return { tests: attr('tests'), failures: attr('failures') };
}

/**
 * 把多份 junit 合成一份。
 *
 * Bun 的 junit 报告结构是固定的：
 *
 *   <testsuites name="bun test" tests=… assertions=… failures=… skipped=… time=…>
 *     <testsuite name="e2e/x.e2e.ts" …>   ← 外层：文件
 *       <testsuite name="…链" …>          ← 内层：describe
 *         <testcase …/>
 *       </testsuite>
 *     </testsuite>
 *   </testsuites>
 *
 * 合并就是：属性相加、内层 testsuite 原样拼起来。
 * **不做任何"修饰"** —— 合并后的数字必须等于各链数字之和，
 * 否则追溯矩阵读出来的条数就跟真实执行过的对不上。
 */
export function mergeJunit(files: string[], outFile: string): { tests: number; failures: number } {
  const bodies: string[] = [];
  let tests = 0;
  let assertions = 0;
  let failures = 0;
  let skipped = 0;
  let time = 0;

  for (const f of files) {
    if (!existsSync(f)) continue;
    const xml = readFileSync(f, 'utf-8');
    const root = xml.match(/<testsuites\b([^>]*)>/);
    if (!root) continue;
    const attr = (name: string): number => {
      const m = root[1]!.match(new RegExp(`${name}="([^"]*)"`));
      return m ? Number(m[1]) : 0;
    };
    tests += attr('tests');
    assertions += attr('assertions');
    failures += attr('failures');
    skipped += attr('skipped');
    time += attr('time');

    const inner = xml.slice(xml.indexOf('>', xml.indexOf('<testsuites')) + 1);
    const body = inner.slice(0, inner.lastIndexOf('</testsuites>'));
    if (body.trim()) bodies.push(body.trim());
  }

  const merged =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<testsuites name="bun test" tests="${tests}" assertions="${assertions}" ` +
    `failures="${failures}" skipped="${skipped}" time="${time.toFixed(6)}">\n` +
    `${bodies.join('\n')}\n</testsuites>\n`;

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, merged, 'utf-8');
  return { tests, failures };
}

/**
 * 跑全部（或指定的）E2E 链，产出合并后的 junit。
 *
 * @returns 0 = 全通过；1 = 有链失败；2 = 一条链都没跑起来
 */
export async function runE2eChains(
  handle: ServerHandle,
  opts: RunE2eOptions = {}
): Promise<{ code: number; results: ChainResult[] }> {
  const allChains = await discoverChains();
  const chains = opts.chains ?? allChains;
  if (chains.length === 0) return { code: 2, results: [] };

  // **子集跑不碰全量证据** —— 理由见 isFullChainRun 的注释。
  const names = evidenceFileNames(chains, allChains);
  const outFile = opts.outFile ?? join(EVIDENCE_DIR, names.junit);
  // 每轮**独立**的临时目录 ——
  //
  // 之前是固定的 `.junit-parts`，于是两个并发跑批会互相踩：
  // 一轮跑完把目录删了，另一轮正在往里写 junit，
  // Bun 写不进去（stderr 里是 "JUnitReportFailed: ... ENOENT"），
  // 但 bun test 照样退出 0 —— 于是"链全过"，合并出来的证据却是空的。
  // 目录名带上 pid + 时刻，两轮就撞不上了。
  const workDir =
    opts.workDir ?? join(EVIDENCE_DIR, `.junit-parts-${process.pid}-${runStamp}`);
  const timeoutMs = opts.chainTimeoutMs ?? DEFAULT_CHAIN_TIMEOUT_MS;
  const outputFile = opts.outputFile ?? join(EVIDENCE_DIR, names.output);

  if (names.partial && !opts.outFile) {
    console.log(
      `  ⚠️ 这一轮只跑了 ${chains.length}/${allChains.length} 条链（${chains.join(' ')}）——`
    );
    console.log(`     证据写到 ${names.junit}，**不覆盖** junit-e2e.xml：`);
    console.log('     全量证据是追溯矩阵唯一的 E2E 来源，被一次调试冲掉就再也证明不了"跑过"。');
  }

  mkdirSync(workDir, { recursive: true });
  // 诊断文件每次从空开始 —— 它记的是**这一轮**的失败详情
  writeFileSync(outputFile, '', 'utf-8');

  const results: ChainResult[] = [];
  const parts: string[] = [];

  for (const chain of chains) {
    const partFile = join(workDir, `junit-${chain}.xml`);
    rmSync(partFile, { force: true });
    console.log(`  ▶ 链 ${chain}`);
    const r = await runOneChain(
      chain,
      handle,
      timeoutMs,
      partFile,
      results.length === 0,
      outputFile,
      opts.extraEnv
    );
    results.push(r);
    parts.push(partFile);
    const tail = r.timedOut
      ? `超时（${Math.round(r.ms / 1000)}s）`
      : r.code === 0
        ? '通过'
        : `失败（退出码 ${r.code}）`;
    console.log(`  ◀ 链 ${chain}: ${tail}　${Math.round(r.ms / 1000)}s`);
  }

  const merged = mergeJunit(parts, outFile);
  console.log(
    `  证据：${outFile}（${merged.tests} 条用例，失败 ${merged.failures} 条）`
  );
  console.log(`  失败详情：${outputFile}`);
  rmSync(workDir, { recursive: true, force: true });

  const failed = results.filter((r) => r.code !== 0);

  // 链都过了、合并出来的证据却是空的 —— **不能算通过**。
  //
  // 「没跑过的验证不是通过」这条规矩有个更硬的双胞胎：
  // 「跑过了但证据没留下」也不是通过。
  // 空证据会让追溯矩阵把 E2E 判据全判成 INCONCLUSIVE，
  // 而这一轮的日志写着"全绿" —— 报告与事实相反，最难查。
  if (merged.tests === 0 && results.length > 0) {
    console.error(
      '\n❌ 链都跑完了，但合并后的 junit 是 0 条用例 —— 证据没落盘，这一轮不算通过。'
    );
    console.error('   （并发跑批把证据目录互删了是最常见的原因；重跑一次即可。）');
    return { code: 1, results };
  }

  return { code: failed.length > 0 ? 1 : 0, results };
}
