#!/usr/bin/env bun
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 一键启动开发环境（后端 API + 前端 Web）
 * ---------------------------------------------------------------------------
 * 用法：
 *   bun run dev:all                                  # 前台起两个服务，Ctrl+C 一起停
 *   bun run scripts/dev.ts -- --api-port 4000        # 换后端端口
 *   bun run scripts/dev.ts -- --web-port 5174 --host 0.0.0.0
 *
 * ---------------------------------------------------------------------------
 * **为什么不用 `bun run dev & bun run dev:web &` 就完事**
 *
 * 1. 后端是 fail-fast 的（缺 GEMINI_API_KEY 直接非零退出）——
 *    两个进程并行起时，后端已经死了、前端照样把页面开出来，
 *    排查的人会先怀疑前端，白白浪费一轮。
 * 2. `&` 起的子进程在 Ctrl+C 之后会变成孤儿继续占着 3000，
 *    下次启动就撞 "port in use"，而这个孤儿没人认领、没人敢杀。
 * 3. 两个进程的输出混在一起，没有来源标识，分不清哪行是后端抛的。
 *
 * 这个脚本把这三件事一次做掉：**按顺序起、标好来源、一起收**。
 *
 * ---------------------------------------------------------------------------
 * **端口冲突的处置原则**
 *
 * - 占端口的进程**是本仓库的旧实例** → 接管（SIGTERM → 等释放 → 必要时 SIGKILL）。
 *   这是"重启一下开发栈"的正常诉求，不该被拦。
 * - 占端口的进程**是别人的** → 拒绝启动，并说清楚是谁占的、怎么放掉。
 *   绝不擅自杀掉不认识的进程。
 *
 * **环境变量优先级**：脚本显式传入的（PORT / APP_URL / API_ORIGIN）覆盖 .env，
 * 所以改了端口之后 CORS 白名单和前端代理会跟着走，不会出现
 * "端口换了但白名单还是旧的"这种半对半错的状态。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '..');

/* ------------------------------------------------------------------ 颜色 */

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
} as const;

const tty = process.stdout.isTTY === true;
const paint = (color: string, text: string): string => (tty ? `${color}${text}${C.reset}` : text);

const log = (msg: string): void => console.log(msg);
const step = (msg: string): void => console.log(`${paint(C.cyan, '▶')} ${msg}`);
const ok = (msg: string): void => console.log(`${paint(C.green, '✔')} ${msg}`);
const warn = (msg: string): void => console.log(`${paint(C.yellow, '!')} ${msg}`);
const fail = (msg: string): void => console.error(`${paint(C.red, '✖')} ${msg}`);

/* -------------------------------------------------------------- 参数解析 */

interface Options {
  apiPort: number;
  webPort: number;
  host?: string;
  install: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    apiPort: Number(process.env['API_PORT'] ?? 3000),
    webPort: Number(process.env['WEB_PORT'] ?? 5173),
    install: true,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} 缺少参数值`);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--api-port':
        opts.apiPort = Number(next());
        break;
      case '--web-port':
        opts.webPort = Number(next());
        break;
      case '--host':
        opts.host = next();
        break;
      case '--no-install':
        opts.install = false;
        break;
      case '-h':
      case '--help':
        opts.help = true;
        break;
      default:
        throw new Error(`未知参数：${arg}`);
    }
  }

  for (const [name, port] of [
    ['api-port', opts.apiPort],
    ['web-port', opts.webPort],
  ] as const) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`--${name} 必须是 1-65535 之间的整数，当前是 ${port}`);
    }
  }
  if (opts.apiPort === opts.webPort) {
    throw new Error('--api-port 和 --web-port 不能相同');
  }
  return opts;
}

function printHelp(): void {
  log(`${paint(C.bold, '一键启动开发环境（后端 API + 前端 Web）')}

${paint(C.bold, '用法')}
  bun run dev:all [选项]

${paint(C.bold, '选项')}
  --api-port <端口>   后端 API 端口（默认 3000，或读 API_PORT）
  --web-port <端口>   前端 Web 端口（默认 5173，或读 WEB_PORT）
  --host <地址>       前端监听地址（默认只听 localhost；传 0.0.0.0 可局域网访问）
  --no-install        缺少 node_modules 时不自动执行 bun install
  -h, --help          显示本帮助

${paint(C.bold, '说明')}
  · 后端就绪（/readyz 通过）之后才启动前端
  · 两个进程的输出分别带 [API] / [WEB] 前缀
  · Ctrl+C 会同时停掉两个服务
  · 端口被本仓库的旧实例占用时自动接管；被其他进程占用时拒绝启动`);
}

/* -------------------------------------------------------------- 端口工具 */

interface PortOwner {
  pid: number;
  cmd: string;
}

/** lsof 查端口占用者 —— 拿不到就返回 null（不猜） */
async function findPortOwner(port: number): Promise<PortOwner | null> {
  try {
    const lsof = Bun.spawn({
      cmd: ['lsof', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'],
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const out = await new Response(lsof.stdout).text();
    const pid = Number(out.trim().split('\n')[0]);
    if (!Number.isInteger(pid) || pid <= 0) return null;

    const ps = Bun.spawn({
      cmd: ['ps', '-p', String(pid), '-o', 'command='],
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const cmd = (await new Response(ps.stdout).text()).trim();
    return { pid, cmd };
  } catch {
    return null;
  }
}

/** 端口是否被占 —— 优先用 lsof（权威），退化到直接试绑 */
async function isPortBusy(port: number): Promise<boolean> {
  const owner = await findPortOwner(port);
  if (owner) return true;
  try {
    const probe = Bun.serve({ port, hostname: '127.0.0.1', fetch: () => new Response('ok') });
    await probe.stop(true);
    return false;
  } catch {
    return true;
  }
}

/** 这条命令行是不是「本仓库的开发进程」 */
function isOwnProcess(cmd: string, service: 'api' | 'web'): boolean {
  if (service === 'api') return cmd.includes('apps/api/src/index.ts');
  return cmd.includes('vite') && (cmd.includes(REPO_ROOT) || cmd.includes('dev:web'));
}

/**
 * 腾出端口
 * —— 本仓库的旧实例：接管；别人的进程：一律不杀，说清楚就退出。
 */
async function releasePort(port: number, service: 'api' | 'web'): Promise<void> {
  if (!(await isPortBusy(port))) return;

  const owner = await findPortOwner(port);
  if (!owner) {
    throw new Error(
      `端口 ${port} 已被占用，但定位不到占用进程。\n` +
        `  请手动排查：lsof -nP -iTCP:${port} -sTCP:LISTEN`
    );
  }

  if (!isOwnProcess(owner.cmd, service)) {
    throw new Error(
      `端口 ${port} 被其他进程占用，拒绝启动：\n` +
        `  PID ${owner.pid}: ${owner.cmd}\n` +
        `  请先释放该端口，或改用 --api-port/--web-port 指定其他端口。`
    );
  }

  step(`端口 ${port} 上有本仓库的旧实例（PID ${owner.pid}），接管中…`);
  try {
    process.kill(owner.pid, 'SIGTERM');
  } catch {
    /* 进程可能刚好自己退了 */
  }

  for (let i = 0; i < 20; i += 1) {
    await Bun.sleep(250);
    if (!(await isPortBusy(port))) {
      ok(`端口 ${port} 已释放`);
      return;
    }
  }

  try {
    process.kill(owner.pid, 'SIGKILL');
    await Bun.sleep(500);
  } catch {
    /* 已经没了 */
  }
  if (await isPortBusy(port)) {
    throw new Error(`端口 ${port} 上的旧实例（PID ${owner.pid}）不肯退出，请手动处理。`);
  }
  ok(`端口 ${port} 已强制释放`);
}

/* ---------------------------------------------------------------- 环境 */

const ENV_TEMPLATE = `# 本地开发环境变量（已被 .gitignore 忽略，不会提交）
#
# GEMINI_API_KEY：本地占位值。填上真实 key 后 AI 端点才会走模型；
# 保持占位值时，模型调用会失败并自动降级到本地确定性实现。
GEMINI_API_KEY="local-dev-placeholder"
GEMINI_MODEL="gemini-2.5-flash"

APP_URL="http://localhost:5173"
PORT=3000
DATABASE_URL="pglite://./.data/pglite"
STORAGE_DIR="./.data/artifacts"
NODE_ENV=development
`;

/** 确保 .env 存在，并且 GEMINI_API_KEY 有值 —— 后端是 fail-fast 的 */
function ensureEnv(): void {
  const envPath = join(REPO_ROOT, '.env');
  if (!existsSync(envPath)) {
    writeFileSync(envPath, ENV_TEMPLATE, 'utf8');
    warn('未找到 .env，已按模板新建一份（GEMINI_API_KEY 是占位值，AI 调用会走本地降级实现）');
    return;
  }
  const content = readFileSync(envPath, 'utf8');
  const keyLine = content.split('\n').find((l) => l.trim().startsWith('GEMINI_API_KEY'));
  // 去掉引号再判空 —— `GEMINI_API_KEY=""` 在后端那里是 fail-fast 的，
  // 提前拦下来能省掉一轮"起了个死进程再去看日志"。
  const rawValue = keyLine?.includes('=') ? keyLine.split('=').slice(1).join('=').trim() : '';
  const hasKey = rawValue.replace(/^["']|["']$/g, '').length > 0;
  if (!hasKey) {
    throw new Error(
      '.env 里没有非空的 GEMINI_API_KEY —— 后端会 fail-fast 拒绝启动。\n' +
        '  请在 .env 中补上该变量后重试。'
    );
  }
}

/** 依赖没装就装 —— "一键"的本意就是不用人先跑一遍 install */
async function ensureDeps(opts: Options): Promise<void> {
  if (existsSync(join(REPO_ROOT, 'node_modules'))) return;
  if (!opts.install) {
    throw new Error('缺少 node_modules，请先执行 bun install（或去掉 --no-install 让脚本自动装）。');
  }
  step('未检测到 node_modules，正在执行 bun install…');
  const install = Bun.spawn({
    cmd: ['bun', 'install'],
    cwd: REPO_ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await install.exited;
  if (code !== 0) throw new Error(`bun install 失败（退出码 ${code}）`);
}

/* ------------------------------------------------------------ 服务管理 */

interface ServiceSpec {
  label: string;
  tag: string;
  color: string;
  cmd: string[];
  env: Record<string, string>;
}

class ManagedService {
  readonly spec: ServiceSpec;
  private proc: Bun.Subprocess | null = null;
  private exitPromise: Promise<number> | null = null;
  private stopPromise: Promise<void> | null = null;
  private pending = '';
  /** 最近若干行输出 —— 启动失败时用来把现场摊给用户看 */
  readonly tail: string[] = [];

  constructor(spec: ServiceSpec) {
    this.spec = spec;
  }

  get pid(): number | undefined {
    return this.proc?.pid;
  }

  /** 进程退出码 —— 谁先退出就以谁为准 */
  get exited(): Promise<number> {
    if (!this.exitPromise) throw new Error(`${this.spec.label} 还没启动`);
    return this.exitPromise;
  }

  start(): void {
    this.proc = Bun.spawn({
      cmd: this.spec.cmd,
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        ...this.spec.env,
        FORCE_COLOR: '1',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    this.exitPromise = this.proc.exited;
    if (this.proc.stdout instanceof ReadableStream) void this.pump(this.proc.stdout);
    if (this.proc.stderr instanceof ReadableStream) void this.pump(this.proc.stderr);
  }

  /** 逐行读子进程输出，加上来源前缀 —— 分不清哪行是谁抛的是最费时间的排查方式 */
  private async pump(stream: ReadableStream<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();
    for await (const chunk of stream) {
      this.pending += decoder.decode(chunk, { stream: true });
      const lines = this.pending.split('\n');
      this.pending = lines.pop() ?? '';
      for (const line of lines) this.write(line);
    }
    if (this.pending) this.write(this.pending);
  }

  private write(line: string): void {
    this.tail.push(line);
    if (this.tail.length > 40) this.tail.shift();
    const tag = paint(this.spec.color, `[${this.spec.tag}]`);
    console.log(`${tag} ${line}`);
  }

  /** 打印最近的输出 —— 进程秒退时用它说清楚「为什么死」 */
  printTail(lines = 20): void {
    if (this.tail.length === 0) return;
    log(paint(C.gray, `  —— ${this.spec.label}最后的输出 ——`));
    for (const line of this.tail.slice(-lines)) log(paint(C.gray, `  ${line}`));
  }

  /**
   * 停掉进程。
   * 重复调用会**返回同一个 Promise** —— 两次 stopAll 竞速时，
   * 后一次必须等前一次真的把进程停干净，不能提前 exit 把孩子留成孤儿。
   */
  stop(): Promise<void> {
    if (!this.stopPromise) this.stopPromise = this.doStop();
    return this.stopPromise;
  }

  private async doStop(): Promise<void> {
    const proc = this.proc;
    if (!proc || proc.killed) return;
    try {
      proc.kill('SIGTERM');
    } catch {
      /* 已经死了 */
    }
    const exited = await Promise.race([
      proc.exited.then(() => true),
      Bun.sleep(3000).then(() => false),
    ]);
    if (!exited) {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* 已经死了 */
      }
    }
  }
}

/* ------------------------------------------------------------ 健康检查 */

async function waitForHttp(
  url: string,
  timeoutMs: number,
  accept: (res: Response) => boolean
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (accept(res)) return true;
    } catch {
      /* 还没起来 */
    }
    await Bun.sleep(300);
  }
  return false;
}

/* ------------------------------------------------------------------ 主流程 */

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  const apiUrl = `http://localhost:${opts.apiPort}`;
  const webUrl = `http://localhost:${opts.webPort}`;

  log('');
  log(paint(C.bold, '  AI PPT Studio · 开发环境启动'));
  log(paint(C.gray, `  ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`));
  log('');

  await ensureDeps(opts);
  ensureEnv();

  step('检查端口占用…');
  await releasePort(opts.apiPort, 'api');
  await releasePort(opts.webPort, 'web');

  /* --- 后端 --- */
  const api = new ManagedService({
    label: '后端 API',
    tag: 'API',
    color: C.cyan,
    cmd: ['bun', 'run', 'dev'],
    env: {
      PORT: String(opts.apiPort),
      // CORS 白名单跟着前端端口走，别让两个端口各说各话
      APP_URL: webUrl,
    },
  });

  log('');
  step(`启动后端 API（:${opts.apiPort}）…`);
  api.start();

  // 探 `/readyz`（就绪，会 ping DB）而不是 `/healthz`（存活，不碰 DB）——
  // 数据库还没就绪时后端进程已经在了，探存活会给出"起来了"的假象。
  const apiUp = await waitForHttp(`${apiUrl}/readyz`, 30_000, (res) => res.ok);
  if (!apiUp) {
    fail('后端 30 秒内没有就绪。');
    api.printTail();
    await api.stop();
    process.exit(1);
  }
  ok(`后端已启动 → ${apiUrl}`);

  const apiReady = await waitForHttp(`${apiUrl}/readyz`, 5_000, (res) => res.ok);
  if (!apiReady) {
    warn('后端进程存活，但 /readyz 未通过（数据库可能还没就绪）——页面能开，AI 相关功能可能报错。');
  }

  /* --- 前端 --- */
  const viteArgs = ['run', 'dev:web', '--', '--port', String(opts.webPort), '--strictPort'];
  if (opts.host) viteArgs.push('--host', opts.host);

  const web = new ManagedService({
    label: '前端 Web',
    tag: 'WEB',
    color: C.magenta,
    cmd: ['bun', ...viteArgs],
    env: {
      // 前端的 /api 代理指向本次实际启动的后端端口
      API_ORIGIN: apiUrl,
    },
  });

  log('');
  step(`启动前端 Web（:${opts.webPort}）…`);
  web.start();

  const webUp = await waitForHttp(webUrl, 30_000, () => true);
  if (!webUp) {
    fail('前端 30 秒内没有就绪。');
    web.printTail();
    await web.stop();
    await api.stop();
    process.exit(1);
  }
  ok(`前端已启动 → ${webUrl}`);

  /* --- 汇总 --- */
  log('');
  log(paint(C.gray, '  ────────────────────────────────────────────'));
  log(`  ${paint(C.bold, '前端 Web')}   ${paint(C.cyan, webUrl)}`);
  log(`  ${paint(C.bold, '后端 API')}   ${paint(C.cyan, apiUrl)}`);
  log(`  ${paint(C.bold, '接口代理')}   /api → ${apiUrl}`);
  log(paint(C.gray, '  ────────────────────────────────────────────'));
  log(paint(C.gray, '  Ctrl+C 停止全部服务'));
  log('');

  /* --- 收尾：一个先死，另一个也得跟着走 --- */
  let stopping = false;
  const stopAll = async (): Promise<void> => {
    await Promise.all([web.stop(), api.stop()]);
  };

  const shutdown = async (reason: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    log('');
    log(paint(C.gray, `  ${reason}，正在停止服务…`));
    await stopAll();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('收到 Ctrl+C'));
  process.on('SIGTERM', () => void shutdown('收到 SIGTERM'));

  const first = await Promise.race([
    api.exited.then((code) => ({ who: '后端 API', code })),
    web.exited.then((code) => ({ who: '前端 Web', code })),
  ]);

  // 这条 race 也可能是因为「我们自己正在停服务」才 resolve 的 ——
  // 那种情况下不是故障，不该报红字、不该以非零码退出。
  if (stopping) {
    await stopAll();
    process.exit(0);
  }

  fail(`${first.who}已退出（退出码 ${first.code}），正在停止另一个服务…`);
  if (first.who === '后端 API') api.printTail();
  else web.printTail();
  await stopAll();
  process.exit(first.code === 0 ? 1 : first.code);
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
