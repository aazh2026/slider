/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 认证链 —— 注册 / 登录 / 登出 / 会话失效
 * ---------------------------------------------------------------------------
 * 这一链覆盖的是**会话生命周期**。以前它只有"注册"一条，
 * 登录、登出、错误密码、会话过期全是空的 ——
 * 而"登出"甚至连 UI 入口都没有（`authService.logout()` 没有任何调用方）。
 *
 * 每条用例自包含：自己注册账号、自己登出，用例之间互不依赖。
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { request as playwrightRequest } from 'playwright';

import {
  API_BASE,
  TEST_TIMEOUT,
  apiFetch,
  assertServersUp,
  createAccountInOtherContext,
  launchHarness,
  makeAccount,
  uncaughtErrors,
  waitFor,
  type Harness,
  type Session,
} from './helpers';

let harness: Harness;

beforeAll(async () => {
  await assertServersUp();
  harness = await launchHarness();
});

afterAll(async () => {
  await harness?.close();
});

/** 在页面上完成一次注册（走 UI） */
async function registerViaUi(
  session: Session,
  account: { email: string; password: string; name: string }
): Promise<void> {
  await session.page.goto('/');
  await session.page.getByTestId('auth-form').waitFor({ state: 'visible', timeout: 15_000 });
  await session.page.getByTestId('auth-tab-register').click();
  await session.page.getByTestId('auth-name').fill(account.name);
  await session.page.getByTestId('auth-email').fill(account.email);
  await session.page.getByTestId('auth-password').fill(account.password);
  await session.page.getByTestId('auth-submit').click();
}

describe('认证链（真实浏览器 + 真实服务端）', () => {
  test('AC-E2E-001 注册 → 服务端签发 HttpOnly 会话，前端据此进入工作台', async () => {
    const session = await harness.newSession();
    try {
      const account = makeAccount();
      await registerViaUi(session, account);

      // 登录成功后进入应用外壳（侧边栏出现）
      await session.page.getByTestId('nav-projects').waitFor({ state: 'visible', timeout: 20_000 });

      // --- 服务端确实认了这个会话 ---
      const me = await apiFetch<{ user: { email: string } }>(session.page, '/api/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.data?.user.email).toBe(account.email);

      // --- 会话 Cookie 是 HttpOnly：JS 读不到 ---
      const cookies = await session.context.cookies();
      const sessionCookie = cookies.find((c) => c.name === 'ppt_session');
      expect(sessionCookie).toBeDefined();
      expect(sessionCookie!.httpOnly).toBe(true);
      expect(sessionCookie!.sameSite).toBe('Lax');

      const docCookie = await session.page.evaluate(() => document.cookie);
      expect(docCookie).not.toContain(sessionCookie!.value);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('登录 → 用已注册的账号换一个新会话', async () => {
    const session = await harness.newSession();
    try {
      const account = makeAccount();
      // 先用 API 建好账号（布置），再用 UI 登录（被测动作）
      await createAccountInOtherContext(harness, account);

      await session.page.goto('/');
      await session.page.getByTestId('auth-form').waitFor({ state: 'visible', timeout: 15_000 });
      await session.page.getByTestId('auth-tab-login').click();
      await session.page.getByTestId('auth-email').fill(account.email);
      await session.page.getByTestId('auth-password').fill(account.password);
      await session.page.getByTestId('auth-submit').click();

      await session.page.getByTestId('nav-projects').waitFor({ state: 'visible', timeout: 20_000 });

      const me = await apiFetch<{ user: { email: string } }>(session.page, '/api/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.data?.user.email).toBe(account.email);

      // 登录也必须下发 HttpOnly Cookie —— 不能因为"登录这条路老一点"就松了
      const cookies = await session.context.cookies();
      const sessionCookie = cookies.find((c) => c.name === 'ppt_session');
      expect(sessionCookie).toBeDefined();
      expect(sessionCookie!.httpOnly).toBe(true);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('密码错误 → 前端显示错误，且不下发任何会话 Cookie', async () => {
    const session = await harness.newSession();
    try {
      const account = makeAccount();
      await createAccountInOtherContext(harness, account);

      await session.page.goto('/');
      await session.page.getByTestId('auth-form').waitFor({ state: 'visible', timeout: 15_000 });
      await session.page.getByTestId('auth-tab-login').click();
      await session.page.getByTestId('auth-email').fill(account.email);
      await session.page.getByTestId('auth-password').fill('这是错误的密码');
      await session.page.getByTestId('auth-submit').click();

      // 错误提示必须出现 —— "静默失败"是最糟的实现
      const error = session.page.getByTestId('auth-error');
      await error.waitFor({ state: 'visible', timeout: 15_000 });
      expect(((await error.textContent()) ?? '').length).toBeGreaterThan(0);

      // 不能进应用
      expect(await session.page.getByTestId('nav-projects').count()).toBe(0);

      // **没有会话** —— 密码错了还发 Cookie，那才是灾难
      const cookies = await session.context.cookies();
      expect(cookies.find((c) => c.name === 'ppt_session')).toBeUndefined();
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('登出 → 服务端作废会话（不是只把界面藏起来）', async () => {
    const session = await harness.newSession();
    try {
      const account = makeAccount();
      await registerViaUi(session, account);
      await session.page.getByTestId('nav-projects').waitFor({ state: 'visible', timeout: 20_000 });

      // 登出前先记住会话值 —— 后面要证明"旧 Cookie 不再管用"
      const before = await session.context.cookies();
      const sessionCookie = before.find((c) => c.name === 'ppt_session');
      expect(sessionCookie).toBeDefined();
      const stolenValue = sessionCookie!.value;

      await session.page.getByTestId('logout').click();

      // 回到登录页
      await session.page.getByTestId('auth-form').waitFor({ state: 'visible', timeout: 20_000 });

      // 浏览器里的 Cookie 被服务端清掉
      await waitFor(
        async () => {
          const cookies = await session.context.cookies();
          return cookies.find((c) => c.name === 'ppt_session') === undefined;
        },
        10_000,
        '登出后浏览器不再持有会话 Cookie'
      );

      // /me 认不出这个会话了
      const me = await apiFetch(session.page, '/api/auth/me');
      expect(me.status).toBe(401);

      // --- 关键：光清 Cookie 不算登出 ---
      // 服务端必须把这个会话 id 作废掉。否则 Cookie 被复制走（比如从别处带上来的）
      // 就能继续用 —— 那 30 天的 Max-Age 等于形同虚设。
      // 用一个独立的请求上下文手动带上旧 Cookie，绕开浏览器的 Cookie 罐子。
      const api = await playwrightRequest.newContext({
        baseURL: API_BASE,
        extraHTTPHeaders: { Cookie: `ppt_session=${stolenValue}` },
      });
      try {
        const replay = await api.get('/api/auth/me');
        expect(replay.status()).toBe(401);
      } finally {
        await api.dispose();
      }
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('会话在服务端失效 → 前端自己退回登录页', async () => {
    const session = await harness.newSession();
    try {
      const account = makeAccount();
      await createAccountInOtherContext(harness, account);

      await session.page.goto('/');
      await session.page.getByTestId('auth-form').waitFor({ state: 'visible', timeout: 15_000 });
      await session.page.getByTestId('auth-tab-login').click();
      await session.page.getByTestId('auth-email').fill(account.email);
      await session.page.getByTestId('auth-password').fill(account.password);
      await session.page.getByTestId('auth-submit').click();
      await session.page.getByTestId('nav-projects').waitFor({ state: 'visible', timeout: 20_000 });

      // 会话 Cookie 被清掉（模拟 Cookie 过期 / 被清 / 被别处登出顶掉）
      await session.context.clearCookies();

      // 现在任何一次**走前端 apiClient 的**请求都会 401 —— 前端必须自己退回登录页，
      // 而不是把用户留在一个"什么都不动"的界面上。
      //
      // 注意：这里必须走 UI 动作，不能用 page.evaluate 直接 fetch ——
      // 直接 fetch 绕过了 apiClient，那个「401 → SESSION_EXPIRED_EVENT → 回登录页」
      // 的链路根本没被触发，测的就不是前端了。
      //
      // 零项目时主区域是空态（empty-projects + goto-projects），
      // 作品库要从空态点进去 —— 这条路径顺便也把 goto-projects 覆盖了。
      await session.page.getByTestId('goto-projects').click();
      await session.page.getByTestId('new-project').click();
      await session.page.getByTestId('new-project-name').fill('会话失效探针');
      await session.page.getByTestId('new-project-submit').click();

      await session.page.getByTestId('auth-form').waitFor({ state: 'visible', timeout: 20_000 });
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);
});
