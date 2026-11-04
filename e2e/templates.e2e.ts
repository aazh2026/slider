/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 模板链 —— 模板中心与模板落库
 * ---------------------------------------------------------------------------
 * 这一链盯的是**模板有没有真的落到服务端**。
 *
 * 以前"应用此模板规范"只改了前端 state：刷新一下就回到旧模板，
 * 而界面上看不出任何区别 —— 属于典型的"看起来做了，其实没做"。
 * 所以这里必须做**刷新后**的核对：模板 id 要在服务端那份项目里。
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BUILT_IN_TEMPLATES } from '@ppt/core';

import {
  TEST_TIMEOUT,
  apiFetch,
  assertServersUp,
  confirmOutlineViaUi,
  createProjectViaUi,
  generateOutlineViaUi,
  launchHarness,
  openProjectInWorkbench,
  registerAndEnterApp,
  unique,
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

/** 服务端存着的模板 id */
async function serverTemplateId(session: Session, projectId: string): Promise<string | null> {
  const res = await apiFetch<{ project: { template?: { templateId?: string } } }>(
    session.page,
    `/api/projects/${projectId}`
  );
  if (res.status !== 200) return null;
  return res.body.data!.project.template?.templateId ?? null;
}

/** 一个**一定不存在**的模板 id —— 服务端对它的答复必须是 404 */
const MISSING_TEMPLATE_ID = '__e2e_missing_template__';

describe('模板链（真实浏览器 + 真实服务端）', () => {
  test('模板中心 → 卡片与内置模板表逐条对得上，深浅筛选各归其位', async () => {
    const session = await harness.newSession();
    try {
      await registerAndEnterApp(session);
      // 模板中心是**项目的**视图 —— 没有项目时那个页签根本不渲染
      await createProjectViaUi(session, unique('E2E 模板清单'));
      await session.page.getByTestId('nav-templates').click();
      await session.page.getByTestId('template-center').waitFor({ state: 'visible', timeout: 20_000 });

      const cards = session.page.getByTestId('template-card');
      expect(await cards.count()).toBe(BUILT_IN_TEMPLATES.length);

      // 卡片上的 id 必须与内置表一致（不是前端另编的一套）
      const shownIds = await cards.evaluateAll((els) =>
        els.map((el) => el.getAttribute('data-template-id'))
      );
      expect(shownIds.sort()).toEqual(BUILT_IN_TEMPLATES.map((t) => t.templateId).sort());

      // --- 深色筛选 ---
      await session.page.getByTestId('template-filter-dark').click();
      const darkCount = BUILT_IN_TEMPLATES.filter((t) => t.theme.isDark).length;
      await waitFor(
        async () => (await session.page.getByTestId('template-card').count()) === darkCount,
        5_000,
        '深色筛选只剩深色模板'
      );

      // --- 浅色筛选 ---
      await session.page.getByTestId('template-filter-light').click();
      const lightCount = BUILT_IN_TEMPLATES.filter((t) => !t.theme.isDark).length;
      await waitFor(
        async () => (await session.page.getByTestId('template-card').count()) === lightCount,
        5_000,
        '浅色筛选只剩浅色模板'
      );

      // --- 回到全部 ---
      await session.page.getByTestId('template-filter-all').click();
      await waitFor(
        async () =>
          (await session.page.getByTestId('template-card').count()) === BUILT_IN_TEMPLATES.length,
        5_000,
        '回到全部模板'
      );
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('应用模板 → 服务端存的是新模板，刷新后仍然是它', async () => {
    const session = await harness.newSession();
    try {
      await registerAndEnterApp(session);
      const projectId = await createProjectViaUi(session, unique('E2E 模板'));
      await generateOutlineViaUi(session, { topic: unique('E2E 模板主题'), pageCount: 4 });
      await confirmOutlineViaUi(session);

      await session.page.getByTestId('nav-templates').click();
      await session.page.getByTestId('template-center').waitFor({ state: 'visible', timeout: 20_000 });

      const before = await serverTemplateId(session, projectId);
      expect(before).toBeTruthy();

      // 挑一个**不是当前**的模板
      const target = BUILT_IN_TEMPLATES.find((t) => t.templateId !== before)!;
      const applyButton = session.page
        .locator(`[data-testid="template-apply"][data-template-id="${target.templateId}"]`);
      await applyButton.first().waitFor({ state: 'visible', timeout: 10_000 });
      await applyButton.first().click();

      // --- 服务端的模板 id 必须换掉 ---
      await waitFor(
        async () => (await serverTemplateId(session, projectId)) === target.templateId,
        20_000,
        '模板落到服务端'
      );

      // --- 刷新后仍然是它（这才是"真的存下来了"） ---
      await session.page.reload();
      await session.page.getByTestId('nav-projects').waitFor({ state: 'visible', timeout: 30_000 });
      await openProjectInWorkbench(session, projectId);
      await session.page.getByTestId('nav-templates').click();
      await session.page.getByTestId('template-center').waitFor({ state: 'visible', timeout: 20_000 });

      const selected = session.page.locator(
        `[data-testid="template-card"][data-selected="true"]`
      );
      await waitFor(
        async () => (await selected.count()) === 1,
        10_000,
        '刷新后仍然只有当前模板被标记为使用中'
      );
      expect(await selected.getAttribute('data-template-id')).toBe(target.templateId);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  /**
   * 应用一个**不存在的**模板 → 服务端拒绝，界面必须**如实**报错。
   *
   * 这条盯的是"假成功"：以前点「应用此模板规范」是**先乐观换成本地模板、
   * 再发请求** —— 请求失败时界面已经显示"用上了"，
   * 而服务端还挂着旧模板，刷新一下就露馅。
   *
   * 404 必须由**真实服务端**给出，不能是前端自己编的 ——
   * 所以这里改写的是**请求 URL**（模板 id 换成不存在的那个），
   * 而不是伪造一个响应。
   */
  test('应用不存在的模板 → 界面如实报错，服务端模板不被改动', async () => {
    const session = await harness.newSession();
    try {
      // 改写 fetch：只有"应用模板"这一个请求会被换成不存在的模板 id。
      // 用 addInitScript（页面脚本之前注入），刷新后依然有效。
      await session.page.addInitScript((missingId: string) => {
        const original = window.fetch.bind(window) as typeof window.fetch;
        window.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
          const url =
            typeof input === 'string'
              ? input
              : input instanceof URL
                ? input.toString()
                : (input as Request).url;
          if (/\/api\/templates\/[^/]+\/apply$/.test(url)) {
            return original(
              url.replace(
                /\/api\/templates\/[^/]+\/apply$/,
                `/api/templates/${missingId}/apply`
              ),
              init
            );
          }
          return original(input, init);
        }) as typeof window.fetch;
      }, MISSING_TEMPLATE_ID);

      await registerAndEnterApp(session);
      const projectId = await createProjectViaUi(session, unique('E2E 模板失败'));
      await generateOutlineViaUi(session, { topic: unique('E2E 模板失败主题'), pageCount: 4 });
      await confirmOutlineViaUi(session);

      await session.page.getByTestId('nav-templates').click();
      await session.page.getByTestId('template-center').waitFor({ state: 'visible', timeout: 20_000 });

      const before = await serverTemplateId(session, projectId);
      expect(before).toBeTruthy();

      // 挑一个**不是当前**的模板 —— 否则"选中标记没变"证明不了任何东西
      const target = BUILT_IN_TEMPLATES.find((t) => t.templateId !== before)!;
      const applyButton = session.page.locator(
        `[data-testid="template-apply"][data-template-id="${target.templateId}"]`
      );
      await applyButton.first().waitFor({ state: 'visible', timeout: 10_000 });

      const responsePromise = session.page.waitForResponse(
        (res) => res.url().includes(`/api/templates/${MISSING_TEMPLATE_ID}/apply`),
        { timeout: 20_000 }
      );
      await applyButton.first().click();

      // --- 服务端确实拒绝了（404 由真实后端给出） ---
      const response = await responsePromise;
      expect(response.status()).toBe(404);

      // --- 界面如实报错 ---
      await waitFor(
        async () => {
          const notice = session.page.getByTestId('sync-notice');
          if ((await notice.count()) === 0) return false;
          return ((await notice.textContent()) ?? '').includes('模板更新失败');
        },
        20_000,
        '界面给出模板更新失败提示'
      );
      const noticeText = (await session.page.getByTestId('sync-notice').textContent()) ?? '';
      expect(noticeText).toContain('模板不存在');

      // --- 服务端的项目模板**没被改动** ---
      expect(await serverTemplateId(session, projectId)).toBe(before);

      // --- 界面没有假装成功：选中标记仍在旧模板上 ---
      const selected = session.page.locator(
        `[data-testid="template-card"][data-selected="true"]`
      );
      await waitFor(
        async () => (await selected.count()) === 1,
        10_000,
        '仍然只有当前模板被标记为使用中'
      );
      expect(await selected.getAttribute('data-template-id')).toBe(before);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);
});
