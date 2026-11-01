/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SPEC-NFR-002 —— 12 页演示文稿整本 PPTX 导出 P95 < 45s
 * ---------------------------------------------------------------------------
 * docs/backend-features.md §N 非功能性需求（NFR）：
 *   > | 整本 PPTX 导出（12 页） | < 45s |
 *
 * 验证目标（spec/spec.yaml）：apps/api/tests/perf/export-latency.bench.ts
 *   判据：AC-NFR-002 ——「连续导出 12 页演示文稿 ≥ 20 次，断言 P95 导出耗时 < 45000ms」
 *
 * ---------------------------------------------------------------------------
 * **测的是什么**
 *
 * 测的是**用户视角的端到端导出耗时**：从 `POST /api/exports` 建任务，
 * 到 `GET /api/exports/:id` 报 `succeeded`（产物已落盘、artifact 已入库）。
 *
 * 这条链路包含：PPTX 渲染（pptxgenjs，把 IR 里的每个元素变成形状）
 * + 产物写盘 + artifacts 表写入。产物落盘和入库都在"导出完成"的语义里 ——
 * 用户拿到下载链接的那一刻，这些必须已经就绪。
 *
 * 12 页的演示文稿由本地大纲 + 版式引擎生成（模型不可用时的确定性路径）。
 * **这里测的是导出管线，不是模型**：NFR 的预算 45s 是给渲染管线的，
 * 不该被模型耗时污染，所以导出基准固定用确定性内容。
 *
 * 基准文件默认**不**被 `bun test`（无参数）收进默认测试集 —— Bun 的默认
 * 匹配规则不含 `.bench.ts`。它由 spec 里登记的命令显式执行。
 */

import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { compileProject, createProject, createTestApp, registerUser, requestJson } from '../helpers';
import {
  collect,
  formatSummary,
  percentile,
  sampleCountFromEnv,
  summarize,
} from './harness';

/** spec 判据要求的最小导出次数 */
const REQUIRED_SAMPLES = 20;
/** 判据阈值 */
const THRESHOLD_MS = 45_000;
/** spec 要求的是 12 页 */
const PAGE_COUNT = 12;

/** 12 页的确定性需求 */
const REQUIREMENT = {
  topic: '新能源汽车电池回收体系',
  purpose: '融资路演',
  audience: '投资人',
  pageCount: PAGE_COUNT,
  style: '专业、克制',
  depth: '标准',
  aspectRatio: '16:9' as const,
};

interface ExportJob {
  id: string;
  status: string;
  error?: string | null;
}

describe('SPEC-NFR-002 整本 PPTX 导出延迟', () => {
  test('测量仪器自检 —— 最近秩分位数算得对', () => {
    const ramp = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(ramp, 95)).toBe(95);
    expect(percentile(ramp, 50)).toBe(50);
    expect(percentile([42], 95)).toBe(42);
    expect(() => percentile([], 95)).toThrow();
  });

  test(
    // 连续导出 12 页演示文稿 ≥ REQUIRED_SAMPLES 次，P95 < THRESHOLD_MS
    'pptx-export-p95-under-threshold',
    async () => {
      const samples = sampleCountFromEnv('BENCH_EXPORT_SAMPLES', REQUIRED_SAMPLES);
      expect(
        samples,
        `导出次数必须 ≥ ${REQUIRED_SAMPLES}（AC-NFR-002 明确要求）`
      ).toBeGreaterThanOrEqual(REQUIRED_SAMPLES);

      // 产物落盘目录 —— 用临时目录，别把基准产物写进仓库
      const storageDir = await mkdtemp(join(tmpdir(), 'ppt-bench-export-'));
      const previousStorage = process.env['STORAGE_DIR'];
      process.env['STORAGE_DIR'] = storageDir;

      try {
        const ctx = await createTestApp();
        const user = await registerUser(ctx.app);
        const projectId = await createProject(ctx.app, user.cookie, '导出基准项目', REQUIREMENT);
        const slides = await compileProject(ctx.app, user.cookie, projectId, REQUIREMENT);

        expect(
          slides.length,
          `基准必须是一份 ${PAGE_COUNT} 页的演示文稿`
        ).toBe(PAGE_COUNT);

        const { samples: taken, failures } = await collect(samples, async () => {
          // 建任务
          const created = await requestJson<{ data: { job: { id: string } } }>(
            ctx.app,
            '/api/exports',
            {
              method: 'POST',
              cookie: user.cookie,
              body: { projectId, format: 'pptx' },
            }
          );
          if (created.status !== 202) {
            throw new Error(`创建导出任务失败：HTTP ${created.status} ${JSON.stringify(created.body)}`);
          }
          const jobId = created.body.data.job.id;

          // 轮询到终态
          const started = Date.now();
          for (;;) {
            const statusRes = await requestJson<{ data: { job: ExportJob } }>(
              ctx.app,
              `/api/exports/${jobId}`,
              { cookie: user.cookie }
            );
            if (statusRes.status !== 200) {
              throw new Error(`查询任务状态失败：HTTP ${statusRes.status}`);
            }
            const job = statusRes.body.data.job;
            if (job.status === 'succeeded') break;
            if (job.status === 'failed' || job.status === 'cancelled') {
              throw new Error(`导出任务失败：${job.status} ${job.error ?? ''}`);
            }
            if (Date.now() - started > THRESHOLD_MS * 2) {
              throw new Error(`导出任务在 ${THRESHOLD_MS * 2}ms 内没有到达终态`);
            }
            await Bun.sleep(100);
          }

          // 产物必须真的可下载 —— 否则"完成"只是个状态字段
          const download = await ctx.app.request(`/api/exports/${jobId}/download`, {
            headers: { cookie: user.cookie },
          });
          if (download.status !== 200) {
            throw new Error(`产物下载失败：HTTP ${download.status}`);
          }
          const bytes = new Uint8Array(await download.arrayBuffer());
          if (bytes.byteLength === 0) {
            throw new Error('产物是空文件');
          }
          // PPTX 是 zip 容器 —— 头两个字节必须是 PK
          if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
            throw new Error(`产物不是合法的 PPTX（magic=${bytes[0]},${bytes[1]}）`);
          }
          return `${bytes.byteLength}B`;
        });

        expect(
          failures,
          `有 ${failures.length} 次导出失败：${failures
            .slice(0, 3)
            .map((f) => `#${f.index}: ${f.error}`)
            .join(' | ')}`
        ).toHaveLength(0);

        expect(taken.length).toBeGreaterThanOrEqual(REQUIRED_SAMPLES);

        const summary = summarize(taken);
        console.log(formatSummary(`整本 PPTX 导出（${PAGE_COUNT} 页）`, summary));

        expect(
          summary.p95,
          `P95 = ${summary.p95.toFixed(1)}ms，超过阈值 ${THRESHOLD_MS}ms`
        ).toBeLessThan(THRESHOLD_MS);
      } finally {
        if (previousStorage === undefined) delete process.env['STORAGE_DIR'];
        else process.env['STORAGE_DIR'] = previousStorage;
        await rm(storageDir, { recursive: true, force: true });
      }
    },
    { timeout: 30 * 60 * 1000 }
  );
});
