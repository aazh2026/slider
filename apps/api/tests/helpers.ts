/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 测试公共设施
 * ---------------------------------------------------------------------------
 * 每个测试文件用**内存 PGlite**（`pglite://memory`）—— 不落盘、可并行、零外部依赖。
 *
 * 模型客户端用 FakeModelClient 替身：能精确注入「5xx / 超时 / 非法 JSON / 非法 Schema」，
 * 从而在不烧 API 额度的前提下复现 docs/testing-strategy.md §「AI 离线 → 录制响应回放」
 * 描述的故障注入场景。
 */

import type { Hono } from 'hono';

import { createApp } from '../src/app';
import { applyDdl, createPgliteDb, type DbHandle } from '../src/db/client';
import {
  ModelCallError,
  ModelRouter,
  type AgentName,
  type ModelClient,
  type ModelClientResult,
  type ModelRequest,
} from '../src/services/modelRouter';
import type { AppEnv } from '../src/types';

/* -------------------------------------------------------------------------- */
/* Fake 模型客户端                                                              */
/* -------------------------------------------------------------------------- */

export type FakeBehavior =
  /** 返回固定文本（模型"说"了什么） */
  | { kind: 'text'; text: string }
  /** 抛模型调用错误（网络 / 5xx / 配额） */
  | { kind: 'error'; message: string; retryable?: boolean; status?: number };

export interface FakeClientOptions {
  model?: string;
  /** 依次消费；只剩最后一个时反复使用 */
  behaviors: FakeBehavior[];
  /**
   * 按 agent 分别配置 —— 例如大纲走模型输出、编辑走补丁输出。
   * 命中该表时**优先于** `behaviors`。
   */
  byAgent?: Partial<Record<AgentName, FakeBehavior[]>>;
}

export class FakeModelClient implements ModelClient {
  readonly provider = 'gemini' as const;
  readonly model: string;
  /** 收到的全部请求 —— 断言"提示里确实回灌了错误"时用 */
  readonly calls: ModelRequest[] = [];

  private readonly behaviors: FakeBehavior[];
  private readonly byAgent: Partial<Record<AgentName, FakeBehavior[]>>;
  /** 各 agent 已消费的条目数 */
  private readonly consumed = new Map<string, number>();

  constructor(opts: FakeClientOptions) {
    this.model = opts.model ?? 'fake-model';
    this.behaviors = [...opts.behaviors];
    this.byAgent = { ...(opts.byAgent ?? {}) };
  }

  get callCount(): number {
    return this.calls.length;
  }

  async invoke(req: ModelRequest): Promise<ModelClientResult> {
    this.calls.push(req);

    const agentBehaviors = this.byAgent[req.agent];
    const behavior = agentBehaviors
      ? this.pickSequential(agentBehaviors, req.agent)
      : this.pickSequential(this.behaviors, '__default__');

    if (behavior.kind === 'error') {
      throw new ModelCallError(behavior.message, {
        status: behavior.status,
        retryable: behavior.retryable ?? true,
      });
    }

    return { text: behavior.text, inputTokens: 10, outputTokens: 20 };
  }

  /** 依次消费；只剩最后一个时反复使用 */
  private pickSequential(list: FakeBehavior[], key: string): FakeBehavior {
    const used = this.consumed.get(key) ?? 0;
    this.consumed.set(key, used + 1);
    if (list.length > 1) return list[used] ?? list[list.length - 1]!;
    return list[0]!;
  }

  /** 取某个 agent 已消费的条目数 */
  consumedFor(agent: AgentName): number {
    return this.consumed.get(agent) ?? 0;
  }
}

/** 永远返回同一段文本 */
export function fakeText(text: string): FakeClientOptions {
  return { behaviors: [{ kind: 'text', text }] };
}

/** 永远失败（可重试的网络错误 —— 模拟 5xx / 超时 / 配额耗尽） */
export function fakeUnavailable(message = '模型服务 503'): FakeClientOptions {
  return { behaviors: [{ kind: 'error', message, retryable: true, status: 503 }] };
}

/* -------------------------------------------------------------------------- */
/* 测试应用                                                                    */
/* -------------------------------------------------------------------------- */

export interface TestContext {
  app: Hono<AppEnv>;
  db: DbHandle;
  router: ModelRouter;
  client: FakeModelClient;
  /** 每次模型调用都会记录到这里 */
  modelCalls: Array<{ agent: string; provider: string; model: string; ok: boolean; error?: string }>;
}

export interface TestAppOptions {
  /** 模型客户端行为 —— 不给就用"永远不可用"，让降级链可测 */
  model?: FakeClientOptions;
  /** 路由超时（毫秒） */
  timeoutMs?: number;
  /** 重试退避基数 —— 测试里设 0，避免拖慢 */
  retryBackoffMs?: number;
}

export async function createTestApp(options: TestAppOptions = {}): Promise<TestContext> {
  const db = createPgliteDb(undefined); // 内存库
  await applyDdl(db);

  const client = new FakeModelClient(options.model ?? fakeUnavailable());
  const modelCalls: TestContext['modelCalls'] = [];

  const router = new ModelRouter({
    clients: [client],
    timeoutMs: options.timeoutMs ?? 5000,
    maxRetries: 1,
    maxRepairs: 1,
    retryBackoffMs: options.retryBackoffMs ?? 0,
    onCall: (record) => modelCalls.push({ ...record }),
  });

  const app = createApp({ db, modelRouter: router });

  return { app, db, router, client, modelCalls };
}

/* -------------------------------------------------------------------------- */
/* 请求助手                                                                    */
/* -------------------------------------------------------------------------- */

export interface RequestOptions {
  method?: string;
  body?: unknown;
  /** 原始 body（multipart 等） */
  rawBody?: BodyInit;
  headers?: Record<string, string>;
  cookie?: string;
}

export interface JsonResponse<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
  res: Response;
}

/** 发一个请求并解析 JSON */
export async function requestJson<T = unknown>(
  app: Hono<AppEnv>,
  path: string,
  opts: RequestOptions = {}
): Promise<JsonResponse<T>> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.cookie) headers['cookie'] = opts.cookie;

  let body: BodyInit | undefined = opts.rawBody;
  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers['content-type'] = headers['content-type'] ?? 'application/json';
  }

  const res = await app.request(path, { method: opts.method ?? 'GET', headers, body });
  const text = await res.text();

  let parsed: unknown;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    parsed = { __raw: text };
  }

  return { status: res.status, body: parsed as T, headers: res.headers, res };
}

/** 从响应里取出会话 Cookie（`name=value`） */
export function cookieFrom(res: Response, name = 'ppt_session'): string | undefined {
  const raw = res.headers.get('set-cookie');
  if (!raw) return undefined;
  for (const part of raw.split(/,(?=[^;]+=)/)) {
    const [pair] = part.split(';');
    const [k, ...v] = (pair ?? '').trim().split('=');
    if (k === name) return `${k}=${v.join('=')}`;
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* 业务助手                                                                    */
/* -------------------------------------------------------------------------- */

export interface RegisteredUser {
  cookie: string;
  userId: string;
  email: string;
}

let userCounter = 0;

/** 注册一个用户并返回会话 Cookie */
export async function registerUser(
  app: Hono<AppEnv>,
  email?: string
): Promise<RegisteredUser> {
  userCounter += 1;
  const addr = email ?? `user${userCounter}-${Date.now()}@example.com`;
  const password = 'password123';

  const res = await requestJson<{ data: { user: { id: string; email: string } } }>(
    app,
    '/api/auth/register',
    { method: 'POST', body: { email: addr, password, name: 'Test User' } }
  );

  if (res.status !== 201) {
    throw new Error(`注册失败：${res.status} ${JSON.stringify(res.body)}`);
  }

  const cookie = cookieFrom(res.res);
  if (!cookie) throw new Error('注册成功但没有拿到会话 Cookie');

  return { cookie, userId: res.body.data.user.id, email: addr };
}

export const SAMPLE_REQUIREMENT = {
  topic: '新能源汽车电池回收体系',
  purpose: '融资路演',
  audience: '投资人',
  pageCount: 6,
  style: '专业、克制',
  depth: '标准',
  aspectRatio: '16:9' as const,
};

/**
 * 造一份合法的「模型大纲输出」
 * ---------------------------------------------------------------------------
 * 用于让 fake 模型在大纲端点返回**能通过 Schema 校验**的内容，
 * 这样同一个测试里可以让大纲走模型、编辑走另一份输出。
 */
export function makeOutlineResponse(pageCount = 6, topic = SAMPLE_REQUIREMENT.topic): string {
  const layouts = [
    'title_cover',
    'cards_grid',
    'problem_solution',
    'cards_grid',
    'architecture_diagram',
    'summary_conclusion',
  ];
  const outline = Array.from({ length: pageCount }, (_, i) => ({
    slideId: `s${i + 1}`,
    order: i + 1,
    title: `${topic} · 第 ${i + 1} 页`,
    purpose: `第 ${i + 1} 页的目的`,
    keyMessage: `第 ${i + 1} 页的核心结论`,
    visualIntent: `第 ${i + 1} 页的视觉意图`,
    layoutPreference: layouts[i % layouts.length],
    requiredElements: [],
    speakerNotes: `第 ${i + 1} 页的备注`,
    bulletPoints: [`${topic} 要点 ${i + 1}`],
  }));
  return JSON.stringify({ outline });
}

/** 创建一个项目并返回其 id */
export async function createProject(
  app: Hono<AppEnv>,
  cookie: string,
  name = '测试项目',
  requirement: Record<string, unknown> = SAMPLE_REQUIREMENT
): Promise<string> {
  const res = await requestJson<{ data: { project: { id: string } } }>(
    app,
    '/api/projects',
    { method: 'POST', cookie, body: { name, requirement } }
  );
  if (res.status !== 201) {
    throw new Error(`创建项目失败：${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.project.id;
}

/** 生成大纲并编译成幻灯片，返回 { slideId, versionId } 列表 */
export async function compileProject(
  app: Hono<AppEnv>,
  cookie: string,
  projectId: string,
  requirement: Record<string, unknown> = SAMPLE_REQUIREMENT
): Promise<Array<{ slideId: string; versionId: string }>> {
  const regen = await requestJson<{ data: { outline: unknown[] } }>(
    app,
    `/api/projects/${projectId}/outline/regenerate`,
    { method: 'POST', cookie, body: { requirement } }
  );
  if (regen.status !== 200) {
    throw new Error(`生成大纲失败：${regen.status} ${JSON.stringify(regen.body)}`);
  }

  const compile = await requestJson<{ data: { slides: Array<{ slideId: string; versionId: string }> } }>(
    app,
    `/api/projects/${projectId}/compile`,
    { method: 'POST', cookie }
  );
  if (compile.status !== 200) {
    throw new Error(`编译幻灯片失败：${compile.status} ${JSON.stringify(compile.body)}`);
  }
  return compile.body.data.slides;
}
