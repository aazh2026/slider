/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 鉴权中间件（docs/backend-design.md §9.1 / §9.2）
 * ---------------------------------------------------------------------------
 *   - `requireAuth`  —— 必须登录，否则 401 UNAUTHORIZED
 *   - `requireProject` —— 必须带 userId 条件命中项目，否则 404 NOT_FOUND
 *
 * **跨租户访问统一返回 404 而不是 403**（SEC-08）——
 * 返回 403 等于告诉攻击者"这个资源存在但你不能看"，那是信息泄露。
 */

import type { MiddlewareHandler } from 'hono';
import { and, eq, isNull } from 'drizzle-orm';

import { ApiError } from '../errors';
import { findSession } from '../services/authService';
import { projects, slides } from '../db/schema';
import { isUuid } from '../utils/uuid';
import type { AppEnv } from '../types';

/** 载入会话（不强制登录） —— 公开端点用它识别用户 */
export const loadSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const cookieName = process.env['SESSION_COOKIE_NAME'] ?? 'ppt_session';
  const raw = c.req.header('cookie');
  if (raw) {
    for (const part of raw.split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name === cookieName) {
        const sessionId = decodeURIComponent(rest.join('='));
        if (sessionId) {
          const session = await findSession(c.get('db'), sessionId);
          if (session) c.set('userId', session.userId);
        }
        break;
      }
    }
  }
  await next();
};

/** 必须登录 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('userId')) {
    throw ApiError.unauthorized('请先登录');
  }
  await next();
};

/**
 * 必须命中当前用户的项目
 * ---------------------------------------------------------------------------
 * 查询条件**必须**同时带 id 与 userId —— 这是资源级鉴权的唯一凭据。
 *
 * 还要带 `deletedAt IS NULL` —— 删除是**软删除**（`deleted_at` 打时间戳）。
 * 少了这个条件，被删掉的项目仍然能读能改："列表里没有了，但直链还打得开"。
 * `listProjects` / `findProject` 都已经过滤了，这里要跟上。
 */
export const requireProject: MiddlewareHandler<AppEnv> = async (c, next) => {
  const userId = c.get('userId');
  if (!userId) throw ApiError.unauthorized('请先登录');

  const id = c.req.param('id');
  // 形态不对的 id 根本不该进数据库 —— 见 utils/uuid.ts 的说明
  if (!id || !isUuid(id)) throw ApiError.notFound('项目不存在');

  const rows = await c
    .get('db')
    .db.select()
    .from(projects)
    .where(
      and(eq(projects.id, id), eq(projects.userId, userId), isNull(projects.deletedAt))
    )
    .limit(1);

  const project = rows[0];
  if (!project) throw ApiError.notFound('项目不存在');

  c.set('project', project);
  await next();
};

/**
 * 必须命中当前用户项目的某一页
 * ---------------------------------------------------------------------------
 * 注意：`projectId` 来自 requireProject 已经校验过的项目，slideId 再带 projectId 条件 ——
 * 避免"知道别人的 slideId 就能读"。
 */
export const requireSlide: MiddlewareHandler<AppEnv> = async (c, next) => {
  const userId = c.get('userId');
  if (!userId) throw ApiError.unauthorized('请先登录');

  const project = c.get('project');
  if (!project) throw ApiError.notFound('项目不存在');

  const slideId = c.req.param('slideId');
  if (!slideId) throw ApiError.notFound('幻灯片不存在');

  const rows = await c
    .get('db')
    .db.select()
    .from(slides)
    .where(and(eq(slides.projectId, project.id), eq(slides.slideId, slideId)))
    .limit(1);

  const slide = rows[0];
  if (!slide) throw ApiError.notFound('幻灯片不存在');

  c.set('slide', slide);
  await next();
};
