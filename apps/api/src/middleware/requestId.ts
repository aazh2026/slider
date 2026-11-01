/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 请求追踪 —— 每个请求一个 traceId，贯穿日志、错误包封与响应头
 */

import type { MiddlewareHandler } from 'hono';

import type { AppEnv } from '../types';

export function newTraceId(): string {
  return `req_${crypto.randomUUID().replace(/-/g, '')}`;
}

export const requestId: MiddlewareHandler<AppEnv> = async (c, next) => {
  const traceId = newTraceId();
  c.set('traceId', traceId);
  c.header('x-trace-id', traceId);
  await next();
};
