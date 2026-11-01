/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Gemini 模型客户端 —— ModelRouter 的一个实现
 * ---------------------------------------------------------------------------
 * 密钥只存在于服务端：apiKey 从 env 读，绝不进入任何响应或日志。
 *
 * 错误映射（供 ModelRouter 判断是否值得重试）：
 *   429 / 5xx / 超时 → retryable
 *   4xx（参数错、鉴权错）→ 不可重试，直接换下一个客户端
 */

import { GoogleGenAI } from '@google/genai';

import {
  ModelCallError,
  type ModelClient,
  type ModelClientResult,
  type ModelRequest,
} from './modelRouter';

export interface GeminiClientOptions {
  apiKey: string;
  model: string;
  /** 结构化输出所允许的 schema 名（Gemini 要求 schema 名匹配 ^[a-zA-Z]+$） */
  responseSchemaName?: string;
  /**
   * 模型端点 —— 不给就用官方地址。
   *
   * **为什么需要这个口子**：docs/testing-strategy.md §6.1 要求
   * 「`bun test` 一律使用回放，**不烧 API 额度**」，且测试结果不能取决于外网可达与否。
   * 把端点指向本地替身，E2E 走的是**同一条真实链路**
   * （真 HTTP → 真 SDK → 真错误分类 → 真降级），只是把链路尽头换成了本机。
   */
  baseUrl?: string;
}

function toModelCallError(err: unknown): ModelCallError {
  if (err instanceof ModelCallError) return err;

  const status =
    typeof err === 'object' && err !== null && 'status' in err
      ? Number((err as { status: unknown }).status)
      : undefined;

  const message =
    err instanceof Error ? err.message : typeof err === 'string' ? err : '未知模型调用错误';

  // 429 / 5xx 值得重试；其余不重试
  const retryable = status === 429 || (status !== undefined && status >= 500);

  return new ModelCallError(`Gemini 调用失败${status ? `（HTTP ${status}）` : ''}：${message}`, {
    status,
    retryable,
  });
}

export class GeminiClient implements ModelClient {
  readonly provider = 'gemini' as const;
  readonly model: string;

  private readonly client: GoogleGenAI;
  private readonly responseSchemaName: string;
  private readonly baseUrl?: string;

  constructor(opts: GeminiClientOptions) {
    this.model = opts.model;
    this.client = new GoogleGenAI({ apiKey: opts.apiKey });
    this.responseSchemaName = opts.responseSchemaName ?? 'response';
    this.baseUrl = opts.baseUrl;
  }

  async invoke(req: ModelRequest): Promise<ModelClientResult> {
    const contents = req.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const config: Record<string, unknown> = {
      maxOutputTokens: req.maxTokens ?? 8192,
      temperature: req.temperature ?? 0.6,
    };

    // 超时必须**交给 SDK** —— 只在 ModelRouter 外面套一个 Promise.race 是不够的：
    // 竞速输了以后，底下那个 HTTP 请求还挂着（socket 不释放），
    // 重试又发一条新的 —— 于是一次卡死的模型调用会攒下一串悬挂请求。
    // 把 timeout 交给 SDK，超时到了它自己会 abort，连接干净地收掉。
    const httpOptions: { baseUrl?: string; timeout?: number } = {};
    if (this.baseUrl) httpOptions.baseUrl = this.baseUrl;
    if (typeof req.timeoutMs === 'number') httpOptions.timeout = req.timeoutMs;
    if (Object.keys(httpOptions).length > 0) config.httpOptions = httpOptions;

    if (req.responseSchema) {
      config.responseMimeType = 'application/json';
      config.responseSchema = {
        ...req.responseSchema,
        // Gemini 要求 schema 有合法名字
        title: this.responseSchemaName,
      };
    }

    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents,
        config: config as never,
      });

      const text = response.text ?? '';
      const usage = response.usageMetadata;

      return {
        text,
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens: usage?.candidatesTokenCount ?? 0,
        cachedTokens: usage?.cachedContentTokenCount ?? undefined,
      };
    } catch (err) {
      throw toModelCallError(err);
    }
  }
}
