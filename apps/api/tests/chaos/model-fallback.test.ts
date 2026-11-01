/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SPEC-NFR-003 —— 主模型完全不可用时端点仍返回合法内容
 * ---------------------------------------------------------------------------
 * docs/architecture.md §7.2 降级链：
 *   > **降级实现的硬约束**：本地实现必须按 `requirement.topic` **动态生成**，
 *   > 不能像现状那样对所有主题返回同一份"企业 AI Agent 技术架构规划"大纲。
 *
 * 验证目标（spec/spec.yaml）：apps/api/tests/chaos/model-fallback.test.ts
 *
 * 判据里有两条：**返回 200 且通过 Schema 校验**，以及**两个不同 topic 的大纲文本不同**。
 * 第二条才是那条"硬约束"真正在测的东西 —— 只测 200 等于没测。
 */

import { describe, expect, test } from 'bun:test';

import { SlideOutlineItemSchema } from '@ppt/core';

import { createTestApp, fakeUnavailable, registerUser, requestJson } from '../helpers';

function requirement(topic: string, pageCount = 6) {
  return {
    topic,
    purpose: '融资路演',
    audience: '投资人',
    pageCount,
    style: '专业、克制',
    depth: '标准',
    aspectRatio: '16:9' as const,
  };
}

describe('SPEC-NFR-003 降级链', () => {
  // 注入 5xx 后大纲端点仍返回 200，且内容通过 SlideOutlineItemSchema 校验
  test('model-unavailable-falls-back-with-valid-outline', async () => {
    const ctx = await createTestApp({ model: fakeUnavailable('模型服务 503') });
    const user = await registerUser(ctx.app);

    const res = await requestJson<{
      data: { outline: unknown[]; source: string; degraded: boolean };
    }>(ctx.app, '/api/ai/outline', {
      method: 'POST',
      cookie: user.cookie,
      body: { requirement: requirement('新能源汽车电池回收体系') },
    });

    expect(res.status).toBe(200);
    expect(res.body.data.degraded).toBe(true);
    expect(res.body.data.source).toBe('local');

    // 每一页都必须过 Schema —— 降级不是"随便返回点东西"
    const outline = res.body.data.outline;
    expect(Array.isArray(outline)).toBe(true);
    expect(outline.length).toBeGreaterThan(0);
    for (const item of outline) {
      const parsed = SlideOutlineItemSchema.safeParse(item);
      expect(parsed.success, `降级输出未通过 Schema：${JSON.stringify(item)}`).toBe(true);
    }
  });

  // 降级输出按 topic 动态生成 —— 两个不同主题的大纲文本不同
  test('fallback-outline-varies-by-topic', async () => {
    const ctx = await createTestApp({ model: fakeUnavailable() });
    const user = await registerUser(ctx.app);

    const a = await requestJson<{ data: { outline: Array<{ title: string; bulletPoints: string[] }> } }>(
      ctx.app,
      '/api/ai/outline',
      {
        method: 'POST',
        cookie: user.cookie,
        body: { requirement: requirement('新能源汽车电池回收体系') },
      }
    );
    const b = await requestJson<{ data: { outline: Array<{ title: string; bulletPoints: string[] }> } }>(
      ctx.app,
      '/api/ai/outline',
      {
        method: 'POST',
        cookie: user.cookie,
        body: { requirement: requirement('远程办公团队效能提升') },
      }
    );

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const textA = JSON.stringify(a.body.data.outline);
    const textB = JSON.stringify(b.body.data.outline);

    expect(textA).not.toBe(textB);
    // 主题必须真的出现在内容里 —— 不是换个无关的壳
    expect(textA).toContain('新能源汽车电池回收体系');
    expect(textB).toContain('远程办公团队效能提升');
    expect(textA).not.toContain('远程办公团队效能提升');
  });

  test('降级输出满足大纲硬约束：页数精确、首页封面、至少一页总结', async () => {
    const ctx = await createTestApp({ model: fakeUnavailable() });
    const user = await registerUser(ctx.app);

    const res = await requestJson<{
      data: { outline: Array<{ layoutPreference: string; order: number; slideId: string }> };
    }>(ctx.app, '/api/ai/outline', {
      method: 'POST',
      cookie: user.cookie,
      body: { requirement: requirement('硬约束检查主题', 8) },
    });

    const outline = res.body.data.outline;
    expect(outline).toHaveLength(8);
    expect(outline[0]!.layoutPreference).toBe('title_cover');
    expect(outline.some((o) => o.layoutPreference === 'summary_conclusion')).toBe(true);
    // slideId 与 order 必须与顺序一致
    outline.forEach((item, i) => {
      expect(item.order).toBe(i + 1);
      expect(item.slideId).toBe(`s${i + 1}`);
    });
  });

  test('网络错误（非 5xx）同样走降级，不把内部错误抛给用户', async () => {
    const ctx = await createTestApp({
      model: { behaviors: [{ kind: 'error', message: 'ECONNREFUSED', retryable: true }] },
    });
    const user = await registerUser(ctx.app);

    const res = await requestJson<{ data: { degraded: boolean } }>(ctx.app, '/api/ai/outline', {
      method: 'POST',
      cookie: user.cookie,
      body: { requirement: requirement('网络故障主题') },
    });

    expect(res.status).toBe(200);
    expect(res.body.data.degraded).toBe(true);
  });

  test('项目级大纲重新生成在模型不可用时也可用', async () => {
    const ctx = await createTestApp({ model: fakeUnavailable() });
    const user = await registerUser(ctx.app);

    const created = await requestJson<{ data: { project: { id: string } } }>(
      ctx.app,
      '/api/projects',
      {
        method: 'POST',
        cookie: user.cookie,
        body: { name: '降级项目', requirement: requirement('项目级降级主题') },
      }
    );
    const projectId = created.body.data.project.id;

    const res = await requestJson<{ data: { degraded: boolean; outline: unknown[] } }>(
      ctx.app,
      `/api/projects/${projectId}/outline/regenerate`,
      { method: 'POST', cookie: user.cookie, body: {} }
    );

    expect(res.status).toBe(200);
    expect(res.body.data.degraded).toBe(true);
    expect(res.body.data.outline.length).toBe(6);
  });
});
