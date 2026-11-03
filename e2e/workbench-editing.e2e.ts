/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 工作台元素编辑链 —— 属性面板改的东西，到底有没有进服务端
 * ---------------------------------------------------------------------------
 * 这一链守的是**属性面板到服务端的那一段**。
 *
 * 以前属性面板的每一个字段都没有 `data-testid`，也没有 `<label htmlFor>` ——
 * 也就是说，"改一下字号"这条路径在物理上**不可测**：
 * 没法定位输入框、没法区分字号和字重、没法证明改完的值落到了服务端。
 *
 * 断言一律落在**服务端 IR** 上，不落在界面显示上：
 * 界面显示的是本地 state，服务端存的是权威 —— 只断言界面的话，
 * 把 PATCH 请求整个换掉这些用例照样绿。
 *
 * 断言分层（页级操作不在这一链里，见 workbench-pages.e2e.ts）：
 *   · 元素级编辑会落库 → 断言在服务端 IR 上。
 *   · 页级操作（加页/删页/移页）**不落库** → 只能在界面侧断言。
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import {
  TEST_TIMEOUT,
  assertServersUp,
  launchHarness,
  uncaughtErrors,
  type Harness,
} from './helpers';
import {
  fetchSlideIr,
  findElement,
  selectElementByRole,
  setColorInput,
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

describe('工作台元素编辑链（真实浏览器 + 真实服务端）', () => {
  test('选中元素 → 属性面板回显的是服务端 IR 里的真实几何', async () => {
    const session = await harness.newSession();
    try {
      const wb = await setupCompiledWorkbench(session, { pageCount: 3 });
      const slideId = wb.slideIds[0]!;

      const elementId = await selectElementByRole(session, 'title');
      const server = findElement(await fetchSlideIr(session, wb.projectId, slideId), elementId);

      expect(await session.page.getByTestId('wb-el-x').inputValue()).toBe(
        String(server.geometry.x)
      );
      expect(await session.page.getByTestId('wb-el-y').inputValue()).toBe(
        String(server.geometry.y)
      );
      expect(await session.page.getByTestId('wb-el-width').inputValue()).toBe(
        String(server.geometry.width)
      );
      expect(await session.page.getByTestId('wb-el-height').inputValue()).toBe(
        String(server.geometry.height)
      );

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('改 X 坐标 → 服务端那一页的 geometry.x 真的变了', async () => {
    const session = await harness.newSession();
    try {
      const wb = await setupCompiledWorkbench(session, { pageCount: 3 });
      const slideId = wb.slideIds[0]!;
      const elementId = await selectElementByRole(session, 'title');

      await session.page.getByTestId('wb-el-x').fill('321');

      await waitForSlideIr(
        session,
        wb.projectId,
        slideId,
        (ir) => findElement(ir, elementId).geometry.x === 321,
        '服务端 X 坐标变成 321'
      );

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('改 Y 坐标 → 服务端那一页的 geometry.y 真的变了', async () => {
    const session = await harness.newSession();
    try {
      const wb = await setupCompiledWorkbench(session, { pageCount: 3 });
      const slideId = wb.slideIds[0]!;
      const elementId = await selectElementByRole(session, 'title');

      await session.page.getByTestId('wb-el-y').fill('654');

      await waitForSlideIr(
        session,
        wb.projectId,
        slideId,
        (ir) => findElement(ir, elementId).geometry.y === 654,
        '服务端 Y 坐标变成 654'
      );

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('改宽高 → 服务端那一页的 geometry.width / height 真的变了', async () => {
    const session = await harness.newSession();
    try {
      const wb = await setupCompiledWorkbench(session, { pageCount: 3 });
      const slideId = wb.slideIds[0]!;
      const elementId = await selectElementByRole(session, 'title');

      await session.page.getByTestId('wb-el-width').fill('880');
      await session.page.getByTestId('wb-el-height').fill('220');

      await waitForSlideIr(
        session,
        wb.projectId,
        slideId,
        (ir) => {
          const el = findElement(ir, elementId);
          return el.geometry.width === 880 && el.geometry.height === 220;
        },
        '服务端宽高变成 880×220'
      );

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('改字号 → 服务端那一页的 style.fontSize 真的变了', async () => {
    const session = await harness.newSession();
    try {
      const wb = await setupCompiledWorkbench(session, { pageCount: 3 });
      const slideId = wb.slideIds[0]!;
      const elementId = await selectElementByRole(session, 'title');

      await session.page.getByTestId('wb-el-font-size').fill('72');

      await waitForSlideIr(
        session,
        wb.projectId,
        slideId,
        (ir) => findElement(ir, elementId).style.fontSize === 72,
        '服务端字号变成 72'
      );

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('改字重 → 服务端那一页的 style.fontWeight 真的变了', async () => {
    const session = await harness.newSession();
    try {
      const wb = await setupCompiledWorkbench(session, { pageCount: 3 });
      const slideId = wb.slideIds[0]!;
      const elementId = await selectElementByRole(session, 'title');

      await session.page.getByTestId('wb-el-font-weight').selectOption('700');

      await waitForSlideIr(
        session,
        wb.projectId,
        slideId,
        (ir) => findElement(ir, elementId).style.fontWeight === 700,
        '服务端字重变成 700'
      );

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('改背景色 → 服务端那一页的 style.backgroundColor 真的变了', async () => {
    const session = await harness.newSession();
    try {
      const wb = await setupCompiledWorkbench(session, { pageCount: 3 });
      const slideId = wb.slideIds[0]!;
      const elementId = await selectElementByRole(session, 'title');

      await setColorInput(session, 'wb-el-bg-color', '#ff8800');

      // 颜色输入框旁边的读数是给人和给测试看的同一份值
      expect(
        ((await session.page.getByTestId('wb-el-bg-color-value').textContent()) ?? '').trim()
      ).toBe('#ff8800');

      await waitForSlideIr(
        session,
        wb.projectId,
        slideId,
        (ir) => findElement(ir, elementId).style.backgroundColor === '#ff8800',
        '服务端背景色变成 #ff8800'
      );

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('改文本内容 → 服务端那一页的 content 真的变了', async () => {
    const session = await harness.newSession();
    try {
      const wb = await setupCompiledWorkbench(session, { pageCount: 3 });
      const slideId = wb.slideIds[0]!;
      const elementId = await selectElementByRole(session, 'title');
      const marker = 'E2E-改过的标题';

      await session.page.getByTestId('wb-el-content-text').fill(marker);

      await waitForSlideIr(
        session,
        wb.projectId,
        slideId,
        (ir) => findElement(ir, elementId).content === marker,
        `服务端标题内容变成 ${marker}`
      );

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('水平居中 → 服务端那一页的 x 落在画布正中', async () => {
    const session = await harness.newSession();
    try {
      const wb = await setupCompiledWorkbench(session, { pageCount: 3 });
      const slideId = wb.slideIds[0]!;
      const elementId = await selectElementByRole(session, 'title');
      const before = findElement(await fetchSlideIr(session, wb.projectId, slideId), elementId);

      await session.page.getByTestId('wb-el-align-h-center').click();

      const expected = Math.round((1920 - before.geometry.width) / 2);
      await waitForSlideIr(
        session,
        wb.projectId,
        slideId,
        (ir) => findElement(ir, elementId).geometry.x === expected,
        `服务端 x 居中到 ${expected}`
      );

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('垂直居中 → 服务端那一页的 y 落在画布正中', async () => {
    const session = await harness.newSession();
    try {
      const wb = await setupCompiledWorkbench(session, { pageCount: 3 });
      const slideId = wb.slideIds[0]!;
      const elementId = await selectElementByRole(session, 'title');
      const before = findElement(await fetchSlideIr(session, wb.projectId, slideId), elementId);

      await session.page.getByTestId('wb-el-align-v-center').click();

      const expected = Math.round((1080 - before.geometry.height) / 2);
      await waitForSlideIr(
        session,
        wb.projectId,
        slideId,
        (ir) => findElement(ir, elementId).geometry.y === expected,
        `服务端 y 居中到 ${expected}`
      );

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('复制元素 → 服务端那一页多出一个副本元素', async () => {
    const session = await harness.newSession();
    try {
      const wb = await setupCompiledWorkbench(session, { pageCount: 3 });
      const slideId = wb.slideIds[0]!;
      const elementId = await selectElementByRole(session, 'title');
      const before = await fetchSlideIr(session, wb.projectId, slideId);
      const original = findElement(before, elementId);

      await session.page.getByTestId('wb-el-duplicate').click();

      await waitForSlideIr(
        session,
        wb.projectId,
        slideId,
        (ir) => ir.elements.length === before.elements.length + 1,
        '服务端多出一个副本元素'
      );

      const after = await fetchSlideIr(session, wb.projectId, slideId);
      const copy = after.elements.find(
        (el) => el.id !== elementId && el.geometry.x === original.geometry.x + 30
      );
      expect(copy).toBeDefined();
      expect(copy!.geometry.y).toBe(original.geometry.y + 30);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('删除元素 → 服务端那一页真的少了一个元素', async () => {
    const session = await harness.newSession();
    try {
      const wb = await setupCompiledWorkbench(session, { pageCount: 3 });
      const slideId = wb.slideIds[0]!;
      const elementId = await selectElementByRole(session, 'title');
      const before = await fetchSlideIr(session, wb.projectId, slideId);

      await session.page.getByTestId('wb-el-delete').click();

      await waitForSlideIr(
        session,
        wb.projectId,
        slideId,
        (ir) =>
          ir.elements.length === before.elements.length - 1 &&
          ir.elements.every((el) => el.id !== elementId),
        '服务端少了一个元素'
      );

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('撤销 → 服务端那一页回到改之前的值', async () => {
    const session = await harness.newSession();
    try {
      const wb = await setupCompiledWorkbench(session, { pageCount: 3 });
      const slideId = wb.slideIds[0]!;
      const elementId = await selectElementByRole(session, 'title');
      const original = findElement(
        await fetchSlideIr(session, wb.projectId, slideId),
        elementId
      );

      await session.page.getByTestId('wb-el-x').fill('321');
      await waitForSlideIr(
        session,
        wb.projectId,
        slideId,
        (ir) => findElement(ir, elementId).geometry.x === 321,
        '服务端 X 坐标先变成 321'
      );

      await session.page.getByTestId('wb-undo').click();

      await waitForSlideIr(
        session,
        wb.projectId,
        slideId,
        (ir) => findElement(ir, elementId).geometry.x === original.geometry.x,
        `服务端 X 坐标撤销回 ${original.geometry.x}`
      );

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('置顶 → 服务端那一页的 zIndex 变成最大', async () => {
    const session = await harness.newSession();
    try {
      const wb = await setupCompiledWorkbench(session, { pageCount: 3 });
      const slideId = wb.slideIds[0]!;
      const elementId = await selectElementByRole(session, 'title');
      const before = await fetchSlideIr(session, wb.projectId, slideId);
      const maxBefore = Math.max(...before.elements.map((el) => el.zIndex ?? 0));
      const target = findElement(before, elementId);

      await session.page.getByTestId('wb-el-bring-front').click();

      await waitForSlideIr(
        session,
        wb.projectId,
        slideId,
        (ir) => (findElement(ir, elementId).zIndex ?? 0) > maxBefore,
        '服务端 zIndex 超过原来的最大值'
      );

      const after = await fetchSlideIr(session, wb.projectId, slideId);
      const maxAfter = Math.max(...after.elements.map((el) => el.zIndex ?? 0));
      expect(findElement(after, elementId).zIndex).toBe(maxAfter);
      expect(target.zIndex ?? 0).toBeLessThan(maxAfter);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);
});
