/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 演示链 —— 全屏放映模式
 * ---------------------------------------------------------------------------
 * 放映模式是**读服务端那份 IR** 的最后一个消费者：
 * 工作台画一遍、导出一遍、放映再画一遍 —— 三处必须一致。
 *
 * 所以这里的判据不是"放映界面出现了"，而是：
 *   · 放映画布上那页的 data-slide-id == 服务端那一页的 slideId
 *   · 放映画布上的文字 == 服务端 IR 里的文字
 *   · 翻页翻的是**服务端那一页**，不是本地数组的下一项
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import {
  TEST_TIMEOUT,
  apiFetch,
  assertServersUp,
  confirmOutlineViaUi,
  createProjectViaUi,
  fetchSlide,
  generateOutlineViaUi,
  launchHarness,
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

/** 放映画布上正在显示的 slideId */
async function presentedSlideId(session: Session): Promise<string | null> {
  const svg = session.page.locator('[data-testid="presentation-canvas"] svg');
  return svg.getAttribute('data-slide-id');
}

/** 放映画布上的文字 */
async function presentedText(session: Session): Promise<string> {
  const html = await session.page
    .locator('[data-testid="presentation-canvas"]')
    .innerHTML();
  return html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, '');
}

/** 建一个编译好的项目并进入放映模式 */
async function enterPresentation(
  session: Session,
  label: string
): Promise<{ projectId: string; slideIds: string[] }> {
  await registerAndEnterApp(session);
  const projectId = await createProjectViaUi(session, unique(label));
  await generateOutlineViaUi(session, { topic: unique(`${label} 主题`), pageCount: 4 });
  await confirmOutlineViaUi(session);

  const slides = await apiFetch<{ slides: Array<{ slideId: string }> }>(
    session.page,
    `/api/projects/${projectId}/slides`
  );
  const slideIds = slides.body.data!.slides.map((s) => s.slideId);

  await session.page.getByTestId('start-present').click();
  await session.page
    .getByTestId('presentation-mode')
    .waitFor({ state: 'visible', timeout: 20_000 });

  return { projectId, slideIds };
}

describe('演示链（真实浏览器 + 真实服务端）', () => {
  test('进入放映 → 画的是服务端第一页，页码是 01 / N', async () => {
    const session = await harness.newSession();
    try {
      const { projectId, slideIds } = await enterPresentation(session, 'E2E 放映');

      expect(slideIds.length).toBe(4);

      // 画布上的 slide-id 必须与服务端第一页一致
      await waitFor(
        async () => (await presentedSlideId(session)) === slideIds[0],
        10_000,
        '放映画布画的是服务端第一页'
      );

      // 页码
      const pager = ((await session.page.getByTestId('presentation-pager').textContent()) ?? '').trim();
      expect(pager).toBe('01 / 04');

      // 标题条上的标题 == 服务端那一页的标题
      const slide = await fetchSlide(session.page, projectId, slideIds[0]!);
      expect(slide).not.toBeNull();
      const serverTitle = (slide!.ir as { title: string }).title;
      expect(serverTitle.length).toBeGreaterThan(0);
      expect(
        ((await session.page.getByTestId('presentation-title').textContent()) ?? '').trim()
      ).toBe(serverTitle);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('翻页 → 换到服务端的后一页，退回后回到第一页', async () => {
    const session = await harness.newSession();
    try {
      const { slideIds } = await enterPresentation(session, 'E2E 放映翻页');

      // 下一页
      await session.page.getByTestId('presentation-next').click();
      await waitFor(
        async () => (await presentedSlideId(session)) === slideIds[1],
        10_000,
        '翻到服务端第二页'
      );
      expect(((await session.page.getByTestId('presentation-pager').textContent()) ?? '').trim()).toBe(
        '02 / 04'
      );

      // 上一页
      await session.page.getByTestId('presentation-prev').click();
      await waitFor(
        async () => (await presentedSlideId(session)) === slideIds[0],
        10_000,
        '退回第一页'
      );

      // --- 键盘翻页也要能用（[空格/箭头]） ---
      await session.page.keyboard.press('ArrowRight');
      await waitFor(
        async () => (await presentedSlideId(session)) === slideIds[1],
        10_000,
        '键盘翻到第二页'
      );
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('放映画面上的文字 == 服务端 IR 里的文字', async () => {
    const session = await harness.newSession();
    try {
      const { projectId, slideIds } = await enterPresentation(session, 'E2E 放映内容');

      const slide = await fetchSlide(session.page, projectId, slideIds[0]!);
      expect(slide).not.toBeNull();

      const ir = slide!.ir as { elements: Array<{ content: unknown }> };
      const texts = ir.elements
        .map((el) => el.content)
        .filter((c): c is string => typeof c === 'string' && c.trim().length > 0);

      expect(texts.length).toBeGreaterThan(0);

      const onScreen = await presentedText(session);
      for (const t of texts) {
        expect(onScreen).toContain(t.replace(/\s+/g, ''));
      }
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('备注抽屉 → 显示本页要点；退出演放 → 回到工作台', async () => {
    const session = await harness.newSession();
    try {
      await enterPresentation(session, 'E2E 放映备注');

      // 备注抽屉默认不显示
      expect(await session.page.getByTestId('presentation-notes').count()).toBe(0);

      await session.page.getByTestId('presentation-toggle-notes').click();
      const notes = session.page.getByTestId('presentation-notes');
      await notes.waitFor({ state: 'visible', timeout: 10_000 });
      expect(((await notes.textContent()) ?? '').trim().length).toBeGreaterThan(0);

      // 大纲抽屉
      await session.page.getByTestId('presentation-toggle-drawer').click();
      await session.page
        .getByTestId('presentation-drawer')
        .waitFor({ state: 'visible', timeout: 10_000 });
      expect(await session.page.getByTestId('presentation-drawer-thumb').count()).toBe(4);

      // 抽屉是**盖在底部控制条上**的 —— 按钮点不到，只能用快捷键收：
      // [G] 开合大纲、[N] 开合备注。这里顺手把快捷键也测了。
      await session.page.keyboard.press('g');
      await session.page
        .getByTestId('presentation-drawer')
        .waitFor({ state: 'detached', timeout: 10_000 });

      await session.page.keyboard.press('n');
      await session.page
        .getByTestId('presentation-notes')
        .waitFor({ state: 'detached', timeout: 10_000 });

      // 退出放映 → 回到工作台
      await session.page.getByTestId('presentation-close').click();
      await session.page
        .getByTestId('presentation-mode')
        .waitFor({ state: 'detached', timeout: 10_000 });
      await session.page.getByTestId('slide-canvas').waitFor({ state: 'visible', timeout: 20_000 });
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);
});
