/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 限流中间件
 * ---------------------------------------------------------------------------
 * 滑动窗口计数（按用户，匿名按 IP）。超限返回 429 RATE_LIMITED。
 *
 * 文档 §6.5 把 `model_calls` 作为限流的基础数据源；这里用的是进程内计数器，
 * 语义等价且不引入 Redis。**多实例部署时每个实例各算各的** —— 这是已知限制，
 * 需要全局精确配额时应换成 DB 计数。
 */

import type { MiddlewareHandler } from 'hono';

import { ApiError } from '../errors';
import type { AppEnv } from '../types';

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();

/** 清理过期条目，避免 Map 无限增长 */
function sweep(windowMs: number, now: number): void {
  for (const [key, bucket] of buckets) {
    bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
    if (bucket.hits.length === 0) buckets.delete(key);
  }
}

export interface RateLimitOptions {
  /** 窗口内最大请求数 */
  limit: number;
  /** 窗口长度（毫秒） */
  windowMs?: number;
  /** 命中不同的 key（默认：用户 id，匿名用 IP） */
  keyOf?: (c: Parameters<MiddlewareHandler<AppEnv>>[0]) => string;
  /**
   * 限流器名字 —— **不同限流器的计数桶必须互相隔离**
   * ---------------------------------------------------------------------------
   * 不传就用自动分配的序号做命名空间。命名空间不是可有可无的：
   * 全局限流、AI 限流、上传限流、模板限流如果共用同一个桶，
   * 它们的额度会互相扣 —— 表现为"配置写 30 次/分钟，实际只能跑 15 次"
   * （每次请求先被全局限流记一次，再被 AI 限流记一次）。
   */
  name?: string;
}

/** 限流器序号 —— 给每个未命名的限流器一个独立命名空间 */
let limiterSeq = 0;

export function rateLimit(opts: RateLimitOptions): MiddlewareHandler<AppEnv> {
  const windowMs = opts.windowMs ?? 60_000;
  const namespace = opts.name ?? `rl${++limiterSeq}`;
  const keyOf =
    opts.keyOf ??
    ((c: Parameters<MiddlewareHandler<AppEnv>>[0]) =>
      c.get('userId') ?? `ip:${c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'}`);

  return async (c, next) => {
    const now = Date.now();
    // 命名空间 + 命中键 —— 不同限流器的额度互不影响
    const key = `${namespace}:${keyOf(c)}`;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { hits: [] };
      buckets.set(key, bucket);
    }

    bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

    if (bucket.hits.length >= opts.limit) {
      const retryAfterSec = Math.ceil(
        (windowMs - (now - bucket.hits[0]!)) / 1000
      );
      c.header('retry-after', String(Math.max(1, retryAfterSec)));
      throw ApiError.rateLimited('请求过于频繁，请稍后再试', { retryAfterSec });
    }

    bucket.hits.push(now);

    // 顺手清理 —— 摊销成本，避免每次请求都全表扫
    if (buckets.size > 1000) sweep(windowMs, now);

    await next();
  };
}

/** 测试用 —— 清空计数 */
export function resetRateLimits(): void {
  buckets.clear();
}
