/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * E2E 服务编排 —— 为前后端集成测试拉起真实的后端与前端
 * ---------------------------------------------------------------------------
 * 为什么需要这个文件：
 *
 *   `e2e/integration.e2e.ts` 断言的是**真实浏览器 + 真实服务端**下的行为。
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

import { startModelStub, type ModelStubHandle } from './model-stub.ts';

const ROOT = new URL('../../', import.meta.url).pathname;

export interface ServerOptions {
  /** 后端端口（不给就现找一个没人监听的） */
  apiPort?: number;
  /** 前端端口（不给就现找一个没人监听的） */
  webPort?: number;
  /** 启动超时（毫秒） */
  timeoutMs?: number;
  /** PGlite 数据目录（默认 .data/e2e-pglite） */
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
  isReady: (res: Response) => Promise<boolean>
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = '（无响应）';
  while (Date.now() < deadline) {
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

/** 后端必须是**后端** —— /healthz 返回带 data.status 的信封 */
async function looksLikeApi(res: Response): Promise<boolean> {
  try {
    const body = (await res.json()) as { data?: { status?: string } };
    return body?.data?.status === 'ok';
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
  const dataDir = opts.dataDir ?? './.data/e2e-pglite';

  // 模型端点替身 —— E2E 离线跑（见 model-stub.ts 里的理由）。
  // 放在重试循环**外面**：它不占固定端口，且与 API 进程的生命周期无关。
  const modelStub: ModelStubHandle = await startModelStub();

  let lastError: unknown = null;
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
        STORAGE_DIR: './.data/e2e-artifacts',
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
      await waitFor(`${apiBase}/healthz`, timeoutMs, '后端', looksLikeApi);
      await waitFor(webBase, timeoutMs, '前端', looksLikeWeb);
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
      await stopServers();
    }
  }

  await modelStub.stop();
  throw new Error(
    `起服务失败（已重试 3 次）：${lastError instanceof Error ? lastError.message : String(lastError)}`
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
