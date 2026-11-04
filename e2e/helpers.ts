/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * E2E 共享夹具
 * ---------------------------------------------------------------------------
 * 存在的原因只有一个：**让每条用例自包含**。
 *
 * 以前整套 E2E 是一条顺序流程，状态挂在模块级变量上（projectId / slideId / versionId），
 * 后果是：
 *   · 前面的用例一挂，后面全部跟着挂 —— 报错变成"projectId 是空的"而不是真因
 *   · 注入检查只能对整文件跑（wholeFile），因为单独跑一个用例会因为"前置没做"而失败
 *     —— 而"前置没做导致的失败"和"抓到了注入的错误"是两回事，混在一起就是假阳性
 *
 * 现在每条用例自己准备前置状态，测试之间互不依赖：
 *   · 失败不级联
 *   · 注入检查可以只跑被注入的那一条用例 —— 失败就一定来自它
 *
 * ---------------------------------------------------------------------------
 * 两条规矩（沿用原 E2E 的约定）：
 *
 *   1. **断言落在服务端状态上**，不是 UI 文本。
 *      UI 操作了什么 → 服务端库里到底存了什么。
 *      只断言 UI 文本的话，把后端整个换成假实现也能通过。
 *
 *   2. **用外部可辨识标记**，不用「不等于空」这种弱断言。
 *      任何硬编码演示文案都不可能命中 `unique()` 生成的标记。
 */

import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

export const BASE_URL = process.env['E2E_BASE_URL'] ?? 'http://127.0.0.1:5173';
export const API_BASE = process.env['E2E_API_BASE'] ?? 'http://127.0.0.1:3000';

/** 单个用例超时 —— 真实浏览器 + 真实服务端，比单元测试慢得多 */
export const TEST_TIMEOUT = 180_000;

/**
 * 单次 API 调用的超时。
 *
 * 没有超时的等待是**最坏的一种失败**：断言还没开始报错，整条链就卡死在那里，
 * 报告上只剩一句"这个用例超时了"，真正的卡点被埋掉了。
 * 这里给每一处等待都加上闸 —— 宁可明确失败，也不要无声挂起。
 */
export const API_TIMEOUT_MS = 30_000;

/** 拉起浏览器 / 探活的超时 */
const LAUNCH_TIMEOUT_MS = 30_000;
const PROBE_TIMEOUT_MS = 5_000;

/* -------------------------------------------------------------------------- */
/* 可视化开关 —— 让「浏览器在干什么」看得见                                    */
/* -------------------------------------------------------------------------- */
/*
 * 默认**无头**：流水线里没有显示器，无头是唯一能跑的选择。
 * 但"无头跑过了"和"人眼看过它跑过"是两件事 ——
 * 前者只证明断言成立，后者才排除"页面其实白屏、断言恰好没查那里"这类假绿。
 *
 * 所以这里把可见性做成开关，而不是二选一：
 *
 *   E2E_HEADFUL=1   弹真窗口，人眼直接看
 *   E2E_SLOWMO=200  每个动作之间放慢 200ms（看清动作序列）
 *   E2E_VIDEO=1     每个会话录一段 webm（事后逐帧回看）
 *   E2E_SHOTS=1     每个会话结束时留一张整页截图
 *   E2E_TRACE=1     Playwright trace（`bunx playwright show-trace` 可交互回放）
 *   E2E_HOLD_MS=500 每个会话的页面在关掉之前多留 500ms（看清这一步之后长什么样）
 *
 * 有头模式下页面是**一个用例一个窗口** ——
 * 用例一断言完就换下一个，窗口一闪而过。
 * E2E_HOLD_MS 就是补这个的：让这一页在屏幕上多停一会儿再拆。
 */

/** 有头模式 —— 真窗口 */
const HEADFUL = process.env['E2E_HEADFUL'] === '1';
/** 动作放慢（毫秒） */
const SLOWMO_MS = Number(process.env['E2E_SLOWMO'] ?? '0') || 0;
/** 录像 */
const VIDEO = process.env['E2E_VIDEO'] === '1';
/** 截图 */
const SHOTS = process.env['E2E_SHOTS'] === '1';
/** trace */
const TRACE = process.env['E2E_TRACE'] === '1';
/** 每个会话的页面在屏幕上多留多久（毫秒） */
const HOLD_MS = Number(process.env['E2E_HOLD_MS'] ?? '0') || 0;

/** 录像 / 截图 / trace 的落盘目录 */
const MEDIA_DIR = process.env['E2E_MEDIA_DIR'] ?? './spec/evidence/e2e-media';
/** 当前链的名字 —— 编排者给的，用来给产物起能看懂的文件名 */
const CHAIN = process.env['E2E_CHAIN'] ?? 'chain';

/** 媒体产物的路径（顺便建好目录） */
function mediaPath(...parts: string[]): string {
  const dir = `${MEDIA_DIR}/${CHAIN}`;
  mkdirSync(dir, { recursive: true });
  return `${dir}/${parts.join('-')}`;
}

let seq = 0;

/**
 * 唯一标记 —— 任何夹具都不会碰巧长这样。
 *
 * 断言用 `toContain(MARK)` 而不是 `not.toBe('')`：
 * 后者对"返回了另一个错误的东西"照样通过。
 */
export function unique(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** 响应信封 —— 成功 { data, traceId }，失败 { error: { code, message, details? }, traceId } */
export interface ApiEnvelope<T = unknown> {
  data?: T;
  error?: { code: string; message: string; details?: Record<string, unknown> };
  traceId?: string;
}

export interface ApiResult<T = unknown> {
  status: number;
  body: ApiEnvelope<T>;
}

/**
 * 确保页面已经落在应用上。
 *
 * 相对路径的 fetch 需要一个真实 origin —— 在 `about:blank` 上跑
 * `fetch('/api/...')` 直接抛 "Failed to parse URL"。
 * 而跨 origin 的绝对 URL 又会被 CORS 挡掉（opaque origin 发不出带 Cookie 的请求）。
 * 所以：**先导航到应用，再打 API**。
 */
export async function ensureOnApp(page: Page): Promise<void> {
  const current = page.url();
  if (current === 'about:blank' || !current.startsWith(BASE_URL)) {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  }
}

/**
 * 在页面上下文里打 API —— 复用浏览器里的会话 Cookie。
 *
 * 走 `page.evaluate` 而不是 Node 侧 fetch：会话在 Cookie 里，
 * Node 侧没有浏览器上下文就拿不到它。
 */
export async function apiFetch<T = unknown>(
  page: Page,
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<ApiResult<T>> {
  await ensureOnApp(page);
  const call = page.evaluate(
    async (args: { path: string; init?: { method?: string; body?: unknown }; timeoutMs: number }) => {
      const res = await fetch(args.path, {
        method: args.init?.method ?? 'GET',
        credentials: 'include',
        headers: args.init?.body ? { 'content-type': 'application/json' } : undefined,
        body: args.init?.body ? JSON.stringify(args.init.body) : undefined,
        signal: AbortSignal.timeout(args.timeoutMs),
      });
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = { __raw: text };
      }
      return { status: res.status, body: parsed };
    },
    { path, init, timeoutMs: API_TIMEOUT_MS }
  ) as Promise<ApiResult<T>>;

  // page.evaluate 本身**没有超时** —— 页面卡死时它会永远挂着。
  // 从外面再压一道闸：宁可抛错，也不要让整条链卡住。
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      call,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`API 调用超时（${API_TIMEOUT_MS}ms）：${path}`)),
          API_TIMEOUT_MS + 5_000
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 轮询直到条件成立 —— 不用固定 sleep（那是掷硬币） */
export async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs: number,
  label: string
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`等待超时（${timeoutMs}ms）：${label}`);
}

/* -------------------------------------------------------------------------- */
/* 浏览器会话                                                                  */
/* -------------------------------------------------------------------------- */

/** 一条会话 —— 一个独立浏览器上下文，Cookie 与别的用例互不干扰 */
export interface Session {
  context: BrowserContext;
  page: Page;
  /** 浏览器侧证据：console / 请求失败 / 4xx+ 响应 / 未捕获异常 */
  logs: string[];
  /**
   * 步骤标记 —— 把"卡在哪一步"写进证据。
   *
   * 超时只会告诉你"这个用例超时了"，标记能告诉你它停在了哪一步。
   */
  mark: (label: string) => void;
  /** 外部（非应用源）请求的处理情况 —— 用来证明"外部确实不可达"而不是用例空洞 */
  externalRequests: { blocked: number; stalled: number };
  /** 关闭并落盘证据 */
  close: () => Promise<void>;
}

/**
 * 外部请求策略。
 *
 * - `block`（默认）：应用源以外的请求一律**掐断**。
 *   E2E 的结论不能依赖外网状态 —— 外部 CDN 抖一次，整条链就会以
 *   "用例超时" 的形式挂掉，而那不是被测实现的锅。
 * - `stall`：应用源以外的请求**挂起**（模拟"外网不可达但不报错"）。
 *   用来验证"外部资源不可达时应用仍能启动"。
 */
export type ExternalPolicy = 'block' | 'stall';

export interface SessionOptions {
  /** 外部请求策略，默认 block */
  external?: ExternalPolicy;
}

export interface Harness {
  browser: Browser;
  /** 开一条新会话（独立上下文） */
  newSession: (opts?: SessionOptions) => Promise<Session>;
  /** 汇总所有会话的浏览器日志并落盘 */
  close: () => Promise<void>;
}

/** 应用自己的源 —— 浏览器只跟它说话 */
const APP_ORIGIN = new URL(BASE_URL).origin;

/** 外部资源被挂起多久后放弃（够慢，慢到足以证伪"卡住就不会白屏"） */
const STALL_MS = 20_000;

/** 这条请求是不是"应用源之外"的 */
function isExternalRequest(url: string): boolean {
  if (
    url.startsWith('data:') ||
    url.startsWith('blob:') ||
    url.startsWith('about:') ||
    url.startsWith('chrome-extension:')
  ) {
    return false;
  }
  try {
    return new URL(url).origin !== APP_ORIGIN;
  } catch {
    return true;
  }
}


/**
 * 探活 —— 服务没起来要立刻报错，不能让后面的断言"莫名其妙地失败"。
 *
 * 探活认**身份**，不只看 `res.ok`：
 * 后端回 JSON 信封、前端回 HTML —— 端口撞车时后端和前端可能拿到同一个端口，
 * 只看 `res.ok` 会把"前端起来了"判成假的。
 *
 * 后端探的是 `/readyz`（就绪，会 ping DB）而不是 `/healthz`（存活，不碰 DB）：
 * DB 不可用时 `/healthz` 照样 200，于是自动化判"后端就绪"，
 * 接着每条要写库的用例都 500 —— 症状指向业务代码，根因在探针探错了地方。
 */
export async function assertServersUp(): Promise<void> {
  const health = await fetch(`${API_BASE}/readyz`, {
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  }).catch(() => null);
  if (!health || !health.ok) {
    throw new Error(
      `后端未就绪（${API_BASE}/readyz —— 就绪探针会检查数据库是否可用）。` +
        `请先启动：bun run apps/api/src/index.ts`
    );
  }
  const front = await fetch(BASE_URL, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) }).catch(
    () => null
  );
  if (!front || !front.ok) {
    throw new Error(`前端未就绪（${BASE_URL}）。请先启动：bunx vite --port 5173`);
  }
}

export async function launchHarness(): Promise<Harness> {
  // 浏览器拉不起来时**明确失败** —— 没有超时的 launch 会挂在那里，
  // 表现成"整条链卡住"，看不出是环境问题还是实现问题。
  //
  // headless 默认 true（流水线里没有显示器）。
  // E2E_HEADFUL=1 时弹真窗口 —— 人眼直接看浏览器在干什么。
  // slowMo 让每个动作之间留出可看清的间隔（E2E_SLOWMO=毫秒）。
  const browser = await chromium.launch({
    timeout: LAUNCH_TIMEOUT_MS,
    headless: !HEADFUL,
    ...(SLOWMO_MS > 0 ? { slowMo: SLOWMO_MS } : {}),
  });
  if (HEADFUL) {
    console.log(`[e2e] 有头模式：浏览器窗口已弹出（链 ${CHAIN}）`);
  }
  const allLogs: string[] = [];
  let sessionsCreated = 0;

  // CPU 采样器（E2E_CPU_PROFILE=1 开启）——
  //
  // **必须挂在浏览器级会话上**：CDP 的 Tracing 域是**整个浏览器一份**，
  // 在页面级会话上调 Tracing.start 会报
  // "Tracing has already been started (possibly in another tab)" ——
  // 也就是说挂在页面上只能采到第一个页面的数据，后面全是空的。
  //
  // 为什么非它不可：页面被堵死时，`Debugger.pause` 叫不醒它，
  // 只剩"页面卡住了"这个现象、没有原因。
  // V8 的采样线程**独立于渲染主线程**，主线程被长任务堵死时采样照样出，
  // 样本经浏览器进程转发给客户端，**不需要主线程回话** ——
  // 这是唯一能在"页面已经卡死"之后还拿到"它当时在跑什么"的手段。
  const profiler =
    process.env['E2E_CPU_PROFILE'] === '1' ? await startCpuProfiler(browser) : null;

  // 浏览器侧证据的落盘位置 —— 注入检查每轮都重起服务，共用一个文件会互相覆盖，
  // 所以可以用 E2E_LOG_FILE 换路径。
  const logFile = process.env['E2E_LOG_FILE'] ?? './spec/evidence/e2e-browser.log';

  // 一轮里第一条链开跑时把证据文件清空 —— 之后各链**追加**。
  //
  // 追加而不是各链覆盖，是因为出问题的往往不是第一条链：
  // 前一条链留下的痕迹（页面停在哪一步、最后一条请求是什么）正是断线的现场。
  //
  // **谁负责清空由外层决定**（E2E_LOG_RESET=1），不由本进程自己判断 ——
  // 现在每条链是**独立进程**（见 spec/verify/run-e2e.ts），
  // 进程内的"第一次"标记每条链都会命中一次，于是每条链都把文件清一遍，
  // 最后只剩下最后一条链的痕迹 —— 现场全丢了。
  // 于是：编排者（run-e2e.ts）只在**第一条链**上给 E2E_LOG_RESET=1，
  // 后面的链一律追加。
  if (process.env['E2E_LOG_RESET'] === '1') {
    try {
      writeFileSync(logFile, '', 'utf-8');
    } catch {
      /* 落盘失败不影响测试结论 */
    }
  }

  // **边发生边落盘**，不等 close()。
  //
  // 等到关浏览器时才写，等于"链挂住了就什么都留不下" ——
  // 而链挂住恰恰是最需要线索的时候。
  const flush = (line: string): void => {
    try {
      appendFileSync(logFile, `${line}\n`, 'utf-8');
    } catch {
      /* 落盘失败不影响测试结论 */
    }
  };

  const newSession = async (opts: SessionOptions = {}): Promise<Session> => {
    const externalPolicy: ExternalPolicy = opts.external ?? 'block';
    // 录像与 trace 都挂在**上下文**上 —— 页面级拿不到。
    // 录像在上下文关闭时才落盘，所以 handle 必须在关之前握住（见 close）。
    const context = await browser.newContext({
      baseURL: BASE_URL,
      ...(VIDEO
        ? { recordVideo: { dir: mediaPath('video-raw'), size: { width: 1280, height: 800 } } }
        : {}),
    });
    // trace 必须**显式 start** —— `browser.newContext()` 没有 `trace` 选项
    // （那是测试运行器 fixture 的参数）。传进去会被静默忽略，
    // 于是收尾时 `tracing.stop()` 报 "Must start tracing before stopping"。
    //
    // 注意 `tracing.start()` 也没有 `mode` 参数（那是 fixture 的）——
    // 它只有 live / screenshots / snapshots / sources 这几个。
    if (TRACE) {
      // 这里不能用 record() —— 它在下面才定义（const 的暂时性死区），
      // 启动失败时回调可能跑在定义之前。退一步打终端。
      await context.tracing
        .start({ screenshots: true, snapshots: true })
        .catch((e: unknown) =>
          console.log(`[media] trace 启动失败：${e instanceof Error ? e.message : String(e)}`)
        );
    }
    const page = await context.newPage();
    const video = VIDEO ? page.video() : null;
    const logs: string[] = [];
    const externalRequests = { blocked: 0, stalled: 0 };
    sessionsCreated += 1;
    const sessionNo = sessionsCreated;

    // 页面心跳 —— 用来分辨"元素找不到"和"主线程被堵死"这两种完全不同的失败。
    //
    // Playwright 的可操作性检查（visible / enabled / stable）跑在页面主线程上；
    // 它返回了"element is visible, enabled and stable"，说明**那一刻**主线程还是活的。
    // 紧接着的 `DOM.scrollIntoViewIfNeeded` 却卡死 —— 那是一条 CDP 命令，
    // 同样要主线程回话。它不回话，只有两种可能：
    //   · 主线程被一个长任务堵住了（页面里死循环 / 超大计算）
    //   · 渲染进程已经死了
    //
    // 这两种根因的修法完全不同，所以必须分开记下来 —— 光看"点击超时"分不出来。
    //
    // 心跳本身用 setInterval 计时：**只有主线程空下来时才会走**，
    // 于是心跳的最大间隔就是"主线程被堵了多久"的直接证据。
    await context.addInitScript(() => {
      const w = window as unknown as {
        __hb?: { count: number; maxGap: number; last: number };
      };
      const hb = { count: 0, maxGap: 0, last: performance.now() };
      w.__hb = hb;
      setInterval(() => {
        const now = performance.now();
        const gap = now - hb.last;
        if (gap > hb.maxGap) hb.maxGap = gap;
        hb.last = now;
        hb.count += 1;
      }, 100);
    });

    // 密闭化 —— 应用源以外的请求按策略处理。
    //
    // 这条闸门是 E2E 结论可信的前提：外部 CDN 抖一次，整条链就会以
    // "用例超时" 的形式挂掉，而那不是被测实现的锅（真实发生过：
    // 字体 CDN 不可达 ⇒ 渲染阻塞样式表 ⇒ 脚本不执行 ⇒ 白屏 ⇒
    // 每条用例都卡在 page.goto 上）。
    //
    // 'stall' 策略下不报错，只是**挂起** —— 用来验证
    // "外部资源不可达时应用外壳仍然起得来"。
    //
    // 注意：handler 里要用到 record，所以注册必须排在 record 定义之后。
    const installExternalPolicy = async (): Promise<void> => {
      await context.route('**/*', async (route) => {
        const url = route.request().url();
        if (!isExternalRequest(url)) {
          // continue() 在页面关闭时可能 reject —— 不接住会变成未处理的 rejection，
          // 把 bun test 进程带走。
          await route.continue().catch(() => {});
          return;
        }
        if (externalPolicy === 'stall') {
          externalRequests.stalled += 1;
          record(`[external:stall] ${url}`);
          await new Promise((r) => setTimeout(r, STALL_MS));
          await route.abort('timedout').catch(() => {});
          return;
        }
        externalRequests.blocked += 1;
        record(`[external:block] ${url}`);
        await route.abort('blockedbyclient').catch(() => {});
      });
    };

    // 同时落到 allLogs —— 落盘的那份证据要包含**所有**会话的日志，
    // 而不是只有最后一个（否则前几条用例的线索就丢了）。
    const record = (line: string): void => {
      const stamped = `[${new Date().toISOString().slice(11, 23)}] ${line}`;
      logs.push(stamped);
      allLogs.push(stamped);
      flush(stamped);
    };

    await installExternalPolicy();

    // 断言失败时，"哪条请求没发出去 / 报了什么错"是最关键的线索。
    // 只留 console / 请求失败 / 4xx+ / 未捕获异常四类，不记全部流量（噪音太大）。
    page.on('console', (msg) => {
      record(`[console:${msg.type()}] ${msg.text()}`);
      // 有头模式下把页面 console 直接打到终端 ——
      // 窗口会一闪而过，但终端上的这行会留下来，
      // 于是"浏览器当时在打印什么"事后也能查。
      if (HEADFUL) {
        console.log(`[page:${msg.type()}] ${msg.text()}`);
      }
    });
    page.on('pageerror', (err) => {
      record(`[pageerror] ${err.message}`);
    });
    // 渲染进程崩了 —— 这时候页面上的任何操作都不会再有回音，
    // 表现成"点击永远超时"。不记这一条的话，只能靠猜。
    page.on('crash', () => {
      record('[page:crash] 渲染进程崩溃');
    });
    page.on('requestfailed', (req) => {
      record(
        `[requestfailed] ${req.method()} ${req.url()} —— ${req.failure()?.errorText ?? '未知原因'}`
      );
    });
    page.on('response', (res) => {
      if (res.status() >= 400) {
        record(`[http ${res.status()}] ${res.request().method()} ${res.url()}`);
      }
    });
    // 全量请求追踪 —— 默认关着，排查"页面卡在哪个请求上"时开（E2E_TRACE_REQUESTS=1）。
    // 成功请求也要看：卡住的时候，浏览器到底在等哪个响应，是唯一有用的线索。
    if (process.env['E2E_TRACE_REQUESTS'] === '1') {
      page.on('request', (req) => {
        record(`[req] ${req.method()} ${req.url()}`);
      });
      page.on('requestfinished', (req) => {
        record(`[req-done] ${req.method()} ${req.url()}`);
      });
    }
    // 页面导航 —— 用来看"卡住的时候页面停在哪一步"
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) record(`[nav] ${frame.url()}`);
    });

    // 卡住时的**现场取证**：用 CDP 的调试器把被堵死的主线程叫停，
    // 拿到它当时正在执行的 JS 调用栈。
    //
    // 为什么非它不可：
    //   页面无应答时，page.evaluate / screenshot 全都叫不醒它 ——
    //   能叫醒的只有 V8 自己的中断机制（Debugger.pause）。
    //   拿不到栈，就只能知道"页面卡住了"，不知道"卡在哪一行"，
    //   而后者才是能改的东西。
    //
    // 平时不启用（每次会话开一个 CDP 连接有开销），只在探测到页面无应答时才接。
    const cdp = await context.newCDPSession(page).catch(() => null);
    let pausedFrames: string[] = [];

    if (cdp) {
      cdp.on('Debugger.paused', (event) => {
        pausedFrames = event.callFrames
          .slice(0, 8)
          .map(
            (f) =>
              `${f.functionName || '(匿名)'} @ ${f.url.split('/').pop() ?? '?'}:${f.location.lineNumber + 1}`
          );
      });
    }
    const captureStack = async (): Promise<void> => {
      if (!cdp || pausedFrames.length > 0) return;
      // **每条 CDP 命令都要带闸** —— 页面被堵死时，cdp.send 可能永远不回来
      // （实测：`Debugger.enable` 在卡死的渲染进程上就再也回不来，
      //   于是这一段"取证代码"自己变成了挂死现场的一部分）。
      const withGate = async (p: Promise<unknown>): Promise<void> => {
        await Promise.race([
          p.catch(() => {}),
          new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
        ]);
      };
      await withGate(cdp.send('Debugger.enable'));
      await withGate(cdp.send('Debugger.pause'));
      // 停下来的页面要放行 —— 不然它永远醒不过来
      await withGate(cdp.send('Debugger.resume'));
      if (pausedFrames.length > 0) {
        record(`[stack] 被堵住时主线程的调用栈：\n    ${pausedFrames.join('\n    ')}`);
      } else {
        record('[stack] 拿不到调用栈（调试器没能打断它）');
      }
    };

    /**
     * 把 CPU 采样整理成"哪段代码吃掉了时间"。
     *
     * 采样事件是 V8 的 `ProfileChunk`：每个 chunk 带一段节点表（id → 调用帧）
     * 和一段样本序列（每个样本是节点 id，附带距上一个样本的时间差）。
     * 按节点 id 累加时间差就是**自身耗时**（self time），
     * 排前面的那几个就是主线程真正在跑的东西。
     */
    const dumpCpuProfile = async (): Promise<void> => {
      if (!profiler) {
        record('[cpu] 没开采样（E2E_CPU_PROFILE=1 才开）');
        return;
      }
      const text = await profiler.dump();
      record(text);
    };

    return {
      context,
      page,
      logs,
      externalRequests,
      mark: (label: string) => record(`[mark] ${label}`),
      close: async () => {
        // 关会话前先探一次"页面还能不能应答"——
        //
        // 用例失败时最需要分清的两件事：
        //   · 页面正常，只是没找到元素      → 实现/选择器问题
        //   · 页面根本不应答（主线程堵死） → 运行时问题，断言压根没跑到
        //
        // page.evaluate 没有超时，页面卡住时它永远不返回 ——
        // 所以在外面再压一道 3 秒的闸，答不上来就记"无应答"。
        const probe = await Promise.race([
          page
            .evaluate(() => {
              const hb = (window as unknown as { __hb?: { count: number; maxGap: number } }).__hb;
              return {
                readyState: document.readyState,
                url: location.href,
                hbCount: hb?.count ?? -1,
                hbMaxGap: Math.round(hb?.maxGap ?? -1),
              };
            })
            .then((v) => ({ alive: true as const, v }))
            .catch((e: unknown) => ({
              alive: false as const,
              v: { error: e instanceof Error ? e.message : String(e) },
            })),
          new Promise<{ alive: false; v: { error: string } }>((resolve) =>
            setTimeout(() => resolve({ alive: false, v: { error: 'evaluate 3 秒内没回话' } }), 3_000)
          ),
        ]);
        if (probe.alive) {
          record(
            `[probe] 页面存活 readyState=${probe.v.readyState} 心跳=${probe.v.hbCount} 次 ` +
              `最大空档=${probe.v.hbMaxGap}ms url=${probe.v.url}`
          );
        } else {
          record(`[probe] 页面无应答（${probe.v.error}）`);
          // 顺序要紧：**先抓 CPU 采样**（不依赖主线程，一定能拿到），
          // 再试着打断主线程（可能失败，而且可能把关会话拖住）。
          await dumpCpuProfile();
          await captureStack();
        }

        // ---- 可视化产物：截图 + trace ----
        //
        // 顺序要紧：**截图与 trace 必须在 context 关闭之前拿到** ——
        //   · 页面一旦关掉，page.screenshot() 会直接抛
        //     "Target page, context or browser has been closed"；
        //   · trace 也是在 context 关闭时随上下文一起收尾的，
        //     关完就取不出来了（这跟录像正好相反，见下）。
        if (SHOTS) {
          const shot = mediaPath(`shot-${String(sessionNo).padStart(2, '0')}.png`);
          await page
            .screenshot({ path: shot, fullPage: true, timeout: 10_000 })
            .then(() => record(`[media] 截图：${shot}`))
            .catch((e: unknown) =>
              record(`[media] 截图失败：${e instanceof Error ? e.message : String(e)}`)
            );
        }
        if (TRACE) {
          const dest = mediaPath(`trace-${String(sessionNo).padStart(2, '0')}.zip`);
          await context
            .tracing.stop({ path: dest })
            .then(() => record(`[media] trace：${dest}`))
            .catch((e: unknown) =>
              record(`[media] trace 保存失败：${e instanceof Error ? e.message : String(e)}`)
            );
        }

        // 关上下文之前，让这一页**留在屏幕上**一会儿 ——
        // 有头模式的意义就在这里：断言一跑完窗口就消失的话，等于没开。
        // 用例之间页面会被换掉，只有这几十毫秒能让人眼看清"这一步之后页面长什么样"。
        if (HOLD_MS > 0 && HEADFUL) {
          console.log(`[e2e] 会话 ${sessionNo} 的页面保留 ${HOLD_MS}ms 供人眼查看…`);
          await new Promise<void>((resolve) => setTimeout(resolve, HOLD_MS));
        }

        // 关上下文也要有闸 —— context.close() 本身**没有超时**，
        // 页面里挂着未完成的请求时它能一直不返回，把整条链的预算吃光。
        await Promise.race([
          context.close().catch(() => {}),
          new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
        ]);

        // ---- 可视化产物：录像 ----
        //
        // 录像**必须在 context 关闭之后**才拿得到完整文件 ——
        // Playwright 是随着上下文关闭才把视频写完的，
        // 关之前 saveAs 拿到的是半截。
        if (video) {
          const dest = mediaPath(`video-${String(sessionNo).padStart(2, '0')}.webm`);
          await video
            .saveAs(dest)
            .then(() => record(`[media] 录像：${dest}`))
            .catch((e: unknown) =>
              record(`[media] 录像保存失败：${e instanceof Error ? e.message : String(e)}`)
            );
          // 原始文件留着没意义（名字是一串随机数），删掉只留能看懂的那份
          try {
            rmSync(await video.path(), { force: true });
          } catch {
            /* 删不掉也不影响结论 */
          }
        }
      },
    };
  };

  return {
    browser,
    newSession,
    close: async () => {
      // 关浏览器之前先记一笔"现场"：开了多少会话、还剩多少上下文、
      // 以及系统里还挂着几个浏览器进程。
      //
      // 为什么记进程数：每条链都自己 launch 一个浏览器，
      // 关闭又只有 3 秒的闸 —— 闸一到就放弃，浏览器就留在那儿了。
      // 九条链九个浏览器，全都活着的话，
      // 机器会被一堆空转的渲染进程拖慢，
      // 于是"点击超时"这种跟实现毫无关系的症状就冒出来了。
      // 这个数字是判断"是不是资源被自己人吃掉了"的唯一直接证据。
      const leftover = countBrowserProcesses();
      flush(
        `[harness] 关闭浏览器：会话 ${sessionsCreated} 个，` +
          `未关闭的上下文 ${browser.contexts().length} 个，系统里浏览器进程 ${leftover} 个`
      );

      // 关浏览器也要有闸 —— 浏览器关不掉时，afterAll 会把整个测试进程挂住。
      // 闸门必须**短于 bun 的钩子超时（5s）**，否则钩子先超时、证据反而丢在后面。
      await Promise.race([
        browser.close().catch(() => {}),
        new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
      ]);
    },
  };
}

/**
 * 浏览器级 CPU 采样器。
 *
 * 采样事件是 V8 的 `ProfileChunk`：每个 chunk 带一段节点表（id → 调用帧）
 * 和一段样本序列（样本是节点 id，附带距上一个样本的时间差）。
 * 按节点 id 累加时间差就是**自身耗时**（self time），
 * 排前面的那几个就是主线程真正在跑的东西。
 *
 * 一个坑：**事件是在 Tracing.end 之后才成批到的**。
 * 所以 dump 的顺序必须是「end → 等一会儿 → 再读缓冲」，
 * 不能在 end 之前读（读到的是空的），也不能等 tracingComplete
 * （渲染进程卡死时那个事件可能永远不来）。
 */
interface CpuProfiler {
  /** 收尾并把"主线程在跑什么"整理成一段文本 */
  dump: () => Promise<string>;
}

async function startCpuProfiler(browser: Browser): Promise<CpuProfiler | null> {
  const cdp = await browser.newBrowserCDPSession().catch(() => null);
  if (!cdp) return null;

  const chunks: Array<{ name?: string; args?: unknown }> = [];
  cdp.on('Tracing.dataCollected', (payload: { value?: Array<{ name?: string; args?: unknown }> }) => {
    chunks.push(...(payload.value ?? []).map((v) => ({ name: v.name ?? '', args: v.args })));
  });

  const start = async (): Promise<void> => {
    // 每条 CDP 命令都要带闸 —— 渲染进程卡死时 cdp.send 可能永远不回来
    await Promise.race([
      cdp
        .send('Tracing.start', {
          categories: 'disabled-by-default-v8.cpu_profiler',
          transferMode: 'ReportEvents',
        })
        .catch(() => {}),
      new Promise<void>((r) => setTimeout(r, 3_000)),
    ]);
  };
  await start();

  return {
    dump: async (): Promise<string> => {
      await Promise.race([
        cdp.send('Tracing.end').catch(() => {}),
        new Promise<void>((r) => setTimeout(r, 3_000)),
      ]);
      // 事件是 end 之后成批到的 —— 给它一点时间到达
      await Bun.sleep(1_500);

      const frames = new Map<number, { functionName: string; url: string; lineNumber: number }>();
      const self = new Map<number, number>();
      let total = 0;
      for (const ev of chunks) {
        if (ev.name !== 'ProfileChunk') continue;
        const data = (
          ev.args as {
            data?: {
              cpuProfile?: {
                nodes?: Array<{
                  id: number;
                  callFrame: { functionName?: string; url?: string; lineNumber?: number };
                }>;
                samples?: number[];
                timeDeltas?: number[];
              };
            };
          } | undefined
        )?.data;
        const prof = data?.cpuProfile;
        if (!prof) continue;
        for (const node of prof.nodes ?? []) {
          frames.set(node.id, {
            functionName: node.callFrame.functionName ?? '',
            url: node.callFrame.url ?? '',
            lineNumber: node.callFrame.lineNumber ?? 0,
          });
        }
        const samples = prof.samples ?? [];
        const deltas = prof.timeDeltas ?? [];
        for (let i = 0; i < samples.length; i++) {
          const id = samples[i]!;
          const dt = deltas[i] ?? 0;
          self.set(id, (self.get(id) ?? 0) + dt);
          total += dt;
        }
      }

      // 采样停了要重新开 —— 不然后面再有页面卡死就没证据了
      chunks.length = 0;
      await start();

      if (total === 0) {
        return '[cpu] 采样为空 —— 主线程可能压根没在跑 JS（卡在渲染/布局上），或采样没开起来';
      }
      const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
      const lines = top
        .map(([id, us]) => {
          const f = frames.get(id);
          if (!f) return null;
          const file = f.url.split('/').pop() ?? '?';
          return `    ${(us / 1000).toFixed(1).padStart(9)}ms  ${f.functionName || '(匿名)'}  ${file}:${f.lineNumber + 1}`;
        })
        .filter((l): l is string => l !== null);
      return `[cpu] 主线程 CPU 采样（浏览器总计 ${(total / 1000).toFixed(0)}ms）：\n${lines.join('\n')}`;
    },
  };
}

/**
 * 系统里还挂着几个浏览器进程。
 *
 * Playwright 无头模式用的是 `headless_shell`（不是 `Chromium`）——
 * 早期用 pgrep 找 "Chromium" 找的是用户自己开的浏览器，
 * 于是"还有没有残留浏览器"这个问题被测了个寂寞。
 *
 * 现在按**安装目录**匹配 `ms-playwright/chromium`：
 *   · 无头：`ms-playwright/chromium_headless_shell/…`
 *   · 有头：`ms-playwright/chromium-1234/chrome-mac/Chromium.app/…`
 * 两种都命中，而用户自己开的 Chrome（`/Applications/Google Chrome.app`）不命中。
 */
function countBrowserProcesses(): number {
  try {
    const proc = Bun.spawnSync(['pgrep', '-f', 'ms-playwright/chromium']);
    const out = proc.stdout.toString().trim();
    return out === '' ? 0 : out.split('\n').length;
  } catch {
    return -1;
  }
}

/**
 * 未捕获异常 —— 应用崩了的话这里会有一条。
 *
 * React 没有错误边界，一个 undefined 就能把整个应用打崩；
 * 页面看起来"还在"，但什么都不响应。断言失败时先看这里。
 */
export function uncaughtErrors(logs: string[]): string[] {
  return logs.filter((l) => l.startsWith('[pageerror]'));
}

/* -------------------------------------------------------------------------- */
/* 夹具 —— 通过 API 布置状态（arrange），被测动作仍然走 UI（act）              */
/* -------------------------------------------------------------------------- */

export interface Account {
  email: string;
  password: string;
  name: string;
}

export function makeAccount(): Account {
  return {
    email: `e2e-${unique('user')}@example.com`,
    password: 'e2e-password-123',
    name: 'E2E 测试用户',
  };
}

/**
 * 通过 API 注册一个账号（**布置**，不是被测动作）。
 *
 * 被测动作是"UI 点了之后发生什么"时，前置状态不必也走 UI ——
 * 走 UI 会让每条用例都慢一大截，而且把"被测的那一步"稀释在几十步噪声里。
 *
 * 注意：注册会**同时下发会话 Cookie**，所以这个页面紧接着就是"已登录"状态。
 * 要测"登录"这条路，用 {@link createAccountInOtherContext} ——
 * 在一个用完就扔的上下文里注册，账号留在服务端，会话不落在被测的上下文里。
 */
export async function createAccountViaApi(page: Page, account: Account): Promise<Account> {
  const res = await apiFetch<{ user: { id: string; email: string } }>(
    page,
    '/api/auth/register',
    {
      method: 'POST',
      body: { email: account.email, password: account.password, name: account.name },
    }
  );
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`注册失败：HTTP ${res.status} ${JSON.stringify(res.body)}`);
  }
  return account;
}

/**
 * 在一个**用完就扔**的浏览器上下文里注册账号。
 *
 * 注册接口会顺带下发会话 Cookie —— 如果在被测上下文里注册，
 * 那条上下文立刻就是"已登录"状态，"登录"这条路根本没被走过。
 * 这里用独立上下文注册：账号留在服务端，会话跟着临时上下文一起消失。
 */
export async function createAccountInOtherContext(
  harness: Harness,
  account: Account
): Promise<Account> {
  const temp = await harness.newSession();
  try {
    return await createAccountViaApi(temp.page, account);
  } finally {
    await temp.close();
  }
}

/** 通过 API 登录（用于"第二个会话"这类场景） */
export async function loginViaApi(page: Page, account: Account): Promise<void> {
  const res = await apiFetch(page, '/api/auth/login', {
    method: 'POST',
    body: { email: account.email, password: account.password },
  });
  if (res.status !== 200) {
    throw new Error(`登录失败：HTTP ${res.status} ${JSON.stringify(res.body)}`);
  }
}

export interface ProjectFixture {
  projectId: string;
  slides: Array<{ slideId: string; orderIndex: number; versionId: string }>;
}

/**
 * 布置一个「已编译、有幻灯片」的项目（全部走 API）。
 *
 * 大纲走的是服务端自己的降级链（模型端点被指向本地替身，见 spec/verify/model-stub-server.ts），
 * 所以这一步很快，且**不依赖外网状态**。
 */
export async function arrangeProjectWithSlides(
  page: Page,
  opts?: { topic?: string; pageCount?: number; name?: string }
): Promise<ProjectFixture> {
  const topic = opts?.topic ?? '城市轨道交通智慧运维平台';
  const pageCount = opts?.pageCount ?? 4;
  const name = opts?.name ?? unique('E2E 项目');

  const created = await apiFetch<{ project: { id: string } }>(page, '/api/projects', {
    method: 'POST',
    body: {
      name,
      requirement: {
        topic,
        purpose: '集成验证',
        audience: '管理层',
        pageCount,
        style: '简洁',
        depth: '深入',
        aspectRatio: '16:9',
      },
    },
  });
  if (created.status !== 201) {
    throw new Error(`建项目失败：HTTP ${created.status} ${JSON.stringify(created.body)}`);
  }
  const projectId = created.body.data!.project.id;

  const outline = await apiFetch<{ outline: unknown[] }>(
    page,
    `/api/projects/${projectId}/outline/regenerate`,
    { method: 'POST', body: {} }
  );
  if (outline.status !== 200) {
    throw new Error(`生成大纲失败：HTTP ${outline.status} ${JSON.stringify(outline.body)}`);
  }

  const compiled = await apiFetch<{ slides: ProjectFixture['slides'] }>(
    page,
    `/api/projects/${projectId}/compile`,
    { method: 'POST' }
  );
  if (compiled.status !== 200) {
    throw new Error(`编译失败：HTTP ${compiled.status} ${JSON.stringify(compiled.body)}`);
  }

  return { projectId, slides: compiled.body.data!.slides };
}

/** 打开项目并进到工作台（UI 路径）—— 让被测的那一步发生在真实的前端状态里 */
export async function openProjectInWorkbench(session: Session, projectId: string): Promise<void> {
  const page = session.page;
  session.mark('开项目：回作品库');
  await page.getByTestId('nav-projects').click();
  const card = page.locator(`[data-testid="project-card"][data-project-id="${projectId}"]`);
  await card.first().waitFor({ state: 'visible', timeout: 20_000 });
  session.mark('开项目：点开');
  await card.first().click();
  await page.getByTestId('slide-canvas').waitFor({ state: 'visible', timeout: 30_000 });
  session.mark('开项目：已进工作台');
}

/* -------------------------------------------------------------------------- */
/* 走 UI 的动作 —— 被测的那一步必须发生在真实的前端状态里                       */
/* -------------------------------------------------------------------------- */

/**
 * 通过 UI 注册并进入应用外壳。
 *
 * 返回账号 —— 后面「第二个会话用同一账号登录」这类用例要靠它。
 */
export async function registerAndEnterApp(session: Session, account?: Account): Promise<Account> {
  const acct = account ?? makeAccount();
  session.mark('注册：打开登录页');
  await session.page.goto('/');
  await session.page.getByTestId('auth-form').waitFor({ state: 'visible', timeout: 15_000 });
  session.mark('注册：填表');
  await session.page.getByTestId('auth-tab-register').click();
  await session.page.getByTestId('auth-name').fill(acct.name);
  await session.page.getByTestId('auth-email').fill(acct.email);
  await session.page.getByTestId('auth-password').fill(acct.password);
  session.mark('注册：提交');
  await session.page.getByTestId('auth-submit').click();
  session.mark('注册：等外壳');
  await session.page.getByTestId('nav-projects').waitFor({ state: 'visible', timeout: 20_000 });
  session.mark('注册：完成');
  return acct;
}

/** 通过 UI 登录（账号必须已存在）—— 第二个会话用同一个账号进来时走这条 */
export async function loginViaUi(session: Session, account: Account): Promise<void> {
  await session.page.goto('/');
  await session.page.getByTestId('auth-form').waitFor({ state: 'visible', timeout: 15_000 });
  await session.page.getByTestId('auth-tab-login').click();
  await session.page.getByTestId('auth-email').fill(account.email);
  await session.page.getByTestId('auth-password').fill(account.password);
  await session.page.getByTestId('auth-submit').click();
  await session.page.getByTestId('nav-projects').waitFor({ state: 'visible', timeout: 20_000 });
}

/** 通过 UI 新建一个项目，返回项目 id（并停在「创作中心」） */
export async function createProjectViaUi(session: Session, name: string): Promise<string> {
  session.mark('建项目：开表单');
  await session.page.getByTestId('nav-projects').click();
  await session.page.getByTestId('new-project').click();
  await session.page.getByTestId('new-project-name').fill(name);
  session.mark('建项目：提交');
  await session.page.getByTestId('new-project-submit').click();

  // 创建完成后应用会跳到「创作中心」—— 那是创建成功的信号
  await session.page.getByTestId('topic-prompt').waitFor({ state: 'visible', timeout: 20_000 });
  session.mark('建项目：已进创作中心');

  // 项目 id 从**服务端列表**取，不从 UI 卡片取：
  // 回作品库读卡片会把界面切走，后面的用例还要在创作中心里接着操作。
  const list = await apiFetch<{ projects: Array<{ id: string; name: string }> }>(
    session.page,
    '/api/projects'
  );
  const found = list.body.data?.projects.find((p) => p.name === name);
  if (!found) throw new Error(`服务端列表里找不到刚建的项目：${name}`);
  session.mark('建项目：完成');
  return found.id;
}

/**
 * 把「页数」滑块拨到指定页数。
 *
 * 用键盘而不是直接改 value —— 直接改 DOM 的 value 不会触发 React 的 onChange
 * （React 记着上一次的 value），改完滑块还是旧页数，测的就不是「用户拨了滑块」。
 * Home 键回到最小值，再按 ArrowRight 逐格走 —— 与真人操作同一条路径。
 *
 * `cc-page-count` 是**创作中心**的滑块 —— 前端把它和 cc-preset / cc-purpose
 * 放在同一套前缀下。Playwright 的 `getByTestId` 是**全等匹配**，
 * 写成 `page-count` 不会「匹配到别的元素」，它会**永远等不到**，
 * 每个用例卡满 15 秒超时（2026-11-04 踩过：前端改名，E2E 没跟）。
 * 这条契约由 `spec/verify/testid-contract.test.ts` 静态守着。
 */
export async function setPageCount(session: Session, pageCount: number): Promise<void> {
  const slider = session.page.getByTestId('cc-page-count');
  await slider.waitFor({ state: 'visible', timeout: 15_000 });
  const min = Number(await slider.getAttribute('min'));
  await slider.focus();
  await slider.press('Home');
  for (let i = 0; i < pageCount - min; i += 1) {
    await slider.press('ArrowRight');
  }
  const actual = await slider.inputValue();
  if (Number(actual) !== pageCount) {
    throw new Error(`页数滑块没拨到位：期望 ${pageCount}，实际 ${actual}`);
  }
}

/**
 * 走 UI 生成大纲（填主题 → 拨页数 → 生成），停在大纲页。
 */
export async function generateOutlineViaUi(
  session: Session,
  opts: { topic: string; pageCount?: number }
): Promise<void> {
  session.mark('大纲：等创作中心');
  await session.page.getByTestId('topic-prompt').waitFor({ state: 'visible', timeout: 20_000 });
  await session.page.getByTestId('topic-prompt').fill(opts.topic);
  await setPageCount(session, opts.pageCount ?? 6);
  session.mark('大纲：请求生成');
  await session.page.getByTestId('generate-outline').click();
  await session.page
    .getByTestId('outline-item-0')
    .waitFor({ state: 'visible', timeout: 60_000 });
  session.mark('大纲：已生成');
}

/**
 * 走 UI 确认大纲并编译，进入工作台。
 */
export async function confirmOutlineViaUi(session: Session): Promise<void> {
  session.mark('编译：确认大纲');
  await session.page.getByTestId('confirm-outline').click();
  await session.page.getByTestId('slide-canvas').waitFor({ state: 'visible', timeout: 60_000 });
  session.mark('编译：已进工作台');
}

/**
 * 读一页的服务端状态（IR + 当前版本号）。
 */
export async function fetchSlide(
  page: Page,
  projectId: string,
  slideId: string
): Promise<{ slideId: string; versionId: string; ir: unknown } | null> {
  const res = await apiFetch<{ slide: { slideId: string; versionId: string; ir: unknown } }>(
    page,
    `/api/projects/${projectId}/slides/${slideId}`
  );
  if (res.status !== 200) return null;
  return res.body.data!.slide;
}

/** IR 里任意位置是否出现了这段文字 */
export function irContains(ir: unknown, needle: string): boolean {
  return JSON.stringify(ir ?? null).includes(needle);
}

/**
 * 画布当前渲染出来的**文字** —— 去掉 SVG 标记、忽略折行与空白。
 *
 * 断言"服务端那份 IR 真的被画出来了"时要比**文字**，不能直接在内联 HTML 里找子串：
 * 一段文字被折行拆进多个 `<tspan>` 是正常排版（`调试标记-mvy1ox` + `mp-4-9vwc`），
 * 在 HTML 里它带着换行和标签，直接 `includes` 会误判成"没画出来"。
 */
export async function canvasText(page: Page): Promise<string> {
  const html = await page.getByTestId('slide-canvas').innerHTML();
  const text = html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
  return text.replace(/\s+/g, '');
}

/** 画布文字里是否出现了这段文字（忽略空白差异） */
export async function canvasShows(page: Page, needle: string): Promise<boolean> {
  const squash = (s: string) => s.replace(/\s+/g, '');
  return (await canvasText(page)).includes(squash(needle));
}

