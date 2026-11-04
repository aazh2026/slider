/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 异常链 —— 后端出问题时，前端**怎么表现**
 * ---------------------------------------------------------------------------
 * 这一链测的是**失败路径**。
 *
 * 只测"正常时能用"的验证器有个盲区：后端挂掉的时候，
 * 前端可能白屏、可能弹一个看不懂的英文、可能**假装成功**。
 * 假装成功是最坏的一种 —— 用户以为文稿存好了，其实根本没存。
 *
 * 所以判据是：
 *   · 出错时界面必须**说出**出了什么事（不是空白、不是"正在加载…"卡死）
 *   · 出错时界面**不能**显示成功（导出失败不能显示"导出成功"）
 *   · 出错之后**还能继续用**（回到登录页 / 留在能操作的界面）
 *
 * 制造故障的方式是**拦截浏览器发出的请求** —— 让请求在到达服务端之前就失败。
 * 这比"把服务端打挂"更可控：服务端还在跑，只是这一条链路断了。
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import {
  TEST_TIMEOUT,
  apiFetch,
  arrangeProjectWithSlides,
  assertServersUp,
  launchHarness,
  makeAccount,
  openProjectInWorkbench,
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

/** 让某个请求直接失败（网络层断开） */
async function breakRequest(
  session: Session,
  urlPattern: string,
  mode: 'abort' | 'status' = 'abort',
  status = 500
): Promise<void> {
  await session.page.route(urlPattern, async (route) => {
    if (mode === 'abort') {
      await route.abort('failed');
      return;
    }
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'INTERNAL_ERROR', message: '注入故障：这条链路被测试切断了' },
        traceId: 'inject-fault',
      }),
    });
  });
}

describe('异常链（真实浏览器 + 真实服务端）', () => {
  test('后端连不上 → 界面明说连不上，登录入口仍然可用', async () => {
    const session = await harness.newSession();
    try {
      // 会话检查这一条链路断掉 —— 等价于"后端没起来"
      await breakRequest(session, '**/api/auth/me', 'abort');

      await session.page.goto('/');

      // --- 界面必须说出出了什么事 ---
      const bootError = session.page.getByTestId('boot-error');
      await bootError.waitFor({ state: 'visible', timeout: 20_000 });
      const text = ((await bootError.textContent()) ?? '').trim();
      expect(text.length).toBeGreaterThan(0);
      expect(text).toContain('无法连接后端');

      // --- 也不能卡在"正在检查会话…" ---
      const body = ((await session.page.locator('body').innerText()) ?? '').trim();
      expect(body).not.toContain('正在检查会话…');

      // --- 登录入口还在，用户还能重试 ---
      await session.page.getByTestId('auth-form').waitFor({ state: 'visible', timeout: 10_000 });
      expect(await session.page.getByTestId('auth-submit').count()).toBe(1);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('项目列表加载失败 → 显示 load-error，且没有假装"加载成功"', async () => {
    const session = await harness.newSession();
    try {
      // 先把账号和会话准备好（走 API 是"布置"，不是被测动作）
      const account = makeAccount();
      await apiFetch(session.page, '/api/auth/register', {
        method: 'POST',
        body: { email: account.email, password: account.password, name: account.name },
      });

      // 再把「拉项目列表」这一条链路切断
      await session.page.route('**/api/projects', async (route) => {
        if (route.request().method() === 'GET') {
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({
              error: { code: 'INTERNAL_ERROR', message: '注入故障：列表接口挂了' },
              traceId: 'inject-fault',
            }),
          });
          return;
        }
        await route.fallback();
      });

      await session.page.goto('/');

      // --- 错误必须显示出来 ---
      const loadError = session.page.getByTestId('load-error');
      await loadError.waitFor({ state: 'visible', timeout: 20_000 });
      expect(((await loadError.textContent()) ?? '').trim().length).toBeGreaterThan(0);

      // --- 不能卡在"正在加载项目…" ---
      const empty = ((await session.page.getByTestId('empty-projects').textContent()) ?? '').trim();
      expect(empty).not.toContain('正在加载项目…');

      // --- 也不能显示成"有项目"（一个项目卡片都没有） ---
      expect(await session.page.getByTestId('project-card').count()).toBe(0);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('导出提交失败 → 界面显示"导出失败"，绝不显示"导出成功"', async () => {
    const session = await harness.newSession();
    try {
      const account = makeAccount();
      await apiFetch(session.page, '/api/auth/register', {
        method: 'POST',
        body: { email: account.email, password: account.password, name: account.name },
      });
      const fixture = await arrangeProjectWithSlides(session.page, { name: 'E2E 导出失败' });
      await session.page.goto('/');
      await openProjectInWorkbench(session, fixture.projectId);

      // 提交导出这一步断掉
      await breakRequest(session, '**/api/exports', 'status', 500);

      await session.page.getByTestId('open-export').click();
      await session.page.getByTestId('export-submit').click();

      const progress = session.page.getByTestId('export-progress');
      await progress.waitFor({ state: 'visible', timeout: 20_000 });

      await waitFor(
        async () => ((await progress.textContent()) ?? '').includes('导出失败'),
        20_000,
        '界面报导出失败'
      );

      const text = ((await progress.textContent()) ?? '').trim();
      expect(text).toContain('导出失败');
      // --- 关键：不能出现成功字样 ---
      expect(text).not.toContain('导出成功');

      // --- 没有任务 id —— 服务端压根没接到这次导出 ---
      expect(await session.page.getByTestId('export-job-id').count()).toBe(0);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('导出任务失败 → 界面显示失败原因，不触发下载', async () => {
    const session = await harness.newSession();
    try {
      const account = makeAccount();
      await apiFetch(session.page, '/api/auth/register', {
        method: 'POST',
        body: { email: account.email, password: account.password, name: account.name },
      });
      const fixture = await arrangeProjectWithSlides(session.page, { name: 'E2E 导出任务失败' });
      await session.page.goto('/');
      await openProjectInWorkbench(session, fixture.projectId);

      // 提交是通的（服务端真的会建任务），只有**轮询状态**这一步报"任务失败"
      await session.page.route('**/api/exports/*', async (route) => {
        const url = route.request().url();
        if (route.request().method() === 'GET' && /\/api\/exports\/[^/]+$/.test(url)) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              data: {
                job: {
                  id: 'injected-job-id',
                  status: 'failed',
                  progress: 40,
                  error: '注入故障：渲染器炸了',
                },
              },
              traceId: 'inject-fault',
            }),
          });
          return;
        }
        await route.fallback();
      });

      await session.page.getByTestId('open-export').click();
      await session.page.getByTestId('export-submit').click();

      const progress = session.page.getByTestId('export-progress');
      await progress.waitFor({ state: 'visible', timeout: 20_000 });

      await waitFor(
        async () => ((await progress.textContent()) ?? '').includes('导出失败'),
        20_000,
        '界面报导出失败'
      );

      // 失败原因要透出来 —— 用户得知道为什么
      expect(((await progress.textContent()) ?? '')).toContain('注入故障');
      expect(((await progress.textContent()) ?? '')).not.toContain('导出成功');
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);
});
