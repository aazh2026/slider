/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SPEC-SEC-002 —— Session Cookie 具备安全属性
 * ---------------------------------------------------------------------------
 * docs/backend-design.md §9.1：
 *   > Cookie：`HttpOnly` + `SameSite=Lax` + `Secure`（生产）+ `Path=/`。
 *   > Session ID 为 32 字节 CSPRNG 的 base64url 编码
 *
 * 验证目标（spec/spec.yaml）：apps/api/tests/security/session-cookie.test.ts
 */

import { afterEach, describe, expect, test } from 'bun:test';

import { BASE64URL_RE } from '../../src/services/authService';
import { createTestApp, requestJson } from '../helpers';

const ORIGINAL_NODE_ENV = process.env['NODE_ENV'];

afterEach(() => {
  if (ORIGINAL_NODE_ENV === undefined) delete process.env['NODE_ENV'];
  else process.env['NODE_ENV'] = ORIGINAL_NODE_ENV;
});

/** 从 Set-Cookie 里取出会话 id */
function sessionIdFrom(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const match = setCookie.match(/ppt_session=([^;]+)/);
  return match?.[1] ?? null;
}

describe('SPEC-SEC-002 Session Cookie 属性', () => {
  // 登录响应带 HttpOnly + SameSite=Lax + Path=/
  test('session-cookie-has-security-attributes', async () => {
    process.env['NODE_ENV'] = 'development';
    const ctx = await createTestApp();

    await requestJson(ctx.app, '/api/auth/register', {
      method: 'POST',
      body: { email: 'cookie@example.com', password: 'password123', name: 'C' },
    });
    const login = await requestJson(ctx.app, '/api/auth/login', {
      method: 'POST',
      body: { email: 'cookie@example.com', password: 'password123' },
    });
    expect(login.status).toBe(200);

    const setCookie = login.res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();

    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    // 开发环境不加 Secure（本地 http 会被浏览器拒收）
    expect(setCookie).not.toContain('Secure');
  });

  // 生产环境下必须带 Secure
  test('session-cookie-secure-in-production', async () => {
    const ctx = await createTestApp();

    await requestJson(ctx.app, '/api/auth/register', {
      method: 'POST',
      body: { email: 'prod@example.com', password: 'password123', name: 'P' },
    });

    process.env['NODE_ENV'] = 'production';
    const login = await requestJson(ctx.app, '/api/auth/login', {
      method: 'POST',
      body: { email: 'prod@example.com', password: 'password123' },
    });
    expect(login.status).toBe(200);

    const setCookie = login.res.headers.get('set-cookie');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
  });

  // Session ID 是 32 字节 CSPRNG 的 base64url（≥ 43 字符）
  test('session-id-is-32-byte-base64url', async () => {
    const ctx = await createTestApp();

    await requestJson(ctx.app, '/api/auth/register', {
      method: 'POST',
      body: { email: 'sid@example.com', password: 'password123', name: 'S' },
    });
    const login = await requestJson(ctx.app, '/api/auth/login', {
      method: 'POST',
      body: { email: 'sid@example.com', password: 'password123' },
    });

    const sessionId = sessionIdFrom(login.res.headers.get('set-cookie'));
    expect(sessionId).toBeTruthy();
    // 32 字节 → base64url 无 padding = 43 字符
    expect(sessionId!.length).toBeGreaterThanOrEqual(43);
    expect(BASE64URL_RE.test(sessionId!)).toBe(true);
    // base64url 不能有 + / = 这些字符
    expect(sessionId).not.toContain('+');
    expect(sessionId).not.toContain('/');
    expect(sessionId).not.toContain('=');
  });

  test('每次登录的 Session ID 都不同', async () => {
    const ctx = await createTestApp();

    await requestJson(ctx.app, '/api/auth/register', {
      method: 'POST',
      body: { email: 'multi@example.com', password: 'password123', name: 'M' },
    });

    const ids = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const login = await requestJson(ctx.app, '/api/auth/login', {
        method: 'POST',
        body: { email: 'multi@example.com', password: 'password123' },
      });
      ids.add(sessionIdFrom(login.res.headers.get('set-cookie'))!);
    }
    expect(ids.size).toBe(3);
  });

  test('登出会销毁服务端会话（Cookie 失效）', async () => {
    const ctx = await createTestApp();

    const reg = await requestJson(ctx.app, '/api/auth/register', {
      method: 'POST',
      body: { email: 'bye@example.com', password: 'password123', name: 'B' },
    });
    const setCookie = reg.res.headers.get('set-cookie');
    const cookie = `ppt_session=${sessionIdFrom(setCookie)}`;

    const before = await requestJson(ctx.app, '/api/auth/me', { cookie });
    expect(before.status).toBe(200);

    const logout = await requestJson(ctx.app, '/api/auth/logout', { method: 'POST', cookie });
    expect(logout.status).toBe(200);

    const after = await requestJson(ctx.app, '/api/auth/me', { cookie });
    expect(after.status).toBe(401);
  });
});
