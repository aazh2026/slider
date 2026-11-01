/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 认证路由（docs/backend-design.md §5.2）
 * ---------------------------------------------------------------------------
 *   POST /api/auth/register   注册
 *   POST /api/auth/login      登录 → Set-Cookie
 *   POST /api/auth/logout     登出
 *   GET  /api/auth/me         当前用户 + 配额
 */

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';

import { ApiError } from '../errors';
import { users } from '../db/schema';
import {
  assertEmail,
  assertPassword,
  clearSessionCookie,
  createSession,
  deleteSession,
  findUserByEmail,
  hashPassword,
  readSessionCookie,
  setSessionCookie,
  verifyPassword,
} from '../services/authService';
import { requireAuth } from '../middleware/auth';
import { respond } from './_helpers';
import type { AppEnv } from '../types';

export const authRoutes = new Hono<AppEnv>();

function cookieName(): string {
  return process.env['SESSION_COOKIE_NAME'] ?? 'ppt_session';
}

function isProduction(): boolean {
  return (process.env['NODE_ENV'] ?? 'development') === 'production';
}

/** 会话有效期（秒） */
function sessionMaxAge(): number {
  const days = Number(process.env['SESSION_IDLE_DAYS'] ?? 30);
  return Math.max(1, days) * 24 * 60 * 60;
}

/** 用户公开信息 */
function publicUser(row: { id: string; email: string; name: string }) {
  return { id: row.id, email: row.email, name: row.name };
}

authRoutes.post('/register', async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = String(body?.email ?? '').trim().toLowerCase();
  const password = String(body?.password ?? '');
  const name = String(body?.name ?? '').trim() || email.split('@')[0] || '用户';

  assertEmail(email);
  assertPassword(password);

  const db = c.get('db');

  const existing = await findUserByEmail(db, email);
  if (existing) {
    throw ApiError.validation('该邮箱已注册', { field: 'email' });
  }

  const passwordHash = await hashPassword(password);
  const [user] = await db
    .db.insert(users)
    .values({ email, passwordHash, name })
    .returning();

  if (!user) throw ApiError.jobFailed('用户创建失败');

  const session = await createSession(db, user.id, sessionMaxAge() / 86400);
  setSessionCookie(c, session.id, {
    cookieName: cookieName(),
    isProduction: isProduction(),
    maxAgeSeconds: sessionMaxAge(),
  });

  return respond(c, { user: publicUser(user) }, 201);
});

authRoutes.post('/login', async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = String(body?.email ?? '').trim().toLowerCase();
  const password = String(body?.password ?? '');

  if (!email || !password) {
    throw ApiError.validation('邮箱与密码必填');
  }

  const db = c.get('db');
  const user = await findUserByEmail(db, email);

  // 邮箱不存在与密码错误返回同样的错误 —— 不泄露"这个邮箱注册过"
  if (!user) throw ApiError.unauthorized('邮箱或密码不正确');

  const okPw = await verifyPassword(password, user.passwordHash);
  if (!okPw) throw ApiError.unauthorized('邮箱或密码不正确');

  const session = await createSession(db, user.id, sessionMaxAge() / 86400);
  setSessionCookie(c, session.id, {
    cookieName: cookieName(),
    isProduction: isProduction(),
    maxAgeSeconds: sessionMaxAge(),
  });

  return respond(c, { user: publicUser(user) });
});

authRoutes.post('/logout', async (c) => {
  const sessionId = readSessionCookie(c, cookieName());
  if (sessionId) {
    await deleteSession(c.get('db'), sessionId);
  }
  clearSessionCookie(c, { cookieName: cookieName(), isProduction: isProduction() });
  return respond(c, { loggedOut: true });
});

authRoutes.get('/me', requireAuth, async (c) => {
  const db = c.get('db');
  const userId = c.get('userId')!;
  const rows = await db.db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = rows[0];
  if (!user) throw ApiError.unauthorized('会话已失效');

  return respond(c, {
    user: publicUser(user),
    // 配额统计 —— 按用户聚合模型调用
    quota: { monthlyTokenBudget: 2_000_000, monthlyCostBudget: 50 },
  });
});
