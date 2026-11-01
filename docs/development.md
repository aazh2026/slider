# AI PPT Studio · 本地开发

> 配套文档：[`architecture.md`](./architecture.md) · [`backend-design.md`](./backend-design.md) · [`testing-strategy.md`](./testing-strategy.md)
> 版本：v1.0 · 2026-11-01

---

## 1. 一键启动

```bash
bun run dev:all
```

macOS 上也可以直接**双击仓库根目录的 `dev.command`**（等价于上面这条命令）。

一条命令同时拉起前后端：

| 服务 | 命令 | 默认端口 | 说明 |
|---|---|---|---|
| 后端 API | `bun run dev` | `3000` | Bun + Hono，`--hot` 热重载 |
| 前端 Web | `bun run dev:web` | `5173` | Vite + React，`/api` 代理到后端 |

启动器（[`scripts/dev.ts`](../scripts/dev.ts)）负责三件手敲两条命令做不到的事：

1. **按顺序起** —— 后端 `/readyz` 通过之后才启动前端。后端是 fail-fast 的（缺 `GEMINI_API_KEY` 直接非零退出），并行起会让"后端已经死了、前端照样把页面开出来"变成常态。
2. **标好来源** —— 两个进程的输出分别带 `[API]` / `[WEB]` 前缀，分不清哪行是谁抛的是最费时间的排查方式。
3. **一起收** —— `Ctrl+C` 同时停掉两个服务，不留占着 3000 端口的孤儿进程。

### 可选参数

```bash
bun run dev:all -- --api-port 4000          # 换后端端口
bun run dev:all -- --web-port 5174          # 换前端端口
bun run dev:all -- --host 0.0.0.0           # 前端监听所有网卡（局域网可访问）
bun run dev:all -- --help
```

改了端口之后，`APP_URL`（后端 CORS 白名单）和 `API_ORIGIN`（前端代理目标）会跟着一起改 —— 这两个值由启动器显式注入并覆盖 `.env`，不会出现"端口换了但白名单还是旧的"这种半对半错的状态。

### 端口冲突的处置

| 占用者 | 行为 |
|---|---|
| 本仓库的旧实例 | **接管**：SIGTERM → 等待释放 → 必要时 SIGKILL |
| 其他进程 | **拒绝启动**，打印 PID 和命令行，并提示改用 `--api-port` / `--web-port` |

绝不擅自杀掉不认识的进程。

---

## 2. 环境准备

### 依赖

- [Bun](https://bun.sh)（≥ 1.3）—— 后端运行时与包管理器
- Node.js —— Vite 运行时

```bash
bun install
```

`node_modules` 缺失时，启动器会自动执行一次 `bun install`（`--no-install` 可关掉）。

### 环境变量

后端配置从仓库根目录的 `.env` 读取（**已被 `.gitignore` 忽略**）。首次运行时若 `.env` 不存在，启动器会按模板新建一份。

关键变量：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `GEMINI_API_KEY` | —（**必填**） | 缺失则后端 fail-fast 拒绝启动。保持占位值时，AI 调用会走本地确定性降级实现 |
| `GEMINI_BASE_URL` | 官方端点 | 模型端点覆盖。**只为离线可测而存在** —— E2E 把它指向本地替身，于是判据结论不取决于外网状态。日常开发不要设 |
| `MODEL_TIMEOUT_MS` | `20000` | 单次模型调用超时（毫秒）。超时后由 SDK 真正 abort 掉请求 |
| `PORT` | `3000` | 后端端口 |
| `APP_URL` | `http://localhost:5173` | CORS 白名单 |
| `DATABASE_URL` | `pglite://./.data/pglite` | `pglite://` 走进程内 PGlite；`postgres://` 走真实 PostgreSQL |
| `STORAGE_DIR` | `./.data/artifacts` | 导出产物落盘目录 |

> `GEMINI_API_KEY` 用真实 key 之前，AI 相关功能（需求拆解、大纲生成、增量改页）会自动降级到本地实现 —— 功能可用，但不是模型质量。

---

## 3. 验证栈是否真的起来了

```bash
curl -s localhost:3000/healthz     # 进程存活
curl -s localhost:3000/readyz      # 数据库就绪
curl -s localhost:5173/             # 前端首页
curl -s localhost:5173/api/meta/models   # 经前端代理打后端
```

最后一条最有用：它同时验证了前端代理链路和后端本身。

---

## 4. 其他命令

| 命令 | 作用 |
|---|---|
| `bun run dev` | 只起后端 |
| `bun run dev:web` | 只起前端 |
| `bun run lint` | 类型检查（`tsc --noEmit`） |
| `bun test` | 全部单元测试 |
| `bun run test:core` / `test:api` | 按层跑 |
| `bun run test:e2e` | 前后端集成 E2E（Playwright，需要前后端都起着） |
| `bun run spec` | SPEC 验证 |

---

## 5. 常见问题

**端口被占，但不知道是谁占的**

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

**改了 `vite.config.ts` 之后代理不生效**

前端代理目标由 `API_ORIGIN` 决定。启动器会把它设成当前实际的后端端口；如果你是手动 `bun run dev:web` 起的，它会退回默认的 `http://localhost:3000`。

**后端启动即失败**

后端是 fail-fast 的：环境变量不合法（尤其缺 `GEMINI_API_KEY`）会直接以非零码退出，并在日志里说清缺的是哪个变量 —— 日志里已经写明原因，不用猜。

**PGlite 数据库锁住**

同一个数据目录不能被两个进程同时打开。确认没有遗留的后端进程：

```bash
pgrep -fl "apps/api/src/index.ts"
```
