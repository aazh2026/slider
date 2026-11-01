/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 环境变量校验 —— fail-fast（docs/backend-features.md SEC-06 / docs/backend-design.md §12）
 * ---------------------------------------------------------------------------
 * 「密钥仅在服务端；缺失即启动失败」—— 这里就是那个 fail-fast 的落点。
 *
 * 校验不通过**必须让进程以非零码退出**，而不是降级成「无密钥运行」：
 * 没有密钥的 AI 端点会在第一次调用时才炸，那种炸法会让线上问题变得难以定位。
 */

import { z } from 'zod';

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** 前端地址 —— CORS 白名单 */
  APP_URL: z.string().min(1).default('http://localhost:5173'),
  /**
   * 数据库连接串。
   * `pglite://<dir>` → 进程内 PGlite（本地 / 测试）；`postgres://...` → 真实 PostgreSQL。
   */
  DATABASE_URL: z.string().min(1).default('pglite://./.data/pglite'),
  /**
   * 模型 API Key —— 缺失即启动失败。
   * 提示语必须明确指出**缺的是哪个变量**，否则运维只能靠猜。
   *
   * `error` 覆盖「类型不对/没给」这条路径（含变量完全缺失），
   * `min(1)` 覆盖「给了但为空」—— 两条路径都要说人话。
   */
  GEMINI_API_KEY: z
    .string({
      error:
        'GEMINI_API_KEY 缺失 —— 服务端模型调用无法进行，请配置该环境变量后重启',
    })
    .min(1, 'GEMINI_API_KEY 为空 —— 服务端模型调用无法进行，请配置该环境变量后重启'),
  GEMINI_MODEL: z.string().min(1).default('gemini-2.5-flash'),
  /**
   * 模型端点 —— 不给就用官方地址。
   *
   * 存在的理由是**离线可测**：docs/testing-strategy.md §6.1 要求
   * 「`bun test` 一律使用回放，不烧 API 额度」。E2E 把这个值指向本地替身，
   * 于是它既不依赖外网可达、也不依赖外网快慢 ——
   * 而"外网这次卡了 20 秒"曾经让整条 E2E 变成掷硬币。
   */
  GEMINI_BASE_URL: z.url('GEMINI_BASE_URL 必须是合法 URL').optional(),
  /** 单次模型调用的超时（毫秒） */
  MODEL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(20000),
  /** Session 空闲有效期（天） */
  SESSION_IDLE_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** Session 绝对有效期（天） */
  SESSION_ABSOLUTE_DAYS: z.coerce.number().int().min(1).max(365).default(90),
  SESSION_COOKIE_NAME: z.string().min(1).default('ppt_session'),
  /** 导出产物落盘目录（本地开发用 FS；生产换对象存储） */
  STORAGE_DIR: z.string().min(1).default('./.data/artifacts'),
  /** 限流：每分钟每 IP 的请求数上限 */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(600),
});

export type Env = z.infer<typeof EnvSchema>;

/** 环境变量不合法 —— 启动时抛出，index.ts 捕获后以非零码退出 */
export class EnvValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`环境变量校验失败：\n  - ${issues.join('\n  - ')}`);
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

/**
 * 校验环境变量
 * @param source 环境变量来源（测试里可以注入假来源）
 * @throws EnvValidationError —— 缺失或非法
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new EnvValidationError(
      parsed.error.issues.map((i) => {
        const path = i.path.join('.');
        return path ? `${path}：${i.message}` : i.message;
      })
    );
  }
  return parsed.data;
}

let cached: Env | null = null;

/** 惰性加载并缓存 —— 导入本模块不会因为缺 key 就炸，炸的是启动流程 */
export function getEnv(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}

/** 仅供测试：重置缓存 */
export function resetEnvCache(): void {
  cached = null;
}

/**
 * 判断 DATABASE_URL 指向哪种数据库
 * ---------------------------------------------------------------------------
 * 「生产用 PG，本地/测试用 PGlite，**单一 SQL 方言**」（docs/backend-design.md §0）
 */
export function databaseKind(url: string): 'pglite' | 'postgres' {
  return url.startsWith('pglite://') || url.startsWith('pglite:') ? 'pglite' : 'postgres';
}

/** PGlite 的数据目录（`pglite://./.data/pglite` → `./.data/pglite`） */
export function pgliteDir(url: string): string | undefined {
  if (!url.startsWith('pglite://')) return undefined;
  const dir = url.slice('pglite://'.length);
  return dir.length > 0 ? dir : undefined;
}
