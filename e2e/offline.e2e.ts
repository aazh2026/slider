/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 离线链 —— 外部资源不可达时，应用外壳仍然起得来
 * ---------------------------------------------------------------------------
 * 这一链盯的是**启动鲁棒性**，不是业务功能。
 *
 * 真实事故：应用把 Google Fonts 的样式表挂在 `<head>` 里当**渲染阻塞**资源。
 * 渲染阻塞样式表一旦 pending，会连带**阻塞脚本执行** ——
 * 外部 CDN 不可达时 `<script type="module">` 永远不跑，
 * React 挂不上，整页白屏，连 `/api/auth/me` 都不会发出去。
 *
 * 后果在测试里特别难看：不是"用例失败"，是**每条用例都卡在 page.goto 上**，
 * 最后以 180s 超时收场 —— 看不出是实现的锅还是外网的锅。
 * 同一批用例在不同机器上轮流挂，判据直接失效。
 *
 * 所以这里有两条判据：
 *   1. 应用 HTML 里**没有**会阻塞渲染的外部样式表（静态判据，确定性）
 *   2. 外部资源被无限期挂起时，外壳仍然能在 8 秒内渲染出来（行为判据）
 *
 * 依据：docs/backend-features.md TPL-12「字体资源托管 …… 服务端渲染不依赖外网」、
 * EXP-12「resvg fontBuffers 注册本地字体」、docs/architecture.md ADR-009
 * 「渲染字体 vendored 进仓库，不运行时拉外网」。
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import {
  BASE_URL,
  TEST_TIMEOUT,
  assertServersUp,
  launchHarness,
  waitFor,
  type Harness,
} from './helpers';

let harness: Harness;

beforeAll(async () => {
  await assertServersUp();
  harness = await launchHarness();
});

afterAll(async () => {
  await harness?.close();
});

/** 应用自己的源 */
const APP_ORIGIN = new URL(BASE_URL).origin;

/** 取标签上的属性值 */
function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  if (!m) return null;
  return m[2] ?? m[3] ?? m[4] ?? null;
}

/**
 * 这张样式表是不是**渲染阻塞**的。
 *
 * 浏览器只有把"匹配当前媒体类型"的样式表算作渲染阻塞。
 * 两种常见的非阻塞写法：
 *   · media="print" —— 不匹配当前媒体 ⇒ 不阻塞（加载完再切回 all）
 *   · rel="preload" as="style" + onload 切 rel —— 异步下载，下载完才成为样式表
 */
function isRenderBlocking(tag: string): boolean {
  const media = attr(tag, 'media');
  const rel = (attr(tag, 'rel') ?? '').toLowerCase();
  const onload = attr(tag, 'onload') ?? '';

  // media 不匹配 screen/all ⇒ 不参与渲染阻塞
  if (media !== null && !/(^|\s)(all|screen)(\s|$)/i.test(media)) return false;

  // preload + onload 切 rel ⇒ 下载期间不是样式表 ⇒ 不阻塞
  if (rel.includes('preload') && /rel/i.test(onload)) return false;

  return true;
}

describe('离线链（外部资源不可达时应用仍能启动）', () => {
  test('应用 HTML → 没有会阻塞渲染的外部样式表', async () => {
    const res = await fetch(BASE_URL, { signal: AbortSignal.timeout(10_000) });
    expect(res.ok).toBe(true);
    const html = await res.text();

    const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];

    // 只看**外部**样式表 —— 本地打包出来的 CSS 不依赖外网，不在判据范围内
    const externalStylesheets = linkTags.filter((tag) => {
      if ((attr(tag, 'rel') ?? '').toLowerCase().split(/\s+/).includes('stylesheet') === false) {
        return false;
      }
      const href = attr(tag, 'href') ?? '';
      if (!/^https?:\/\//i.test(href)) return false;
      try {
        return new URL(href).origin !== APP_ORIGIN;
      } catch {
        return true;
      }
    });

    const blocking = externalStylesheets.filter(isRenderBlocking);
    // 断言字符串而不是数组 —— 失败时直接把违规的标签打出来
    expect(blocking.join(' | ')).toBe('');
  });

  test('外部资源被挂起 → 外壳仍在 8 秒内渲染出来', async () => {
    // stall 策略：外部请求**挂起**（不报错、不返回），模拟"外网不可达"。
    const session = await harness.newSession({ external: 'stall' });
    try {
      const started = Date.now();

      // 只等"导航已提交"，不等 load —— 挂起的样式表会让 load 永远不触发，
      // 等它就等于把用例变成"必然超时"。
      await session.page.goto('/', { waitUntil: 'commit', timeout: 20_000 });

      // 外壳（登录表单）必须在 8 秒内出现
      await session.page
        .getByTestId('auth-form')
        .waitFor({ state: 'visible', timeout: 8_000 });
      const elapsed = Date.now() - started;
      expect(elapsed).toBeLessThan(8_000);

      // 非空洞检查：确实有外部请求被挂起了。
      // 否则这条用例会因为"根本没有外部资源"而恒过 —— 证不了任何东西。
      await waitFor(
        async () => session.externalRequests.stalled > 0,
        10_000,
        '确实有外部请求被挂起'
      );
      expect(session.externalRequests.stalled).toBeGreaterThan(0);

      // 而且应用是**活的** —— 不是白屏，而是真的能操作
      await session.page.getByTestId('auth-tab-register').click();
      await session.page.getByTestId('auth-name').waitFor({ state: 'visible', timeout: 5_000 });
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);
});
