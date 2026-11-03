/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 导航链 —— 大纲编辑 / 页签互切 / 放映与导出
 * ---------------------------------------------------------------------------
 * 这一链守的是「用户在几屏之间来回走」的那部分路径：
 *
 *   · **大纲编辑器** —— 增 / 改 / 移 / 删，每一个动作都必须**落服务端**。
 *     大纲是页面的骨架，改了不落库 = 刷新就白改。
 *   · **六个页签互切** —— 切过去就得真的切过去，不能是"点了没反应"。
 *   · **放映与导出** —— 这几条挂着 AC 编号，是两个真 bug 的回归锁：
 *
 *     · **AC-E2E-023** PNG / SVG 导出只导**当前页**。
 *       曾经 `currentSlideIndex` 被写死成 0 → 无论你停在哪一页，
 *       导出来的永远是第 1 页，而且**不报错**。
 *     · **AC-E2E-024** 导出弹窗里那句「当前第 N 页」必须跟着当前页走。
 *       它和上面是同一个 bug 的两个症状 —— 文案是页码的免费回显，
 *       不用等真的导出就能看出页码对不对。
 *     · **AC-E2E-025** 放映从**当前页**开始。
 *       曾经 `<PresentationMode>` 根本没传 `initialSlideIndex` → 永远从第 1 页放。
 *
 * 断言分层：
 *   · 大纲的增 / 改 / 移 / 删**都落服务端**（`PATCH /api/projects/:id`），
 *     所以断言查服务端那份 outline；
 *   · 放映是纯前端行为（不落库），断言只能落在界面上；
 *   · 导出的断言落在**请求体**上（客户端按当前页算出来的 scope）。
 *
 * 导出那一段用 `page.route` 拦下了任务提交：产物本身（是不是真 PNG、
 * 里面画的是哪一页）由另一条链验；这一链只验契约 —— **客户端按当前页
 * 算出了正确的 scope**。拦下来是为了让链跑得快且确定，不是为了绕过什么。
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import {
  TEST_TIMEOUT,
  apiFetch,
  assertServersUp,
  launchHarness,
  uncaughtErrors,
  waitFor,
  type Harness,
  type Session,
} from './helpers';
import {
  currentSlideId,
  fetchSlideIr,
  setupCompiledWorkbench,
} from './fixtures.workbench';

let harness: Harness;

beforeAll(async () => {
  await assertServersUp();
  harness = await launchHarness();
});

afterAll(async () => {
  await harness?.close();
});

/* -------------------------------------------------------------------------- */
/* 服务端大纲                                                                   */
/* -------------------------------------------------------------------------- */

interface ServerOutlineItem {
  slideId: string;
  order: number;
  title: string;
  purpose: string;
  keyMessage: string;
  layoutPreference: string;
}

/** 读服务端那份大纲 */
async function fetchOutline(session: Session, projectId: string): Promise<ServerOutlineItem[]> {
  const res = await apiFetch<{ project: { outline: ServerOutlineItem[] | null } }>(
    session.page,
    `/api/projects/${projectId}`
  );
  const outline = res.body.data?.project?.outline;
  if (!outline) throw new Error(`读服务端大纲失败：HTTP ${res.status}`);
  return outline;
}

/** 等服务端大纲满足条件 */
async function waitForOutline(
  session: Session,
  projectId: string,
  predicate: (outline: ServerOutlineItem[]) => boolean,
  label: string,
  timeoutMs = 25_000
): Promise<ServerOutlineItem[]> {
  let last: ServerOutlineItem[] = [];
  await waitFor(
    async () => {
      last = await fetchOutline(session, projectId);
      return predicate(last);
    },
    timeoutMs,
    label
  );
  return last;
}

/* -------------------------------------------------------------------------- */
/* 界面动作                                                                     */
/* -------------------------------------------------------------------------- */

/** 切到大纲页签 —— 大纲页签在没有大纲时是禁用的，要等它先可点 */
async function gotoOutlineTab(session: Session): Promise<void> {
  const nav = session.page.getByTestId('nav-outline');
  await nav.waitFor({ state: 'visible', timeout: 20_000 });
  await waitFor(
    async () => !(await nav.isDisabled()),
    25_000,
    'nav-outline 变为可用（说明项目详情里的 outline 已经加载进来）'
  );
  await nav.click();
  await session.page.getByTestId('outline-item-0').waitFor({ state: 'visible', timeout: 20_000 });
}

/** 界面上的大纲条目数 */
async function outlineItemCount(session: Session): Promise<number> {
  return session.page.locator('[data-testid^="outline-item-"]').count();
}

/** 停到第 N 页（0 基）—— 等画布真的换成了那一页 */
async function gotoSlide(session: Session, index: number, expectedId: string): Promise<void> {
  await session.page.locator('[data-testid="slide-thumb"]').nth(index).click();
  await waitFor(
    async () => {
      const id = await session.page
        .getByTestId('slide-canvas')
        .getAttribute('data-slide-id')
        .catch(() => null);
      return id === expectedId;
    },
    15_000,
    `画布切到第 ${index + 1} 页`
  );
}

/* -------------------------------------------------------------------------- */
/* 导出请求体                                                                   */
/* -------------------------------------------------------------------------- */

interface ExportRequestBody {
  projectId: string;
  format: string;
  scope?: { slideIds: string[] };
}

/**
 * 拦下导出任务提交，只取**请求体**。
 *
 * 产物本身（是不是真 PNG、里面画的是哪一页）由另一条链验；这一链只验
 * 契约：**客户端按当前页算出了正确的 scope**。所以这里不真的跑服务端
 * 那趟渲染 —— 拦下来、记下请求体、立刻回一个空任务，链跑得快且确定。
 */
async function captureExportRequests(session: Session): Promise<ExportRequestBody[]> {
  const bodies: ExportRequestBody[] = [];

  await session.page.route('**/api/exports**', async (route) => {
    const req = route.request();
    const url = req.url();

    if (req.method() === 'POST' && url.endsWith('/api/exports')) {
      const raw = req.postData();
      if (raw) {
        try {
          bodies.push(JSON.parse(raw) as ExportRequestBody);
        } catch {
          /* 不是 JSON 就当没抓到 —— 断言那一步会自己失败 */
        }
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { job: { id: 'job_e2e', status: 'queued', progress: 0 } },
          traceId: 'e2e',
        }),
      });
      return;
    }

    if (req.method() === 'GET' && url.endsWith('/download')) {
      await route.fulfill({ status: 404, contentType: 'text/plain', body: 'e2e' });
      return;
    }

    if (req.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            job: {
              id: 'job_e2e',
              status: 'succeeded',
              progress: 100,
              result: { artifactId: null, filename: 'e2e.png' },
            },
          },
          traceId: 'e2e',
        }),
      });
      return;
    }

    await route.fallback();
  });

  return bodies;
}

/** 把标签页去掉空白与标签 —— SVG 里文字被拆成多个 tspan 时用它对齐 */
function squash(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, '');
}

/* -------------------------------------------------------------------------- */
/* 用例                                                                         */
/* -------------------------------------------------------------------------- */

describe('导航链（真实浏览器 + 真实服务端）', () => {
  /* ---------------------------------------------------------------- */
  /* 大纲编辑                                                          */
  /* ---------------------------------------------------------------- */

  test('大纲：新增页面 → 服务端的大纲真的多了一项', async () => {
    const session = await harness.newSession();
    try {
      const fx = await setupCompiledWorkbench(session, { pageCount: 3 });
      await gotoOutlineTab(session);

      const before = await fetchOutline(session, fx.projectId);
      expect(before.length).toBeGreaterThanOrEqual(1);

      await session.page.getByTestId('outline-add-slide').click();

      const after = await waitForOutline(
        session,
        fx.projectId,
        (o) => o.length === before.length + 1,
        '服务端大纲多了一项'
      );

      expect(after.length).toBe(before.length + 1);
      expect(await outlineItemCount(session)).toBe(after.length);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('大纲：改页面目标 → 服务端那一项的 purpose 变了', async () => {
    const session = await harness.newSession();
    try {
      const fx = await setupCompiledWorkbench(session, { pageCount: 3 });
      await gotoOutlineTab(session);

      const marker = `目标-${Date.now().toString(36)}`;
      await session.page.getByTestId('outline-edit-0').click();
      await session.page.getByTestId('outline-purpose-input-0').fill(marker);

      const after = await waitForOutline(
        session,
        fx.projectId,
        (o) => o.length > 0 && o[0].purpose === marker,
        '服务端第 1 项的 purpose 更新了'
      );

      expect(after[0].purpose).toBe(marker);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('大纲：改核心结论 → 服务端那一项的 keyMessage 变了', async () => {
    const session = await harness.newSession();
    try {
      const fx = await setupCompiledWorkbench(session, { pageCount: 3 });
      await gotoOutlineTab(session);

      const marker = `结论-${Date.now().toString(36)}`;
      await session.page.getByTestId('outline-edit-0').click();
      await session.page.getByTestId('outline-key-message-input-0').fill(marker);

      const after = await waitForOutline(
        session,
        fx.projectId,
        (o) => o.length > 0 && o[0].keyMessage === marker,
        '服务端第 1 项的 keyMessage 更新了'
      );

      expect(after[0].keyMessage).toBe(marker);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('大纲：改版式 → 服务端那一项的 layoutPreference 变了', async () => {
    const session = await harness.newSession();
    try {
      const fx = await setupCompiledWorkbench(session, { pageCount: 3 });
      await gotoOutlineTab(session);

      await session.page.getByTestId('outline-layout-select-0').selectOption('stats_kpi');

      const after = await waitForOutline(
        session,
        fx.projectId,
        (o) => o.length > 0 && o[0].layoutPreference === 'stats_kpi',
        '服务端第 1 项的版式换成了 stats_kpi'
      );

      expect(after[0].layoutPreference).toBe('stats_kpi');

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('大纲：上移本页 → 服务端的页序真的换了', async () => {
    const session = await harness.newSession();
    try {
      const fx = await setupCompiledWorkbench(session, { pageCount: 3 });
      await gotoOutlineTab(session);

      const before = await fetchOutline(session, fx.projectId);
      expect(before.length).toBeGreaterThanOrEqual(2);
      const movedId = before[1].slideId;

      await session.page.getByTestId('outline-move-up-1').click();

      const after = await waitForOutline(
        session,
        fx.projectId,
        (o) => o.length === before.length && o[0].slideId === movedId,
        '服务端大纲的第 1 项换成了原来第 2 项'
      );

      expect(after.map((i) => i.slideId)).toEqual([
        movedId,
        ...before.filter((i) => i.slideId !== movedId).map((i) => i.slideId),
      ]);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('大纲：下移本页 → 服务端的页序真的换了', async () => {
    const session = await harness.newSession();
    try {
      const fx = await setupCompiledWorkbench(session, { pageCount: 3 });
      await gotoOutlineTab(session);

      const before = await fetchOutline(session, fx.projectId);
      expect(before.length).toBeGreaterThanOrEqual(2);
      const movedId = before[0].slideId;

      await session.page.getByTestId('outline-move-down-0').click();

      const after = await waitForOutline(
        session,
        fx.projectId,
        (o) => o.length === before.length && o[1].slideId === movedId,
        '服务端大纲的第 2 项换成了原来第 1 项'
      );

      // 「下移」是跟**紧邻的那一项**换位，不是挪到末尾
      expect(after.map((i) => i.slideId)).toEqual([
        before[1].slideId,
        movedId,
        ...before.slice(2).map((i) => i.slideId),
      ]);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('大纲：删除本页 → 服务端的大纲少了一项', async () => {
    const session = await harness.newSession();
    try {
      const fx = await setupCompiledWorkbench(session, { pageCount: 3 });
      await gotoOutlineTab(session);

      const before = await fetchOutline(session, fx.projectId);
      expect(before.length).toBeGreaterThanOrEqual(2);
      const removedId = before[1].slideId;

      await session.page.getByTestId('outline-delete-1').click();

      const after = await waitForOutline(
        session,
        fx.projectId,
        (o) => o.length === before.length - 1,
        '服务端大纲少了一项'
      );

      expect(after.length).toBe(before.length - 1);
      expect(after.map((i) => i.slideId)).not.toContain(removedId);
      expect(await outlineItemCount(session)).toBe(after.length);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  /* ---------------------------------------------------------------- */
  /* 页签互切                                                          */
  /* ---------------------------------------------------------------- */

  test('页签互切 → 六个页签都真的切过去了', async () => {
    const session = await harness.newSession();
    try {
      await setupCompiledWorkbench(session, { pageCount: 3 });

      const tabs: Array<[string, string]> = [
        ['projects', 'project-card'],
        ['create', 'topic-prompt'],
        ['outline', 'outline-item-0'],
        ['templates', 'template-center'],
        ['quality', 'quality-report'],
        ['workbench', 'slide-canvas'],
      ];

      for (const [tab, panel] of tabs) {
        await session.page.getByTestId(`nav-${tab}`).click();
        await session.page
          .getByTestId(panel)
          .first()
          .waitFor({ state: 'visible', timeout: 20_000 });
      }

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  /* ---------------------------------------------------------------- */
  /* bug 回归锁                                                        */
  /* ---------------------------------------------------------------- */

  test('AC-E2E-023 PNG/SVG 导出 → scope 只含当前页', async () => {
    const session = await harness.newSession();
    try {
      const fx = await setupCompiledWorkbench(session, { pageCount: 4 });

      // 停在第 2 页
      await gotoSlide(session, 1, fx.slideIds[1]);
      expect(await currentSlideId(session)).toBe(fx.slideIds[1]);

      const bodies = await captureExportRequests(session);

      // PNG
      await session.page.getByTestId('open-export').click();
      await session.page.getByTestId('export-format-png').click();
      await session.page.getByTestId('export-submit').click();
      await waitFor(async () => bodies.length >= 1, 25_000, '捕获到 PNG 导出请求');

      // SVG —— 同一个 scope 规则
      await session.page.getByTestId('export-format-svg').click();
      await session.page.getByTestId('export-submit').click();
      await waitFor(async () => bodies.length >= 2, 25_000, '捕获到 SVG 导出请求');

      const png = bodies[0];
      const svg = bodies[1];

      expect(png.format).toBe('png');
      expect(png.projectId).toBe(fx.projectId);
      // 关键：scope 里**只有当前页**，第 1 页不许混进来
      expect(png.scope?.slideIds).toEqual([fx.slideIds[1]]);

      expect(svg.format).toBe('svg');
      expect(svg.projectId).toBe(fx.projectId);
      expect(svg.scope?.slideIds).toEqual([fx.slideIds[1]]);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('AC-E2E-024 导出弹窗的 PNG 说明 → 页码跟着当前页走', async () => {
    const session = await harness.newSession();
    try {
      const fx = await setupCompiledWorkbench(session, { pageCount: 4 });

      // 停在第 2 页
      await gotoSlide(session, 1, fx.slideIds[1]);
      expect(await currentSlideId(session)).toBe(fx.slideIds[1]);

      await session.page.getByTestId('open-export').click();
      await session.page.getByTestId('export-format-png').click();

      const hint = (
        (await session.page.getByTestId('export-png-hint').textContent()) ?? ''
      ).trim();

      expect(hint).toContain('当前第 2 页');
      // 不许写死第 1 页
      expect(hint).not.toContain('当前第 1 页');

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('AC-E2E-025 工作台第 2 页点放映 → 从第 2 页开始', async () => {
    const session = await harness.newSession();
    try {
      const fx = await setupCompiledWorkbench(session, { pageCount: 4 });

      // 停在第 2 页
      await gotoSlide(session, 1, fx.slideIds[1]);
      expect(await currentSlideId(session)).toBe(fx.slideIds[1]);

      await session.page.getByTestId('start-present').click();
      await session.page
        .getByTestId('presentation-mode')
        .waitFor({ state: 'visible', timeout: 20_000 });

      const mode = session.page.getByTestId('presentation-mode');
      expect(await mode.getAttribute('data-slide-index')).toBe('1');

      const total = fx.slideIds.length;
      const pager = ((await session.page.getByTestId('presentation-pager').textContent()) ?? '').trim();
      expect(pager).toBe(
        `${String(2).padStart(2, '0')} / ${String(total).padStart(2, '0')}`
      );

      // 放映画布上画的必须是**服务端第 2 页那份 IR**
      const serverIr = await fetchSlideIr(session, fx.projectId, fx.slideIds[1]);
      const title = (
        (await session.page.getByTestId('presentation-title').textContent()) ?? ''
      ).trim();
      expect(title).toBe(serverIr.title);

      const canvasHtml = await session.page.getByTestId('presentation-canvas').innerHTML();
      const head = squash(serverIr.title).slice(0, 6);
      expect(squash(canvasHtml)).toContain(head);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  /* ---------------------------------------------------------------- */
  /* 放映补充                                                          */
  /* ---------------------------------------------------------------- */

  test('放映：退出放映回到工作台，页码没变', async () => {
    const session = await harness.newSession();
    try {
      const fx = await setupCompiledWorkbench(session, { pageCount: 4 });

      await gotoSlide(session, 1, fx.slideIds[1]);
      expect(await currentSlideId(session)).toBe(fx.slideIds[1]);

      await session.page.getByTestId('start-present').click();
      await session.page
        .getByTestId('presentation-mode')
        .waitFor({ state: 'visible', timeout: 20_000 });

      await session.page.getByTestId('presentation-close').click();
      await session.page
        .getByTestId('presentation-mode')
        .waitFor({ state: 'hidden', timeout: 20_000 });

      // 回到工作台，仍然停在第 2 页
      await session.page.getByTestId('slide-canvas').waitFor({ state: 'visible', timeout: 20_000 });
      expect(await currentSlideId(session)).toBe(fx.slideIds[1]);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('放映：计时器重置归零', async () => {
    const session = await harness.newSession();
    try {
      await setupCompiledWorkbench(session, { pageCount: 3 });

      await session.page.getByTestId('start-present').click();
      await session.page
        .getByTestId('presentation-mode')
        .waitFor({ state: 'visible', timeout: 20_000 });

      // 计时器就在重置按钮的前一个兄弟节点上
      const timer = session.page
        .getByTestId('presentation-timer-reset')
        .locator('xpath=preceding-sibling::span');

      // 等它真的走起来（至少 2 秒）—— 不然"重置"前后读数一样，测不出东西
      await waitFor(
        async () => /^00:0[2-9]$/.test(((await timer.textContent()) ?? '').trim()),
        20_000,
        '计时器走到 2 秒以上'
      );

      await session.page.getByTestId('presentation-timer-reset').click();

      const after = ((await timer.textContent()) ?? '').trim();
      // 重置后是 00:00；但那一秒的定时器可能正好跳一下 → 00:01 也算数
      expect(after).toMatch(/^00:0[01]$/);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);
});
