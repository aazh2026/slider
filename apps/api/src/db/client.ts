/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 数据库客户端 —— PostgreSQL（生产）/ PGlite（本地与测试）
 * ---------------------------------------------------------------------------
 * docs/backend-design.md §0：「生产用 PG，本地/测试用 PGlite，**单一 SQL 方言**」。
 * 两种后端都走 Drizzle 的 query builder，业务代码里没有方言分支。
 */

import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { mkdirSync } from 'node:fs';
import postgres from 'postgres';

import * as schema from './schema';
import { DDL_STATEMENTS } from './ddl';
import { databaseKind, pgliteDir, type Env } from '../env';

export type DrizzleDb = PostgresJsDatabase<typeof schema> | PgliteDatabase<typeof schema>;

export interface DbHandle {
  db: DrizzleDb;
  kind: 'pglite' | 'postgres';
  /** 执行一条原生 SQL（建表 / 探针） */
  exec(statement: string): Promise<void>;
  /** 读回查询结果（原生 SQL） */
  query<T = Record<string, unknown>>(statement: string): Promise<T[]>;
  close(): Promise<void>;
}

/** 建表 —— 两种后端跑同一套 DDL */
export async function applyDdl(handle: DbHandle): Promise<void> {
  for (const statement of DDL_STATEMENTS) {
    await handle.exec(statement);
  }
}

/** PGlite（进程内 Postgres） */
export function createPgliteDb(dataDir?: string): DbHandle {
  // PGlite 不会自动创建数据目录 —— 缺失就 ENOENT。
  // `pglite://memory` / `pglite://:memory:` 表示纯内存库（测试用）。
  const target = !dataDir || dataDir === 'memory' || dataDir === ':memory:' ? undefined : dataDir;

  if (target) {
    mkdirSync(target, { recursive: true });
  }

  const client = new PGlite(target);
  const db = drizzlePglite(client, { schema });
  return {
    db,
    kind: 'pglite',
    async exec(statement: string) {
      await client.exec(statement);
    },
    async query<T = Record<string, unknown>>(statement: string): Promise<T[]> {
      const res = await client.query<Record<string, unknown>>(statement);
      return res.rows as T[];
    },
    async close() {
      await client.close();
    },
  };
}

/** 真实 PostgreSQL */
export function createPostgresDb(url: string): DbHandle {
  const client = postgres(url, { max: 10 });
  const db = drizzlePostgres(client, { schema });
  return {
    db,
    kind: 'postgres',
    async exec(statement: string) {
      await client.unsafe(statement);
    },
    async query<T = Record<string, unknown>>(statement: string): Promise<T[]> {
      const res = await client.unsafe(statement);
      return (res as unknown as T[]) ?? [];
    },
    async close() {
      await client.end();
    },
  };
}

/** 按环境变量建库 */
export function createDb(env: Env): DbHandle {
  if (databaseKind(env.DATABASE_URL) === 'pglite') {
    return createPgliteDb(pgliteDir(env.DATABASE_URL));
  }
  return createPostgresDb(env.DATABASE_URL);
}

/** 建库 + 建表 */
export async function createReadyDb(env: Env): Promise<DbHandle> {
  const handle = createDb(env);
  await applyDdl(handle);
  return handle;
}

/** 事务 —— 供「写项目 + 写幻灯片」这类多表写入使用 */
export async function withTransaction<T>(
  handle: DbHandle,
  fn: (tx: DrizzleDb) => Promise<T>
): Promise<T> {
  return handle.db.transaction(async (tx: unknown) => fn(tx as DrizzleDb));
}

/** 探针 —— /readyz 用 */
export async function pingDb(handle: DbHandle): Promise<boolean> {
  try {
    await handle.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export { sql };
