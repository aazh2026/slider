/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 前后端集成 E2E —— Playwright 驱动真实浏览器
 * ---------------------------------------------------------------------------
 * 这不是"UI 冒烟测试"。判据全部落在**服务端状态**上：
 *
 *   UI 操作了什么  →  服务端库里到底存了什么
 *
 * 只断言 UI 文本的话，把后端整个换成假实现也能通过 —— 那就证明不了
 * "前后端功能集成"。所以这里的每条断言都是"UI 操作 → 直接打 API 核对"。
 *
 * ---------------------------------------------------------------------------
 * **运行环境**
 *
 *   终端 1：bun run apps/api/src/index.ts     （:3000）
 *   终端 2：bunx vite --port 5173             （:5173，/api 代理到 :3000）
 *   终端 3：bun test ./e2e/integration.e2e.ts
 *
 * 服务没起来时会**明确失败**，不会静默跳过 —— 静默跳过等于把
 * "没验证"说成 "验证通过"。
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

const BASE_URL = process.env['E2E_BASE_URL'] ?? 'http://127.0.0.1:5173';
const API_BASE = process.env['E2E_API_BASE'] ?? 'http://127.0.0.1:3000';

/** 唯一邮箱 —— 每次运行都是新账号，互不干扰 */
const EMAIL = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
const PASSWORD = 'e2e-password-123';
const PROJECT_NAME = `E2E 集成验证 ${Date.now()}`;
const TOPIC = '城市轨道交通智慧运维平台';

/** 单个用例超时 —— 真实浏览器 + 真实服务端，比单元测试慢得多 */
const TEST_TIMEOUT = 180_000;

let browser: Browser;
let context: BrowserContext;
let page: Page;

/**
 * 浏览器侧证据（console / 请求失败 / 4xx+ 响应 / 未捕获异常）。
 *
 * 失败时"哪条请求没发出去、报了什么错"是最关键的线索 ——
 * 只看"元素没出现"根本猜不出是前端没发请求、后端报错、还是模型降级了。
 */
const browserLog: string[] = [];

/** 项目 id —— 由 UI 创建后从服务端列表里取 */
let projectId = '';
/** 第一页的 slideId */
let firstSlideId = '';
/** 第一页当前的 versionId（乐观锁基线） */
let firstSlideVersionId = '';

beforeAll(async () => {
  // 先探活：服务没起来要立刻报错，不能让后面的断言"莫名其妙地失败"
  const health = await fetch(`${API_BASE}/healthz`).catch(() => null);
  if (!health || !health.ok) {
    throw new Error(
      `后端未就绪（${API_BASE}/healthz）。请先启动：bun run apps/api/src/index.ts`
    );
  }
  const front = await fetch(BASE_URL).catch(() => null);
  if (!front || !front.ok) {
    throw new Error(`前端未就绪（${BASE_URL}）。请先启动：bunx vite --port 5173`);
  }

  browser = await chromium.launch();
  context = await browser.newContext({ baseURL: BASE_URL });
  page = await context.newPage();

  // --- 浏览器侧证据 ---
  // 断言失败时，"哪条请求没发出去 / 报了什么错"是最关键的线索。
  // 只留 console / 请求失败 / 未捕获异常三类，不记全部流量（噪音太大）。
  page.on('console', (msg) => {
    browserLog.push(`[console:${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    browserLog.push(`[pageerror] ${err.message}`);
  });
  page.on('requestfailed', (req) => {
    browserLog.push(
      `[requestfailed] ${req.method()} ${req.url()} —— ${req.failure()?.errorText ?? '未知原因'}`
    );
  });
  page.on('response', (res) => {
    if (res.status() >= 400) {
      browserLog.push(`[http ${res.status()}] ${res.request().method()} ${res.url()}`);
    }
  });
});

afterAll(async () => {
  await context?.close();
  await browser?.close();

  // 浏览器侧证据落盘 —— 断言失败时能回头看"当时浏览器报了什么"。
  // 路径可用 E2E_LOG_FILE 覆盖（注入检查每轮都重起服务，共用一个文件会互相覆盖）。
  const logFile = process.env['E2E_LOG_FILE'] ?? './spec/evidence/e2e-browser.log';
  try {
    await writeFile(logFile, browserLog.join('\n'), 'utf-8');
  } catch {
    /* 落盘失败不影响测试结论 */
  }
});

/* -------------------------------------------------------------------------- */
/* 浏览器内 API 助手 —— 走浏览器的会话 Cookie                                 */
/* -------------------------------------------------------------------------- */

interface ApiEnvelope<T> {
  data?: T;
  error?: { code: string; message: string; details?: Record<string, unknown> };
  traceId?: string;
}

/** 在页面上下文里打 API —— 复用浏览器里的会话 Cookie */
async function apiFetch<T = unknown>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<{ status: number; body: ApiEnvelope<T> }> {
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
  ) as Promise<{ status: number; body: ApiEnvelope<T> }>;
}

/** 等到某个条件成立（轮询服务端状态） */
async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs: number,
  label: string
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await page.waitForTimeout(250);
  }
  throw new Error(`等待超时（${timeoutMs}ms）：${label}`);
}

/* -------------------------------------------------------------------------- */

describe('前后端集成（真实浏览器 + 真实服务端）', () => {
  test('1. 注册 → 服务端签发 HttpOnly 会话，前端据此进入工作台', async () => {
    await page.goto('/');

    // 未登录时只能看到登录卡
    await page.getByTestId('auth-form').waitFor({ state: 'visible', timeout: 15_000 });

    await page.getByTestId('auth-tab-register').click();
    await page.getByTestId('auth-name').fill('E2E 测试用户');
    await page.getByTestId('auth-email').fill(EMAIL);
    await page.getByTestId('auth-password').fill(PASSWORD);
    await page.getByTestId('auth-submit').click();

    // 登录成功后进入应用外壳（侧边栏出现）
    await page.getByTestId('nav-projects').waitFor({ state: 'visible', timeout: 20_000 });

    // --- 服务端确实认了这个会话 ---
    const me = await apiFetch<{ user: { email: string } }>('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data?.user.email).toBe(EMAIL);

    // --- 会话 Cookie 是 HttpOnly：JS 读不到 ---
    const cookies = await context.cookies();
    const session = cookies.find((c) => c.name === 'ppt_session');
    expect(session).toBeDefined();
    expect(session!.httpOnly).toBe(true);
    expect(session!.sameSite).toBe('Lax');

    const docCookie = await page.evaluate(() => document.cookie);
    expect(docCookie).not.toContain(session!.value);
  }, TEST_TIMEOUT);

  test('2. 新建项目 → 服务端库里真的有这条项目', async () => {
    await page.getByTestId('nav-projects').click();
    await page.getByTestId('new-project').click();
    await page.getByTestId('new-project-name').fill(PROJECT_NAME);
    await page.getByTestId('new-project-submit').click();

    // 创建完成后应用会跳到「创作中心」—— 那是创建成功的信号
    await page.getByTestId('topic-prompt').waitFor({ state: 'visible', timeout: 20_000 });

    // 回到作品库，UI 上应当出现这张卡片
    await page.getByTestId('nav-projects').click();
    const card = page.getByTestId('project-card').filter({ hasText: PROJECT_NAME });
    await card.first().waitFor({ state: 'visible', timeout: 20_000 });

    // --- 服务端列表里也有 ---
    const list = await apiFetch<{
      projects: Array<{ id: string; name: string; topic: string }>;
    }>('/api/projects');
    expect(list.status).toBe(200);
    const found = list.body.data?.projects.find((p) => p.name === PROJECT_NAME);
    expect(found).toBeDefined();
    projectId = found!.id;
    // 卡片上的项目 id 必须和服务端列表里的是同一个 —— 否则后面所有核对都是空转
    expect(await card.first().getAttribute('data-project-id')).toBe(projectId);
  }, TEST_TIMEOUT);

  test('3. 生成大纲 → 服务端按主题动态生成（不是写死的固定文案）', async () => {
    await page.getByTestId('nav-create').click();
    await page.getByTestId('topic-prompt').fill(
      `帮我制作一份${TOPIC}汇报，面向地铁集团管理层，约 6 页，重点介绍运维痛点、平台架构与实施路线。`
    );
    await page.getByTestId('generate-outline').click();

    // 生成完自动切到大纲页
    await page.getByTestId('confirm-outline').waitFor({ state: 'visible', timeout: 60_000 });

    // --- 服务端存的是按这个主题生成的大纲 ---
    const detail = await apiFetch<{
      project: { outline: Array<{ title: string; slideId: string }> };
    }>(`/api/projects/${projectId}`);
    if (detail.status !== 200) {
      throw new Error(
        `GET /api/projects/${projectId} → ${detail.status} ${JSON.stringify(detail.body)}`
      );
    }
    const outline = detail.body.data?.project.outline ?? [];
    expect(outline.length).toBeGreaterThan(0);

    // 旧版前端在失败时会返回写死的「企业 AI Agent 技术架构规划」——
    // docs/architecture.md §7.2 点名的反模式。大纲必须跟着**本次主题**走。
    const joined = outline.map((o) => o.title).join(' | ');
    expect(joined).not.toContain('企业 AI Agent 技术架构规划');
    expect(joined).toContain('轨道交通');
  }, TEST_TIMEOUT);

  test('3b. 编辑大纲标题 → 服务端存的是前端改的那份', async () => {
    const editedTitle = `E2E 改过的大纲标题 ${Date.now()}`;

    await page.getByTestId('outline-edit-0').click();
    const titleInput = page.getByTestId('outline-title-input-0');
    await titleInput.waitFor({ state: 'visible', timeout: 10_000 });
    await titleInput.fill(editedTitle);
    await titleInput.press('Enter');

    // 大纲 PATCH 是即时落服务端的（不走防抖），但仍留一点网络余量
    await waitFor(
      async () => {
        const detail = await apiFetch<{
          project: { outline: Array<{ title: string }> };
        }>(`/api/projects/${projectId}`);
        return detail.body.data?.project.outline?.[0]?.title === editedTitle;
      },
      15_000,
      '服务端收到前端改的大纲标题'
    );

    const detail = await apiFetch<{
      project: { outline: Array<{ title: string }> };
    }>(`/api/projects/${projectId}`);
    expect(detail.body.data!.project.outline[0]!.title).toBe(editedTitle);
  }, TEST_TIMEOUT);

  test('4. 编译 → 工作台渲染的是服务端生成的 Slide IR', async () => {
    await page.getByTestId('confirm-outline').click();

    const canvas = page.getByTestId('slide-canvas');
    await canvas.waitFor({ state: 'visible', timeout: 60_000 });

    // --- 服务端的幻灯片 IR 与画布标题一致 ---
    const detail = await apiFetch<{
      project: { slides: Array<{ slideId: string }> };
    }>(`/api/projects/${projectId}`);
    const slides = detail.body.data?.project.slides ?? [];
    expect(slides.length).toBeGreaterThan(0);

    const slide = await apiFetch<{ slide: { ir: { title: string }; versionId: string } }>(
      `/api/projects/${projectId}/slides/${slides[0]!.slideId}`
    );
    expect(slide.status).toBe(200);
    const serverTitle = slide.body.data!.slide.ir.title;
    firstSlideId = slides[0]!.slideId;
    firstSlideVersionId = slide.body.data!.slide.versionId;

    // 画布上的标题属性来自同一份 IR
    expect(await canvas.getAttribute('data-slide-title')).toBe(serverTitle);

    // 左侧缩略图数量 = 服务端幻灯片数
    await waitFor(
      async () => (await page.getByTestId('slide-thumb').count()) === slides.length,
      20_000,
      '缩略图数量与服务端幻灯片数一致'
    );
  }, TEST_TIMEOUT);

  test('5. 编辑文本 → 防抖同步写回服务端（乐观锁生成新版本）', async () => {
    const target = page.locator('[data-testid="slide-element"][data-editable="true"]').first();
    await target.waitFor({ state: 'visible', timeout: 20_000 });

    const elementId = await target.getAttribute('data-element-id');
    expect(elementId).toBeTruthy();

    const newText = `E2E 修改过的标题 ${Date.now()}`;
    await target.dblclick();
    const editor = page.getByTestId('inline-text-editor');
    await editor.waitFor({ state: 'visible', timeout: 15_000 });
    await editor.fill(newText);
    await editor.press('Enter');

    // 防抖 700ms + 网络往返 —— 轮询服务端直到看到新内容
    let serverContent = '';
    let serverVersion = '';
    await waitFor(
      async () => {
        const res = await apiFetch<{
          slide: {
            ir: { elements: Array<{ id: string; content?: unknown }> };
            versionId: string;
          };
        }>(`/api/projects/${projectId}/slides/${firstSlideId}`);
        const el = res.body.data?.slide.ir.elements.find((e) => e.id === elementId);
        serverContent = typeof el?.content === 'string' ? el.content : '';
        serverVersion = res.body.data?.slide.versionId ?? '';
        return serverContent === newText;
      },
      20_000,
      '服务端收到前端编辑的文本'
    );

    // 服务端存的就是前端改的那份 —— 这是真正的集成点
    expect(serverContent).toBe(newText);
    // 乐观锁生成了新版本
    expect(serverVersion).not.toBe(firstSlideVersionId);
    firstSlideVersionId = serverVersion;
  }, TEST_TIMEOUT);

  test('6. 陈旧 baseVersionId → 409 冲突，且不覆盖服务端内容', async () => {
    const current = await apiFetch<{
      slide: { ir: { title: string; elements: Array<{ id: string; content?: unknown }> } };
    }>(`/api/projects/${projectId}/slides/${firstSlideId}`);
    const serverTitleBefore = current.body.data!.slide.ir.title;

    const conflict = await page.evaluate(
      async (args: { pid: string; sid: string; ir: unknown }) => {
        const r = await fetch(`/api/projects/${args.pid}/slides/${args.sid}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            baseVersionId: 'stale-version-id-from-another-session',
            ir: args.ir,
          }),
        });
        return { status: r.status, body: await r.json() };
      },
      {
        pid: projectId,
        sid: firstSlideId,
        ir: { ...current.body.data!.slide.ir, title: '被冲突的写入' },
      }
    );

    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('SLIDE_VERSION_CONFLICT');
    // 服务端要回报当前版本号，前端才知道该提示什么
    expect(conflict.body.error.details?.['currentVersionId']).toBeTruthy();

    // 冲突的写入**没有**生效
    const after = await apiFetch<{ slide: { ir: { title: string } } }>(
      `/api/projects/${projectId}/slides/${firstSlideId}`
    );
    expect(after.body.data!.slide.ir.title).toBe(serverTitleBefore);
  }, TEST_TIMEOUT);

  test('7. AI 编辑 → 服务端施加 IRPatch，前端采纳服务端返回的 IR', async () => {
    const before = await apiFetch<{
      slide: {
        versionId: string;
        ir: { elements: Array<{ id: string; content?: unknown }> };
      };
    }>(`/api/projects/${projectId}/slides/${firstSlideId}`);
    const versionBefore = before.body.data!.slide.versionId;
    const contentBefore = JSON.stringify(
      before.body.data!.slide.ir.elements.map((e) => [e.id, e.content])
    );

    // 上一步的选中元素会把右侧检查器切到「属性」页 —— 先切回 AI 页
    const aiTab = page.getByTestId('wb-tab-ai');
    if (await aiTab.isVisible().catch(() => false)) {
      await aiTab.click();
    } else {
      await page.getByTestId('wb-tab-ai-collapsed').click();
    }
    await page.getByTestId('ai-instruction').waitFor({ state: 'visible', timeout: 15_000 });

    // 抓住服务端对这次 AI 编辑的**原始响应** —— 前端展示的降级状态必须与它一致
    const aiResponse = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        r.url().includes(`/api/projects/${projectId}/slides/${firstSlideId}/patches`),
      { timeout: 60_000 }
    );

    await page.getByTestId('ai-instruction').fill('把要点精简成三条，突出量化收益');
    await page.getByTestId('ai-run').click();

    const raw = await aiResponse;
    const serverBody = (await raw.json()) as {
      data?: { degraded?: boolean; message?: string };
    };

    // 出现反馈（成功或明确的失败，不允许静默）
    const message = page.getByTestId('ai-message');
    await message.waitFor({ state: 'visible', timeout: 60_000 });
    const text = (await message.textContent()) ?? '';
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain('AI 编辑失败');

    // 前端展示的降级状态 === 服务端说的降级状态（不能自己编）
    expect(await message.getAttribute('data-degraded')).toBe(
      String(serverBody.data?.degraded === true)
    );

    // --- 服务端确实写库、升版本，而且内容真的变了 ---
    const after = await apiFetch<{
      slide: {
        versionId: string;
        ir: { elements: Array<{ id: string; content?: unknown }> };
      };
    }>(`/api/projects/${projectId}/slides/${firstSlideId}`);
    expect(after.body.data!.slide.versionId).not.toBe(versionBefore);
    const contentAfter = JSON.stringify(
      after.body.data!.slide.ir.elements.map((e) => [e.id, e.content])
    );
    expect(contentAfter).not.toBe(contentBefore);
    firstSlideVersionId = after.body.data!.slide.versionId;
  }, TEST_TIMEOUT);

  test('8. 导出 → 服务端任务产出真实 PPTX 产物', async () => {
    await page.getByTestId('open-export').click();
    await page.getByTestId('export-format-pptx').click();
    await page.getByTestId('export-submit').click();

    const progress = page.getByTestId('export-progress');
    await progress.waitFor({ state: 'visible', timeout: 20_000 });

    // jobId 从 data 属性读 —— 不要用正则去扒 body 文本，
    // 相邻按钮的文字会粘上来（"…jobId: <uuid>取消确认导出"）。
    await waitFor(
      async () => {
        const text = (await progress.textContent()) ?? '';
        if (text.includes('导出失败')) {
          throw new Error(`导出失败：${text}`);
        }
        return text.includes('导出成功');
      },
      90_000,
      '导出任务成功'
    );

    const jobId = await page.getByTestId('export-job-id').getAttribute('data-job-id');
    expect(jobId).toBeTruthy();

    // --- 产物是真正的 PPTX（ZIP 魔数 PK）且非空 ---
    const download = await page.evaluate(async (jid: string) => {
      const res = await fetch(`/api/exports/${jid}/download`, { credentials: 'include' });
      const buf = new Uint8Array(await res.arrayBuffer());
      return {
        status: res.status,
        contentType: res.headers.get('content-type') ?? '',
        length: buf.length,
        head: Array.from(buf.slice(0, 4)),
        body: res.headers.get('content-type')?.includes('json')
          ? new TextDecoder().decode(buf.slice(0, 300))
          : '',
      };
    }, jobId!);

    if (download.status !== 200) {
      throw new Error(
        `下载产物失败：HTTP ${download.status} ${download.body} (jobId=${jobId})`
      );
    }
    expect(download.length).toBeGreaterThan(1024);
    expect(download.head[0]).toBe(0x50);
    expect(download.head[1]).toBe(0x4b);

    // 弹窗是全屏遮罩 —— 不关掉会挡住后续所有点击
    await page.getByTestId('export-close').click();
    await page.getByTestId('export-close').waitFor({ state: 'detached', timeout: 10_000 });
  }, TEST_TIMEOUT);

  test('9. 跨租户隔离 → 别人的项目拿不到（404 而不是 403）', async () => {
    // 用**独立浏览器上下文**注册另一个账号 —— 不能污染主会话
    const otherContext = await browser.newContext({ baseURL: BASE_URL });
    const otherPage = await otherContext.newPage();
    // 先导航到应用 —— 否则 about:blank 里 fetch 相对路径会解析失败
    await otherPage.goto('/');
    const otherEmail = `e2e-other-${Date.now()}@example.com`;

    const other = await otherPage.evaluate(
      async (args: { email: string; password: string }) => {
        const reg = await fetch('/api/auth/register', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: args.email, password: args.password, name: '另一个用户' }),
        });
        const created = await fetch('/api/projects', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: '另一个用户的项目',
            requirement: {
              topic: '别的租户',
              purpose: '隔离验证',
              audience: '无',
              pageCount: 1,
              style: '无',
              depth: '无',
              aspectRatio: '16:9',
            },
          }),
        });
        const createdBody = await created.json();
        return {
          regStatus: reg.status,
          projectId: createdBody?.data?.project?.id as string | undefined,
        };
      },
      { email: otherEmail, password: PASSWORD }
    );

    await otherContext.close();

    expect(other.regStatus).toBe(201);
    expect(other.projectId).toBeTruthy();

    // 主会话访问别人的项目 → 404（不是 403 —— 403 会泄露"该 id 存在"）
    const res = await apiFetch(`/api/projects/${other.projectId}`);
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe('NOT_FOUND');
  }, TEST_TIMEOUT);

  test('10. 重命名项目 → 服务端存的是新名字', async () => {
    const newName = `E2E 改名后的项目 ${Date.now()}`;

    await page.getByTestId('project-name-button').click();
    const input = page.getByTestId('project-name-input');
    await input.waitFor({ state: 'visible', timeout: 10_000 });
    await input.fill(newName);
    await input.press('Enter');

    await waitFor(
      async () => {
        const detail = await apiFetch<{ project: { name: string } }>(
          `/api/projects/${projectId}`
        );
        return detail.body.data?.project.name === newName;
      },
      15_000,
      '服务端收到前端改的项目名'
    );

    const detail = await apiFetch<{ project: { name: string } }>(
      `/api/projects/${projectId}`
    );
    expect(detail.body.data!.project.name).toBe(newName);
  }, TEST_TIMEOUT);

  test('11. 导出 PDF → 产物是真正的 PDF（%PDF 魔数）', async () => {
    await page.getByTestId('open-export').click();
    await page.getByTestId('export-format-pdf').click();
    await page.getByTestId('export-submit').click();

    const progress = page.getByTestId('export-progress');
    await progress.waitFor({ state: 'visible', timeout: 20_000 });
    await waitFor(
      async () => {
        const text = (await progress.textContent()) ?? '';
        if (text.includes('导出失败')) throw new Error(`导出失败：${text}`);
        return text.includes('导出成功');
      },
      90_000,
      'PDF 导出任务成功'
    );

    const jobId = await page.getByTestId('export-job-id').getAttribute('data-job-id');
    expect(jobId).toBeTruthy();

    const download = await page.evaluate(async (jid: string) => {
      const res = await fetch(`/api/exports/${jid}/download`, { credentials: 'include' });
      const buf = new Uint8Array(await res.arrayBuffer());
      return {
        status: res.status,
        contentType: res.headers.get('content-type') ?? '',
        length: buf.length,
        head: Array.from(buf.slice(0, 5)).map((b) => String.fromCharCode(b)),
        body: res.headers.get('content-type')?.includes('json')
          ? new TextDecoder().decode(buf.slice(0, 300))
          : '',
      };
    }, jobId!);

    if (download.status !== 200) {
      throw new Error(`下载 PDF 失败：HTTP ${download.status} ${download.body}`);
    }
    expect(download.contentType).toContain('pdf');
    expect(download.length).toBeGreaterThan(1024);
    expect(download.head.join('')).toStartWith('%PDF');

    // 同样是全屏遮罩 —— 关掉
    await page.getByTestId('export-close').click();
    await page.getByTestId('export-close').waitFor({ state: 'detached', timeout: 10_000 });
  }, TEST_TIMEOUT);

  test('12. 删除项目 → 服务端真的删掉了（且列表里也没有）', async () => {
    // 删除走 confirm() —— Playwright 默认会**拒绝**对话框，得显式接受
    page.on('dialog', (dialog) => void dialog.accept());

    // 用 UI 建一个一次性项目
    const throwaway = `待删除项目 ${Date.now()}`;
    await page.getByTestId('nav-projects').click();
    await page.getByTestId('new-project').click();
    await page.getByTestId('new-project-name').fill(throwaway);
    await page.getByTestId('new-project-submit').click();
    await page.getByTestId('topic-prompt').waitFor({ state: 'visible', timeout: 20_000 });

    await page.getByTestId('nav-projects').click();
    const card = page.getByTestId('project-card').filter({ hasText: throwaway });
    await card.first().waitFor({ state: 'visible', timeout: 20_000 });
    const throwawayId = await card.first().getAttribute('data-project-id');
    expect(throwawayId).toBeTruthy();

    // 先确认它确实在服务端
    const before = await apiFetch(`/api/projects/${throwawayId}`);
    expect(before.status).toBe(200);

    await card.first().getByTestId('project-delete').click();

    // 服务端查不到了
    await waitFor(
      async () => {
        const res = await apiFetch(`/api/projects/${throwawayId}`);
        return res.status === 404;
      },
      15_000,
      '服务端项目已删除'
    );

    const after = await apiFetch(`/api/projects/${throwawayId}`);
    expect(after.status).toBe(404);
    expect(after.body.error?.code).toBe('NOT_FOUND');

    // 列表里也不该再有它
    const list = await apiFetch<{ projects: Array<{ id: string }> }>('/api/projects');
    expect(list.body.data?.projects.some((p) => p.id === throwawayId)).toBe(false);
  }, TEST_TIMEOUT);
});
