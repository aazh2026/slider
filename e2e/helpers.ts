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

import { writeFile } from 'node:fs/promises';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

export const BASE_URL = process.env['E2E_BASE_URL'] ?? 'http://127.0.0.1:5173';
export const API_BASE = process.env['E2E_API_BASE'] ?? 'http://127.0.0.1:3000';

/** 单个用例超时 —— 真实浏览器 + 真实服务端，比单元测试慢得多 */
export const TEST_TIMEOUT = 180_000;

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
  return page.evaluate(
    async (args: { path: string; init?: { method?: string; body?: unknown } }) => {
      const res = await fetch(args.path, {
        method: args.init?.method ?? 'GET',
        credentials: 'include',
        headers: args.init?.body ? { 'content-type': 'application/json' } : undefined,
        body: args.init?.body ? JSON.stringify(args.init.body) : undefined,
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
    { path, init }
  ) as Promise<ApiResult<T>>;
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
  /** 关闭并落盘证据 */
  close: () => Promise<void>;
}

export interface Harness {
  browser: Browser;
  /** 开一条新会话（独立上下文） */
  newSession: () => Promise<Session>;
  /** 汇总所有会话的浏览器日志并落盘 */
  close: () => Promise<void>;
}

/**
 * 探活 —— 服务没起来要立刻报错，不能让后面的断言"莫名其妙地失败"。
 *
 * 探活认**身份**，不只看 `res.ok`：
 * 后端回 JSON 信封、前端回 HTML —— 端口撞车时后端和前端可能拿到同一个端口，
 * 只看 `res.ok` 会把"前端起来了"判成假的。
 */
export async function assertServersUp(): Promise<void> {
  const health = await fetch(`${API_BASE}/healthz`).catch(() => null);
  if (!health || !health.ok) {
    throw new Error(`后端未就绪（${API_BASE}/healthz）。请先启动：bun run apps/api/src/index.ts`);
  }
  const front = await fetch(BASE_URL).catch(() => null);
  if (!front || !front.ok) {
    throw new Error(`前端未就绪（${BASE_URL}）。请先启动：bunx vite --port 5173`);
  }
}

export async function launchHarness(): Promise<Harness> {
  const browser = await chromium.launch();
  const allLogs: string[] = [];

  const newSession = async (): Promise<Session> => {
    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    const logs: string[] = [];

    // 同时落到 allLogs —— 落盘的那份证据要包含**所有**会话的日志，
    // 而不是只有最后一个（否则前几条用例的线索就丢了）。
    const record = (line: string): void => {
      logs.push(line);
      allLogs.push(line);
    };

    // 断言失败时，"哪条请求没发出去 / 报了什么错"是最关键的线索。
    // 只留 console / 请求失败 / 4xx+ / 未捕获异常四类，不记全部流量（噪音太大）。
    page.on('console', (msg) => {
      record(`[console:${msg.type()}] ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      record(`[pageerror] ${err.message}`);
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

    return {
      context,
      page,
      logs,
      close: async () => {
        await context.close().catch(() => {});
      },
    };
  };

  return {
    browser,
    newSession,
    close: async () => {
      await browser.close().catch(() => {});
      // 浏览器侧证据落盘 —— 断言失败时能回头看"当时浏览器报了什么"。
      // 路径可用 E2E_LOG_FILE 覆盖（注入检查每轮都重起服务，共用一个文件会互相覆盖）。
      const logFile = process.env['E2E_LOG_FILE'] ?? './spec/evidence/e2e-browser.log';
      try {
        await writeFile(logFile, allLogs.join('\n'), 'utf-8');
      } catch {
        /* 落盘失败不影响测试结论 */
      }
    },
  };
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
export async function openProjectInWorkbench(page: Page, projectId: string): Promise<void> {
  await page.getByTestId('nav-projects').click();
  const card = page.locator(`[data-testid="project-card"][data-project-id="${projectId}"]`);
  await card.first().waitFor({ state: 'visible', timeout: 20_000 });
  await card.first().click();
  await page.getByTestId('slide-canvas').waitFor({ state: 'visible', timeout: 30_000 });
}
