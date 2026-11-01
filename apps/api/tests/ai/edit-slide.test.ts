/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SPEC-IRP-001 —— AI 编辑返回增量补丁而非全量元素
 * ---------------------------------------------------------------------------
 * docs/backend-design.md §4.3 IRPatch 协议：
 *   > **AI 返回 `{ patches: IRPatch[], message: string }`**，
 *   > 由后端 `patchApplier.ts` 统一施加
 *
 * 验证目标（spec/spec.yaml）：apps/api/tests/ai/edit-slide.test.ts::returns-patches-not-full-elements
 *
 * 行为契约：
 *   - when: 用户要求修改一个元素
 *   - then: 响应中的 patches 数组长度与被改元素数相当，而非等于整页元素总数
 */

import { describe, expect, test } from 'bun:test';

import { IRPatchOperationSchema } from '@ppt/core';

import {
  compileProject,
  createProject,
  createTestApp,
  makeOutlineResponse,
  registerUser,
  requestJson,
} from '../helpers';

const PATCH_OPERATIONS: string[] = IRPatchOperationSchema.options;

/** 模型返回的补丁 —— 只改一个元素 */
const MODEL_PATCH_RESPONSE = {
  patches: [
    {
      operation: 'update_element',
      targetId: 'grid_card_s2_0',
      changes: { content: '被 AI 改写后的要点' },
      reason: '按指令重写该卡片文案',
    },
  ],
  message: '已更新卡片文案',
};

/** 大纲走模型、编辑走补丁 —— 两个 agent 各给各的输出 */
function fakeByAgent(): Parameters<typeof createTestApp>[0] {
  return {
    model: {
      behaviors: [],
      byAgent: {
        outline: [{ kind: 'text', text: makeOutlineResponse() }],
        edit: [{ kind: 'text', text: JSON.stringify(MODEL_PATCH_RESPONSE) }],
      },
    },
  };
}

describe('SPEC-IRP-001 AI 编辑返回增量补丁', () => {
  test('returns-patches-not-full-elements', async () => {
    const ctx = await createTestApp(fakeByAgent());
    const user = await registerUser(ctx.app);
    const projectId = await createProject(ctx.app, user.cookie);
    const slides = await compileProject(ctx.app, user.cookie, projectId);
    // 第 2 页是 cards_grid —— 卡片元素 id 形如 grid_card_s2_0
    const slideId = slides[1]!.slideId;

    const slideRes = await requestJson<{
      data: { slide: { ir: { elements: unknown[] } } };
    }>(ctx.app, `/api/projects/${projectId}/slides/${slideId}`, { cookie: user.cookie });
    const elementCount = slideRes.body.data.slide.ir.elements.length;
    expect(elementCount).toBeGreaterThan(1);

    const res = await requestJson<{
      data: { patches: Array<{ operation: string }>; message: string };
    }>(ctx.app, `/api/ai/slides/${slideId}/suggest`, {
      method: 'POST',
      cookie: user.cookie,
      body: {
        slideId,
        instruction: '把「回收网络」改成「电池回收网络」',
        currentContent: { bullets: ['回收网络'] },
        elementDigest: [{ id: 'grid_card_s2_0', role: 'card', text: '回收网络' }],
        layout: 'cards_grid',
      },
    });

    expect(res.status).toBe(200);

    // 1. 响应含 patches 数组
    expect(Array.isArray(res.body.data.patches)).toBe(true);
    expect(res.body.data.patches.length).toBeGreaterThan(0);

    // 2. 响应**不含** updatedElements 数组
    expect((res.body.data as Record<string, unknown>)['updatedElements']).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('updatedElements');

    // 3. operation 取值属于枚举
    for (const patch of res.body.data.patches) {
      expect(PATCH_OPERATIONS).toContain(patch.operation);
    }

    // 4. 补丁数量与被改元素数相当，而不是整页元素总数
    expect(res.body.data.patches.length).toBeLessThan(elementCount);
  });

  test('项目级 AI 编辑端点同样返回补丁而不是全量元素', async () => {
    const ctx = await createTestApp(fakeByAgent());
    const user = await registerUser(ctx.app);
    const projectId = await createProject(ctx.app, user.cookie);
    const slides = await compileProject(ctx.app, user.cookie, projectId);
    const slideId = slides[1]!.slideId;

    const res = await requestJson<{
      data: { patches: Array<{ operation: string }>; versionId: string; ir: { elements: unknown[] } };
    }>(ctx.app, `/api/projects/${projectId}/slides/${slideId}/patches`, {
      method: 'POST',
      cookie: user.cookie,
      body: {
        baseVersionId: slides[1]!.versionId,
        instruction: '把要点改得更简洁',
        mode: 'content',
      },
    });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.patches)).toBe(true);
    expect((res.body.data as Record<string, unknown>)['updatedElements']).toBeUndefined();
    for (const patch of res.body.data.patches) {
      expect(PATCH_OPERATIONS).toContain(patch.operation);
    }
    // 补丁真的被施加了 —— 版本号变了
    expect(res.body.data.versionId).not.toBe(slides[1]!.versionId);
  });

  test('本地降级路径也返回补丁（不是全量元素）', async () => {
    // 模型不可用 → 本地确定性改写
    const ctx = await createTestApp({
      model: { behaviors: [{ kind: 'error', message: '模型服务 503', retryable: true, status: 503 }] },
    });
    const user = await registerUser(ctx.app);

    const res = await requestJson<{
      data: { patches: Array<{ operation: string }>; source: string; degraded: boolean };
    }>(ctx.app, '/api/ai/slides/s1/suggest', {
      method: 'POST',
      cookie: user.cookie,
      body: {
        slideId: 's1',
        instruction: '把「回收网络」改成「电池回收网络」',
        currentContent: { bullets: ['回收网络'] },
        elementDigest: [{ id: 'grid_card_s2_0', role: 'card', text: '回收网络' }],
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.data.degraded).toBe(true);
    expect(res.body.data.patches.length).toBeGreaterThan(0);
    for (const patch of res.body.data.patches) {
      expect(PATCH_OPERATIONS).toContain(patch.operation);
    }
    expect((res.body.data as Record<string, unknown>)['updatedElements']).toBeUndefined();
  });
});
