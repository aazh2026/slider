/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * E2E 服务编排 —— 为前后端集成测试拉起真实的后端与前端
 * ---------------------------------------------------------------------------
 * 为什么需要这个文件：
 *
 *   `e2e/*.e2e.ts` 断言的是**真实浏览器 + 真实服务端**下的行为。
 *   之前它只能靠人手动开三个终端跑 —— 于是它既不产出 junit 证据，
 *   也没有任何判据指向它，追溯矩阵里"全绿"但用户真正用的那个界面是裸奔的。
 *
 *   把拉起逻辑收进这里之后：
 *     · spec/verify/all.ts 能自己起服务、跑 E2E、把结果并进证据集
 *     · spec/verify/mutation-check.ts 能对 E2E 判据做注入错误检查
 *
 * ---------------------------------------------------------------------------
 * **端口与数据目录一律用独立的**
 *
 *   · 端口 —— 默认现找一个没人监听的端口；不跟开发者本机正在跑的
 *     dev server（3000/5173）打架，也不会撞上上一轮自动化残留的进程
 *   · 数据库 .data/e2e-pglite —— PGlite 是**文件**数据库，两个进程写同一个目录
 *     会互相锁死；共享目录会让人开着一个 dev server 就跑不了自动化
 *
 *   于是自动化跑的一定是**当前代码**，而不是"某个还活着的旧进程"。
 *
 * ---------------------------------------------------------------------------
 * **为什么端口要现找，而不是写死**
 *
 * 注入错误检查（mutation-check.ts）要在**每一轮**都重起服务 ——
 * 服务进程在启动那一刻就把源码读进内存了，之后改磁盘上的文件对它毫无影响。
 * 复用同一个进程跑"注入前/注入后"两轮，等于注入根本没进到被测系统里，
 * 结论会变成一个自己造出来的假阴性。
 *
 * 每轮都换端口，是为了让"上一轮的进程还没退干净"不至于变成"这一轮
 * 连到了旧进程" —— 那种情况同样是静默地测了旧代码还报通过。
 */

import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

import { startModelStub, type ModelStubHandle } from './model-stub.ts';

const ROOT = new URL('../../', import.meta.url).pathname;

export interface ServerOptions {
  /** 后端端口（不给就现找一个没人监听的） */
  apiPort?: number;
  /** 前端端口（不给就现找一个没人监听的） */
  webPort?: number;
  /** 启动超时（毫秒） */
  timeoutMs?: number;
  /**
   * PGlite 数据目录（默认：每次调用一个全新的独立目录）
   *
   * **必须是每次都新的**，理由有两条，缺一不可：
   *
   *   1. *跨进程*：PGlite 是**文件**数据库，两个进程写同一个目录会互相锁死。
   *   2. *跨轮次*：被 `kill -9` 打断的 Postgres 会留下 `postmaster.pid`；
   *      下一轮启动时它看到锁文件还在，就拒绝启动 —— 报的是
   *      "lock file already exists"，而症状是"服务起不来"，完全看不出
   *      根因是上一轮的残留。实测踩过：一次强杀之后，
   *      之后每一轮 E2E 都起不来后端。
   *
   * 顺带的好处：**每轮 E2E 从空库开始**，
   * "这个邮箱已注册"之类的历史数据不会跨轮次污染结论。
   */
  dataDir?: string;
}

export interface ServerHandle {
  /** 后端根地址 */
  apiBase: string;
  /** 前端根地址 */
  webBase: string;
  /** 供 E2E 使用的环境变量 */
  env: Record<string, string>;
  /** 关掉这两个进程 */
  stop: () => Promise<void>;
  /**
   * 取回这一轮的 stdout + stderr（后端与前端都收）。
   *
   * 失败时「测试没通过」本身没有诊断价值 —— 要知道是请求没发出去、
   * 服务端报了什么错、还是根本没进到模型调用，日志是唯一的线索。
   * 采集日志不改变被测系统的行为，只是把它的输出留下来。
   *
   * 前端的日志也要收：vite 会把「page reload」打在 stdout 上，
   * 页面被热重载这件事**只在**那里看得见 —— 浏览器侧只能看到
   * 「[vite] connecting... 又来了一次」，看不到是谁触发的。
   */
  logs: () => string;
}

/**
 * 找两个**互不相同**的空闲端口。
 *
 * 必须同时占住两个探针再一起放开 ——
 * 分两次"借一个、放一个"的话，操作系统很可能把刚放开的那个端口又发一次，
 * 于是后端和前端拿到了**同一个端口**：vite 绑不上（strictPort 直接退出），
 * 而探活打到的却是后端 —— 一整套"看起来起来了、其实前端根本没起"的假象。
 * 这个坑踩过一次：AC-E2E-008 的基线跑挂了，查下去是端口撞了，不是实现坏了。
 */
async function findFreePorts(count: number): Promise<number[]> {
  const probes: Array<{ server: { port?: number; stop: () => Promise<void> | void } }> = [];
  try {
    for (let i = 0; i < count; i++) {
      const server = Bun.serve({ port: 0, fetch: () => new Response('ok') });
      probes.push({ server });
    }
    const ports = probes.map((p) => p.server.port);
    if (ports.some((p) => typeof p !== 'number')) {
      throw new Error('拿不到空闲端口 —— Bun.serve 没返回 port');
    }
    if (new Set(ports).size !== ports.length) {
      throw new Error(`分配到了重复端口：${ports.join(', ')}`);
    }
    return ports as number[];
  } finally {
    for (const p of probes) await p.server.stop();
  }
}

/** 探活：轮询到服务真的能应答为止 */
async function waitFor(
  url: string,
  timeoutMs: number,
  label: string,
  isReady: (res: Response) => Promise<boolean>,
  /** 子进程 —— 退出即立刻失败，不必把超时耗满 */
  proc?: { exitCode: number | null }
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = '（无响应）';
  while (Date.now() < deadline) {
    // 进程已经死了还接着等 —— 那是在把"启动就崩"伪装成"启动慢"。
    // 崩在启动阶段的错误信息全在日志里，早失败早看到。
    if (proc && proc.exitCode !== null) {
      throw new Error(`${label} 进程已退出（exit ${proc.exitCode}），未就绪（${url}）`);
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok && (await isReady(res))) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await Bun.sleep(200);
  }
  throw new Error(`${label} 在 ${timeoutMs}ms 内未就绪（${url}）：${lastError}`);
}

/**
 * 后端必须是**后端** —— /readyz 返回带 data.status 的信封
 *
 * **必须探 /readyz，不能探 /healthz**：
 *   · /healthz 是**存活**探针 —— 不查 DB，进程在就算"活着"
 *   · /readyz 是**就绪**探针 —— ping 一下 DB，DB 通了才算"能接流量"
 *
 * 探错的后果不是"起不来"，而是"起来了但不能用"：
 * DB 锁住/迁移没跑完时，HTTP 照样 200，
 * 于是自动化判"后端就绪"，然后每一条要写库的用例都 500 ——
 * 症状指向业务代码，根因在探针选错了。实测踩过：
 * 一轮 E2E 的注册全线 500，追查后是探针探了 /healthz。
 */
async function looksLikeApi(res: Response): Promise<boolean> {
  try {
    const body = (await res.json()) as { data?: { status?: string } };
    return body?.data?.status === 'ready';
  } catch {
    return false;
  }
}

/** 前端必须是**前端** —— 返回的是 HTML 页面，不是一段 JSON */
async function looksLikeWeb(res: Response): Promise<boolean> {
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('text/html')) return false;
  try {
    const html = await res.text();
    return html.includes('<div id="root"') || html.includes('<!doctype html');
  } catch {
    return false;
  }
}

/** 杀掉子进程及其子孙 —— vite 会派生子进程，只 kill 父进程会留残留 */
function killTree(proc: { kill: () => void }): void {
  try {
    proc.kill();
  } catch {
    /* 进程可能已经自己退了 */
  }
}

/**
 * 拉起后端 + 前端，返回可关闭的句柄。
 *
 * 端口默认现找 —— 开发者本机开着 dev server（3000 / 5173）不影响自动化跑，
 * 而且自动化测的一定是**当前代码**。
 *
 * **绝不静默复用旧服务**：vite 加了 `--strictPort`，端口被占就启动失败报错；
 * 后端则靠"现找端口"绕开占用。两者都不会出现"连到了旧进程还报通过"。
 *
 * 起不来会**换一组端口重试**（最多 3 次）—— 端口分配是概率事件，
 * 撞了就撞了，重试比"整个 E2E 挂掉"划算。真的起不来就明确报错。
 */
export async function startServers(opts: ServerOptions = {}): Promise<ServerHandle> {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  // 每轮一个全新目录 —— 见 ServerOptions.dataDir 的说明（残留锁 + 跨轮污染）。
  const runId = `run-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const dataDir = opts.dataDir ?? `./.data/e2e-pglite/${runId}`;
  const ownsDataDir = opts.dataDir === undefined;

  // 导出产物也必须**每轮一个目录**。
  //
  // 一轮 E2E 会导出十几份 PPTX/PDF/PNG，一份 PDF 就有 36MB —— 攒十几轮就是
  // 近 10GB。这些产物**不是证据**（证据是 junit 与浏览器日志），
  // 留着没有意义，只是把磁盘吃满、让后面的跑批变慢。
  //
  // 写死一个共享目录 = 每轮都在同一个地方堆 —— 实测堆到了 9.6GB。
  const storageDir = `./.data/e2e-artifacts/${runId}`;

  // 模型端点替身 —— E2E 离线跑（见 model-stub.ts 里的理由）。
  // 放在重试循环**外面**：它不占固定端口，且与 API 进程的生命周期无关。
  const modelStub: ModelStubHandle = await startModelStub();

  let lastError: unknown = null;
  let lastLogs = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ports =
      opts.apiPort !== undefined && opts.webPort !== undefined
        ? [opts.apiPort, opts.webPort]
        : await findFreePorts(2);
    const apiPort = ports[0]!;
    const webPort = ports[1]!;

    const apiBase = `http://127.0.0.1:${apiPort}`;
    const webBase = `http://127.0.0.1:${webPort}`;

    const apiProc = Bun.spawn(['bun', 'run', 'apps/api/src/index.ts'], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(apiPort),
        APP_URL: webBase,
        // 独立的数据目录 —— PGlite 是文件数据库，不能两个进程共享
        DATABASE_URL: `pglite://${dataDir}`,
        STORAGE_DIR: storageDir,
        // 走本地替身而不是官方端点 —— E2E 的结论不能取决于外网状态
        GEMINI_BASE_URL: modelStub.baseUrl,
        GEMINI_API_KEY: process.env['GEMINI_API_KEY'] ?? 'local-dev-placeholder',
        GEMINI_MODEL: process.env['GEMINI_MODEL'] ?? 'gemini-2.5-flash',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // 前端 —— **关掉热重载与文件监听**（DISABLE_HMR=true，见 vite.config.ts）。
    //
    // 为什么必须关：vite 的 dev server 监听**整个项目根目录**，
    // 而 E2E 跑的时候，根目录底下一直在变：
    //
    //   · .data/e2e-pglite/      —— PGlite 是文件数据库，每写一行都在改文件
    //   · .data/e2e-artifacts/   —— 导出产物落盘
    //   · spec/evidence/*.log   —— 浏览器侧证据落盘
    //   · 注入检查还会直接改源码（apps/api/src/…、packages/core/src/…）
    //
    // 任何一次改动都可能让 vite 给页面发一次**整页重载**。
    // 页面一重载，React 的内存状态就没了，E2E 里「UI 操作 → 服务端存了什么」
    // 这条链子就断在中间 —— 实测两次：一次让「还原后」那一轮连挂 4 个用例，
    // 一次只是碰巧没炸。
    //
    // E2E 断言的是**服务端状态**，不测热重载 —— 热重载对它是纯噪声。
    // 这个开关本来就是为「agent 改文件时页面乱闪」准备的（见 vite.config.ts 的注释）。
    const webProc = Bun.spawn(
      [
        'bun',
        'node_modules/vite/bin/vite.js',
        '--port',
        String(webPort),
        '--strictPort',
        '--host',
        '127.0.0.1',
      ],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          // 前端代理要打到我们刚起的后端端口上
          API_ORIGIN: apiBase,
          // 关掉热重载与文件监听 —— 见下面那段说明
          DISABLE_HMR: 'true',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      }
    );

    const stopServers = async (): Promise<void> => {
      killTree(webProc);
      killTree(apiProc);
      // 给子进程一点时间退干净，避免占着端口
      await Bun.sleep(300);
    };

    // 对外暴露的 stop 要把模型替身一起收掉 —— 它是这一轮的一部分
    const stop = async (): Promise<void> => {
      await stopServers();
      await modelStub.stop();
      // 自己开的数据目录用完就删 —— 留着只会攒下"上一轮的残留锁"，
      // 让下一轮起不来（现象是"服务起不来"，根因却是上一轮）。
      if (ownsDataDir) {
        await rm(resolve(ROOT, dataDir), { recursive: true, force: true }).catch(() => {});
      }
      // 导出产物同理 —— 一轮近 1GB 的垃圾，留着只会把磁盘吃满
      await rm(resolve(ROOT, storageDir), { recursive: true, force: true }).catch(() => {});
    };

    // 采集后端与前端日志 —— 失败诊断靠它
    const logChunks: string[] = [];
    const collect = (stream: ReadableStream<Uint8Array>, tag: string): void => {
      void (async () => {
        const decoder = new TextDecoder();
        for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
          logChunks.push(`[${tag}] ${decoder.decode(chunk)}`);
        }
      })().catch(() => {
        /* 进程被杀时流会中断 —— 采到多少算多少 */
      });
    };
    collect(apiProc.stdout as ReadableStream<Uint8Array>, 'api');
    collect(apiProc.stderr as ReadableStream<Uint8Array>, 'api-err');
    collect(webProc.stdout as ReadableStream<Uint8Array>, 'web');
    collect(webProc.stderr as ReadableStream<Uint8Array>, 'web-err');

    try {
      // 探活要认**身份**：后端得回信封，前端得回 HTML。
      // 只看 res.ok 的话，"后端占了这个端口"也会被当成"前端起来了"。
      await waitFor(`${apiBase}/readyz`, timeoutMs, '后端', looksLikeApi, apiProc);
      await waitFor(webBase, timeoutMs, '前端', looksLikeWeb, webProc);
      return {
        apiBase,
        webBase,
        env: {
          E2E_API_BASE: apiBase,
          E2E_BASE_URL: webBase,
        },
        stop,
        logs: () => logChunks.join(''),
      };
    } catch (err) {
      lastError = err;
      // 服务起不来时把子进程的输出留下来 —— "没就绪"本身没有诊断价值，
      // 是端口被占、数据库锁住、还是代码启动就崩了，只有日志说了算。
      // 这一轮失败后不重置累积日志：三次尝试的日志连起来更能看出规律。
      lastLogs = logChunks.join('');
      await stopServers();
    }
  }

  await modelStub.stop();
  throw new Error(
    `起服务失败（已重试 3 次）：${lastError instanceof Error ? lastError.message : String(lastError)}` +
      (lastLogs ? `\n\n--- 子进程日志 ---\n${lastLogs}` : '\n\n（子进程没有输出 —— 进程可能压根没起来）')
  );
}

/** 判断某地址上是否已经有服务在跑 */
export async function isUp(base: string): Promise<boolean> {
  try {
    const res = await fetch(base, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}
