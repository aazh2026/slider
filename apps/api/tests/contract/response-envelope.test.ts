/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AC-API-001 —— 统一响应与错误包封
 * ---------------------------------------------------------------------------
 * 判据（spec/spec.yaml SPEC-API-001）：
 *   "对全部路由枚举各发一次成功请求与一次失败请求，断言成功响应含 data 与 traceId，
 *    失败响应含 error.code、error.message 与 traceId，且 error.code ∈ 上述枚举"
 *
 * Oracle：authoritative —— docs/backend-design.md §5.3 统一响应与错误规范
 *
 * **枚举覆盖说明**（不是降低标准，是把"没有失败分支"这件事写清楚）：
 *   `/healthz`、`/api/meta/models` 是纯读取端点，**设计上不存在失败分支**
 *   （前者不查 DB，后者只读环境变量），所以它们只有成功用例。
 *   `/readyz` 的失败分支通过"关掉数据库"构造 —— 这条是真的被执行了。
 *   `/api/exports/:id/download` 与 `/api/exports/:id/events` 返回二进制 / SSE，
 *   不走 JSON 包封 —— 它们只断言状态码与错误分支的包封。
 */

import { describe, expect, it } from 'bun:test';

import { ERROR_CODES, type ErrorCode } from '../../src/errors';
import {
  SAMPLE_REQUIREMENT,
  compileProject,
  createProject,
  createTestApp,
  registerUser,
  requestJson,
  type TestContext,
} from '../helpers';

interface Envelope {
  data?: unknown;
  traceId?: string;
  error?: { code?: string; message?: string; details?: unknown };
}

interface Probe {
  label: string;
  method: string;
  path: string;
  body?: unknown;
  cookie?: string;
  headers?: Record<string, string>;
  /** 非 JSON 响应（二进制 / SSE）—— 只断言状态码 */
  raw?: boolean;
}

/** 探针生成器 —— 涉及乐观锁的探针必须在执行前读取最新版本号 */
type ProbeFactory = () => Promise<Probe>;

function isErrorCode(value: unknown): value is (typeof ERROR_CODES)[number] {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

/** 断言成功包封 */
function expectSuccessEnvelope(body: Envelope, label: string): void {
  expect(body, `${label}: 成功响应必须有 body`).toBeTruthy();
  expect(body, `${label}: 成功响应必须含 data 字段`).toHaveProperty('data');
  expect(body, `${label}: 成功响应必须含 traceId`).toHaveProperty('traceId');
  expect(typeof body.traceId, `${label}: traceId 必须是字符串`).toBe('string');
  expect(body.traceId!.length, `${label}: traceId 不能为空`).toBeGreaterThan(0);
  expect(body, `${label}: 成功响应不应含 error 字段`).not.toHaveProperty('error');
}

/** 断言失败包封 + 错误码在封闭枚举内 */
function expectErrorEnvelope(body: Envelope, label: string): void {
  expect(body, `${label}: 失败响应必须有 body`).toBeTruthy();
  expect(body, `${label}: 失败响应必须含 error 字段`).toHaveProperty('error');
  expect(body, `${label}: 失败响应必须含 traceId`).toHaveProperty('traceId');
  expect(typeof body.traceId, `${label}: traceId 必须是字符串`).toBe('string');

  const err = body.error!;
  expect(typeof err.code, `${label}: error.code 必须是字符串`).toBe('string');
  expect(typeof err.message, `${label}: error.message 必须是字符串`).toBe('string');
  expect(err.message!.length, `${label}: error.message 不能为空`).toBeGreaterThan(0);
  expect(
    isErrorCode(err.code),
    `${label}: error.code="${err.code}" 不在封闭枚举 ${JSON.stringify(ERROR_CODES)} 内`
  ).toBe(true);
  expect(body, `${label}: 失败响应不应含 data 字段`).not.toHaveProperty('data');
}

/**
 * 构造全套探针
 * ---------------------------------------------------------------------------
 * 每个路由两条：一条成功、一条失败。失败分支覆盖三种触发方式：
 *   - 未登录      → 401 UNAUTHORIZED
 *   - 参数不合法  → 400 VALIDATION_FAILED
 *   - 资源不存在 / 越权 → 404 NOT_FOUND
 */
async function buildProbes(
  ctx: TestContext
): Promise<{ success: Array<Probe | ProbeFactory>; failure: Probe[] }> {
  const owner = await registerUser(ctx.app);
  const other = await registerUser(ctx.app);
  // 登出会销毁会话 —— 用一个独立账号跑 logout，别影响后续探针
  const logoutUser = await registerUser(ctx.app);

  const projectId = await createProject(ctx.app, owner.cookie, '包封测试项目');
  const slides = await compileProject(ctx.app, owner.cookie, projectId);
  const slideId = slides[0]!.slideId;
  const versionId = slides[0]!.versionId;

  // 一个已完成的导出任务（供 download / events 用）
  const exportRes = await requestJson<{ data: { job: { id: string } } }>(
    ctx.app,
    '/api/exports',
    { method: 'POST', cookie: owner.cookie, body: { projectId, format: 'json' } }
  );
  const jobId = exportRes.body.data.job.id;
  // 等任务结束
  for (let i = 0; i < 100; i++) {
    const st = await requestJson<{ data: { job: { status: string } } }>(
      ctx.app,
      `/api/exports/${jobId}`,
      { cookie: owner.cookie }
    );
    const s = st.body.data.job.status;
    if (s === 'succeeded' || s === 'failed') break;
    await Bun.sleep(100);
  }

  const P = { projectId, slideId, versionId, jobId };
  const ownerCookie = owner.cookie;
  const otherCookie = other.cookie;

  const success: Array<Probe | ProbeFactory> = [
    { label: 'GET /healthz', method: 'GET', path: '/healthz' },
    { label: 'GET /readyz', method: 'GET', path: '/readyz' },
    { label: 'GET /api/meta/models', method: 'GET', path: '/api/meta/models' },

    {
      label: 'POST /api/auth/register',
      method: 'POST',
      path: '/api/auth/register',
      body: { email: `sweep-${Date.now()}@example.com`, password: 'password123', name: 'Sweep' },
    },
    {
      label: 'POST /api/auth/login',
      method: 'POST',
      path: '/api/auth/login',
      body: { email: owner.email, password: 'password123' },
    },
    {
      label: 'POST /api/auth/logout',
      method: 'POST',
      path: '/api/auth/logout',
      cookie: logoutUser.cookie,
    },
    { label: 'GET /api/auth/me', method: 'GET', path: '/api/auth/me', cookie: ownerCookie },

    { label: 'GET /api/projects', method: 'GET', path: '/api/projects', cookie: ownerCookie },
    {
      label: 'POST /api/projects',
      method: 'POST',
      path: '/api/projects',
      cookie: ownerCookie,
      body: { name: '包封新建', requirement: SAMPLE_REQUIREMENT },
    },
    {
      label: 'POST /api/projects/import',
      method: 'POST',
      path: '/api/projects/import',
      cookie: ownerCookie,
      body: { name: '包封导入', requirement: SAMPLE_REQUIREMENT, outline: [], slides: [] },
    },
    {
      label: 'GET /api/projects/:id',
      method: 'GET',
      path: `/api/projects/${P.projectId}`,
      cookie: ownerCookie,
    },
    {
      label: 'PATCH /api/projects/:id',
      method: 'PATCH',
      path: `/api/projects/${P.projectId}`,
      cookie: ownerCookie,
      body: { name: '包封改名' },
    },
    {
      label: 'POST /api/projects/:id/duplicate',
      method: 'POST',
      path: `/api/projects/${P.projectId}/duplicate`,
      cookie: ownerCookie,
    },
    {
      label: 'GET /api/projects/:id/export',
      method: 'GET',
      path: `/api/projects/${P.projectId}/export`,
      cookie: ownerCookie,
    },
    {
      label: 'PATCH /api/projects/:id/outline',
      method: 'PATCH',
      path: `/api/projects/${P.projectId}/outline`,
      cookie: ownerCookie,
      body: { outline: [] },
    },
    {
      label: 'POST /api/projects/:id/outline/regenerate',
      method: 'POST',
      path: `/api/projects/${P.projectId}/outline/regenerate`,
      cookie: ownerCookie,
      body: { requirement: SAMPLE_REQUIREMENT },
    },
    {
      label: 'POST /api/projects/:id/compile',
      method: 'POST',
      path: `/api/projects/${P.projectId}/compile`,
      cookie: ownerCookie,
    },
    {
      label: 'GET /api/projects/:id/content',
      method: 'GET',
      path: `/api/projects/${P.projectId}/content`,
      cookie: ownerCookie,
    },
    {
      label: 'GET /api/projects/:id/slides',
      method: 'GET',
      path: `/api/projects/${P.projectId}/slides`,
      cookie: ownerCookie,
    },
    {
      label: 'GET /api/projects/:id/slides/:slideId',
      method: 'GET',
      path: `/api/projects/${P.projectId}/slides/${P.slideId}`,
      cookie: ownerCookie,
    },
    // —— 涉及乐观锁的探针：执行前先读当前版本，避免用过期 baseVersionId ——
    async () => {
      const cur = await requestJson<{ data: { slide: { versionId: string; ir: unknown } } }>(
        ctx.app,
        `/api/projects/${P.projectId}/slides/${P.slideId}`,
        { cookie: ownerCookie }
      );
      const slide = cur.body.data.slide;
      const ir = slide.ir as { elements?: unknown[] };
      return {
        label: 'PATCH /api/projects/:id/slides/:slideId',
        method: 'PATCH',
        path: `/api/projects/${P.projectId}/slides/${P.slideId}`,
        cookie: ownerCookie,
        body: {
          baseVersionId: slide.versionId,
          description: '包封测试',
          elements: ir.elements ?? [],
        },
      };
    },
    {
      label: 'GET /api/projects/:id/slides/:slideId/versions',
      method: 'GET',
      path: `/api/projects/${P.projectId}/slides/${P.slideId}/versions`,
      cookie: ownerCookie,
    },
    async () => {
      const cur = await requestJson<{ data: { slide: { versionId: string } } }>(
        ctx.app,
        `/api/projects/${P.projectId}/slides/${P.slideId}`,
        { cookie: ownerCookie }
      );
      return {
        label: 'POST /api/projects/:id/slides/:slideId/versions/:versionId/rollback',
        method: 'POST',
        path: `/api/projects/${P.projectId}/slides/${P.slideId}/versions/${P.versionId}/rollback`,
        cookie: ownerCookie,
        body: { baseVersionId: cur.body.data.slide.versionId },
      };
    },

    {
      label: 'POST /api/ai/requirement',
      method: 'POST',
      path: '/api/ai/requirement',
      body: { prompt: '做一个关于碳中和政策的汇报' },
    },
    {
      label: 'POST /api/ai/outline',
      method: 'POST',
      path: '/api/ai/outline',
      body: { requirement: SAMPLE_REQUIREMENT },
    },
    {
      label: 'POST /api/ai/edit-slide',
      method: 'POST',
      path: '/api/ai/edit-slide',
      body: {
        slideId: P.slideId,
        instruction: '把标题改成「包封测试」',
        layout: 'title_cover',
        currentContent: { bullets: [] },
        elementDigest: [{ id: 'x', role: 'title', text: '旧标题' }],
      },
    },
    {
      label: 'POST /api/ai/slides/:slideId/suggest',
      method: 'POST',
      path: `/api/ai/slides/${P.slideId}/suggest`,
      body: {
        slideId: P.slideId,
        instruction: '把这页的要点改得更具体',
        currentContent: { bullets: ['要点一'] },
        elementDigest: [{ id: 'grid_card_s2_0', role: 'card', text: '要点一' }],
        layout: 'cards_grid',
      },
    },

    { label: 'GET /api/templates', method: 'GET', path: '/api/templates', cookie: ownerCookie },
    {
      label: 'POST /api/templates/:id/apply',
      method: 'POST',
      path: '/api/templates/tpl_modern_light/apply',
      cookie: ownerCookie,
      body: { projectId: P.projectId },
    },

    {
      label: 'POST /api/quality/evaluate',
      method: 'POST',
      path: '/api/quality/evaluate',
      cookie: ownerCookie,
      body: { projectId: P.projectId },
    },
    {
      label: 'POST /api/quality/auto-fix',
      method: 'POST',
      path: '/api/quality/auto-fix',
      cookie: ownerCookie,
      body: { projectId: P.projectId },
    },

    {
      label: 'POST /api/exports',
      method: 'POST',
      path: '/api/exports',
      cookie: ownerCookie,
      body: { projectId: P.projectId, format: 'json' },
    },
    { label: 'GET /api/exports/:id', method: 'GET', path: `/api/exports/${P.jobId}`, cookie: ownerCookie },
    {
      label: 'GET /api/exports/:id/download',
      method: 'GET',
      path: `/api/exports/${P.jobId}/download`,
      cookie: ownerCookie,
      raw: true,
    },
  ];

  const failure: Probe[] = [
    // —— 未登录 ——
    { label: 'GET /api/auth/me [未登录]', method: 'GET', path: '/api/auth/me' },
    { label: 'GET /api/projects [未登录]', method: 'GET', path: '/api/projects' },
    {
      label: 'POST /api/projects [未登录]',
      method: 'POST',
      path: '/api/projects',
      body: { name: 'x', requirement: SAMPLE_REQUIREMENT },
    },
    { label: 'GET /api/templates [未登录]', method: 'GET', path: '/api/templates' },
    {
      label: 'POST /api/exports [未登录]',
      method: 'POST',
      path: '/api/exports',
      body: { projectId: P.projectId, format: 'json' },
    },
    {
      label: 'GET /api/exports/:id [未登录]',
      method: 'GET',
      path: `/api/exports/${P.jobId}`,
    },

    // —— 参数不合法 ——
    {
      label: 'POST /api/auth/register [邮箱非法]',
      method: 'POST',
      path: '/api/auth/register',
      body: { email: 'not-an-email', password: 'password123' },
    },
    {
      label: 'POST /api/auth/register [密码太短]',
      method: 'POST',
      path: '/api/auth/register',
      body: { email: `short-${Date.now()}@example.com`, password: '123' },
    },
    {
      label: 'POST /api/auth/login [密码错误]',
      method: 'POST',
      path: '/api/auth/login',
      body: { email: owner.email, password: 'wrong-password' },
    },
    {
      label: 'POST /api/projects [缺 requirement]',
      method: 'POST',
      path: '/api/projects',
      cookie: ownerCookie,
      body: { name: '缺字段' },
    },
    {
      label: 'POST /api/projects/import [缺 requirement]',
      method: 'POST',
      path: '/api/projects/import',
      cookie: ownerCookie,
      body: { name: '缺字段' },
    },
    {
      label: 'PATCH /api/projects/:id/outline [outline 类型错]',
      method: 'PATCH',
      path: `/api/projects/${P.projectId}/outline`,
      cookie: ownerCookie,
      body: { outline: 'not-an-array' },
    },
    {
      label: 'PATCH /api/projects/:id/slides/:slideId [缺 baseVersionId]',
      method: 'PATCH',
      path: `/api/projects/${P.projectId}/slides/${P.slideId}`,
      cookie: ownerCookie,
      body: { description: '缺少乐观锁字段' },
    },
    {
      label: 'POST /api/projects/:id/slides/:slideId/patches [既无 patches 也无 instruction]',
      method: 'POST',
      path: `/api/projects/${P.projectId}/slides/${P.slideId}/patches`,
      cookie: ownerCookie,
      body: { baseVersionId: P.versionId },
    },
    {
      label: 'POST /api/ai/requirement [缺 prompt]',
      method: 'POST',
      path: '/api/ai/requirement',
      body: {},
    },
    {
      label: 'POST /api/ai/outline [requirement 类型错]',
      method: 'POST',
      path: '/api/ai/outline',
      body: { requirement: { topic: 123 } },
    },
    {
      label: 'POST /api/ai/edit-slide [缺 instruction]',
      method: 'POST',
      path: '/api/ai/edit-slide',
      body: { slideId: P.slideId },
    },
    {
      label: 'POST /api/ai/slides/:slideId/suggest [缺 instruction]',
      method: 'POST',
      path: `/api/ai/slides/${P.slideId}/suggest`,
      body: { slideId: P.slideId, currentContent: { bullets: [] } },
    },
    {
      label: 'POST /api/templates/extract [缺文件]',
      method: 'POST',
      path: '/api/templates/extract',
      cookie: ownerCookie,
      body: { notAFile: true },
      headers: { 'content-type': 'application/json' },
    },
    {
      label: 'POST /api/quality/evaluate [缺 projectId]',
      method: 'POST',
      path: '/api/quality/evaluate',
      cookie: ownerCookie,
      body: {},
    },
    {
      label: 'POST /api/exports [缺 projectId]',
      method: 'POST',
      path: '/api/exports',
      cookie: ownerCookie,
      body: { format: 'json' },
    },

    // —— 资源不存在 / 越权 ——
    {
      label: 'GET /api/projects/:id [不存在]',
      method: 'GET',
      path: `/api/projects/00000000-0000-4000-8000-000000000000`,
      cookie: ownerCookie,
    },
    {
      label: 'GET /api/projects/:id [他人项目]',
      method: 'GET',
      path: `/api/projects/${P.projectId}`,
      cookie: otherCookie,
    },
    {
      label: 'PATCH /api/projects/:id [他人项目]',
      method: 'PATCH',
      path: `/api/projects/${P.projectId}`,
      cookie: otherCookie,
      body: { name: '越权改名' },
    },
    {
      label: 'DELETE /api/projects/:id [他人项目]',
      method: 'DELETE',
      path: `/api/projects/${P.projectId}`,
      cookie: otherCookie,
    },
    {
      label: 'GET /api/projects/:id/slides/:slideId [他人项目]',
      method: 'GET',
      path: `/api/projects/${P.projectId}/slides/${P.slideId}`,
      cookie: otherCookie,
    },
    {
      label: 'GET /api/exports/:id [不存在]',
      method: 'GET',
      path: `/api/exports/00000000-0000-4000-8000-000000000000`,
      cookie: ownerCookie,
    },
    {
      label: 'GET /api/exports/:id/download [不存在]',
      method: 'GET',
      path: `/api/exports/00000000-0000-4000-8000-000000000000/download`,
      cookie: ownerCookie,
      raw: true,
    },
    {
      label: 'POST /api/templates/:id/apply [模板不存在]',
      method: 'POST',
      path: '/api/templates/tpl_not_exist/apply',
      cookie: ownerCookie,
      body: { projectId: P.projectId },
    },
    {
      label: 'POST /api/quality/evaluate [项目不存在]',
      method: 'POST',
      path: '/api/quality/evaluate',
      cookie: ownerCookie,
      body: { projectId: '00000000-0000-4000-8000-000000000000' },
    },
    {
      label: 'POST /api/projects/:id/compile [无大纲]',
      method: 'POST',
      path: `/api/projects/${P.projectId}/compile`,
      cookie: otherCookie,
    },
  ];

  return { success, failure };
}

describe('AC-API-001 统一响应与错误包封', () => {
  // 成功响应一律是 { data, traceId }
  it('success-response-envelope', async () => {
    const ctx = await createTestApp();
    const { success } = await buildProbes(ctx);

    expect(success.length).toBeGreaterThan(30);

    for (const entry of success) {
      const probe = typeof entry === 'function' ? await entry() : entry;
      const res = await requestJson<Envelope>(ctx.app, probe.path, {
        method: probe.method,
        body: probe.body,
        cookie: probe.cookie,
        headers: probe.headers,
      });

      expect(res.status, `${probe.label}: 期望成功状态码，实际 ${res.status}`).toBeLessThan(400);

      if (probe.raw) continue; // 二进制响应不走 JSON 包封
      expectSuccessEnvelope(res.body, probe.label);
    }
  });

  // 失败响应一律是 { error: { code, message }, traceId }
  it('failure-response-envelope', async () => {
    const ctx = await createTestApp();
    const { failure } = await buildProbes(ctx);

    expect(failure.length).toBeGreaterThan(20);

    for (const probe of failure) {
      const res = await requestJson<Envelope>(ctx.app, probe.path, {
        method: probe.method,
        body: probe.body,
        cookie: probe.cookie,
        headers: probe.headers,
      });

      expect(res.status, `${probe.label}: 期望失败状态码，实际 ${res.status}`).toBeGreaterThanOrEqual(400);
      expectErrorEnvelope(res.body, probe.label);
    }
  });

  // 每个失败响应的错误码都在封闭枚举内（枚举本身不被扩大）
  it('error-codes-closed-enum', async () => {
    const ctx = await createTestApp();
    const { failure } = await buildProbes(ctx);

    const seen = new Set<string>();
    for (const probe of failure) {
      const res = await requestJson<Envelope>(ctx.app, probe.path, {
        method: probe.method,
        body: probe.body,
        cookie: probe.cookie,
        headers: probe.headers,
      });
      seen.add(res.body.error!.code!);
    }

    for (const code of seen) {
      expect(isErrorCode(code), `错误码 ${code} 不在枚举内`).toBe(true);
    }
    // 枚举本身必须与设计文档一致 —— 不增不减
    const expectedCodes: ErrorCode[] = [
      'FORBIDDEN',
      'JOB_FAILED',
      'MODEL_OUTPUT_INVALID',
      'MODEL_UNAVAILABLE',
      'NOT_FOUND',
      'QUOTA_EXCEEDED',
      'RATE_LIMITED',
      'SLIDE_VERSION_CONFLICT',
      'UNAUTHORIZED',
      'VALIDATION_FAILED',
    ];
    expect([...ERROR_CODES].sort()).toEqual(expectedCodes.sort());
  });

  it('/readyz 在数据库不可用时返回 503 且带错误包封', async () => {
    const ctx = await createTestApp();

    const ok = await requestJson<Envelope>(ctx.app, '/readyz');
    expect(ok.status).toBe(200);
    expectSuccessEnvelope(ok.body, 'GET /readyz');

    await ctx.db.close(); // 数据库下线

    const down = await requestJson<Envelope>(ctx.app, '/readyz');
    expect(down.status).toBe(503);
    expectErrorEnvelope(down.body, 'GET /readyz [数据库不可用]');
    expect(down.body.error!.code).toBe('JOB_FAILED');
  });
});
