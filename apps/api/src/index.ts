/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 服务入口（docs/backend-design.md §5.2 / §12）
 * ---------------------------------------------------------------------------
 * **启动即 fail-fast**：环境变量不合法（尤其是 GEMINI_API_KEY 缺失）时，
 * 进程必须以非零码退出，并在日志里说清楚缺的是哪个变量。
 *
 * 为什么不能「缺了也跑」：没有密钥的 AI 端点会在第一次真实调用时才炸，
 * 那种炸法会把配置问题伪装成供应商问题，排查成本高一个数量级。
 * （AC-API-005）
 */

import { createApp } from './app';
import { EnvValidationError, loadEnv, type Env } from './env';
import { createReadyDb, type DbHandle } from './db/client';
import { modelCalls } from './db/schema';
import { ModelRouter, type ModelCallRecord } from './services/modelRouter';
import { GeminiClient } from './services/geminiClient';

/** 启动失败 —— 打印可操作的提示后以非零码退出 */
function failStartup(message: string, detail?: string): never {
  console.error(`[启动失败] ${message}`);
  if (detail) console.error(detail);
  process.exit(1);
}

async function main(): Promise<void> {
  let env: Env;
  try {
    env = loadEnv();
  } catch (err) {
    if (err instanceof EnvValidationError) {
      failStartup(
        '环境变量校验失败。',
        `${err.message}\n请参考仓库根目录 .env.example 配置后重启。`
      );
    }
    throw err;
  }

  // 数据库 —— 建库 + 建表
  let db: DbHandle;
  try {
    db = await createReadyDb(env);
  } catch (err) {
    failStartup(
      `数据库初始化失败（DATABASE_URL=${env.DATABASE_URL}）。`,
      err instanceof Error ? err.stack ?? err.message : String(err)
    );
  }

  // 模型路由 —— primary 只有 Gemini；后续可加 Anthropic/OpenAI 作为 secondary
  const gemini = new GeminiClient({
    apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL,
    // 测试可指向本地替身（离线）—— 见 env.ts 里 GEMINI_BASE_URL 的说明
    baseUrl: env.GEMINI_BASE_URL,
  });

  const recordCall = (record: ModelCallRecord): void => {
    // 留痕是「尽力而为」—— 写库失败不能影响主流程
    void db.db
      .insert(modelCalls)
      .values({
        agent: record.agent,
        provider: record.provider,
        model: record.model,
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens,
        latencyMs: record.latencyMs,
        ok: record.ok,
        error: record.error,
      })
      .catch((err) => {
        console.error('[model_calls] 留痕写入失败：', err instanceof Error ? err.message : err);
      });
  };

  const modelRouter = new ModelRouter({
    clients: [gemini],
    timeoutMs: env.MODEL_TIMEOUT_MS,
    onCall: recordCall,
  });

  const app = createApp({ db, modelRouter });

  const server = Bun.serve({
    port: env.PORT,
    fetch: app.fetch,
  });

  console.log(
    JSON.stringify({
      level: 'info',
      message: 'AI PPT Studio API 已启动',
      url: `http://localhost:${server.port}`,
      database: db.kind,
      model: env.GEMINI_MODEL,
      appUrl: env.APP_URL,
    })
  );

  const shutdown = async (signal: string): Promise<void> => {
    console.log(JSON.stringify({ level: 'info', message: `收到 ${signal}，正在关闭` }));
    await server.stop(true);
    await db.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  failStartup('未捕获的启动异常。', err instanceof Error ? (err.stack ?? err.message) : String(err));
});
