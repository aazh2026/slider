/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 系统路由（docs/backend-design.md §5.2 / §10）
 * ---------------------------------------------------------------------------
 *   GET /healthz        进程存活 —— 不查 DB，探针用
 *   GET /readyz         就绪 —— 查 DB，能接流量才返回 200
 *   GET /api/meta/models 可用模型与降级链信息
 *
 * **这些端点不返回密钥，也不返回任何凭据**（SEC-06）。
 */

import { Hono } from 'hono';
import { sql } from 'drizzle-orm';

import { pingDb } from '../db/client';
import { respond } from './_helpers';
import type { AppEnv } from '../types';

export const systemRoutes = new Hono<AppEnv>();

/** 存活探针 —— 只说明进程在，不做任何 IO */
systemRoutes.get('/healthz', (c) => {
  return respond(c, { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) });
});

/** 就绪探针 —— DB 通了才算就绪 */
systemRoutes.get('/readyz', async (c) => {
  const db = c.get('db');
  const ok = await pingDb(db);
  if (!ok) {
    return c.json(
      {
        error: { code: 'JOB_FAILED', message: '数据库不可用' },
        traceId: c.get('traceId'),
      },
      503
    );
  }
  return respond(c, { status: 'ready', database: db.kind });
});

/** 模型清单 —— 前端用来显示「当前用哪个模型 / 会不会降级」 */
systemRoutes.get('/api/meta/models', (c) => {
  const model = process.env['GEMINI_MODEL'] ?? 'gemini-2.5-flash';
  const hasKey = Boolean(process.env['GEMINI_API_KEY']);
  return respond(c, {
    models: [
      {
        id: model,
        provider: 'gemini',
        /** 密钥缺失时，模型调用会整体走本地确定性降级 */
        available: hasKey,
        role: 'primary',
      },
    ],
    degradation: {
      /** 降级链 —— 全部失败后走本地确定性实现，不返回 5xx 给用户 */
      localFallback: true,
      localFallbackScope: ['requirement', 'outline', 'edit'],
    },
  });
});

/** 探活 SQL —— 供 readyz 复用（保留导出以便测试直接调用） */
export const READY_PROBE_SQL = sql`SELECT 1`;
