/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 会话与密码（docs/backend-design.md §9.1）
 * ---------------------------------------------------------------------------
 *   注册/登录：`Bun.password.hash(pw, { algorithm: 'argon2id' })`；验证 `Bun.password.verify`
 *   Session ID：32 字节 CSPRNG → base64url，存 DB（可吊销）
 *   Cookie：`HttpOnly` + `SameSite=Lax` + `Secure`（生产）+ `Path=/`
 */

import { and, eq, gt } from 'drizzle-orm';
import { setCookie, deleteCookie } from 'hono/cookie';
import type { Context } from 'hono';

import { sessions, users, type SessionRow, type UserRow } from '../db/schema';
import type { DbHandle } from '../db/client';
import type { AppEnv } from '../types';
import { ApiError } from '../errors';

/* -------------------------------------------------------------------------- */
/* 密码                                                                        */
/* -------------------------------------------------------------------------- */

/** argon2id 哈希 —— 数据库里永远不出现明文或可逆密文 */
export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: 'argon2id' });
}

/** 校验密码 —— 正确返回 true，错误返回 false */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

/* -------------------------------------------------------------------------- */
/* Session                                                                     */
/* -------------------------------------------------------------------------- */

/** 32 字节 CSPRNG → base64url（43 字符，无 padding） */
export function newSessionId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

/** base64url 字符集 */
export const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

export interface SessionInfo {
  id: string;
  userId: string;
  expiresAt: Date;
}

export async function createSession(
  db: DbHandle,
  userId: string,
  ttlDays: number
): Promise<SessionInfo> {
  const id = newSessionId();
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  await db.db.insert(sessions).values({ id, userId, expiresAt });
  return { id, userId, expiresAt };
}

export async function findSession(db: DbHandle, sessionId: string): Promise<SessionRow | undefined> {
  const rows = await db.db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0];
}

export async function deleteSession(db: DbHandle, sessionId: string): Promise<void> {
  await db.db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function findUserByEmail(db: DbHandle, email: string): Promise<UserRow | undefined> {
  const rows = await db.db.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0];
}

export async function findUserById(db: DbHandle, id: string): Promise<UserRow | undefined> {
  const rows = await db.db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0];
}

/* -------------------------------------------------------------------------- */
/* Cookie                                                                      */
/* -------------------------------------------------------------------------- */

export interface CookieOptions {
  cookieName: string;
  isProduction: boolean;
  maxAgeSeconds: number;
}

/** 设置会话 Cookie —— HttpOnly + SameSite=Lax + Path=/（生产加 Secure） */
export function setSessionCookie(
  c: Context<AppEnv>,
  sessionId: string,
  opts: CookieOptions
): void {
  setCookie(c, opts.cookieName, sessionId, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: opts.isProduction,
    maxAge: opts.maxAgeSeconds,
  });
}

export function clearSessionCookie(
  c: Context<AppEnv>,
  opts: Pick<CookieOptions, 'cookieName' | 'isProduction'>
): void {
  deleteCookie(c, opts.cookieName, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: opts.isProduction,
  });
}

/** 从请求里取会话 id */
export function readSessionCookie(
  c: Context<AppEnv>,
  cookieName: string
): string | undefined {
  const raw = c.req.header('cookie');
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === cookieName) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

/** 邮箱格式校验 —— 只挡明显不合法，不做过度限制 */
export function assertEmail(email: string): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw ApiError.validation('邮箱格式不合法', { field: 'email' });
  }
}

/** 密码强度 —— 最低 8 位 */
export function assertPassword(password: string): void {
  if (password.length < 8) {
    throw ApiError.validation('密码至少 8 位', { field: 'password' });
  }
  if (password.length > 200) {
    throw ApiError.validation('密码过长', { field: 'password' });
  }
}
