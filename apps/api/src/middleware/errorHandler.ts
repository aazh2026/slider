/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 统一错误处理 —— 任何未捕获异常都必须变成 `{ error: { code, message }, traceId }`
 * ---------------------------------------------------------------------------
 * **错误码必须落在封闭枚举内**（docs/backend-design.md §5.3）——
 * 客户端按 code 分支，枚举外的 code 等于协议破坏。
 */

import type { ErrorHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';

import { ApiError, fail, type ErrorCode } from '../errors';
import { PatchApplyError } from '@ppt/core';
import { ModelOutputInvalidError, ModelUnavailableError } from '../services/modelRouter';
import type { AppEnv } from '../types';

interface Classified {
  status: number;
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/** 未分类的服务端异常 —— 枚举里没有 INTERNAL_ERROR，JOB_FAILED 是唯一可用的兜底 */
function classify(err: unknown): Classified {
  if (err instanceof ApiError) {
    return { status: err.status, code: err.code, message: err.message, details: err.details };
  }

  if (err instanceof ZodError) {
    return {
      status: 400,
      code: 'VALIDATION_FAILED',
      message: '参数校验失败',
      details: {
        issues: err.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
          code: i.code,
        })),
      },
    };
  }

  // 模型响应了但输出非法 —— 显式报错，不用降级掩盖（AC-API-004）
  if (err instanceof ModelOutputInvalidError) {
    return {
      status: 422,
      code: 'MODEL_OUTPUT_INVALID',
      message: '模型输出未通过校验，已拒绝写入',
      details: { issues: err.issues },
    };
  }

  // 模型完全不可用且调用方没有本地降级路径
  if (err instanceof ModelUnavailableError) {
    return {
      status: 503,
      code: 'MODEL_UNAVAILABLE',
      message: '模型服务暂时不可用，请稍后重试',
      details: { attempts: err.attempts },
    };
  }

  if (err instanceof PatchApplyError) {
    // 补丁指向不存在的元素 → 资源不存在；其余补丁问题都是入参问题
    if (err.code === 'UNKNOWN_ELEMENT') {
      return {
        status: 404,
        code: 'NOT_FOUND',
        message: err.message,
        details: { patchCode: err.code, ...err.details },
      };
    }
    return {
      status: 400,
      code: 'VALIDATION_FAILED',
      message: err.message,
      details: { patchCode: err.code, ...err.details },
    };
  }

  return {
    status: 500,
    code: 'JOB_FAILED',
    message: '服务内部错误',
  };
}

export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  const traceId = c.get('traceId') ?? 'req_unknown';
  const { status, code, message, details } = classify(err);

  // 5xx 必须留下原始错误 —— 但**不能打印密钥**（SEC-06）
  if (status >= 500) {
    console.error(
      JSON.stringify({
        level: 'error',
        traceId,
        message,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack?.split('\n').slice(0, 6).join('\n') : undefined,
      })
    );
  }

  return c.json(fail(code, message, traceId, details), status as ContentfulStatusCode);
};
