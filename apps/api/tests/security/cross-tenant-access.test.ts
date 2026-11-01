/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SPEC-API-003 —— 每个资源查询强制带 userId 条件
 * ---------------------------------------------------------------------------
 * docs/backend-design.md §9.2：
 *   > **绝不依赖"资源 ID 难猜"来防越权**——每个资源查询都必须带 `userId` 条件。
 *
 * docs/backend-features.md §N SEC-08：
 *   跨租户访问统一返回 **404 NOT_FOUND**，不返回 403 ——
 *   403 等于告诉攻击者"这个资源存在但你不能看"。
 *
 * 验证目标（spec/spec.yaml）：
 *   apps/api/tests/security/cross-tenant-access.test.ts::cross-tenant-resource-read-is-404
 *
 * 覆盖四类资源：projects / slides / documents / artifacts。
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';

import {
  compileProject,
  createProject,
  createTestApp,
  registerUser,
  requestJson,
  SAMPLE_REQUIREMENT,
  type TestContext,
} from '../helpers';

const STORAGE_DIR = `/tmp/ppt-cross-tenant-${process.pid}`;

interface Tenant {
  cookie: string;
  userId: string;
  email: string;
  projectId: string;
  slideId: string;
  versionId: string;
}

describe('SPEC-API-003 跨租户访问', () => {
  let ctx: TestContext;
  let alice: Tenant;
  let bob: Tenant;

  beforeAll(async () => {
    await mkdir(STORAGE_DIR, { recursive: true });
    process.env['STORAGE_DIR'] = STORAGE_DIR;

    ctx = await createTestApp();

    const a = await registerUser(ctx.app, 'alice@example.com');
    const b = await registerUser(ctx.app, 'bob@example.com');

    alice = {
      cookie: a.cookie,
      userId: a.userId,
      email: a.email,
      projectId: await createProject(ctx.app, a.cookie, 'Alice 的项目'),
      slideId: '',
      versionId: '',
    };
    bob = {
      cookie: b.cookie,
      userId: b.userId,
      email: b.email,
      projectId: await createProject(ctx.app, b.cookie, 'Bob 的项目'),
      slideId: '',
      versionId: '',
    };

    const aSlides = await compileProject(ctx.app, alice.cookie, alice.projectId);
    // Bob 的项目页数刻意更少 —— 于是「Alice 有、Bob 没有」的 slideId 才存在，
    // 否则两边都是 s1..s6，用 s1 试探根本区分不出跨租户与页内命中。
    const bSlides = await compileProject(ctx.app, bob.cookie, bob.projectId, {
      ...SAMPLE_REQUIREMENT,
      pageCount: 2,
      topic: 'Bob 的主题',
    });
    alice.slideId = aSlides[aSlides.length - 1]!.slideId;
    alice.versionId = aSlides[aSlides.length - 1]!.versionId;
    bob.slideId = bSlides[0]!.slideId;
    bob.versionId = bSlides[0]!.versionId;
  });

  afterAll(async () => {
    await rm(STORAGE_DIR, { recursive: true, force: true });
    delete process.env['STORAGE_DIR'];
  });

  /** 断言「404 且不泄露存在性」 */
  function expectHidden(res: { status: number; body: unknown }): void {
    expect(res.status).toBe(404);
    const body = res.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    // 响应体里不能出现对方项目的任何标识
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('Alice 的项目');
    expect(serialized).not.toContain('Bob 的项目');
  }

  /* ------------------------------------------------------------------ */
  /* AC-API-003 的主用例：一类资源一条断言，判据与用例一一对应          */
  /* ------------------------------------------------------------------ */

  test('cross-tenant-resource-read-is-404', async () => {
    // projects
    expectHidden(
      await requestJson(ctx.app, `/api/projects/${alice.projectId}`, { cookie: bob.cookie })
    );

    // slides
    expectHidden(
      await requestJson(
        ctx.app,
        `/api/projects/${alice.projectId}/slides/${alice.slideId}`,
        { cookie: bob.cookie }
      )
    );

    // documents
    const form = new FormData();
    form.append('file', new File(['Alice 的私有参考资料'], 'alice-notes.md', { type: 'text/markdown' }));
    const upload = await requestJson<{ data: { document: { id: string } } }>(
      ctx.app,
      `/api/projects/${alice.projectId}/documents`,
      { method: 'POST', cookie: alice.cookie, rawBody: form }
    );
    expect(upload.status).toBe(201);
    expectHidden(
      await requestJson(ctx.app, `/api/documents/${upload.body.data.document.id}/text`, {
        cookie: bob.cookie,
      })
    );

    // artifacts（导出任务）
    const created = await requestJson<{ data: { job: { id: string } } }>(
      ctx.app,
      '/api/exports',
      { method: 'POST', cookie: alice.cookie, body: { projectId: alice.projectId, format: 'json' } }
    );
    expect(created.status).toBe(202);
    expectHidden(
      await requestJson(ctx.app, `/api/exports/${created.body.data.job.id}`, { cookie: bob.cookie })
    );
  });

  /* ------------------------------------------------------------------ */
  /* projects                                                            */
  /* ------------------------------------------------------------------ */

  test('Bob 访问 Alice 的项目 → 404', async () => {
    expectHidden(
      await requestJson(ctx.app, `/api/projects/${alice.projectId}`, { cookie: bob.cookie })
    );
  });

  test('Bob 对 Alice 的项目做写操作 → 404（不是 403）', async () => {
    const patch = await requestJson(ctx.app, `/api/projects/${alice.projectId}`, {
      method: 'PATCH',
      cookie: bob.cookie,
      body: { name: '被劫持的项目' },
    });
    expectHidden(patch);

    const del = await requestJson(ctx.app, `/api/projects/${alice.projectId}`, {
      method: 'DELETE',
      cookie: bob.cookie,
    });
    expectHidden(del);

    const duplicate = await requestJson(ctx.app, `/api/projects/${alice.projectId}/duplicate`, {
      method: 'POST',
      cookie: bob.cookie,
    });
    expectHidden(duplicate);
  });

  test('Bob 访问 Alice 项目的子资源 → 404', async () => {
    for (const path of [
      `/api/projects/${alice.projectId}/slides`,
      `/api/projects/${alice.projectId}/content`,
      `/api/projects/${alice.projectId}/export`,
      `/api/projects/${alice.projectId}/outline`,
      `/api/projects/${alice.projectId}/documents`,
    ]) {
      const res = await requestJson(ctx.app, path, { cookie: bob.cookie });
      expectHidden(res);
    }
  });

  test('Bob 的项目列表里不含 Alice 的项目', async () => {
    const res = await requestJson<{ data: { projects: Array<{ id: string }> } }>(
      ctx.app,
      '/api/projects',
      { cookie: bob.cookie }
    );
    expect(res.status).toBe(200);
    const ids = res.body.data.projects.map((p) => p.id);
    expect(ids).not.toContain(alice.projectId);
    expect(ids).toContain(bob.projectId);
  });

  /* ------------------------------------------------------------------ */
  /* slides                                                              */
  /* ------------------------------------------------------------------ */

  test('Bob 拿自己的项目 + Alice 的 slideId → 404（不能靠猜 slideId 读）', async () => {
    const res = await requestJson(
      ctx.app,
      `/api/projects/${bob.projectId}/slides/${alice.slideId}`,
      { cookie: bob.cookie }
    );
    expectHidden(res);
  });

  test('Bob 直接访问 Alice 项目的幻灯片 → 404', async () => {
    for (const path of [
      `/api/projects/${alice.projectId}/slides/${alice.slideId}`,
      `/api/projects/${alice.projectId}/slides/${alice.slideId}/versions`,
    ]) {
      const res = await requestJson(ctx.app, path, { cookie: bob.cookie });
      expectHidden(res);
    }
  });

  test('Bob 对 Alice 的幻灯片写入 → 404', async () => {
    const res = await requestJson(
      ctx.app,
      `/api/projects/${alice.projectId}/slides/${alice.slideId}`,
      {
        method: 'PATCH',
        cookie: bob.cookie,
        body: {
          baseVersionId: alice.versionId,
          elements: [{ id: 'whatever', content: '越权写入' }],
        },
      }
    );
    expectHidden(res);
  });

  /* ------------------------------------------------------------------ */
  /* documents                                                           */
  /* ------------------------------------------------------------------ */

  test('Bob 访问 Alice 的文档 → 404', async () => {
    // Alice 先上传一份文档
    const form = new FormData();
    form.append('file', new File(['Alice 的私有参考资料'], 'alice-notes.md', { type: 'text/markdown' }));

    const upload = await requestJson<{ data: { document: { id: string } } }>(
      ctx.app,
      `/api/projects/${alice.projectId}/documents`,
      { method: 'POST', cookie: alice.cookie, rawBody: form }
    );
    expect(upload.status).toBe(201);
    const documentId = upload.body.data.document.id;

    // Bob 拿文档 id 直接读 → 404
    expectHidden(await requestJson(ctx.app, `/api/documents/${documentId}/text`, { cookie: bob.cookie }));

    // Bob 删 → 404
    expectHidden(
      await requestJson(ctx.app, `/api/documents/${documentId}`, {
        method: 'DELETE',
        cookie: bob.cookie,
      })
    );

    // Alice 自己读得到
    const own = await requestJson<{ data: { text: string } }>(
      ctx.app,
      `/api/documents/${documentId}/text`,
      { cookie: alice.cookie }
    );
    expect(own.status).toBe(200);
    expect(own.body.data.text).toContain('Alice 的私有参考资料');
  });

  /* ------------------------------------------------------------------ */
  /* artifacts (导出任务与产物)                                            */
  /* ------------------------------------------------------------------ */

  test('Bob 访问 Alice 的导出任务与产物 → 404', async () => {
    const created = await requestJson<{ data: { job: { id: string } } }>(
      ctx.app,
      '/api/exports',
      {
        method: 'POST',
        cookie: alice.cookie,
        body: { projectId: alice.projectId, format: 'json' },
      }
    );
    expect(created.status).toBe(202);
    const jobId = created.body.data.job.id;

    // 等任务跑完，才能验证 download 路径
    let status = 'queued';
    for (let i = 0; i < 100 && status !== 'succeeded' && status !== 'failed'; i++) {
      const poll = await requestJson<{ data: { job: { status: string } } }>(
        ctx.app,
        `/api/exports/${jobId}`,
        { cookie: alice.cookie }
      );
      status = poll.body.data.job.status;
      if (status !== 'succeeded' && status !== 'failed') await Bun.sleep(50);
    }
    expect(status).toBe('succeeded');

    // Bob 读任务 → 404
    expectHidden(await requestJson(ctx.app, `/api/exports/${jobId}`, { cookie: bob.cookie }));

    // Bob 下载产物 → 404
    expectHidden(
      await requestJson(ctx.app, `/api/exports/${jobId}/download`, { cookie: bob.cookie })
    );

    // Bob 订阅 SSE → 404
    expectHidden(await requestJson(ctx.app, `/api/exports/${jobId}/events`, { cookie: bob.cookie }));
  });

  /* ------------------------------------------------------------------ */
  /* 未登录                                                              */
  /* ------------------------------------------------------------------ */

  test('未登录访问项目 → 401 UNAUTHORIZED', async () => {
    const res = await requestJson<{ error: { code: string } }>(
      ctx.app,
      `/api/projects/${alice.projectId}`
    );
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});
