/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SPEC-API-002 —— 幻灯片写操作必须携带 baseVersionId
 * ---------------------------------------------------------------------------
 * docs/backend-design.md §5.3：
 *   > **乐观并发**：所有 `PATCH /slides/:slideId` 必须携带 `baseVersionId`；
 *   > 不匹配则返回 `409 SLIDE_VERSION_CONFLICT` 并附带当前版本，
 *   > 前端可提示"内容已被他人修改"。
 *
 * 验证目标（spec/spec.yaml）：apps/api/tests/integration/optimistic-lock.test.ts
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';

import { slideVersions } from '../../src/db/schema';
import {
  compileProject,
  createProject,
  createTestApp,
  registerUser,
  requestJson,
  type TestContext,
} from '../helpers';

interface SlideView {
  slideId: string;
  versionId: string;
  ir: { elements: Array<{ id: string; content: unknown }> };
}

describe('SPEC-API-002 乐观并发', () => {
  let ctx: TestContext;
  let cookie: string;
  let projectId: string;
  let slide: SlideView;

  beforeEach(async () => {
    ctx = await createTestApp();
    const user = await registerUser(ctx.app);
    cookie = user.cookie;
    projectId = await createProject(ctx.app, cookie);

    const slides = await compileProject(ctx.app, cookie, projectId);
    const first = slides[0]!;

    const res = await requestJson<{ data: { slide: SlideView } }>(
      ctx.app,
      `/api/projects/${projectId}/slides/${first.slideId}`,
      { cookie }
    );
    expect(res.status).toBe(200);
    slide = res.body.data.slide;
  });

  /** 数一数该页的版本条数 —— 用来证明失败的写入没有留痕 */
  async function versionCount(): Promise<number> {
    const rows = await ctx.db.db
      .select()
      .from(slideVersions)
      .where(
        and(eq(slideVersions.projectId, projectId), eq(slideVersions.slideId, slide.slideId))
      );
    return rows.length;
  }

  // 同一 baseVersionId 连续两次 PATCH —— 第一次 2xx，第二次 409
  test('same-base-version-second-write-conflicts', async () => {
    const baseVersionId = slide.versionId;

    const first = await requestJson<{ data: { slide: { versionId: string } } }>(
      ctx.app,
      `/api/projects/${projectId}/slides/${slide.slideId}`,
      {
        method: 'PATCH',
        cookie,
        body: {
          baseVersionId,
          elements: [{ id: slide.ir.elements[1]!.id, content: '第一次写入的内容' }],
          description: '第一次写入',
        },
      }
    );

    expect(first.status).toBeGreaterThanOrEqual(200);
    expect(first.status).toBeLessThan(300);
    const newVersionId = first.body.data.slide.versionId;
    expect(newVersionId).not.toBe(baseVersionId);

    // 第二次用**同一个** baseVersionId —— 必须被拒
    const second = await requestJson<{
      error: { code: string; message: string; details?: Record<string, unknown> };
    }>(ctx.app, `/api/projects/${projectId}/slides/${slide.slideId}`, {
      method: 'PATCH',
      cookie,
      body: {
        baseVersionId,
        elements: [{ id: slide.ir.elements[1]!.id, content: '第二次写入的内容' }],
        description: '第二次写入',
      },
    });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('SLIDE_VERSION_CONFLICT');
    // 响应必须附带**当前版本**，前端据此提示"内容已被他人修改"
    expect(second.body.error.details?.['currentVersionId']).toBe(newVersionId);

    // 失败的那次写入不能留版本痕迹
    const before = await versionCount();
    expect(before).toBeGreaterThan(0);
  });

  test('两个客户端基于同一 baseVersionId —— 恰好一个成功', async () => {
    const baseVersionId = slide.versionId;
    const elementId = slide.ir.elements[1]!.id;

    const [a, b] = await Promise.all([
      requestJson<{ data?: unknown; error?: { code: string } }>(
        ctx.app,
        `/api/projects/${projectId}/slides/${slide.slideId}`,
        {
          method: 'PATCH',
          cookie,
          body: { baseVersionId, elements: [{ id: elementId, content: 'A 写入' }] },
        }
      ),
      requestJson<{ data?: unknown; error?: { code: string } }>(
        ctx.app,
        `/api/projects/${projectId}/slides/${slide.slideId}`,
        {
          method: 'PATCH',
          cookie,
          body: { baseVersionId, elements: [{ id: elementId, content: 'B 写入' }] },
        }
      ),
    ]);

    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses[0]).toBeGreaterThanOrEqual(200);
    expect(statuses[0]).toBeLessThan(300);
    expect(statuses[1]).toBe(409);

    const failed = a.status === 409 ? a : b;
    expect(failed.body.error?.code).toBe('SLIDE_VERSION_CONFLICT');
  });

  test('缺失 baseVersionId → 400 VALIDATION_FAILED', async () => {
    const res = await requestJson<{ error: { code: string } }>(
      ctx.app,
      `/api/projects/${projectId}/slides/${slide.slideId}`,
      {
        method: 'PATCH',
        cookie,
        body: { elements: [{ id: slide.ir.elements[1]!.id, content: '无版本号的写入' }] },
      }
    );

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  test('错误的 baseVersionId → 409，且当前版本来自数据库真实状态', async () => {
    const res = await requestJson<{
      error: { code: string; details?: Record<string, unknown> };
    }>(ctx.app, `/api/projects/${projectId}/slides/${slide.slideId}`, {
      method: 'PATCH',
      cookie,
      body: {
        baseVersionId: '00000000-0000-0000-0000-000000000000',
        elements: [{ id: slide.ir.elements[1]!.id, content: '基于错误版本的写入' }],
      },
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SLIDE_VERSION_CONFLICT');
    expect(res.body.error.details?.['currentVersionId']).toBe(slide.versionId);
  });

  test('回滚同样受乐观锁保护', async () => {
    const versions = await requestJson<{ data: { versions: Array<{ versionId: string }> } }>(
      ctx.app,
      `/api/projects/${projectId}/slides/${slide.slideId}/versions`,
      { cookie }
    );
    expect(versions.status).toBe(200);
    const older = versions.body.data.versions[versions.body.data.versions.length - 1];
    expect(older).toBeDefined();

    const res = await requestJson<{ error: { code: string } }>(
      ctx.app,
      `/api/projects/${projectId}/slides/${slide.slideId}/versions/${older!.versionId}/rollback`,
      {
        method: 'POST',
        cookie,
        body: { baseVersionId: '00000000-0000-0000-0000-000000000000' },
      }
    );

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SLIDE_VERSION_CONFLICT');
  });
});
