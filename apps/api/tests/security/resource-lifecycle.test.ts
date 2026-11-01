/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 资源生命周期与非法标识的边界行为
 * ---------------------------------------------------------------------------
 * 这两条都是**真实缺陷**的回归锁 —— 它们是被 E2E 打出来的，不是先写测试
 * 再实现：
 *
 *   1. **软删除的项目仍然打得开**
 *      `DELETE /api/projects/:id` 打的是 `deleted_at` 时间戳（软删除）。
 *      列表查询过滤了 `deleted_at IS NULL`，但 `requireProject` 中间件**漏了**，
 *      于是出现"作品库里没有了，直链却还能读能改"。
 *
 *   2. **非法 UUID 让接口 500**
 *      `projects.id` 是 Postgres 的 `uuid` 列。把 `12d5...取消确认导出`
 *      这种非 UUID 塞进 `WHERE id = $1`，Postgres 在**类型转换**时抛错，
 *      异常一路冒到错误处理器 → 500。
 *      但从调用方看，"路径里的 id 长得不像 UUID"就是**这个资源不存在**，
 *      应该是 404，而不是把数据库异常抛给客户端。
 *
 * 判据来源：docs/backend-design.md §5.3（错误包封与封闭错误码枚举）
 *          docs/backend-features.md SEC-08（跨租户 / 已删资源一律 404）
 */

import { describe, expect, test } from 'bun:test';

import { createProject, createTestApp, registerUser, requestJson } from '../helpers';

describe('资源生命周期边界', () => {
  test('软删除的项目：详情与子资源一律 404（不能"列表没了、直链还在"）', async () => {
    const { app } = await createTestApp();
    const user = await registerUser(app);
    const projectId = await createProject(app, user.cookie, '待删除的项目');

    // 删除前当然读得到
    const before = await requestJson(app, `/api/projects/${projectId}`, {
      cookie: user.cookie,
    });
    expect(before.status).toBe(200);

    const del = await requestJson(app, `/api/projects/${projectId}`, {
      method: 'DELETE',
      cookie: user.cookie,
    });
    expect(del.status).toBe(200);

    // 删除后：详情 404
    const after = await requestJson<{ error: { code: string } }>(
      app,
      `/api/projects/${projectId}`,
      { cookie: user.cookie }
    );
    expect(after.status).toBe(404);
    expect(after.body.error.code).toBe('NOT_FOUND');

    // 子资源同样 404 —— 不能只挡住详情页
    const slides = await requestJson<{ error: { code: string } }>(
      app,
      `/api/projects/${projectId}/slides`,
      { cookie: user.cookie }
    );
    expect(slides.status).toBe(404);
    expect(slides.body.error.code).toBe('NOT_FOUND');

    // 写操作也不能再落到已删项目上
    const patch = await requestJson<{ error: { code: string } }>(
      app,
      `/api/projects/${projectId}`,
      { method: 'PATCH', cookie: user.cookie, body: { name: '改名试试' } }
    );
    expect(patch.status).toBe(404);
    expect(patch.body.error.code).toBe('NOT_FOUND');

    // 列表里也不该再有它
    const list = await requestJson<{ data: { projects: Array<{ id: string }> } }>(
      app,
      '/api/projects',
      { cookie: user.cookie }
    );
    expect(list.body.data.projects.some((p) => p.id === projectId)).toBe(false);
  });

  test('非法 UUID 的路径参数 → 404 而不是 500（不把数据库异常抛给客户端）', async () => {
    const { app } = await createTestApp();
    const user = await registerUser(app);

    // 这些值都真实出现在过客户端请求里 —— 比如 jobId 被正则多截了一段
    const malformed = [
      'not-a-uuid',
      '12d560d7-3cd8-4664-8688-0b8596349c10取消确认导出',
      '../../etc/passwd',
      '00000000-0000-0000-0000-000000000000',
      'a'.repeat(500),
    ];

    for (const bad of malformed) {
      const detail = await requestJson<{ error: { code: string } }>(
        app,
        `/api/projects/${encodeURIComponent(bad)}`,
        { cookie: user.cookie }
      );
      expect(detail.status).toBe(404);
      expect(detail.body.error.code).toBe('NOT_FOUND');

      const job = await requestJson<{ error: { code: string } }>(
        app,
        `/api/exports/${encodeURIComponent(bad)}`,
        { cookie: user.cookie }
      );
      expect(job.status).toBe(404);
      expect(job.body.error.code).toBe('NOT_FOUND');
    }
  });

  test('未登录访问非法 id → 401（鉴权先于资源存在性判定）', async () => {
    const { app } = await createTestApp();

    const res = await requestJson<{ error: { code: string } }>(
      app,
      '/api/projects/not-a-uuid'
    );
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});
