/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SPEC-SEC-001 —— 密码使用 argon2id 哈希存储
 * ---------------------------------------------------------------------------
 * docs/backend-design.md §9.1：
 *   > 注册/登录：`Bun.password.hash(pw, { algorithm: 'argon2id' })`；验证 `Bun.password.verify`。
 *
 * 验证目标（spec/spec.yaml）：apps/api/tests/security/password-hashing.test.ts
 *
 * 判据要求**直接查库** —— 只断言"登录成功"证明不了存储格式。
 */

import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';

import { users } from '../../src/db/schema';
import { verifyPassword } from '../../src/services/authService';
import { createTestApp, registerUser, requestJson } from '../helpers';

const PLAINTEXT = 'correct horse battery staple';

describe('SPEC-SEC-001 密码哈希', () => {
  // 注册后查库 —— 存的是 argon2id 哈希，不是明文
  test('password-stored-as-argon2id-hash', async () => {
    const ctx = await createTestApp();
    const user = await registerUser(ctx.app, 'hash@example.com');

    const rows = await ctx.db.db.select().from(users).where(eq(users.email, 'hash@example.com'));
    expect(rows).toHaveLength(1);

    const stored = rows[0]!.passwordHash;

    expect(stored).not.toBe(PLAINTEXT);
    expect(stored.startsWith('$argon2id$')).toBe(true);
    // 哈希里也不该出现明文的任何片段
    expect(stored).not.toContain(PLAINTEXT);
    expect(user.userId).toBe(rows[0]!.id);
  });

  // 校验密码 —— 正确密码 true，错误密码 false
  test('password-verify-accepts-correct-and-rejects-wrong', async () => {
    const ctx = await createTestApp();

    const reg = await requestJson<{ data: { user: { id: string } } }>(
      ctx.app,
      '/api/auth/register',
      { method: 'POST', body: { email: 'verify@example.com', password: PLAINTEXT, name: 'V' } }
    );
    expect(reg.status).toBe(201);

    const rows = await ctx.db.db.select().from(users).where(eq(users.email, 'verify@example.com'));
    const stored = rows[0]!.passwordHash;

    // 应用自己的校验入口 —— 断言的是**我们的代码**，不是 Bun 库自身的行为。
    // 只调 Bun.password.verify 的话，这条判据对实现的任何改动都无感
    //（注入错误也抓不到），所以两段都要有。
    expect(await verifyPassword(PLAINTEXT, stored)).toBe(true);
    expect(await verifyPassword('wrong password', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
    expect(await verifyPassword(PLAINTEXT.toUpperCase(), stored)).toBe(false);

    // 库层同样要成立 —— 存下来的确实是 Bun 能验的 argon2id 哈希
    expect(await Bun.password.verify(PLAINTEXT, stored)).toBe(true);
    expect(await Bun.password.verify('wrong password', stored)).toBe(false);
    expect(await Bun.password.verify('', stored)).toBe(false);
    expect(await Bun.password.verify(PLAINTEXT.toUpperCase(), stored)).toBe(false);
  });

  test('登录走的是哈希校验 —— 错误密码进不去', async () => {
    const ctx = await createTestApp();

    const reg = await requestJson(ctx.app, '/api/auth/register', {
      method: 'POST',
      body: { email: 'login@example.com', password: PLAINTEXT, name: 'L' },
    });
    expect(reg.status).toBe(201);

    const ok = await requestJson<{ data: { user: { email: string } } }>(
      ctx.app,
      '/api/auth/login',
      { method: 'POST', body: { email: 'login@example.com', password: PLAINTEXT } }
    );
    expect(ok.status).toBe(200);
    expect(ok.body.data.user.email).toBe('login@example.com');

    const bad = await requestJson<{ error: { code: string } }>(ctx.app, '/api/auth/login', {
      method: 'POST',
      body: { email: 'login@example.com', password: 'not-the-password' },
    });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('UNAUTHORIZED');
  });

  test('邮箱不存在与密码错误返回同样的错误（不泄露账号是否存在）', async () => {
    const ctx = await createTestApp();

    await requestJson(ctx.app, '/api/auth/register', {
      method: 'POST',
      body: { email: 'exists@example.com', password: PLAINTEXT, name: 'E' },
    });

    const noSuchUser = await requestJson<{ error: { message: string } }>(
      ctx.app,
      '/api/auth/login',
      { method: 'POST', body: { email: 'nobody@example.com', password: PLAINTEXT } }
    );
    const wrongPassword = await requestJson<{ error: { message: string } }>(
      ctx.app,
      '/api/auth/login',
      { method: 'POST', body: { email: 'exists@example.com', password: 'nope-nope-nope' } }
    );

    expect(noSuchUser.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(noSuchUser.body.error.message).toBe(wrongPassword.body.error.message);
  });

  test('每个用户的哈希都不同（盐生效）', async () => {
    const ctx = await createTestApp();

    await requestJson(ctx.app, '/api/auth/register', {
      method: 'POST',
      body: { email: 'salt1@example.com', password: PLAINTEXT, name: 'S1' },
    });
    await requestJson(ctx.app, '/api/auth/register', {
      method: 'POST',
      body: { email: 'salt2@example.com', password: PLAINTEXT, name: 'S2' },
    });

    const rows = await ctx.db.db.select().from(users);
    const hashes = rows.map((r) => r.passwordHash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });
});
