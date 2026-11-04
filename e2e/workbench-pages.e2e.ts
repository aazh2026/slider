/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 工作台页级操作链 —— 加页 / 复制页 / 删页 / 移页 / 切页
 * ---------------------------------------------------------------------------
 * 这一链守的是**页栏（左侧缩略图轨道）**这一层交互。
 *
 * 以前缩略图上的四种操作（上移 / 下移 / 复制 / 删除）只有 `title` 属性，
 * 没有 `data-testid` —— 而且它们是 **hover 才显形**的，
 * 连"怎么点到它们"这件事本身都没有答案。
 *
 * 断言分层（这一链必须显式登记，否则读者会以为断言写错了）
 * ---------------------------------------------------------------------------
 * `App.tsx` 的 `syncProject` 只在「某一页自己的 IR 变了」时才写服务端：
 *
 *   · 新建的页没有 `baseVersionId` → 直接跳过；
 *   · 删页 / 移页 / 复制页改的是**页集合**，每页自己的 IR 一个字节都没动
 *     → 同步器认为"没东西可写" → 也不写。
 *
 * 所以**页级操作不落库**（刷新就丢）。
 * 这一点已登记进 `spec/spec.yaml` 的 `known_gaps`（SPEC-E2E-003）。
 * 因此这一链的断言落在**界面侧**（缩略图数量、顺序、画布当前页），
 * 唯一的例外是「插入元素」—— 那是元素级编辑，会落库，断言在服务端 IR 上。
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import {
  TEST_TIMEOUT,
  assertServersUp,
  launchHarness,
  uncaughtErrors,
  type Harness,
  type Session,
} from './helpers';
import {
  currentSlideId,
  fetchSlideIr,
  setupCompiledWorkbench,
  waitForSlideIr,
} from './fixtures.workbench';

let harness: Harness;

beforeAll(async () => {
  await assertServersUp();
  harness = await launchHarness();
});

afterAll(async () => {
  await harness?.close();
});

/** 缩略图数量 */
async function thumbCount(session: Session): Promise<number> {
  return session.page.locator('[data-testid="slide-thumb"]').count();
}

/** 缩略图按顺序的 slideId */
async function thumbIds(session: Session): Promise<string[]> {
  const thumbs = session.page.locator('[data-testid="slide-thumb"]');
  const count = await thumbs.count();
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    ids.push((await thumbs.nth(i).getAttribute('data-slide-id')) ?? '');
  }
  return ids;
}

/** hover 到第 index 张缩略图 —— 页操作按钮是 hover 才显形的 */
async function hoverThumb(session: Session, index: number): Promise<void> {
  await session.page.locator('[data-testid="slide-thumb"]').nth(index).hover();
}

describe('工作台页级操作链（真实浏览器 + 真实服务端）', () => {
  test('加页 → 缩略图多一页，画布切到新页', async () => {
    const session = await harness.newSession();
    try {
      const wb = await setupCompiledWorkbench(session, { pageCount: 3 });
      const before = await thumbCount(session);
      const beforeSlide = await currentSlideId(session);

      await session.page.getByTestId('wb-rail-add-slide').click();
      await session.page.getByTestId('wb-layout-option-cards_grid').click();

      expect(await thumbCount(session)).toBe(before + 1);

      const afterSlide = await currentSlideId(session);
      expect(afterSlide).not.toBe(beforeSlide);
      expect(wb.slideIds).not.toContain(afterSlide);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('加页 → 版式弹窗可以关掉且不产生新页', async () => {
    const session = await harness.newSession();
    try {
      await setupCompiledWorkbench(session, { pageCount: 3 });
      const before = await thumbCount(session);

      await session.page.getByTestId('wb-rail-add-slide').click();
      await session.page.getByTestId('wb-layout-modal-close').click();

      expect(await session.page.getByTestId('wb-layout-option-cards_grid').count()).toBe(0);
      expect(await thumbCount(session)).toBe(before);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('复制页 → 缩略图多一页，新页标题带「(副本)」', async () => {
    const session = await harness.newSession();
    try {
      await setupCompiledWorkbench(session, { pageCount: 3 });
      const before = await thumbCount(session);

      await hoverThumb(session, 0);
      await session.page.getByTestId('wb-slide-duplicate-0').click();

      expect(await thumbCount(session)).toBe(before + 1);

      const titles = await session.page
        .locator('[data-testid="slide-thumb"]')
        .nth(1)
        .textContent();
      expect(titles ?? '').toContain('(副本)');

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('删页 → 缩略图少一页', async () => {
    const session = await harness.newSession();
    try {
      await setupCompiledWorkbench(session, { pageCount: 3 });
      const before = await thumbCount(session);

      await hoverThumb(session, 1);
      await session.page.getByTestId('wb-slide-delete-1').click();

      expect(await thumbCount(session)).toBe(before - 1);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('上移 → 缩略图顺序真的换了位置', async () => {
    const session = await harness.newSession();
    try {
      await setupCompiledWorkbench(session, { pageCount: 3 });
      const before = await thumbIds(session);

      await hoverThumb(session, 1);
      await session.page.getByTestId('wb-slide-move-up-1').click();

      const after = await thumbIds(session);
      expect(after[0]).toBe(before[1]);
      expect(after[1]).toBe(before[0]);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('下移 → 缩略图顺序真的换了位置', async () => {
    const session = await harness.newSession();
    try {
      await setupCompiledWorkbench(session, { pageCount: 3 });
      const before = await thumbIds(session);

      await hoverThumb(session, 0);
      await session.page.getByTestId('wb-slide-move-down-0').click();

      const after = await thumbIds(session);
      expect(after[0]).toBe(before[1]);
      expect(after[1]).toBe(before[0]);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('点缩略图 → 画布切到那一页', async () => {
    const session = await harness.newSession();
    try {
      const wb = await setupCompiledWorkbench(session, { pageCount: 3 });

      await session.page.locator('[data-testid="slide-thumb"]').nth(2).click();

      expect(await currentSlideId(session)).toBe(wb.slideIds[2]);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('撤销 → 页级操作也能退回去', async () => {
    const session = await harness.newSession();
    try {
      await setupCompiledWorkbench(session, { pageCount: 3 });
      const before = await thumbCount(session);

      await session.page.getByTestId('wb-rail-add-slide').click();
      await session.page.getByTestId('wb-layout-option-summary_conclusion').click();
      expect(await thumbCount(session)).toBe(before + 1);

      await session.page.getByTestId('wb-undo').click();

      expect(await thumbCount(session)).toBe(before);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('插入元素 → 元素级编辑会落库（服务端 IR 多一个元素）', async () => {
    const session = await harness.newSession();
    try {
      const wb = await setupCompiledWorkbench(session, { pageCount: 3 });
      const slideId = wb.slideIds[0]!;
      const before = await fetchSlideIr(session, wb.projectId, slideId);

      await session.page.getByTestId('wb-insert-menu').click();
      await session.page.getByTestId('wb-insert-text').click();

      await waitForSlideIr(
        session,
        wb.projectId,
        slideId,
        (ir) => ir.elements.length === before.elements.length + 1,
        '服务端多了一个新插入的元素'
      );

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('收起左栏 → 只剩页码按钮，展开后缩略图回来', async () => {
    const session = await harness.newSession();
    try {
      await setupCompiledWorkbench(session, { pageCount: 3 });
      expect(await thumbCount(session)).toBeGreaterThan(0);

      await session.page.getByTestId('wb-rail-collapse').click();

      expect(await session.page.locator('[data-testid="slide-thumb"]').count()).toBe(0);
      expect(await session.page.getByTestId('wb-rail-page-0').count()).toBe(1);
      expect(await session.page.getByTestId('wb-rail-add-slide-collapsed').count()).toBe(1);

      await session.page.getByTestId('wb-rail-collapse').click();

      expect(await thumbCount(session)).toBeGreaterThan(0);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);
});
