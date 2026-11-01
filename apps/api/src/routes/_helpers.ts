/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 路由公共工具
 */

import type { ContentfulStatusCode } from 'hono/utils/http-status';

import { ApiError, ok } from '../errors';
import type { AppContext } from '../types';

/** 统一成功包封 —— { data, traceId } */
export function respond<T>(c: AppContext, data: T, status: ContentfulStatusCode = 200) {
  return c.json(ok(data, c.get('traceId')), status);
}

/** 取当前用户 id —— 未登录直接抛 401 */
export function requireUserId(c: AppContext): string {
  const userId = c.get('userId');
  if (!userId) throw ApiError.unauthorized('请先登录');
  return userId;
}
