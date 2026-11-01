/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SPEC-API-004 —— AI 输出必须经 Schema 校验方可进入系统
 * ---------------------------------------------------------------------------
 * docs/backend-design.md §12 安全：
 *   > 模型输出**永远经过 Zod 校验**后才进入系统，非法输出无法污染 IR
 *
 * 验证目标（spec/spec.yaml）：apps/api/tests/security/ai-output-validation.test.ts
 *
 * **失败分类（关键）**
 *   - 模型**不可用**（网络 / 5xx / 超时）→ 走本地降级，返回 200
 *   - 模型**响应了但输出非法** → 422 MODEL_OUTPUT_INVALID，**不降级掩盖**
 *
 * 判据要求「项目数据中不出现该输出的任何片段」——
 * 所以除了看状态码，还要真的去查库。
 */

import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';

import { projects, slides } from '../../src/db/schema';
import {
  createProject,
  createTestApp,
  fakeText,
  registerUser,
  requestJson,
} from '../helpers';

/** 含多余字段与非法类型的模型输出 */
const INVALID_OUTPUT = {
  outline: [
    {
      slideId: 's1',
      order: 1,
      title: 'INJECTED_TITLE_MARKER',
      purpose: 'INJECTED_PURPOSE_MARKER',
      keyMessage: 'INJECTED_KEY_MESSAGE_MARKER',
      visualIntent: 'INJECTED_VISUAL_INTENT_MARKER',
      // 非法取值 —— 不属于 8 种版式
      layoutPreference: 'not_a_real_layout_at_all',
      // 非法类型 —— 必须是字符串数组
      requiredElements: 'INJECTED_REQUIRED_ELEMENTS_MARKER',
      speakerNotes: 'INJECTED_SPEAKER_NOTES_MARKER',
      bulletPoints: ['INJECTED_BULLET_MARKER'],
      // 多余字段
      extraUnexpectedField: 'INJECTED_EXTRA_FIELD_MARKER',
    },
  ],
};

/** 所有注入标记 —— 用于断言「一段都不许进系统」 */
const MARKERS = [
  'INJECTED_TITLE_MARKER',
  'INJECTED_PURPOSE_MARKER',
  'INJECTED_KEY_MESSAGE_MARKER',
  'INJECTED_VISUAL_INTENT_MARKER',
  'INJECTED_REQUIRED_ELEMENTS_MARKER',
  'INJECTED_SPEAKER_NOTES_MARKER',
  'INJECTED_BULLET_MARKER',
  'INJECTED_EXTRA_FIELD_MARKER',
  'not_a_real_layout_at_all',
];

describe('SPEC-API-004 AI 输出必须过 Schema', () => {
  // 非法类型 → 4xx MODEL_OUTPUT_INVALID，且不落库
  test('invalid-model-output-rejected-and-not-persisted', async () => {
    const ctx = await createTestApp({
      model: fakeText(JSON.stringify(INVALID_OUTPUT)),
    });
    const user = await registerUser(ctx.app);
    const projectId = await createProject(ctx.app, user.cookie);

    const res = await requestJson<{ error: { code: string; message: string } }>(
      ctx.app,
      `/api/projects/${projectId}/outline/regenerate`,
      { method: 'POST', cookie: user.cookie, body: {} }
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body.error.code).toBe('MODEL_OUTPUT_INVALID');

    // 关键：项目数据里不能出现任何注入片段
    const rows = await ctx.db.db.select().from(projects).where(eq(projects.id, projectId));
    const serialized = JSON.stringify(rows);
    for (const marker of MARKERS) {
      expect(serialized, `注入片段 ${marker} 落进了项目数据`).not.toContain(marker);
    }

    // 也不能凭空多出幻灯片
    const slideRows = await ctx.db.db.select().from(slides).where(eq(slides.projectId, projectId));
    expect(slideRows).toHaveLength(0);
  });

  test('非 JSON 输出 → 4xx MODEL_OUTPUT_INVALID，不降级', async () => {
    const ctx = await createTestApp({
      model: fakeText('这不是 JSON，只是一段模型胡言乱语。'),
    });
    const user = await registerUser(ctx.app);

    const res = await requestJson<{ error: { code: string } }>(
      ctx.app,
      '/api/ai/outline',
      {
        method: 'POST',
        cookie: user.cookie,
        body: {
          requirement: {
            topic: '测试主题',
            purpose: '',
            audience: '',
            pageCount: 3,
            style: '',
            depth: '',
            aspectRatio: '16:9',
          },
        },
      }
    );

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('MODEL_OUTPUT_INVALID');
  });

  test('非法输出不会触发本地降级（与「模型不可用」严格区分）', async () => {
    // 模型不可用 → 降级成功 200
    const unavailable = await createTestApp({
      model: { behaviors: [{ kind: 'error', message: '模型服务 503', retryable: true, status: 503 }] },
    });
    const userA = await registerUser(unavailable.app);

    const degraded = await requestJson<{ data: { degraded: boolean; source: string } }>(
      unavailable.app,
      '/api/ai/outline',
      {
        method: 'POST',
        cookie: userA.cookie,
        body: {
          requirement: {
            topic: '降级测试主题',
            purpose: '',
            audience: '',
            pageCount: 3,
            style: '',
            depth: '',
            aspectRatio: '16:9',
          },
        },
      }
    );
    expect(degraded.status).toBe(200);
    expect(degraded.body.data.degraded).toBe(true);
    expect(degraded.body.data.source).toBe('local');

    // 模型输出非法 → 不降级，422
    const invalid = await createTestApp({ model: fakeText(JSON.stringify(INVALID_OUTPUT)) });
    const userB = await registerUser(invalid.app);

    const rejected = await requestJson<{ error: { code: string } }>(
      invalid.app,
      '/api/ai/outline',
      {
        method: 'POST',
        cookie: userB.cookie,
        body: {
          requirement: {
            topic: '降级测试主题',
            purpose: '',
            audience: '',
            pageCount: 3,
            style: '',
            depth: '',
            aspectRatio: '16:9',
          },
        },
      }
    );
    expect(rejected.status).toBe(422);
    expect(rejected.body.error.code).toBe('MODEL_OUTPUT_INVALID');
  });

  test('合法输出可以进系统（校验不是把门焊死）', async () => {
    const validOutput = {
      outline: [
        {
          slideId: 's1',
          order: 1,
          title: '合法标题',
          purpose: '合法目的',
          keyMessage: '合法结论',
          visualIntent: '合法视觉意图',
          layoutPreference: 'title_cover',
          requiredElements: [],
          speakerNotes: '合法备注',
          bulletPoints: ['合法要点'],
        },
      ],
    };

    const ctx = await createTestApp({ model: fakeText(JSON.stringify(validOutput)) });
    const user = await registerUser(ctx.app);
    const projectId = await createProject(ctx.app, user.cookie);

    const res = await requestJson<{ data: { source: string; degraded: boolean } }>(
      ctx.app,
      `/api/projects/${projectId}/outline/regenerate`,
      { method: 'POST', cookie: user.cookie, body: {} }
    );

    expect(res.status).toBe(200);
    expect(res.body.data.source).toBe('model');
    expect(res.body.data.degraded).toBe(false);

    const rows = await ctx.db.db.select().from(projects).where(eq(projects.id, projectId));
    expect(JSON.stringify(rows)).toContain('合法标题');
  });

  test('多余字段被剥离而不是整条拒绝', async () => {
    // Zod 对象默认剥离未知键 —— 多余字段本身不致命，
    // 但**必须被剥掉**，不能原样进入系统。
    const withExtra = {
      outline: [
        {
          slideId: 's1',
          order: 1,
          title: '正常标题',
          purpose: '',
          keyMessage: '',
          visualIntent: '',
          layoutPreference: 'title_cover',
          requiredElements: [],
          speakerNotes: '',
          bulletPoints: [],
          extraUnexpectedField: 'SHOULD_BE_STRIPPED',
        },
      ],
    };

    const ctx = await createTestApp({ model: fakeText(JSON.stringify(withExtra)) });
    const user = await registerUser(ctx.app);
    const projectId = await createProject(ctx.app, user.cookie);

    const res = await requestJson(ctx.app, `/api/projects/${projectId}/outline/regenerate`, {
      method: 'POST',
      cookie: user.cookie,
      body: {},
    });
    expect(res.status).toBe(200);

    const rows = await ctx.db.db.select().from(projects).where(eq(projects.id, projectId));
    expect(JSON.stringify(rows)).not.toContain('SHOULD_BE_STRIPPED');
    expect(JSON.stringify(rows)).toContain('正常标题');
  });
});
