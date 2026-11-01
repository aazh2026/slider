/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ModelRouter —— 多模型路由与降级链（docs/backend-design.md §6.1）
 * ---------------------------------------------------------------------------
 * 路由策略：
 *   1. 按 agent 的能力需求选择模型
 *   2. 成本优先：默认 Flash / Haiku 级模型，`extract` 与 `edit` 升级到强模型
 *   3. **降级链**：`primary → secondary → 本地确定性实现`
 *   4. **重试**：仅对 429 / 5xx / 超时重试（指数退避 + 抖动），不对 4xx 参数错误重试
 *   5. **输出修复**：输出非法 → 把报错回灌给模型要求修复（最多 2 次）
 *
 * **失败分两类**（决定调用方是降级还是报错）：
 *   - `ModelUnavailableError`     模型不可用（网络 / 5xx / 超时 / 配额）→ 走本地降级
 *   - `ModelOutputInvalidError`   模型响应了但输出非法 → **显式报错**，不用降级掩盖
 *
 * **模型输出永远经过 Zod 校验后才进入系统**（§12 安全）——
 * 校验在这一层做，而不是在各个 Agent 里各写一遍。
 */

import type { ZodType } from 'zod';

export type AgentName = 'requirement' | 'outline' | 'edit' | 'extract';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelRequest {
  messages: ChatMessage[];
  /** 由 Zod schema 生成的 JSON Schema —— 启用厂商的结构化输出 */
  responseSchema?: Record<string, unknown>;
  /** Zod schema —— 输出必须通过它才会被交出去 */
  parse?: ZodType;
  maxTokens?: number;
  temperature?: number;
  /** 上下文缓存：把稳定前缀标记为可缓存 */
  cachePrefix?: boolean;
  timeoutMs?: number;
  agent: AgentName;
}

export interface ModelResponse {
  /** 已按 responseSchema 校验过的输出 */
  raw: unknown;
  provider: 'gemini' | 'anthropic' | 'openai';
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  latencyMs: number;
}

export interface ModelClientResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
}

/** 模型调用客户端 —— 一个 Provider / 一个模型 */
export interface ModelClient {
  provider: 'gemini' | 'anthropic' | 'openai';
  model: string;
  invoke(req: ModelRequest): Promise<ModelClientResult>;
}

/** 模型调用失败 —— 带上是否值得重试 */
export class ModelCallError extends Error {
  readonly status?: number;
  readonly retryable: boolean;

  constructor(message: string, opts: { status?: number; retryable?: boolean } = {}) {
    super(message);
    this.name = 'ModelCallError';
    this.status = opts.status;
    this.retryable = opts.retryable ?? false;
  }
}

/** 所有客户端都失败 —— 调用方应当走本地确定性降级 */
export class ModelUnavailableError extends Error {
  readonly attempts: Array<{ provider: string; model: string; error: string }>;

  constructor(attempts: Array<{ provider: string; model: string; error: string }>) {
    super(
      `所有模型均不可用：${attempts.map((a) => `${a.provider}/${a.model}: ${a.error}`).join('; ')}`
    );
    this.name = 'ModelUnavailableError';
    this.attempts = attempts;
  }
}

/**
 * 模型**响应了**，但输出没通过 JSON 解析或 Schema 校验
 * ---------------------------------------------------------------------------
 * 与 `ModelUnavailableError` 是两回事：
 *   - 不可用：模型没给出任何输出（网络、5xx、超时、配额）→ 可以走本地降级
 *   - 输出非法：模型给了输出，但内容违反契约 → **不能降级掩盖**，必须显式报错
 *
 * 对应错误码 `MODEL_OUTPUT_INVALID`（docs/backend-design.md §5.3）。
 * 关键安全性质：**非法输出永远不进入系统**（docs/backend-design.md §12）。
 */
export class ModelOutputInvalidError extends Error {
  readonly attempts: Array<{ provider: string; model: string; error: string }>;
  readonly issues: string[];

  constructor(
    attempts: Array<{ provider: string; model: string; error: string }>,
    issues: string[] = []
  ) {
    super(
      `模型输出未通过校验：${attempts.map((a) => `${a.provider}/${a.model}: ${a.error}`).join('; ')}`
    );
    this.name = 'ModelOutputInvalidError';
    this.attempts = attempts;
    this.issues = issues;
  }
}

/** 留痕记录 —— 写进 `model_calls` 表 */
export interface ModelCallRecord {
  agent: AgentName;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  ok: boolean;
  error?: string;
}

export interface ModelRouterOptions {
  /** 按优先级排列的客户端 —— 第一个是 primary */
  clients: ModelClient[];
  timeoutMs?: number;
  /** 网络类失败的重试次数（不含首次） */
  maxRetries?: number;
  /** 输出修复的最大次数（JSON 解析 / Schema 校验失败后回灌重问） */
  maxRepairs?: number;
  /** 每次调用的留痕回调 */
  onCall?: (record: ModelCallRecord) => void;
  /** 重试退避基数（毫秒）—— 测试里设为 0 */
  retryBackoffMs?: number;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof ModelCallError) return err.retryable;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** JSON.parse 的安全包装 */
function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export class ModelRouter {
  private readonly clients: ModelClient[];
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxRepairs: number;
  private readonly onCall?: (record: ModelCallRecord) => void;
  private readonly retryBackoffMs: number;

  constructor(opts: ModelRouterOptions) {
    this.clients = opts.clients;
    this.timeoutMs = opts.timeoutMs ?? 20000;
    this.maxRetries = opts.maxRetries ?? 2;
    this.maxRepairs = opts.maxRepairs ?? 2;
    this.onCall = opts.onCall;
    this.retryBackoffMs = opts.retryBackoffMs ?? 250;
  }

  /**
   * 调用模型。
   *
   * @throws ModelUnavailableError —— 模型**不可用**（网络 / 5xx / 超时 / 配额），
   *         调用方应走本地确定性降级（AC-NFR-003）。
   * @throws ModelOutputInvalidError —— 模型**响应了但输出非法**，
   *         调用方必须显式报错，不能用降级掩盖（AC-API-004）。
   */
  async invoke(req: ModelRequest): Promise<ModelResponse> {
    const attempts: Array<{ provider: string; model: string; error: string }> = [];
    const outputIssues: string[] = [];

    // 链上最后一次失败决定最终错误类型 —— 「降级链」的终点语义
    let lastFailure: 'unavailable' | 'output-invalid' = 'unavailable';

    for (const client of this.clients) {
      const messages = [...req.messages];

      for (let repair = 0; repair <= this.maxRepairs; repair++) {
        const started = Date.now();
        let lastError: unknown;
        /** 本轮失败是否是「输出非法」—— 决定是回灌修复还是换客户端 */
        let outputInvalid = false;

        // 网络类失败重试（429 / 5xx / 超时）
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
          try {
            const result = await this.callWithTimeout(client, { ...req, messages });
            const parsed = tryParseJson(result.text);

            if (!parsed.ok) {
              lastError = new ModelOutputInvalidError(
                [{ provider: client.provider, model: client.model, error: `JSON 解析失败：${parsed.error}` }],
                [parsed.error]
              );
              outputInvalid = true;
              messages.push({
                role: 'user',
                content: `上一次输出无法解析为 JSON（${parsed.error}）。请重新输出，且只输出符合 schema 的 JSON，不要任何解释文字。`,
              });
              break; // 交给「输出修复」循环
            }

            if (req.parse) {
              const validated = req.parse.safeParse(parsed.value);
              if (!validated.success) {
                const detail = validated.error.issues
                  .map((i) => `${i.path.join('.')}: ${i.message}`)
                  .join('; ');
                lastError = new ModelOutputInvalidError(
                  [
                    {
                      provider: client.provider,
                      model: client.model,
                      error: `Schema 校验失败：${detail}`,
                    },
                  ],
                  validated.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
                );
                outputInvalid = true;
                messages.push({
                  role: 'user',
                  content: `上一次输出未通过校验（${detail}）。请重新输出，且只输出符合 schema 的 JSON，不要任何解释文字。`,
                });
                break;
              }

              const latencyMs = Date.now() - started;
              this.onCall?.({
                agent: req.agent,
                provider: client.provider,
                model: client.model,
                inputTokens: result.inputTokens,
                outputTokens: result.outputTokens,
                latencyMs,
                ok: true,
              });
              return {
                raw: validated.data,
                provider: client.provider,
                model: client.model,
                inputTokens: result.inputTokens,
                outputTokens: result.outputTokens,
                cachedTokens: result.cachedTokens,
                latencyMs,
              };
            }

            const latencyMs = Date.now() - started;
            this.onCall?.({
              agent: req.agent,
              provider: client.provider,
              model: client.model,
              inputTokens: result.inputTokens,
              outputTokens: result.outputTokens,
              latencyMs,
              ok: true,
            });
            return {
              raw: parsed.value,
              provider: client.provider,
              model: client.model,
              inputTokens: result.inputTokens,
              outputTokens: result.outputTokens,
              cachedTokens: result.cachedTokens,
              latencyMs,
            };
          } catch (err) {
            lastError = err;
            if (err instanceof ModelOutputInvalidError) {
              outputInvalid = true;
              break;
            }
            if (attempt < this.maxRetries && isRetryable(err)) {
              const backoff = this.retryBackoffMs * 2 ** attempt;
              await sleep(backoff);
              continue;
            }
            break;
          }
        }

        const message = lastError instanceof Error ? lastError.message : String(lastError);
        attempts.push({ provider: client.provider, model: client.model, error: message });
        if (outputInvalid) outputIssues.push(message);
        this.onCall?.({
          agent: req.agent,
          provider: client.provider,
          model: client.model,
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: Date.now() - started,
          ok: false,
          error: message,
        });

        if (outputInvalid) {
          // 还有修复预算 → 回灌提示再问一次
          if (repair < this.maxRepairs) continue;
          // 修复预算用尽 → 换下一个客户端（链上还有 secondary 就继续试）
          lastFailure = 'output-invalid';
          break;
        }

        // 模型不可用 → 换下一个客户端，不再消耗修复预算
        lastFailure = 'unavailable';
        break;
      }
    }

    if (lastFailure === 'output-invalid') {
      throw new ModelOutputInvalidError(attempts, outputIssues);
    }
    throw new ModelUnavailableError(attempts);
  }

  /** 超时包装 */
  private async callWithTimeout(
    client: ModelClient,
    req: ModelRequest
  ): Promise<ModelClientResult> {
    const timeoutMs = req.timeoutMs ?? this.timeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        // 把**生效的**超时一并告诉客户端 —— 客户端要靠它 abort 底层请求，
        // 否则竞速输了以后那个 HTTP 请求还挂着（socket 不释放）。
        client.invoke({ ...req, timeoutMs }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new ModelCallError(`模型调用超时（${timeoutMs}ms）`, { retryable: true })
              ),
            timeoutMs
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
