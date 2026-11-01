/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SPEC-API-005 —— 密钥仅存在于服务端且缺失即启动失败
 * ---------------------------------------------------------------------------
 * docs/backend-features.md §N 安全（SEC）· SEC-06：
 *   > 密钥仅在服务端；缺失即启动失败；日志不打印密钥
 *
 * 验证目标（spec/spec.yaml）：apps/api/tests/security/secret-handling.test.ts
 *
 * 两段断言：
 *   1. **缺失即启动失败** —— 真起一个子进程（不用 mock），断言非零退出码 + 明确提示
 *   2. **密钥不出现在任何响应体与任何日志行里** —— 用哨兵密钥跑一遍全端点
 */

import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  compileProject,
  createProject,
  createTestApp,
  registerUser,
  requestJson,
} from '../helpers';

/** 仓库根 —— 从 apps/api/tests/security 上溯四级 */
const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..');
const SERVER_ENTRY = join(REPO_ROOT, 'apps', 'api', 'src', 'index.ts');

/** 哨兵密钥 —— 任何一处泄漏都能被字符串搜出来 */
const SENTINEL_KEY = 'sk-SENTINEL-KEY-must-never-leak-9f3a2b';

describe('SPEC-API-005 密钥管理', () => {
  // GEMINI_API_KEY 缺失 → 进程以非零码退出且日志提示明确
  test('missing-api-key-fails-startup', async () => {
    // 用一个空目录当 cwd —— 那里没有 .env，Bun 不会把仓库里的 .env 读进来
    const cwd = await mkdtemp(join(tmpdir(), 'ppt-nokey-'));

    try {
      const proc = Bun.spawn({
        cmd: ['bun', SERVER_ENTRY],
        cwd,
        env: {
          ...process.env,
          GEMINI_API_KEY: '',
          NODE_ENV: 'development',
          PORT: '3199',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const [exitCode, stderr, stdout] = await Promise.all([
        proc.exited,
        new Response(proc.stderr).text(),
        new Response(proc.stdout).text(),
      ]);

      expect(exitCode).not.toBe(0);

      const output = `${stdout}\n${stderr}`;
      // 必须明确指出缺的是哪个变量
      expect(output).toContain('GEMINI_API_KEY');
      expect(output).toContain('启动失败');
      // 不能打印任何密钥
      expect(output).not.toContain(SENTINEL_KEY);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  // 任何 API 响应体与任何日志行都不含 API Key 值
  test('secret-never-leaks-into-responses-or-logs', async () => {
    const original = process.env['GEMINI_API_KEY'];
    process.env['GEMINI_API_KEY'] = SENTINEL_KEY;

    // 捕获日志
    const logLines: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    const capture = (...args: unknown[]) => {
      logLines.push(args.map((a) => String(a)).join(' '));
    };
    console.log = capture;
    console.error = capture;
    console.warn = capture;

    const bodies: string[] = [];

    try {
      const ctx = await createTestApp({
        model: { behaviors: [{ kind: 'error', message: '模型服务 503', retryable: true, status: 503 }] },
      });
      const user = await registerUser(ctx.app);
      const projectId = await createProject(ctx.app, user.cookie);
      const slides = await compileProject(ctx.app, user.cookie, projectId);

      const probes: Array<[string, string, string?]> = [
        ['GET', '/healthz'],
        ['GET', '/readyz'],
        ['GET', '/api/meta/models'],
        ['GET', '/api/auth/me', user.cookie],
        ['GET', '/api/projects', user.cookie],
        ['GET', `/api/projects/${projectId}`, user.cookie],
        ['GET', `/api/projects/${projectId}/slides`, user.cookie],
        ['GET', `/api/projects/${projectId}/slides/${slides[0]!.slideId}`, user.cookie],
        ['GET', '/api/templates', user.cookie],
        ['GET', '/api/projects', user.cookie],
      ];

      for (const [method, path, cookie] of probes) {
        const res = await requestJson<unknown>(ctx.app, path, { method, cookie });
        bodies.push(JSON.stringify(res.body));
        bodies.push(JSON.stringify([...res.headers.entries()]));
      }

      // AI 端点也要过 —— 降级路径的报错信息可能带上上游细节
      const ai = await requestJson<unknown>(ctx.app, '/api/ai/outline', {
        method: 'POST',
        cookie: user.cookie,
        body: {
          requirement: {
            topic: '密钥泄漏检查',
            purpose: '',
            audience: '',
            pageCount: 3,
            style: '',
            depth: '',
            aspectRatio: '16:9',
          },
        },
      });
      bodies.push(JSON.stringify(ai.body));
    } finally {
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
      if (original === undefined) delete process.env['GEMINI_API_KEY'];
      else process.env['GEMINI_API_KEY'] = original;
    }

    const allOutput = [...bodies, ...logLines].join('\n');
    expect(allOutput).not.toContain(SENTINEL_KEY);
    // 也不能出现密钥的任意片段
    expect(allOutput).not.toContain('SENTINEL');
    expect(allOutput).not.toContain('must-never-leak');
  });

  test('/api/meta/models 只暴露"有没有密钥"，不暴露密钥本身', async () => {
    const original = process.env['GEMINI_API_KEY'];
    process.env['GEMINI_API_KEY'] = SENTINEL_KEY;

    try {
      const ctx = await createTestApp();
      const res = await requestJson<{
        data: { models: Array<Record<string, unknown>> };
      }>(ctx.app, '/api/meta/models');

      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain(SENTINEL_KEY);
      // 只能有布尔可用性标记
      for (const model of res.body.data.models) {
        expect(typeof model['available']).toBe('boolean');
        expect(model['apiKey']).toBeUndefined();
      }
    } finally {
      if (original === undefined) delete process.env['GEMINI_API_KEY'];
      else process.env['GEMINI_API_KEY'] = original;
    }
  });
});
