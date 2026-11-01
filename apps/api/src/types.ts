/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hono 上下文类型
 */

import type { Context } from 'hono';

import type { DbHandle } from './db/client';
import type { ModelRouter } from './services/modelRouter';
import type { ProjectRow, SlideRow } from './db/schema';

export interface AppBindings {
  /** 每请求一个的追踪 ID（`req_xxx`） */
  traceId: string;
  /** 当前登录用户 —— 未登录时为 undefined */
  userId?: string;
  /** 当前项目 —— 由 requireProject 中间件装载 */
  project?: ProjectRow;
  /** 当前幻灯片 —— 由 requireSlide 中间件装载 */
  slide?: SlideRow;
  /** 数据库句柄 */
  db: DbHandle;
  /** 模型路由 */
  modelRouter: ModelRouter;
}

export type AppEnv = { Bindings: AppBindings; Variables: AppBindings };

export type AppContext = Context<AppEnv>;

export interface AppServices {
  db: DbHandle;
  modelRouter: ModelRouter;
}
