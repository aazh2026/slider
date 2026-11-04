/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * `POST /api/projects/import` —— 导入端必须**校验**它认的那份形状
 * ---------------------------------------------------------------------------
 * 这个文件存在的原因：
 *
 *   导入端的 schema 原本是 `slides: z.array(z.unknown()).optional()` ——
 *   **一个字段都不校验**，`slides` 本身还允许缺省。于是：
 *
 *     · `orderIndex` 重复   → `listSlides` 按 orderIndex 排序，
 *                             同键的行顺序由数据库说了算 —— 导出的页序**丢了**
 *                             （"导出去能再导回来，中间不丢东西"这句话当场失效），
 *                             而且**没有任何报错**
 *     · `orderIndex` 为 0 / 负数 → 违反领域内核的契约
 *                             （`packages/core/src/contracts/outline.ts`：
 *                              `order: z.number().int().min(1)`）
 *     · 字段缺失 → NOT NULL / 唯一约束在数据库里炸 → 客户端拿到 **500**，
 *                             而不是入参问题该有的 **400**
 *     · 整个 `slides` 缺失 → 被当成空项目导进去，页数 0
 *
 *   这**不是**实现细节的自由发挥 —— 源文档写明了：
 *     · docs/backend-features.md PRJ-07：
 *       「校验 `slides`/`name` 字段合法性；非法文件返回明确错误而非崩溃」
 *     · docs/test-cases.md TC-CONTRACT-034~036：
 *       `POST /api/projects/import` → 201 / 400 非法 JSON / **400 缺 slides 字段**
 *
 *   也就是说：文档早就要求校验，实现一直没做。
 *
 * ---------------------------------------------------------------------------
 * **为什么这里不断言「页码从 0 还是从 1 开始」**：
 *
 *   页序基线在五份设计文档里从未被规定，唯一能定住它的是领域内核的契约
 *   `packages/core/src/contracts/outline.ts`：`order: z.number().int().min(1)` —— 1-based。
 *   但导入端要保证的是**页序本身**，不是某个具体数字：
 *   导出的第 1 页，导入后还得是第 1 页。
 *   所以这里断言的是「导入前后页序一致」与「坏形状被 400 挡下」。
 */

import { describe, expect, test } from 'bun:test';

import {
  compileProject,
  createProject,
  createTestApp,
  registerUser,
  requestJson,
  type TestContext,
} from '../helpers';

interface BundleSlide {
  slideId: string;
  orderIndex: number;
  ir: unknown;
}

interface Bundle {
  name: string;
  requirement: unknown;
  template: unknown;
  outline: unknown[];
  slides: BundleSlide[];
}

/** 造一个应用 + 用户 + 已编译的项目，返回它的 bundle（导出端的真实产物） */
async function makeBundle(): Promise<{
  ctx: TestContext;
  cookie: string;
  bundle: Bundle;
}> {
  const ctx = await createTestApp();
  const { cookie } = await registerUser(ctx.app);
  const projectId = await createProject(ctx.app, cookie, '导入源项目');
  await compileProject(ctx.app, cookie, projectId);

  const res = await requestJson<{ data: { bundle: Bundle } }>(
    ctx.app,
    `/api/projects/${projectId}/export`,
    { cookie }
  );
  if (res.status !== 200) {
    throw new Error(`取 bundle 失败：${res.status} ${JSON.stringify(res.body)}`);
  }
  return { ctx, cookie, bundle: res.body.data.bundle };
}

/** 发一次导入，返回状态码与错误码 */
async function importBundle(
  ctx: TestContext,
  cookie: string,
  body: unknown
): Promise<{ status: number; code: string }> {
  const res = await requestJson<{ error?: { code: string } }>(ctx.app, '/api/projects/import', {
    method: 'POST',
    cookie,
    body,
  });
  return { status: res.status, code: res.body.error?.code ?? '' };
}

describe('导入端认 bundle 的形状', () => {
  test('exported-bundle-round-trips-with-page-order-intact', async () => {
    // 导出的 bundle 能原样导回去，且页序不变（docs/test-cases.md TC-EXP-023）
    const { ctx, cookie, bundle } = await makeBundle();

    const res = await requestJson<{ data: { project: { id: string } } }>(
      ctx.app,
      '/api/projects/import',
      { method: 'POST', cookie, body: bundle }
    );
    expect(res.status).toBe(201);

    // 导入后读回来，页序必须和源项目一致
    const detail = await requestJson<{
      data: { project: { slides: Array<{ slideId: string; orderIndex: number }> } };
    }>(ctx.app, `/api/projects/${res.body.data.project.id}`, { cookie });
    expect(detail.status).toBe(200);

    const sourceOrder = bundle.slides.map((s) => s.slideId);
    const importedOrder = detail.body.data.project.slides.map((s) => s.slideId);
    expect(importedOrder).toEqual(sourceOrder);
  });

  test('page-order-baseline-is-one', async () => {
    // 页序基线是 1 —— packages/core/src/contracts/outline.ts：order: z.number().int().min(1)
    const { bundle } = await makeBundle();
    expect(bundle.slides[0]!.orderIndex).toBe(1);
  });
});

describe('导入端挡下坏形状 —— 缺陷回放', () => {
  test('duplicate-order-index-is-rejected', async () => {
    // 重复的 orderIndex 会让排序键相同 —— 页序从此由数据库决定（静默的数据损坏）
    const { ctx, cookie, bundle } = await makeBundle();
    const broken = {
      ...bundle,
      slides: bundle.slides.map((s, i) =>
        i === 1 ? { ...s, orderIndex: bundle.slides[0]!.orderIndex } : s
      ),
    };

    const res = await importBundle(ctx, cookie, broken);
    expect(res.status).toBe(400);
    expect(res.code).toBe('VALIDATION_FAILED');
  });

  test('zero-order-index-is-rejected', async () => {
    const { ctx, cookie, bundle } = await makeBundle();
    const broken = {
      ...bundle,
      slides: bundle.slides.map((s, i) => (i === 0 ? { ...s, orderIndex: 0 } : s)),
    };

    const res = await importBundle(ctx, cookie, broken);
    expect(res.status).toBe(400);
  });

  test('negative-order-index-is-rejected', async () => {
    const { ctx, cookie, bundle } = await makeBundle();
    const broken = {
      ...bundle,
      slides: bundle.slides.map((s, i) => (i === 0 ? { ...s, orderIndex: -1 } : s)),
    };

    const res = await importBundle(ctx, cookie, broken);
    expect(res.status).toBe(400);
  });

  test('non-integer-order-index-is-rejected', async () => {
    const { ctx, cookie, bundle } = await makeBundle();
    const broken = {
      ...bundle,
      slides: bundle.slides.map((s, i) => (i === 0 ? { ...s, orderIndex: 1.5 } : s)),
    };

    const res = await importBundle(ctx, cookie, broken);
    expect(res.status).toBe(400);
  });

  test('missing-order-index-is-rejected', async () => {
    // 缺字段曾经是 500（NOT NULL 约束炸掉）—— 入参问题不该是服务端错误
    const { ctx, cookie, bundle } = await makeBundle();
    const broken = {
      ...bundle,
      slides: bundle.slides.map((s, i) => {
        if (i !== 0) return s;
        const { orderIndex: _dropped, ...rest } = s;
        return rest as BundleSlide;
      }),
    };

    const res = await importBundle(ctx, cookie, broken);
    expect(res.status).toBe(400);
    expect(res.code).toBe('VALIDATION_FAILED');
  });

  test('missing-slide-id-is-rejected', async () => {
    const { ctx, cookie, bundle } = await makeBundle();
    const broken = {
      ...bundle,
      slides: bundle.slides.map((s, i) => {
        if (i !== 0) return s;
        const { slideId: _dropped, ...rest } = s;
        return rest as BundleSlide;
      }),
    };

    const res = await importBundle(ctx, cookie, broken);
    expect(res.status).toBe(400);
  });

  test('duplicate-slide-id-is-rejected', async () => {
    // DB 里有唯一约束 —— 不该让它炸成 500
    const { ctx, cookie, bundle } = await makeBundle();
    const broken = {
      ...bundle,
      slides: bundle.slides.map((s, i) =>
        i === 1 ? { ...s, slideId: bundle.slides[0]!.slideId } : s
      ),
    };

    const res = await importBundle(ctx, cookie, broken);
    expect(res.status).toBe(400);
  });

  test('missing-ir-is-rejected', async () => {
    const { ctx, cookie, bundle } = await makeBundle();
    const broken = {
      ...bundle,
      slides: bundle.slides.map((s, i) => {
        if (i !== 0) return s;
        const { ir: _dropped, ...rest } = s;
        return rest as BundleSlide;
      }),
    };

    const res = await importBundle(ctx, cookie, broken);
    expect(res.status).toBe(400);
  });

  test('non-array-slides-is-rejected', async () => {
    const { ctx, cookie, bundle } = await makeBundle();
    const res = await importBundle(ctx, cookie, { ...bundle, slides: 'not-an-array' });
    expect(res.status).toBe(400);
  });

  test('missing-slides-field-is-rejected', async () => {
    // docs/test-cases.md TC-CONTRACT-034~036 —— 「400 缺 slides 字段」
    // 原来这里是 `.optional()`，缺 slides 的文件会被当成**空项目**导进去
    const { ctx, cookie, bundle } = await makeBundle();
    const { slides: _dropped, ...withoutSlides } = bundle;

    const res = await importBundle(ctx, cookie, withoutSlides);
    expect(res.status).toBe(400);
    expect(res.code).toBe('VALIDATION_FAILED');
  });

  test('missing-name-field-is-rejected', async () => {
    // docs/backend-features.md PRJ-07 —— 「校验 slides/name 字段合法性」
    const { ctx, cookie, bundle } = await makeBundle();
    const { name: _dropped, ...withoutName } = bundle;

    const res = await importBundle(ctx, cookie, withoutName);
    expect(res.status).toBe(400);
  });

  test('invalid-json-body-is-rejected', async () => {
    // docs/test-cases.md TC-CONTRACT-035 —— 「400 非法 JSON」
    // 注意要带上会话 —— 鉴权中间件跑在 body 解析之前，
    // 没登录的话拿到的是 401（那是另一件事，不是这个用例要验的）。
    const ctx = await createTestApp();
    const { cookie } = await registerUser(ctx.app);

    const res = await requestJson<{ error?: { code: string } }>(
      ctx.app,
      '/api/projects/import',
      {
        method: 'POST',
        cookie,
        rawBody: '{ 这不是 JSON',
        headers: { 'content-type': 'application/json' },
      }
    );
    expect(res.status).toBe(400);
  });
});
