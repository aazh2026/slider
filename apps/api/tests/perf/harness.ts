/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 性能基准的公共测量工具
 * ---------------------------------------------------------------------------
 * 基准文件最大的风险不是"跑得慢"，而是**测出来的数不是要测的数**。
 * 所以这里把测量仪器本身单独拿出来：
 *
 *   - `percentile` 用**最近秩法**（nearest-rank）算分位数 —— 定义写死在代码里，
 *     不依赖任何统计库的口径差异；
 *   - `summarize` 把样本数 / min / p50 / p95 / max 一次性摊开，
 *     让"只报一个 P95"的报告没法掩盖样本量不足。
 *
 * 每个基准文件都必须先跑一遍 `percentile` 的**已知答案**自检：
 * 测量仪器本身没被验证过，就不能拿它的输出当证据。
 */

/** 一次采样 */
export interface Sample {
  /** 耗时（毫秒） */
  durationMs: number;
  /** 该次采样的标签 —— 例如失败原因 */
  label?: string;
}

export interface Summary {
  count: number;
  min: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
}

/**
 * 最近秩法分位数
 * ---------------------------------------------------------------------------
 * 定义：`P(p)` = 升序排序后第 `ceil(p/100 × n)` 个样本。
 * n=100 时 P95 就是第 95 小的样本（不是插值出来的 95.05）。
 *
 * 选这个口径而不是插值法，是因为它**总是等于某个真实观测到的样本**——
 * 报告出来的 P95 一定对应一次真实发生的请求。
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new Error('空样本无法计算分位数');
  if (p <= 0 || p > 100) throw new Error(`分位数 p 必须落在 (0, 100]，收到 ${p}`);

  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.min(Math.max(rank, 1), sorted.length) - 1;
  return sorted[idx]!;
}

/** 汇总一组采样 */
export function summarize(samples: readonly Sample[]): Summary {
  const values = samples.map((s) => s.durationMs);
  if (values.length === 0) throw new Error('空采样无法汇总');
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    count: values.length,
    min: Math.min(...values),
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: Math.max(...values),
    mean: sum / values.length,
  };
}

/** 把汇总打印成一行行便于人读的文本 */
export function formatSummary(title: string, s: Summary): string {
  return [
    `[bench] ${title}`,
    `[bench]   样本数 = ${s.count}`,
    `[bench]   min=${s.min.toFixed(1)}ms  p50=${s.p50.toFixed(1)}ms  p95=${s.p95.toFixed(1)}ms  max=${s.max.toFixed(1)}ms  mean=${s.mean.toFixed(1)}ms`,
  ].join('\n');
}

/**
 * 采样循环
 * ---------------------------------------------------------------------------
 * `body` 返回一个标签字符串；抛异常则该次采样记为失败并带上错误信息。
 * 失败不会中断整轮采样 —— 但失败次数会作为一个显式返回值交给调用方断言。
 */
export async function collect(
  count: number,
  body: (index: number) => Promise<string | undefined>
): Promise<{ samples: Sample[]; failures: Array<{ index: number; error: string }> }> {
  const samples: Sample[] = [];
  const failures: Array<{ index: number; error: string }> = [];

  for (let i = 0; i < count; i++) {
    const started = performance.now();
    try {
      const label = await body(i);
      samples.push({ durationMs: performance.now() - started, label });
    } catch (err) {
      failures.push({
        index: i,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { samples, failures };
}

/** 环境变量里的采样次数 —— 允许调小以做冒烟，但基准判定要求不低于 spec 规定的最小值 */
export function sampleCountFromEnv(envKey: string, fallback: number): number {
  const raw = process.env[envKey];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${envKey} 必须是正整数，收到 "${raw}"`);
  }
  return Math.floor(parsed);
}
