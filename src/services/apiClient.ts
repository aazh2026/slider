/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * API 客户端 —— 统一处理后端的响应信封
 * ---------------------------------------------------------------------------
 * 后端契约（docs/backend-design.md §5.1）：
 *
 *   成功：{ data: <载荷>, traceId: string }
 *   失败：{ error: { code, message, details? }, traceId: string }
 *
 * 前端**只认 data**。信封的拆解集中在这一个文件里 ——
 * 业务代码永远拿不到 `{ data: ... }` 这一层，也永远不用自己判断
 * `res.ok` 还是 `res.status === 200`。
 *
 * 会话：认证走 HttpOnly Cookie，所以每个请求都必须带 credentials。
 * （XHR/fetch 默认不带 Cookie，同源情况下 `credentials: 'same-origin'`
 *  才带上跨端口的 dev 代理 —— 显式写 'include' 最稳。）
 */

/** 后端错误码枚举（docs/backend-design.md §5.1 错误码表） */
export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'SLIDE_VERSION_CONFLICT'
  | 'QUOTA_EXCEEDED'
  | 'MODEL_UNAVAILABLE'
  | 'MODEL_OUTPUT_INVALID'
  | 'JOB_FAILED'
  | 'RATE_LIMITED';

export interface ApiErrorBody {
  code: ApiErrorCode | string;
  message: string;
  details?: Record<string, unknown>;
}

/** 带错误码与 traceId 的异常 */
export class ApiClientError extends Error {
  readonly code: ApiErrorCode | string;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  readonly traceId?: string;

  constructor(opts: {
    code: ApiErrorCode | string;
    message: string;
    status: number;
    details?: Record<string, unknown>;
    traceId?: string;
  }) {
    super(opts.message);
    this.name = 'ApiClientError';
    this.code = opts.code;
    this.status = opts.status;
    this.details = opts.details;
    this.traceId = opts.traceId;
  }

  /** 会话失效 —— UI 据此回到登录页 */
  get isUnauthorized(): boolean {
    return this.status === 401 || this.code === 'UNAUTHORIZED';
  }

  /** 乐观锁冲突 —— UI 据此提示"页面已被其他会话修改" */
  get isVersionConflict(): boolean {
    return this.status === 409 || this.code === 'SLIDE_VERSION_CONFLICT';
  }
}

const BASE_URL = (import.meta.env?.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** JSON 载荷 —— 会被序列化并自动带 content-type */
  body?: unknown;
  /** 原始 body（multipart 等）—— 不设 content-type，交给浏览器 */
  rawBody?: BodyInit;
  headers?: Record<string, string>;
  /** 期望的响应类型 */
  responseType?: 'json' | 'blob';
  signal?: AbortSignal;
}

/** 触发一个"会话失效"事件，让 App 切回登录页 */
export const SESSION_EXPIRED_EVENT = 'ppt:session-expired';

function notifySessionExpired(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
  }
}

/**
 * 发一个请求并解包信封
 * ---------------------------------------------------------------------------
 * 成功返回 `data`；失败抛 `ApiClientError`（带 code / message / traceId）。
 */
export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...opts.headers };

  let body: BodyInit | undefined = opts.rawBody;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers['content-type'] = headers['content-type'] ?? 'application/json';
  }

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body,
      credentials: 'include',
      signal: opts.signal,
    });
  } catch (err) {
    // 网络层失败（后端没起来、断网）—— 不属于业务错误码，单列一种
    throw new ApiClientError({
      code: 'NETWORK_ERROR',
      message: err instanceof Error ? err.message : '网络请求失败',
      status: 0,
    });
  }

  const traceId = res.headers.get('x-trace-id') ?? undefined;

  if (!res.ok) {
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    const errorBody = (parsed as { error?: ApiErrorBody } | null)?.error;
    const err = new ApiClientError({
      code: errorBody?.code ?? 'UNKNOWN',
      message: errorBody?.message ?? `请求失败（HTTP ${res.status}）`,
      status: res.status,
      details: errorBody?.details,
      traceId: (parsed as { traceId?: string } | null)?.traceId ?? traceId,
    });
    if (err.isUnauthorized) notifySessionExpired();
    throw err;
  }

  if (opts.responseType === 'blob') {
    return (await res.blob()) as unknown as T;
  }

  const text = await res.text();
  if (!text) return null as T;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiClientError({
      code: 'INVALID_RESPONSE',
      message: '服务端返回了非 JSON 响应',
      status: res.status,
      traceId,
    });
  }

  const envelope = parsed as { data?: T; traceId?: string };
  // 后端契约：载荷一定在 data 里
  if (envelope && typeof envelope === 'object' && 'data' in envelope) {
    return envelope.data as T;
  }

  // 没有信封就是契约被破坏了 —— 明确报错，不要静默把整个 body 当载荷
  throw new ApiClientError({
    code: 'INVALID_ENVELOPE',
    message: '服务端响应缺少 data 字段（响应信封契约被破坏）',
    status: res.status,
    traceId,
  });
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => apiRequest<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    apiRequest<T>(path, { ...opts, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    apiRequest<T>(path, { ...opts, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    apiRequest<T>(path, { ...opts, method: 'PUT', body }),
  del: <T>(path: string, opts?: RequestOptions) => apiRequest<T>(path, { ...opts, method: 'DELETE' }),
  /** 下载二进制（导出产物） */
  blob: (path: string, opts?: RequestOptions) =>
    apiRequest<Blob>(path, { ...opts, responseType: 'blob' }),
};

/** 把任意异常归一化成给用户看的一句话 */
export function describeError(err: unknown): string {
  if (err instanceof ApiClientError) {
    return err.traceId ? `${err.message}（traceId: ${err.traceId}）` : err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
