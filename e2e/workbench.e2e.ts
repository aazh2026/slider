/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 工作台链 —— 大纲 / 编译 / 编辑 / 同步 / 冲突 / AI
 * ---------------------------------------------------------------------------
 * 这一链覆盖的是**创作主链路**。以前它只有 6 条用例串在一条流程里，
 * 而且最要命的一条（版本冲突）是用 `page.evaluate` 直接发 fetch 测的 ——
 * 绕开了前端的 apiClient，于是 `App.tsx` 的冲突分支（409 → 提示用户刷新）
 * 实际上**一行都没被跑到过**。
 *
 * 现在每条用例自包含：自己建账号、自己建项目、自己编译。
 * 冲突用例用**两个浏览器上下文**造真实的并发，而不是手工构造一个 409。
 *
 * 判据仍然落在服务端状态上：UI 做了什么 → 服务端库里到底存了什么。
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import {
  TEST_TIMEOUT,
  apiFetch,
  assertServersUp,
  canvasShows,
  canvasText,
  confirmOutlineViaUi,
  createProjectViaUi,
  fetchSlide,
  generateOutlineViaUi,
  irContains,
  launchHarness,
  loginViaUi,
  openProjectInWorkbench,
  registerAndEnterApp,
  uncaughtErrors,
  unique,
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

/** 一页的标题元素（覆盖层上的那个） */
function titleElement(session: Session) {
  return session.page.locator(
    '[data-testid="slide-element"][data-role="title"][data-editable="true"]'
  );
}

/**
 * 双击标题元素 → 就地改文本 → 回车保存。
 *
 * 走的是「双击画布上的元素」这条路 —— 不是调 API 假装编辑过。
 */
async function editTitleText(session: Session, text: string): Promise<void> {
  const el = titleElement(session);
  await el.waitFor({ state: 'visible', timeout: 20_000 });
  await el.dblclick();
  const editor = session.page.getByTestId('inline-text-editor');
  await editor.waitFor({ state: 'visible', timeout: 10_000 });
  await editor.fill(text);
  await editor.press('Enter');
}

describe('工作台链（真实浏览器 + 真实服务端）', () => {
  test('AC-E2E-003 生成大纲 → 页数、主题、服务端与 UI 一致', async () => {
    const session = await harness.newSession();
    try {
      await registerAndEnterApp(session);
      const projectId = await createProjectViaUi(session, unique('E2E 大纲项目'));

      const topic = unique('E2E 主题');
      const pageCount = 5;
      await generateOutlineViaUi(session, { topic, pageCount });

      // --- UI 上的页数 ---
      const items = session.page.locator('[data-testid^="outline-item-"]');
      expect(await items.count()).toBe(pageCount);

      // --- UI 上的标题就是主题（本地降级也必须按主题动态生成） ---
      const firstItem = session.page.getByTestId('outline-item-0');
      expect(await firstItem.textContent()).toContain(topic);

      // --- 服务端存的就是这份大纲 ---
      const detail = await apiFetch<{
        project: { outline: Array<{ title: string; order: number }> };
      }>(session.page, `/api/projects/${projectId}`);
      expect(detail.status).toBe(200);
      const outline = detail.body.data!.project.outline;
      expect(outline).toHaveLength(pageCount);
      expect(outline[0]!.title).toBe(topic);

      // 页序必须是 1..N —— 大纲乱了，编译出来的页序就乱了
      expect(outline.map((o) => o.order)).toEqual([1, 2, 3, 4, 5]);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('AC-E2E-004 改大纲标题 → 服务端存新标题，UI 也显示新标题', async () => {
    const session = await harness.newSession();
    try {
      await registerAndEnterApp(session);
      const projectId = await createProjectViaUi(session, unique('E2E 改大纲'));
      await generateOutlineViaUi(session, { topic: unique('E2E 改写主题'), pageCount: 4 });

      const newTitle = unique('E2E 新标题');
      await session.page.getByTestId('outline-edit-0').click();
      const input = session.page.getByTestId('outline-title-input-0');
      await input.waitFor({ state: 'visible', timeout: 10_000 });
      await input.fill(newTitle);
      // 关掉编辑态 —— 标题随即显示为 h3
      await session.page.getByTestId('outline-edit-0').click();

      // --- 服务端落库（大纲走的是立刻写，不是防抖同步） ---
      await waitFor(
        async () => {
          const detail = await apiFetch<{ project: { outline: Array<{ title: string }> } }>(
            session.page,
            `/api/projects/${projectId}`
          );
          return detail.body.data?.project.outline[0]?.title === newTitle;
        },
        15_000,
        '服务端收到前端改的大纲标题'
      );

      const detail = await apiFetch<{ project: { outline: Array<{ title: string }> } }>(
        session.page,
        `/api/projects/${projectId}`
      );
      expect(detail.body.data!.project.outline[0]!.title).toBe(newTitle);

      // --- UI 上显示的也是新标题 ---
      await session.page
        .getByTestId('outline-item-0')
        .locator('h3')
        .waitFor({ state: 'visible', timeout: 10_000 });
      expect(await session.page.getByTestId('outline-item-0').textContent()).toContain(newTitle);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('AC-E2E-005 确认大纲并编译 → 画布渲染的正是服务端那份 IR', async () => {
    const session = await harness.newSession();
    try {
      await registerAndEnterApp(session);
      const projectId = await createProjectViaUi(session, unique('E2E 编译项目'));
      const topic = unique('E2E 编译主题');
      await generateOutlineViaUi(session, { topic, pageCount: 4 });
      await confirmOutlineViaUi(session);

      // --- 服务端编译出了 4 页 ---
      const slides = await apiFetch<{ slides: Array<{ slideId: string; versionId: string }> }>(
        session.page,
        `/api/projects/${projectId}/slides`
      );
      expect(slides.status).toBe(200);
      const serverSlides = slides.body.data!.slides;
      expect(serverSlides).toHaveLength(4);

      // --- 画布上那一页就是服务端的第一页 ---
      const canvas = session.page.getByTestId('slide-canvas');
      await canvas.waitFor({ state: 'visible', timeout: 30_000 });
      expect(await canvas.getAttribute('data-slide-id')).toBe(serverSlides[0]!.slideId);

      // --- 画布上画出来的是服务端 IR 里的标题，不是前端自己编的 ---
      const slide = await fetchSlide(session.page, projectId, serverSlides[0]!.slideId);
      expect(slide).not.toBeNull();
      const serverIr = slide!.ir as { title: string; elements: Array<{ content: unknown }> };

      // 画布**自己声明**画的是哪一页、标题是什么 —— 必须与服务端那份一致。
      // （只断言"画布里出现了主题文字"抓不到"标题被写死"：写死的标题照样能通过）
      expect(serverIr.title.length).toBeGreaterThan(0);
      expect(await canvas.getAttribute('data-slide-title')).toBe(serverIr.title);

      // --- 画布上**每一个**文本元素都来自服务端 IR ---
      const texts = serverIr.elements
        .map((el) => el.content)
        .filter((c): c is string => typeof c === 'string' && c.trim().length > 0);
      expect(texts.length).toBeGreaterThan(0);
      const painted = await canvasText(session.page);
      for (const t of texts) {
        expect(painted).toContain(t.replace(/\s+/g, ''));
      }
      expect(painted).toContain(topic.replace(/\s+/g, ''));

      // 左侧缩略图数量 == 服务端页数
      expect(await session.page.locator('[data-testid="slide-thumb"]').count()).toBe(4);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  // ---------------------------------------------------------------------------
  // AC-CORE-011 —— 画布在**屏幕上**必须保持 16:9
  //
  // 2026-11-04 实测到的真实缺陷：画布那层是 flex 项，`width: 1920` 被
  // flex-shrink 压成容器宽度（528px 的视口里被压成 480px，高度仍是 1080px），
  // 于是 1920×1080 的 SVG 被塞进 480×1080 的竖条。preserveAspectRatio="meet"
  // 只能把幻灯片缩成中间一条，上下留大片空白 —— 画布看起来是竖着的，
  // 幻灯片只剩四分之一高，而**所有内容类断言照样通过**（文字确实在 DOM 里）。
  //
  // 这条判据守的就是这个：断言的是**屏幕上的实际盒子**，不是 DOM 里有什么。
  // ---------------------------------------------------------------------------
  test('AC-CORE-011 工作台画布在屏幕上保持 16:9，不出现信箱边', async () => {
    const session = await harness.newSession();
    try {
      await registerAndEnterApp(session);
      await createProjectViaUi(session, unique('E2E 画布比例项目'));
      await generateOutlineViaUi(session, { topic: unique('E2E 画布比例主题'), pageCount: 4 });
      await confirmOutlineViaUi(session);

      const canvas = session.page.getByTestId('slide-canvas');
      await canvas.waitFor({ state: 'visible', timeout: 30_000 });
      // 等缩放过渡（transition-transform duration-100）跑完再量
      await session.page.waitForTimeout(400);

      const measured = await session.page.evaluate(() => {
        const canvas = document.querySelector('[data-testid="slide-canvas"]');
        if (!canvas) return null;
        const svg = canvas.querySelector('svg');
        if (!svg) return null;

        const box = canvas.getBoundingClientRect();
        // 幻灯片自己的整幅背景 —— layoutEngine 产出的 role=background 元素，
        // 在 SVG 里就是覆盖 0,0,1920,1080 的那个 rect。它铺满 ⇒ 没有信箱边。
        const bg = Array.from(svg.querySelectorAll('rect')).find(
          (r) => r.getAttribute('width') === '1920' && r.getAttribute('height') === '1080'
        );
        const bgBox = bg ? bg.getBoundingClientRect() : null;
        const vb = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);

        return {
          canvasW: box.width,
          canvasH: box.height,
          bgW: bgBox?.width ?? null,
          bgH: bgBox?.height ?? null,
          bgX: bgBox?.x ?? null,
          bgY: bgBox?.y ?? null,
          boxX: box.x,
          boxY: box.y,
          viewBox: vb,
        };
      });

      expect(measured).not.toBeNull();
      const m = measured!;

      // --- 画布盒必须是 16:9 ---
      // 1920/1080 = 1.7777…；容差 2% 足以容纳亚像素舍入，又足以抓住
      // "被压成 480×1080"（比例 0.44）这种量级的偏差。
      const aspect = m.canvasW / m.canvasH;
      expect(aspect).toBeGreaterThan(16 / 9 / 1.02);
      expect(aspect).toBeLessThan((16 / 9) * 1.02);

      // --- SVG 的 viewBox 比例也必须是 16:9 ---
      // viewBox 比例 == 元素盒比例 ⇒ preserveAspectRatio="meet" 下必然铺满
      const vbAspect = m.viewBox[2]! / m.viewBox[3]!;
      expect(vbAspect).toBeGreaterThan(16 / 9 / 1.02);
      expect(vbAspect).toBeLessThan((16 / 9) * 1.02);

      // --- 幻灯片必须真的铺满整个画布盒（上下左右都不留白） ---
      expect(m.bgW).not.toBeNull();
      expect(m.bgH).not.toBeNull();
      const fillW = m.bgW! / m.canvasW;
      const fillH = m.bgH! / m.canvasH;
      expect(fillW).toBeGreaterThan(0.98);
      expect(fillW).toBeLessThan(1.02);
      expect(fillH).toBeGreaterThan(0.98);
      expect(fillH).toBeLessThan(1.02);
      // 位置也要对齐：背景左上角 ≈ 画布左上角
      expect(Math.abs(m.bgX! - m.boxX)).toBeLessThan(2);
      expect(Math.abs(m.bgY! - m.boxY)).toBeLessThan(2);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  // ---------------------------------------------------------------------------
  // AC-CORE-012 —— 画布超出可视区时，溢出的两侧都**滚得到**
  //
  // 2026-11-05 实测到的真实缺陷：滚动容器写的是 `justify-content: center`。
  // 放大到超过适配档位后画布比可视内容区宽，center 会把溢出量**平均分到两侧**，
  // 而滚动容器只能往右滚 —— 左边那一半落在负坐标上，滚多少都看不到。
  // 实测 73% 缩放下左侧 460px 被裁掉且不可达（scrollLeft 已经是 0 了）。
  //
  // 这跟 SLD-02/SLD-04 是直接冲突的：位于幻灯片左侧的元素根本没法选中、没法拖。
  // 而这一类缺陷断言是抓不到的 —— DOM 里元素都在，只是"屏幕上看不见"。
  // ---------------------------------------------------------------------------
  test('AC-CORE-012 画布放大超出可视区后，左右上下都滚得到，不被裁掉', async () => {
    const session = await harness.newSession();
    try {
      await registerAndEnterApp(session);
      await createProjectViaUi(session, unique('E2E 画布可达项目'));
      await generateOutlineViaUi(session, { topic: unique('E2E 画布可达主题'), pageCount: 4 });
      await confirmOutlineViaUi(session);

      const canvas = session.page.getByTestId('slide-canvas');
      await canvas.waitFor({ state: 'visible', timeout: 30_000 });
      await session.page.waitForTimeout(400);

      // 放大到超过「适配缩放」—— 让画布确实比可视内容区宽
      for (let i = 0; i < 6; i++) {
        await session.page.getByTestId('wb-zoom-in').click();
        await session.page.waitForTimeout(40);
      }
      await session.page.waitForTimeout(400);

      const m = await session.page.evaluate(() => {
        const canvas = document.querySelector('[data-testid="slide-canvas"]');
        if (!canvas) return null;
        const holder = canvas.parentElement;
        const placeholder = holder?.parentElement;
        const viewport = placeholder?.parentElement;
        if (!viewport || !placeholder) return null;

        const cs = getComputedStyle(viewport);
        const padL = parseFloat(cs.paddingLeft);
        const padT = parseFloat(cs.paddingTop);
        const padR = parseFloat(cs.paddingRight);
        const padB = parseFloat(cs.paddingBottom);
        const vr = viewport.getBoundingClientRect();
        // 可视内容区（去掉内边距）—— 画布能看见的范围
        const contentLeft = vr.x + padL;
        const contentTop = vr.y + padT;
        const contentW = viewport.clientWidth - padL - padR;
        const contentH = viewport.clientHeight - padT - padB;

        const ph = placeholder.getBoundingClientRect();

        // 滚到最左 / 最上：幻灯片的起始边必须还在视野里
        viewport.scrollLeft = 0;
        viewport.scrollTop = 0;
        const atStart = canvas.getBoundingClientRect();
        // 滚到最右 / 最下：幻灯片的末端边必须能滚进视野
        viewport.scrollLeft = 999_999;
        viewport.scrollTop = 999_999;
        const atEnd = canvas.getBoundingClientRect();
        const maxScrollLeft = viewport.scrollWidth - viewport.clientWidth;
        const maxScrollTop = viewport.scrollHeight - viewport.clientHeight;
        viewport.scrollLeft = 0;
        viewport.scrollTop = 0;

        return {
          contentLeft,
          contentTop,
          contentW,
          contentH,
          phW: ph.width,
          phH: ph.height,
          startX: atStart.x,
          startY: atStart.y,
          endRight: atEnd.x + atEnd.width,
          endBottom: atEnd.y + atEnd.height,
          maxScrollLeft,
          maxScrollTop,
        };
      });

      expect(m).not.toBeNull();
      const d = m!;

      // --- 前置：这条用例必须真的处在「画布比可视区宽」的状态，否则它没测到东西 ---
      expect(d.phW).toBeGreaterThan(d.contentW + 100);
      expect(d.phH).toBeGreaterThan(d.contentH + 100);

      // --- 起始边不能被裁掉：滚到最左时，画布左边缘落在内容框内 ---
      expect(d.startX).toBeGreaterThanOrEqual(d.contentLeft - 1);
      expect(d.startY).toBeGreaterThanOrEqual(d.contentTop - 1);

      // --- 末端边必须能滚进来：滚到最右时，画布右边缘贴住内容框右边界 ---
      expect(d.endRight).toBeGreaterThanOrEqual(d.contentLeft + d.contentW - 2);
      expect(d.endRight).toBeLessThanOrEqual(d.contentLeft + d.contentW + 2);
      expect(d.endBottom).toBeGreaterThanOrEqual(d.contentTop + d.contentH - 2);
      expect(d.endBottom).toBeLessThanOrEqual(d.contentTop + d.contentH + 2);

      // --- 整段溢出都必须可滚：scrollLeft 的行程 == 溢出量，而不是溢出量的一半 ---
      // （`justify-content: center` 的症状正是这里只给了一半）
      expect(d.maxScrollLeft).toBeGreaterThanOrEqual(d.phW - d.contentW - 2);
      expect(d.maxScrollTop).toBeGreaterThanOrEqual(d.phH - d.contentH - 2);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  // ---------------------------------------------------------------------------
  // AC-CORE-013 —— 缩放档位始终跟着容器走
  //
  // 适配缩放如果只按"挂载时那一次"的容器尺寸算，容器一变宽它就停在旧值上：
  // 画布比可视区宽 → 多出来的一侧被裁掉（AC-CORE-012 那个坑）。
  // 容器尺寸会因很多原因变：窗口缩放、左右面板收起/展开、面板换宽度。
  // 这里用「改变窗口宽度」来验证：改完之后画布必须重新适配到新的可视区。
  // ---------------------------------------------------------------------------
  test('AC-CORE-013 容器尺寸变化后缩放档位自动重新适配，画布不被裁掉', async () => {
    const session = await harness.newSession();
    try {
      await registerAndEnterApp(session);
      await createProjectViaUi(session, unique('E2E 画布适配项目'));
      await generateOutlineViaUi(session, { topic: unique('E2E 画布适配主题'), pageCount: 4 });
      await confirmOutlineViaUi(session);

      const canvas = session.page.getByTestId('slide-canvas');
      await canvas.waitFor({ state: 'visible', timeout: 30_000 });
      await session.page.waitForTimeout(500);

      const read = async () =>
        session.page.evaluate(() => {
          const canvas = document.querySelector('[data-testid="slide-canvas"]');
          if (!canvas) return null;
          const holder = canvas.parentElement;
          const placeholder = holder?.parentElement;
          const viewport = placeholder?.parentElement;
          if (!viewport || !placeholder) return null;
          const cs = getComputedStyle(viewport);
          const padL = parseFloat(cs.paddingLeft);
          const padT = parseFloat(cs.paddingTop);
          const vr = viewport.getBoundingClientRect();
          const contentW = viewport.clientWidth - padL - parseFloat(cs.paddingRight);
          const contentH = viewport.clientHeight - padT - parseFloat(cs.paddingBottom);
          const box = canvas.getBoundingClientRect();
          return {
            contentW,
            contentH,
            canvasW: box.width,
            canvasH: box.height,
            contentLeft: vr.x + padL,
            contentTop: vr.y + padT,
            canvasX: box.x,
            canvasY: box.y,
          };
        });

      const before = await read();
      expect(before).not.toBeNull();

      // 把窗口拉宽 —— 画布容器随之变宽
      await session.page.setViewportSize({ width: 1600, height: 900 });
      await session.page.waitForTimeout(600);
      const after = await read();
      expect(after).not.toBeNull();

      const a = after!;
      const b = before!;

      // 容器确实变宽了（否则这条用例没测到东西）
      expect(a.contentW).toBeGreaterThan(b.contentW + 100);

      // 画布必须重新适配到新的可视区。
      // 注意"适配"是取宽高两个方向里**更紧的那个**（min(scaleW, scaleH)），
      // 所以不能要求画布把两个方向都填满 —— 容器比 16:9 更宽时，
      // 幻灯片按宽度贴合，高度方向本来就会留白。正确的判据是：
      // 画布尺寸 == 按新容器算出来的适配尺寸（容差 20px：
      // 适配缩放向下取整到 1%，最多差 0.01×1920 = 19.2px）。
      const fit = Math.min(a.contentW / 1920, a.contentH / 1080);
      const expectW = 1920 * fit;
      const expectH = 1080 * fit;
      expect(Math.abs(a.canvasW - expectW)).toBeLessThanOrEqual(20);
      expect(Math.abs(a.canvasH - expectH)).toBeLessThanOrEqual(20);

      // 且任何方向都不许超出可视内容区（超出 = 被裁掉）
      expect(a.canvasW).toBeLessThanOrEqual(a.contentW + 1);
      expect(a.canvasH).toBeLessThanOrEqual(a.contentH + 1);

      // 画布必须完整落在可视内容区里（左上角不被切）
      expect(a.canvasX).toBeGreaterThanOrEqual(a.contentLeft - 1);
      expect(a.canvasY).toBeGreaterThanOrEqual(a.contentTop - 1);
    } finally {
      await session.page.setViewportSize({ width: 1280, height: 720 }).catch(() => undefined);
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('AC-E2E-006 就地改文本 → 防抖写回服务端，并产生新版本号', async () => {
    const session = await harness.newSession();
    try {
      await registerAndEnterApp(session);
      const projectId = await createProjectViaUi(session, unique('E2E 编辑项目'));
      await generateOutlineViaUi(session, { topic: unique('E2E 编辑主题'), pageCount: 4 });
      await confirmOutlineViaUi(session);

      const slides = await apiFetch<{ slides: Array<{ slideId: string; versionId: string }> }>(
        session.page,
        `/api/projects/${projectId}/slides`
      );
      const first = slides.body.data!.slides[0]!;
      const before = await fetchSlide(session.page, projectId, first.slideId);
      expect(before).not.toBeNull();

      const marker = unique('E2E 手改文本');
      await editTitleText(session, marker);

      // --- 防抖写回：服务端最终拿到新文本 ---
      await waitFor(
        async () => {
          const now = await fetchSlide(session.page, projectId, first.slideId);
          return now !== null && irContains(now.ir, marker);
        },
        20_000,
        '文本编辑被写回服务端'
      );

      const after = await fetchSlide(session.page, projectId, first.slideId);
      expect(irContains(after!.ir, marker)).toBe(true);

      // --- 版本号必须前进（乐观锁的基线就靠它） ---
      expect(after!.versionId).not.toBe(before!.versionId);

      // --- 画布上画的是新文本 ---
      await waitFor(
        async () => (await canvasShows(session.page, marker)),
        10_000,
        '画布重绘出改后的文本'
      );
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('AC-E2E-007 两个会话改同一页 → 后者收到 409，前端提示且没覆盖服务端', async () => {
    const sessionA = await harness.newSession();
    const sessionB = await harness.newSession();
    try {
      // --- A 布置项目并编译 ---
      const account: Account = await registerAndEnterApp(sessionA);
      const projectId = await createProjectViaUi(sessionA, unique('E2E 冲突项目'));
      await generateOutlineViaUi(sessionA, { topic: unique('E2E 冲突主题'), pageCount: 4 });
      await confirmOutlineViaUi(sessionA);

      const slides = await apiFetch<{ slides: Array<{ slideId: string; versionId: string }> }>(
        sessionA.page,
        `/api/projects/${projectId}/slides`
      );
      const slideId = slides.body.data!.slides[0]!.slideId;
      const v0 = (await fetchSlide(sessionA.page, projectId, slideId))!.versionId;

      // --- B 用**同一个账号**登录，并打开同一个项目 ---
      // B 此刻持有的还是 v0 —— 冲突就是从这里来的。
      await loginViaUi(sessionB, account);
      await openProjectInWorkbench(sessionB, projectId);
      await titleElement(sessionB).waitFor({ state: 'visible', timeout: 20_000 });

      // --- A 先改：服务端推进到 v1 ---
      const markerA = unique('E2E A 会话');
      await editTitleText(sessionA, markerA);
      await waitFor(
        async () => {
          const now = await fetchSlide(sessionA.page, projectId, slideId);
          return now !== null && now.versionId !== v0 && irContains(now.ir, markerA);
        },
        20_000,
        'A 的修改落到服务端'
      );
      const v1 = (await fetchSlide(sessionA.page, projectId, slideId))!.versionId;
      expect(v1).not.toBe(v0);

      // --- B 接着改：B 的 baseVersionId 还是 v0 → 409 ---
      const markerB = unique('E2E B 会话');
      await editTitleText(sessionB, markerB);

      const notice = sessionB.page.getByTestId('sync-notice');
      await notice.waitFor({ state: 'visible', timeout: 20_000 });
      const noticeText = (await notice.textContent()) ?? '';
      expect(noticeText).toContain('其他会话');
      // 提示里要带上服务端当前版本号 —— 用户据此判断该刷新到什么状态
      expect(noticeText).toContain(v1);

      // --- 关键：服务端的内容没被 B 覆盖 ---
      const final = await fetchSlide(sessionA.page, projectId, slideId);
      expect(irContains(final!.ir, markerA)).toBe(true);
      expect(irContains(final!.ir, markerB)).toBe(false);
      expect(final!.versionId).toBe(v1);
    } finally {
      await sessionA.close();
      await sessionB.close();
    }
  }, TEST_TIMEOUT);

  test('AC-E2E-008 AI 编辑 → 服务端施加补丁，画布跟着重绘', async () => {
    const session = await harness.newSession();
    try {
      await registerAndEnterApp(session);
      const projectId = await createProjectViaUi(session, unique('E2E AI 项目'));
      await generateOutlineViaUi(session, { topic: unique('E2E AI 主题'), pageCount: 4 });
      await confirmOutlineViaUi(session);

      const slides = await apiFetch<{ slides: Array<{ slideId: string }> }>(
        session.page,
        `/api/projects/${projectId}/slides`
      );
      const slideId = slides.body.data!.slides[0]!.slideId;
      const before = await fetchSlide(session.page, projectId, slideId);

      // --- 走 UI 的 AI 面板 ---
      await session.page.getByTestId('wb-tab-ai').click();
      const marker = unique('E2E AI 指令');
      await session.page.getByTestId('ai-instruction').fill(marker);
      await session.page.getByTestId('ai-run').click();

      const message = session.page.getByTestId('ai-message');
      await message.waitFor({ state: 'visible', timeout: 30_000 });
      expect(((await message.textContent()) ?? '').length).toBeGreaterThan(0);

      // --- 服务端真的把补丁施加到 IR 并写了新版本 ---
      await waitFor(
        async () => {
          const now = await fetchSlide(session.page, projectId, slideId);
          return now !== null && irContains(now.ir, marker);
        },
        20_000,
        'AI 补丁被服务端施加'
      );
      const after = await fetchSlide(session.page, projectId, slideId);
      expect(after!.versionId).not.toBe(before!.versionId);

      // --- 画布重绘出补丁结果 ---
      // 比文字而不是比 HTML：文字被折行拆进多个 <tspan> 是正常排版，
      // 直接在 innerHTML 里找子串会把"画出来了"误判成"没画出来"
      await waitFor(
        async () => (await canvasShows(session.page, marker)),
        15_000,
        '画布重绘出 AI 修改后的内容'
      );
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('AI 样式模式 → 请求带上 mode=style，服务端照单执行', async () => {
    const session = await harness.newSession();
    try {
      await registerAndEnterApp(session);
      const projectId = await createProjectViaUi(session, unique('E2E AI 样式'));
      await generateOutlineViaUi(session, { topic: unique('E2E AI 样式主题'), pageCount: 4 });
      await confirmOutlineViaUi(session);

      const slides = await apiFetch<{ slides: Array<{ slideId: string }> }>(
        session.page,
        `/api/projects/${projectId}/slides`
      );
      const slideId = slides.body.data!.slides[0]!.slideId;

      // 抓前端发出的补丁请求 —— 确认 mode 真的传到了服务端
      const bodies: string[] = [];
      session.page.on('request', (req) => {
        if (req.url().includes('/patches') && req.method() === 'POST') {
          bodies.push(req.postData() ?? '');
        }
      });

      await session.page.getByTestId('wb-tab-ai').click();
      await session.page.getByTestId('ai-mode-style').click();
      const marker = unique('E2E 样式指令');
      await session.page.getByTestId('ai-instruction').fill(marker);
      await session.page.getByTestId('ai-run').click();
      await session.page.getByTestId('ai-message').waitFor({ state: 'visible', timeout: 30_000 });

      expect(bodies.length).toBeGreaterThan(0);
      const body = JSON.parse(bodies[0]!) as { mode?: string; baseVersionId?: string };
      expect(body.mode).toBe('style');
      // 乐观锁的基线必须带上 —— 不带就等于没有并发保护
      expect(typeof body.baseVersionId).toBe('string');
      expect(body.baseVersionId!.length).toBeGreaterThan(0);

      // 服务端确实写进去了
      await waitFor(
        async () => {
          const now = await fetchSlide(session.page, projectId, slideId);
          return now !== null && irContains(now.ir, marker);
        },
        20_000,
        '样式模式的补丁被服务端施加'
      );
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('版本快照 → 回退后服务端内容也回到修改前', async () => {
    const session = await harness.newSession();
    try {
      await registerAndEnterApp(session);
      const projectId = await createProjectViaUi(session, unique('E2E 版本项目'));
      const topic = unique('E2E 版本主题');
      await generateOutlineViaUi(session, { topic, pageCount: 4 });
      await confirmOutlineViaUi(session);

      const slides = await apiFetch<{ slides: Array<{ slideId: string }> }>(
        session.page,
        `/api/projects/${projectId}/slides`
      );
      const slideId = slides.body.data!.slides[0]!.slideId;

      const marker = unique('E2E 要回退的修改');
      await editTitleText(session, marker);
      await waitFor(
        async () => {
          const now = await fetchSlide(session.page, projectId, slideId);
          return now !== null && irContains(now.ir, marker);
        },
        20_000,
        '修改已写回服务端'
      );

      // --- 版本列表里出现了这条快照 ---
      // 版本历史在 **AI 面板**里，而画布上的任何一次按下都会把检查器切到「属性」页
      // （`handleElementMouseDown` → `setActiveTab('props')`）—— 得切回去。
      await session.page.getByTestId('wb-tab-ai').click();
      const item = session.page.getByTestId('version-item').first();
      await item.waitFor({ state: 'visible', timeout: 15_000 });
      expect(await item.textContent()).toContain('手动文本修改');

      // --- 点「回退」---
      await session.page.getByTestId('version-rollback').first().click();

      // --- 服务端内容回到修改前 ---
      await waitFor(
        async () => {
          const now = await fetchSlide(session.page, projectId, slideId);
          return now !== null && !irContains(now.ir, marker);
        },
        20_000,
        '回退已写回服务端'
      );
      const after = await fetchSlide(session.page, projectId, slideId);
      expect(irContains(after!.ir, marker)).toBe(false);
      expect(irContains(after!.ir, topic)).toBe(true);

      // --- 服务端自己的版本历史留了痕（权威那份） ---
      const versions = await apiFetch<{ versions: Array<{ versionId: string; author: string }> }>(
        session.page,
        `/api/projects/${projectId}/slides/${slideId}/versions`
      );
      expect(versions.status).toBe(200);
      expect(versions.body.data!.versions.length).toBeGreaterThanOrEqual(2);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('刷新页面 → 摘要没有把已加载的 IR 抹掉（合并回归）', async () => {
    const session = await harness.newSession();
    try {
      await registerAndEnterApp(session);
      const projectId = await createProjectViaUi(session, unique('E2E 刷新项目'));
      await generateOutlineViaUi(session, { topic: unique('E2E 刷新主题'), pageCount: 4 });
      await confirmOutlineViaUi(session);

      const slides = await apiFetch<{ slides: Array<{ slideId: string }> }>(
        session.page,
        `/api/projects/${projectId}/slides`
      );
      const pageCount = slides.body.data!.slides.length;
      expect(pageCount).toBe(4);

      // --- 刷新 ---
      await session.page.reload();
      await session.page.getByTestId('nav-projects').waitFor({ state: 'visible', timeout: 30_000 });
      await openProjectInWorkbench(session, projectId);

      // --- 刷新后必须还是满页在工作台上 ---
      // 摘要接口的 slides 恒为空 —— 拿它覆盖已加载的全量就会渲染出「零页」项目，
      // 而 Workbench 在零页时仍一路解引用 currentSlide，整个应用直接崩。
      await session.page.getByTestId('slide-canvas').waitFor({ state: 'visible', timeout: 30_000 });
      expect(await session.page.getByTestId('workbench-empty').count()).toBe(0);
      expect(await session.page.locator('[data-testid="slide-thumb"]').count()).toBe(pageCount);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);
});
