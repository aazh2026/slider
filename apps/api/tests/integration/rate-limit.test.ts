/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 限流额度隔离（docs/backend-design.md §11 架构决策表 · 限流）
 * ---------------------------------------------------------------------------
 *   > | 限流 | 按 IP + 用户双维度；AI 端点单独更严 |
 *
 * 验证目标（spec/spec.yaml）：apps/api/tests/integration/rate-limit.test.ts
 *
 * ---------------------------------------------------------------------------
 * **这个测试是被一个真实缺陷逼出来的**
 *
 * 基准脚本（apps/api/tests/perf/outline-latency.bench.ts）在跑 HTTP 采样时
 * 撞到 429 —— 但它只打了 25 次，而 AI 端点配的是 30 次/分钟。
 *
 * 根因：限流中间件用一个**全局**的计数桶 Map，key 只有"用户 id"，
 * 没有区分"哪个限流器"。全局限流（600/分钟）和 AI 限流（30/分钟）
 * 记进了同一个桶 —— 每次 AI 请求被记两次，额度实际只剩 15 次/分钟。
 * 同样地，模板上传限流（10/分钟）会被全局限流预扣到只剩 5 次。
 *
 * 这条测试固定住"AI 端点的额度就是配置的那个数，且不被别的限流器预扣"。
 */

import { describe, expect, test } from 'bun:test';

import { createTestApp, fakeUnavailable, registerUser, requestJson } from '../helpers';

/** AI 端点的限流配置 —— 见 apps/api/src/routes/ai.ts */
const AI_LIMIT = 30;

function requirement() {
  return {
    topic: '限流额度隔离检查',
    purpose: '',
    audience: '',
    pageCount: 3,
    style: '',
    depth: '',
    aspectRatio: '16:9' as const,
  };
}

describe('限流额度隔离', () => {
  test('AI 端点连续 30 次都通过 —— 额度不被全局限流预扣', async () => {
    const ctx = await createTestApp({ model: fakeUnavailable() });
    const user = await registerUser(ctx.app);

    const statuses: number[] = [];
    for (let i = 0; i < AI_LIMIT; i++) {
      const res = await requestJson<unknown>(ctx.app, '/api/ai/outline', {
        method: 'POST',
        cookie: user.cookie,
        body: { requirement: requirement() },
      });
      statuses.push(res.status);
    }

    const limited = statuses.filter((s) => s === 429).length;
    expect(
      limited,
      `AI 端点应放行 ${AI_LIMIT} 次，实际有 ${limited} 次被限流：${statuses.join(',')}`
    ).toBe(0);
    expect(statuses.every((s) => s === 200)).toBe(true);
  });

  test('第 31 次才被限流，且错误码是 RATE_LIMITED', async () => {
    const ctx = await createTestApp({ model: fakeUnavailable() });
    const user = await registerUser(ctx.app);

    for (let i = 0; i < AI_LIMIT; i++) {
      await requestJson<unknown>(ctx.app, '/api/ai/outline', {
        method: 'POST',
        cookie: user.cookie,
        body: { requirement: requirement() },
      });
    }

    const res = await requestJson<{ error: { code: string; details?: { retryAfterSec?: number } } }>(
      ctx.app,
      '/api/ai/outline',
      { method: 'POST', cookie: user.cookie, body: { requirement: requirement() } }
    );

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.body.error.details?.retryAfterSec).toBeGreaterThan(0);
    // 限流响应也必须带 traceId —— 信封契约对错误响应一视同仁
    expect(res.headers.get('x-trace-id')).toBeTruthy();
  });

  test('AI 额度打满不影响普通业务端点 —— 各限流器额度互相独立', async () => {
    const ctx = await createTestApp({ model: fakeUnavailable() });
    const user = await registerUser(ctx.app);

    // 把 AI 额度用光
    for (let i = 0; i < AI_LIMIT; i++) {
      await requestJson<unknown>(ctx.app, '/api/ai/outline', {
        method: 'POST',
        cookie: user.cookie,
        body: { requirement: requirement() },
      });
    }

    // AI 端点确实被限流了
    const ai = await requestJson<unknown>(ctx.app, '/api/ai/outline', {
      method: 'POST',
      cookie: user.cookie,
      body: { requirement: requirement() },
    });
    expect(ai.status).toBe(429);

    // 普通端点照常工作 —— 说明它走的是另一个计数桶
    const projects = await requestJson<unknown>(ctx.app, '/api/projects', { cookie: user.cookie });
    expect(projects.status).toBe(200);

    const templates = await requestJson<unknown>(ctx.app, '/api/templates', { cookie: user.cookie });
    expect(templates.status).toBe(200);
  });
});
