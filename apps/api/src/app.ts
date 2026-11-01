/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 应用装配（docs/backend-design.md §5.2）
 * ---------------------------------------------------------------------------
 * 中间件顺序（有依赖，不能随意换）：
 *   1. cors        —— 必须在最前，否则预检请求拿不到 CORS 头
 *   2. requestId   —— 每个请求一个 traceId，后续所有日志/错误都带着它
 *   3. inject      —— 把 db / modelRouter 注入 context
 *   4. onError     —— 任何未捕获异常都变成 { error, traceId }
 *   5. loadSession —— 读 Cookie 认用户（不强制登录）
 *   6. 限流        —— 全局限流兜底
 *
 * **路由注册一律挂 `/api` 前缀**；`/healthz`、`/readyz` 例外（探针路径固定）。
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { errorHandler } from './middleware/errorHandler';
import { requestId } from './middleware/requestId';
import { loadSession } from './middleware/auth';
import { rateLimit } from './middleware/rateLimit';

import { authRoutes } from './routes/auth';
import { projectRoutes } from './routes/projects';
import { aiRoutes } from './routes/ai';
import { templateRoutes } from './routes/templates';
import { qualityRoutes } from './routes/quality';
import { exportRoutes } from './routes/exports';
import { documentRoutes } from './routes/documents';
import { systemRoutes } from './routes/system';

import type { AppEnv, AppServices } from './types';

export function createApp(services: AppServices): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const appUrl = process.env['APP_URL'] ?? 'http://localhost:5173';
  const allowedOrigins = appUrl
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.use(
    '*',
    cors({
      origin: (origin) => {
        // 无 Origin（同源请求 / curl / 服务端调用）→ 放行
        if (!origin) return origin;
        return allowedOrigins.includes(origin) ? origin : allowedOrigins[0] ?? origin;
      },
      credentials: true,
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'x-trace-id'],
      exposeHeaders: ['x-trace-id'],
    })
  );

  app.use('*', requestId);

  // 依赖注入 —— db / modelRouter 在每个请求里可见
  app.use('*', async (c, next) => {
    c.set('db', services.db);
    c.set('modelRouter', services.modelRouter);
    await next();
  });

  app.onError(errorHandler);

  app.use('*', loadSession);

  // 全局限流兜底 —— AI 端点另有更严格的独立限流
  // `name` 让各限流器的额度互相隔离 —— 否则 AI 限流会被全局限流"预扣"额度
  const globalLimit = Number(process.env['RATE_LIMIT_PER_MINUTE'] ?? 600);
  app.use('/api/*', rateLimit({ limit: globalLimit, windowMs: 60_000, name: 'global' }));

  // 探针 —— 固定路径，不带 /api 前缀
  app.route('/', systemRoutes);

  // 业务路由
  app.route('/api/auth', authRoutes);
  app.route('/api/projects', projectRoutes);
  app.route('/api/ai', aiRoutes);
  app.route('/api/templates', templateRoutes);
  app.route('/api/quality', qualityRoutes);
  app.route('/api/exports', exportRoutes);
  app.route('/api', documentRoutes);

  app.notFound((c) =>
    c.json(
      {
        error: { code: 'NOT_FOUND', message: '接口不存在' },
        traceId: c.get('traceId'),
      },
      404
    )
  );

  return app;
}

export type { AppEnv };
