/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 统一错误码与响应包封（docs/backend-design.md §5.3）
 * ---------------------------------------------------------------------------
 *   成功 { "data": <T>, "traceId": "req_xxx" }
 *   失败 { "error": { "code": "...", "message": "...", "details": {...} }, "traceId": "req_xxx" }
 *
 * 错误码是**封闭枚举** —— 客户端可以按 code 分支处理，不必解析 message。
 */

/** 错误码枚举 —— 不得增删，客户端按它分支 */
export const ERROR_CODES = [
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'SLIDE_VERSION_CONFLICT',
  'QUOTA_EXCEEDED',
  'MODEL_UNAVAILABLE',
  'MODEL_OUTPUT_INVALID',
  'JOB_FAILED',
  'RATE_LIMITED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

/** 业务异常 —— 带 HTTP 状态码与错误码 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static unauthorized(message = '未登录或会话已过期', details?: Record<string, unknown>) {
    return new ApiError(401, 'UNAUTHORIZED', message, details);
  }
  static forbidden(message = '没有权限', details?: Record<string, unknown>) {
    return new ApiError(403, 'FORBIDDEN', message, details);
  }
  static notFound(message = '资源不存在', details?: Record<string, unknown>) {
    return new ApiError(404, 'NOT_FOUND', message, details);
  }
  static validation(message = '参数校验失败', details?: Record<string, unknown>) {
    return new ApiError(400, 'VALIDATION_FAILED', message, details);
  }
  static versionConflict(message: string, details?: Record<string, unknown>) {
    return new ApiError(409, 'SLIDE_VERSION_CONFLICT', message, details);
  }
  static quotaExceeded(message = '配额已用尽', details?: Record<string, unknown>) {
    return new ApiError(402, 'QUOTA_EXCEEDED', message, details);
  }
  static modelUnavailable(message = '模型服务不可用', details?: Record<string, unknown>) {
    return new ApiError(503, 'MODEL_UNAVAILABLE', message, details);
  }
  static modelOutputInvalid(message = '模型输出未通过校验', details?: Record<string, unknown>) {
    return new ApiError(422, 'MODEL_OUTPUT_INVALID', message, details);
  }
  static jobFailed(message = '任务失败', details?: Record<string, unknown>) {
    return new ApiError(500, 'JOB_FAILED', message, details);
  }
  static rateLimited(message = '请求过于频繁', details?: Record<string, unknown>) {
    return new ApiError(429, 'RATE_LIMITED', message, details);
  }
}

/** 成功包封 */
export function ok<T>(data: T, traceId: string): { data: T; traceId: string } {
  return { data, traceId };
}

/** 失败包封 */
export function fail(
  code: ErrorCode,
  message: string,
  traceId: string,
  details?: Record<string, unknown>
): {
  error: { code: ErrorCode; message: string; details?: Record<string, unknown> };
  traceId: string;
} {
  return {
    error: details ? { code, message, details } : { code, message },
    traceId,
  };
}
