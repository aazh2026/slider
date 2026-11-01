/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SPEC-NFR-001 —— 6 页大纲生成 P95 < 25s
 * ---------------------------------------------------------------------------
 * docs/backend-features.md §N 非功能性需求（NFR）：
 *   > | 大纲生成 P95（6 页） | < 25s |
 *
 * 验证目标（spec/spec.yaml）：apps/api/tests/perf/outline-latency.bench.ts
 *   判据：AC-NFR-001 ——「在评估环境连续采样 ≥ 100 次大纲生成，断言 P95 延迟 < 25000ms」
 *
 * ---------------------------------------------------------------------------
 * **测的是什么**
 *
 * 测的是 `OutlineAgent.generate()` —— 需求 → 逐页大纲（含模型调用、Zod 校验、
 * 硬约束归一化）。这是"大纲生成"这件事本身。
 *
 * 为什么不走 HTTP 端点做 100 次采样：`/api/ai/outline` 挂在**成本限流**上
 * （30 次/分钟，见 apps/api/src/routes/ai.ts）。要采 100 个点，要么改生产配置
 * （那就是为了让基准好看而改系统），要么等 3 分钟以上（基准本身失去意义）。
 * 限流保护的是**模型开销**，不是生成延迟，两者不是一回事。
 * HTTP 侧的额外开销（鉴权 + 信封 + JSON 序列化）单独用一小轮采样测，
 * 见本文件末尾的 `http-端到端开销`。
 *
 * ---------------------------------------------------------------------------
 * **诚实声明 —— 这条基准在什么环境下测的**
 *
 * 两种模式，输出的结论**可信度完全不同**：
 *
 *   1. `real` —— 有真实 GEMINI_API_KEY 且显式设了 `BENCH_REAL_MODEL=1`。
 *      测的是真模型往返延迟。25s 预算主要就是给模型留的，这一轮才有意义。
 *
 *   2. `degraded` —— 模型不可用，测的是**本地确定性降级**路径。
 *      这轮只能证明"降级路径不慢"，**完全不能**证明真实 NFR 达标 ——
 *      因为模型延迟根本没被采样到。此时本文件的 PASS 只对降级路径成立，
 *      对 AC-NFR-001 在真实评估环境下的结论仍是 INCONCLUSIVE。
 *
 * 默认走 `degraded` —— 因为跑 100 次真实模型调用是要真金白银的，
 * 不能因为跑了一次 `bun test` 就自动发生。真实评估环境请显式设置：
 *
 *   BENCH_REAL_MODEL=1 GEMINI_API_KEY=<真实密钥> bun test apps/api/tests/perf/outline-latency.bench.ts
 *
 * 基准文件默认**不**被 `bun test`（无参数）收进默认测试集 —— Bun 的默认
 * 匹配规则不含 `.bench.ts`。它由 spec 里登记的命令显式执行。
 */

import { describe, expect, test } from 'bun:test';

import { SlideOutlineItemSchema } from '@ppt/core';

import { OutlineAgent } from '../../src/services/agents/outlineAgent';
import { GeminiClient } from '../../src/services/geminiClient';
import { ModelRouter } from '../../src/services/modelRouter';
import {
  createTestApp,
  fakeUnavailable,
  FakeModelClient,
  registerUser,
  requestJson,
} from '../helpers';
import {
  collect,
  formatSummary,
  percentile,
  sampleCountFromEnv,
  summarize,
} from './harness';

/** spec 判据要求的最小采样数 */
const REQUIRED_SAMPLES = 100;
/** 判据阈值 */
const THRESHOLD_MS = 25_000;
/** spec 要求的是 6 页大纲 */
const PAGE_COUNT = 6;

type BenchMode = 'real' | 'degraded';

interface BenchSetup {
  agent: OutlineAgent;
  mode: BenchMode;
  /** 模型调用留痕 —— 用来核对"这一轮到底有没有真的打模型" */
  modelCalls: Array<{ ok: boolean; error?: string }>;
}

function requirement(pageCount = PAGE_COUNT) {
  return {
    topic: '新能源汽车电池回收体系',
    purpose: '融资路演',
    audience: '投资人',
    pageCount,
    style: '专业、克制',
    depth: '标准',
    aspectRatio: '16:9' as const,
  };
}

/**
 * 判断能不能跑真实模型
 * ---------------------------------------------------------------------------
 * 三个条件缺一不可：
 *   - `BENCH_REAL_MODEL=1` —— 显式同意烧额度
 *   - 有非空 key
 *   - key 不是仓库里那个占位符（`local-dev-placeholder`）
 */
function detectMode(): { mode: BenchMode; key?: string; reason: string } {
  const key = process.env['GEMINI_API_KEY']?.trim();
  const optedIn = process.env['BENCH_REAL_MODEL'] === '1';

  if (!optedIn) {
    return {
      mode: 'degraded',
      reason: '未设置 BENCH_REAL_MODEL=1 —— 不自动消耗模型额度',
    };
  }
  if (!key) {
    return { mode: 'degraded', reason: 'GEMINI_API_KEY 为空' };
  }
  if (/placeholder/i.test(key)) {
    return {
      mode: 'degraded',
      reason: 'GEMINI_API_KEY 是占位符，不是真实密钥',
    };
  }
  return { mode: 'real', key, reason: '使用真实模型' };
}

async function setup(): Promise<BenchSetup> {
  const detected = detectMode();
  const modelCalls: BenchSetup['modelCalls'] = [];

  if (detected.mode === 'real') {
    const client = new GeminiClient({
      apiKey: detected.key!,
      model: process.env['GEMINI_MODEL'] ?? 'gemini-2.5-flash',
    });
    const router = new ModelRouter({
      clients: [client],
      timeoutMs: Number(process.env['MODEL_TIMEOUT_MS'] ?? 20_000),
      maxRetries: 1,
      maxRepairs: 1,
      onCall: (record) => modelCalls.push({ ok: record.ok, error: record.error }),
    });
    return { agent: new OutlineAgent({ router }), mode: 'real', modelCalls };
  }

  const client = new FakeModelClient(fakeUnavailable());
  const router = new ModelRouter({
    clients: [client],
    timeoutMs: 5_000,
    maxRetries: 1,
    maxRepairs: 1,
    retryBackoffMs: 0,
    onCall: (record) => modelCalls.push({ ok: record.ok, error: record.error }),
  });
  return { agent: new OutlineAgent({ router }), mode: 'degraded', modelCalls };
}

describe('SPEC-NFR-001 大纲生成延迟', () => {
  test('测量仪器自检 —— 最近秩分位数算得对', () => {
    // 已知答案：1..100 的 P95 是第 95 小的样本，也就是 95
    const ramp = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(ramp, 95)).toBe(95);
    expect(percentile(ramp, 50)).toBe(50);
    expect(percentile(ramp, 100)).toBe(100);
    // 单样本
    expect(percentile([42], 95)).toBe(42);
    // n=20 时 ceil(0.95*20)=19 → 第 19 小的样本
    expect(percentile(Array.from({ length: 20 }, (_, i) => i + 1), 95)).toBe(19);
    // 空样本必须抛错，不能静默返回 0（否则"没测到"会被当成"测得很快"）
    expect(() => percentile([], 95)).toThrow();
    // 非法 p
    expect(() => percentile([1, 2], 0)).toThrow();
    expect(() => percentile([1, 2], 101)).toThrow();
  });

  test(
    // 连续采样 ≥ REQUIRED_SAMPLES 次大纲生成，P95 < THRESHOLD_MS
    'outline-generation-p95-under-threshold',
    async () => {
      const samples = sampleCountFromEnv('BENCH_OUTLINE_SAMPLES', REQUIRED_SAMPLES);
      expect(
        samples,
        `采样数必须 ≥ ${REQUIRED_SAMPLES}（AC-NFR-001 明确要求）`
      ).toBeGreaterThanOrEqual(REQUIRED_SAMPLES);

      const { agent, mode, modelCalls } = await setup();

      console.log(`[bench] 大纲生成延迟基准 —— 模式：${mode}（${detectMode().reason}）`);
      if (mode === 'degraded') {
        console.log(
          '[bench] ⚠️ 本轮测的是**本地降级**路径，未采样任何模型往返延迟。' +
            '因此本轮的 PASS 只对降级路径成立；' +
            'AC-NFR-001 在真实评估环境下仍是 INCONCLUSIVE。'
        );
      }

      const req = requirement();
      const { samples: taken, failures } = await collect(samples, async () => {
        const result = await agent.generate(req);
        // 每次采样都必须是**成功生成**的 6 页大纲 —— 否则测的不是生成延迟
        expect(result.outline.length).toBe(PAGE_COUNT);
        for (const item of result.outline) {
          expect(SlideOutlineItemSchema.safeParse(item).success).toBe(true);
        }
        return `${result.source}/${result.degraded ? 'degraded' : 'model'}`;
      });

      // 有失败样本就不是"测到了延迟"，而是"测到了一堆错误"
      expect(
        failures,
        `有 ${failures.length} 次采样失败：${failures
          .slice(0, 3)
          .map((f) => `#${f.index}: ${f.error}`)
          .join(' | ')}`
      ).toHaveLength(0);

      expect(taken.length).toBeGreaterThanOrEqual(REQUIRED_SAMPLES);

      const summary = summarize(taken);
      console.log(formatSummary(`大纲生成（6 页，模式=${mode}）`, summary));

      // 记录模型调用次数 —— degraded 模式下应当是 0 次成功调用
      const okCalls = modelCalls.filter((c) => c.ok).length;
      console.log(`[bench]   模型成功调用次数 = ${okCalls}（总调用 ${modelCalls.length} 次）`);

      // 模式自洽性检查：real 模式必须真的打到了模型，degraded 模式必须一次都没成功
      if (mode === 'real') {
        expect(okCalls, 'real 模式必须真的调用到模型，否则测的不是模型延迟').toBeGreaterThan(0);
      } else {
        expect(okCalls, 'degraded 模式不应有成功的模型调用').toBe(0);
      }

      expect(
        summary.p95,
        `P95 = ${summary.p95.toFixed(1)}ms，超过阈值 ${THRESHOLD_MS}ms`
      ).toBeLessThan(THRESHOLD_MS);
    },
    { timeout: 30 * 60 * 1000 }
  );

  test('http 端到端开销 —— 端点本身的开销相对 25s 预算可忽略', async () => {
    // AI 端点有 30 次/分钟的成本限流，所以这里只采 25 次（留 5 次余量）
    const samples = sampleCountFromEnv('BENCH_OUTLINE_HTTP_SAMPLES', 25);
    expect(samples).toBeLessThanOrEqual(25);

    const ctx = await createTestApp({ model: fakeUnavailable() });
    const user = await registerUser(ctx.app);

    const req = requirement();
    const { samples: taken, failures } = await collect(samples, async () => {
      const res = await requestJson<{ data: { outline: unknown[] } }>(ctx.app, '/api/ai/outline', {
        method: 'POST',
        cookie: user.cookie,
        body: { requirement: req },
      });
      if (res.status !== 200) {
        throw new Error(`HTTP ${res.status}：${JSON.stringify(res.body)}`);
      }
      return undefined;
    });

    expect(failures, `HTTP 采样失败：${failures.slice(0, 3).map((f) => f.error).join(' | ')}`).toHaveLength(0);

    const summary = summarize(taken);
    console.log(formatSummary('大纲生成 HTTP 端到端（降级模式）', summary));

    // 端点开销必须远小于预算 —— 预算要留给模型，不该被框架吃掉
    expect(summary.p95).toBeLessThan(THRESHOLD_MS / 10);
  });
});
