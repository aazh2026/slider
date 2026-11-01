/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 项目链 —— 建项目 / 改名 / 删除 / 列表 / 跨租户
 * ---------------------------------------------------------------------------
 * 判据落在**服务端状态**上：UI 操作了什么，服务端库里到底存了什么。
 *
 * 每条用例自包含：自己建账号、自己建项目。失败不级联。
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import {
  TEST_TIMEOUT,
  apiFetch,
  assertServersUp,
  launchHarness,
  makeAccount,
  uncaughtErrors,
  waitFor,
  type Account,
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

/** 在页面上完成一次注册（走 UI），成功后停在应用外壳 */
async function registerAndEnterApp(session: Session): Promise<Account> {
  const account = makeAccount();
  await session.page.goto('/');
  await session.page.getByTestId('auth-form').waitFor({ state: 'visible', timeout: 15_000 });
  await session.page.getByTestId('auth-tab-register').click();
  await session.page.getByTestId('auth-name').fill(account.name);
  await session.page.getByTestId('auth-email').fill(account.email);
  await session.page.getByTestId('auth-password').fill(account.password);
  await session.page.getByTestId('auth-submit').click();
  await session.page.getByTestId('nav-projects').waitFor({ state: 'visible', timeout: 20_000 });
  return account;
}

/** 通过 UI 新建一个项目，返回项目 id */
async function createProjectViaUi(session: Session, name: string): Promise<string> {
  await session.page.getByTestId('nav-projects').click();
  await session.page.getByTestId('new-project').click();
  await session.page.getByTestId('new-project-name').fill(name);
  await session.page.getByTestId('new-project-submit').click();

  // 创建完成后应用会跳到「创作中心」—— 那是创建成功的信号
  await session.page.getByTestId('topic-prompt').waitFor({ state: 'visible', timeout: 20_000 });

  await session.page.getByTestId('nav-projects').click();
  const card = session.page.locator(`[data-testid="project-card"][data-project-id]`);
  const target = card.filter({ hasText: name }).first();
  await target.waitFor({ state: 'visible', timeout: 20_000 });
  const id = await target.getAttribute('data-project-id');
  if (!id) throw new Error(`项目卡片上读不到 data-project-id（name=${name}）`);
  return id;
}

describe('项目链（真实浏览器 + 真实服务端）', () => {
  test('AC-E2E-002 新建项目 → 服务端库里真的有这条项目，且归属当前用户', async () => {
    const session = await harness.newSession();
    try {
      await registerAndEnterApp(session);
      const name = `E2E 新建项目 ${Date.now()}`;

      const projectId = await createProjectViaUi(session, name);

      // --- 服务端列表里也有 ---
      const list = await apiFetch<{
        projects: Array<{ id: string; name: string; topic: string }>;
      }>(session.page, '/api/projects');
      expect(list.status).toBe(200);
      const found = list.body.data?.projects.find((p) => p.name === name);
      expect(found).toBeDefined();
      expect(found!.id).toBe(projectId);

      // --- 归属的是**当前登录的这个用户** ---
      // 这是 AC-E2E-002 的正身：注入「新建项目时归属写成了别的用户」要能被这条抓到。
      const me = await apiFetch<{ user: { id: string } }>(session.page, '/api/auth/me');
      const detail = await apiFetch<{ project: { id: string; userId?: string } }>(
        session.page,
        `/api/projects/${projectId}`
      );
      expect(detail.status).toBe(200);
      if (detail.body.data?.project.userId !== undefined) {
        expect(detail.body.data.project.userId).toBe(me.body.data!.user.id);
      }

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('AC-E2E-012 重命名项目 → 服务端存的是新名字', async () => {
    const session = await harness.newSession();
    try {
      await registerAndEnterApp(session);
      const projectId = await createProjectViaUi(session, `E2E 待改名 ${Date.now()}`);

      const newName = `E2E 改名后的项目 ${Date.now()}`;
      await session.page.getByTestId('project-name-button').click();
      const input = session.page.getByTestId('project-name-input');
      await input.waitFor({ state: 'visible', timeout: 10_000 });
      await input.fill(newName);
      await input.press('Enter');

      await waitFor(
        async () => {
          const detail = await apiFetch<{ project: { name: string } }>(
            session.page,
            `/api/projects/${projectId}`
          );
          return detail.body.data?.project.name === newName;
        },
        15_000,
        '服务端收到前端改的项目名'
      );

      const detail = await apiFetch<{ project: { name: string } }>(
        session.page,
        `/api/projects/${projectId}`
      );
      expect(detail.body.data!.project.name).toBe(newName);

      // UI 上显示的也必须是新名字 —— 否则用户改完看着还是旧名字
      await session.page.getByTestId('project-name-button').waitFor({ state: 'visible', timeout: 10_000 });
      expect(await session.page.getByTestId('project-name-button').textContent()).toContain(newName);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('AC-E2E-013 删除项目 → 服务端真的删掉了（且列表里也没有）', async () => {
    const session = await harness.newSession();
    try {
      await registerAndEnterApp(session);
      const throwaway = `待删除项目 ${Date.now()}`;

      // 删除按钮在「只剩一个项目」时是禁用的（不能把最后一个作品删掉），
      // 所以先建第二个项目，让 UI 里有两张卡。
      //
      // 两个都走 UI —— 后端布置的项目不会出现在前端已经加载好的列表里，
      // 那样按钮仍然是禁用的，测的就不是"点了删除会怎样"了。
      await createProjectViaUi(session, `陪衬项目 ${Date.now()}`);

      const throwawayId = await createProjectViaUi(session, throwaway);

      // 先确认它确实在服务端
      const before = await apiFetch(session.page, `/api/projects/${throwawayId}`);
      expect(before.status).toBe(200);

      // 删除走 confirm() —— Playwright 默认会**拒绝**对话框，得显式接受
      session.page.on('dialog', (dialog) => void dialog.accept());

      const card = session.page.locator(
        `[data-testid="project-card"][data-project-id="${throwawayId}"]`
      );
      await card.first().waitFor({ state: 'visible', timeout: 20_000 });
      await card.first().getByTestId('project-delete').click();

      // 服务端查不到了
      await waitFor(
        async () => {
          const res = await apiFetch(session.page, `/api/projects/${throwawayId}`);
          return res.status === 404;
        },
        15_000,
        '服务端项目已删除'
      );

      const after = await apiFetch(session.page, `/api/projects/${throwawayId}`);
      expect(after.status).toBe(404);
      expect(after.body.error?.code).toBe('NOT_FOUND');

      // 列表里也不该再有它
      const list = await apiFetch<{ projects: Array<{ id: string }> }>(
        session.page,
        '/api/projects'
      );
      expect(list.body.data?.projects.some((p) => p.id === throwawayId)).toBe(false);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('AC-E2E-011 跨租户隔离 → 别人的项目拿不到（404 而不是 403）', async () => {
    const session = await harness.newSession();
    try {
      await registerAndEnterApp(session);

      // 另一个租户 —— 用**独立浏览器上下文**注册，不能污染主会话
      const otherAccount = makeAccount();
      const otherSession = await harness.newSession();
      let otherProjectId = '';
      try {
        await otherSession.page.goto('/');
        await otherSession.page.getByTestId('auth-form').waitFor({ state: 'visible', timeout: 15_000 });
        await otherSession.page.getByTestId('auth-tab-register').click();
        await otherSession.page.getByTestId('auth-name').fill('另一个用户');
        await otherSession.page.getByTestId('auth-email').fill(otherAccount.email);
        await otherSession.page.getByTestId('auth-password').fill(otherAccount.password);
        await otherSession.page.getByTestId('auth-submit').click();
        await otherSession.page.getByTestId('nav-projects').waitFor({ state: 'visible', timeout: 20_000 });

        const created = await apiFetch<{ project: { id: string } }>(otherSession.page, '/api/projects', {
          method: 'POST',
          body: {
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
          },
        });
        expect(created.status).toBe(201);
        otherProjectId = created.body.data!.project.id;
      } finally {
        await otherSession.close();
      }

      expect(otherProjectId).toBeTruthy();

      // 主会话访问别人的项目 → 404（不是 403 —— 403 会泄露"该 id 存在"）
      const res = await apiFetch(session.page, `/api/projects/${otherProjectId}`);
      expect(res.status).toBe(404);
      expect(res.body.error?.code).toBe('NOT_FOUND');

      // 列表里也不能出现别人的项目
      const list = await apiFetch<{ projects: Array<{ id: string }> }>(
        session.page,
        '/api/projects'
      );
      expect(list.body.data?.projects.some((p) => p.id === otherProjectId)).toBe(false);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('零项目 → 空态提示可见，且能从空态回到作品库', async () => {
    const session = await harness.newSession();
    try {
      await registerAndEnterApp(session);

      // 一个新账号一个项目都没有
      const empty = session.page.getByTestId('empty-projects');
      await empty.waitFor({ state: 'visible', timeout: 20_000 });
      expect(((await empty.textContent()) ?? '').length).toBeGreaterThan(0);

      // 空态里那个「打开项目管理」按钮必须真的能带路过去
      await session.page.getByTestId('goto-projects').click();
      await session.page.getByTestId('new-project').waitFor({ state: 'visible', timeout: 15_000 });

      // 建完之后空态应当消失 —— 状态变了 UI 必须跟着变
      await session.page.getByTestId('new-project').click();
      await session.page.getByTestId('new-project-name').fill(`空态转正 ${Date.now()}`);
      await session.page.getByTestId('new-project-submit').click();
      await session.page.getByTestId('topic-prompt').waitFor({ state: 'visible', timeout: 20_000 });

      expect(await session.page.getByTestId('empty-projects').count()).toBe(0);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('项目列表 → UI 上的卡片与服务端列表逐条对得上', async () => {
    const session = await harness.newSession();
    try {
      await registerAndEnterApp(session);

      const names: string[] = [];
      for (let i = 0; i < 2; i += 1) {
        const name = `列表对账 ${i}-${Date.now()}`;
        names.push(name);
        await createProjectViaUi(session, name);
      }

      const list = await apiFetch<{ projects: Array<{ id: string; name: string }> }>(
        session.page,
        '/api/projects'
      );
      const serverIds = new Set(list.body.data!.projects.map((p) => p.id));

      // UI 上的卡片 id 必须是服务端列表里的 id —— 不能有"幽灵卡片"
      const cardIds = await session.page
        .locator('[data-testid="project-card"][data-project-id]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-project-id')));
      expect(cardIds.length).toBe(serverIds.size);
      for (const id of cardIds) {
        expect(serverIds.has(id!)).toBe(true);
      }

      // 两个名字都要在 UI 上出现
      for (const name of names) {
        await session.page
          .getByTestId('project-card')
          .filter({ hasText: name })
          .first()
          .waitFor({ state: 'visible', timeout: 15_000 });
      }
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('跨租户的项目不能被当前用户删除', async () => {
    const session = await harness.newSession();
    try {
      await registerAndEnterApp(session);

      const otherAccount = makeAccount();
      const otherSession = await harness.newSession();
      let otherProjectId = '';
      try {
        await otherSession.page.goto('/');
        await otherSession.page.getByTestId('auth-form').waitFor({ state: 'visible', timeout: 15_000 });
        await otherSession.page.getByTestId('auth-tab-register').click();
        await otherSession.page.getByTestId('auth-email').fill(otherAccount.email);
        await otherSession.page.getByTestId('auth-password').fill(otherAccount.password);
        await otherSession.page.getByTestId('auth-submit').click();
        await otherSession.page.getByTestId('nav-projects').waitFor({ state: 'visible', timeout: 20_000 });

        const created = await apiFetch<{ project: { id: string } }>(otherSession.page, '/api/projects', {
          method: 'POST',
          body: {
            name: '别人的项目',
            requirement: {
              topic: '隔离验证',
              purpose: '',
              audience: '',
              pageCount: 1,
              style: '',
              depth: '',
              aspectRatio: '16:9',
            },
          },
        });
        otherProjectId = created.body.data!.project.id;
      } finally {
        await otherSession.close();
      }

      // 直接去删别人的项目 → 404，且**不能真被删掉**
      const del = await apiFetch(session.page, `/api/projects/${otherProjectId}`, { method: 'DELETE' });
      expect(del.status).toBe(404);
      expect(del.body.error?.code).toBe('NOT_FOUND');

      // 别人的项目还在（用另一个身份去核对）
      const otherCheck = await harness.newSession();
      try {
        await otherCheck.page.goto('/');
        await apiFetch(otherCheck.page, '/api/auth/login', {
          method: 'POST',
          body: { email: otherAccount.email, password: otherAccount.password },
        });
        const still = await apiFetch(otherCheck.page, `/api/projects/${otherProjectId}`);
        expect(still.status).toBe(200);
      } finally {
        await otherCheck.close();
      }
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);
});
