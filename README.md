# AI PPT Studio

> **以结构化 Slide IR 为唯一真相、以确定性排版内核保证质量、以多 Agent 编排驱动内容生产的演示文稿工程平台。**

输入一句话或一份文档，产出一份可继续编辑、可追溯版本、可交付（PPTX / PDF / PNG）的演示文稿 —— 每一页的几何都由纯函数算出，不依赖模型"画"坐标。

---

## 快速开始

```bash
bun run dev:all
```

一条命令拉起前后端（后端 `:3000`、前端 `:5173`）。macOS 上可直接双击仓库根目录的 `dev.command`。

<details>
<summary>前提与首次准备</summary>

- **[Bun](https://bun.sh) ≥ 1.3** —— 后端运行时与包管理器
- **Node.js ≥ 20.19**（或 ≥ 22.12）—— Vite 运行时要求
- **`.env`** —— 不存在时脚本会自动按模板新建。其中 `GEMINI_API_KEY` 用真实 key 之前，AI 相关功能会走**本地确定性降级实现**（功能可用，但不是模型质量）

```bash
bun install     # 依赖缺失时 dev:all 会自动执行一次
```

</details>

启动器（[`scripts/dev.ts`](scripts/dev.ts)）负责三件手敲两条命令做不到的事：

1. **按顺序起** —— 后端 `/readyz` 通过之后才启动前端（后端是 fail-fast 的，缺 `GEMINI_API_KEY` 会直接退出）
2. **标好来源** —— 两边输出分别带 `[API]` / `[WEB]` 前缀
3. **一起收** —— `Ctrl+C` 同时停掉两个服务，不留占着端口的孤儿进程

常用参数：

```bash
bun run dev:all -- --api-port 4000 --web-port 5174 --host 0.0.0.0
```

改端口后，`APP_URL`（CORS 白名单）与 `API_ORIGIN`（前端代理目标）会自动跟着走。详见 [`docs/development.md`](docs/development.md)。

---

## 技术栈

| 层 | 选型 |
|---|---|
| 运行时 / 语言 | Bun 1.3 · TypeScript |
| 前端 | React 19 · Vite 8 · Tailwind 4 |
| 后端 | Hono 4 · Zod 4 |
| 存储 | Drizzle ORM · PostgreSQL 16（本地开发用 PGlite 进程内库） |
| AI | `@google/genai`（统一 `ModelRouter` 抽象，含降级链与调用记账） |
| 导出 | `pptxgenjs` · `pdf-lib` · `@resvg/resvg-js` |
| 测试 | `bun test` · Playwright（E2E）· 黄金快照 |

---

## 目录结构

```
slider/
├── apps/
│   └── api/                 后端服务（Hono）
│       ├── src/routes/      auth · projects · ai · quality · exports · templates · documents
│       ├── src/db/          Drizzle schema · PGlite/PG 客户端
│       ├── src/services/    ModelRouter · GeminiClient · 降级链
│       └── src/middleware/  auth · rateLimit · requestId · errorHandler
├── packages/
│   └── core/                @ppt/core —— 前后端共享的领域内核
│       ├── src/engine/      layoutEngine · contentBinding · patchApplier
│       │                    qualityEngine · svgRenderer · exportEngine · textMetrics
│       ├── src/contracts/   outline · patch（契约）
│       ├── src/data/        templates（8 套主题）· layoutIntents
│       └── src/types/       slide（SlideIR）· content（SlideContent 槽位）
├── src/                     前端应用
│   ├── components/          创建中心 · 大纲编辑 · 工作台 · 模板中心
│   │                        质量中心 · 演示模式 · 导出 · 项目管理 · 认证
│   └── services/            apiClient · authService · aiService · projectStorage
├── spec/                    可执行规格（契约 → 判据 → 验证器 → 证据）
│   ├── spec.yaml            49 条条款 / 64 条判据
│   └── verify/              独立 Oracle + 变异检查 + 追溯矩阵
├── docs/                    设计文档
├── scripts/                 dev.ts（一键启动）· check-coverage.ts 等
└── e2e/                     Playwright 前后端集成测试
```

---

## 核心概念

### IR 三层管线

架构的中枢。**分界线就是产品的质量承诺**：AI 到 L2 为止，L2 → L3 是确定性计算。

| 层 | 内容 | 来源 |
|---|---|---|
| **L1 需求层** | `PresentationRequirement`（主题、用途、受众、页数、风格） | 人工表单 + AI 抽取 |
| **L2 叙事 + 排版层** | `SlideOutlineItem` + `SlideContent`（版式槽位契约） | AI 产出 + 人工编辑 + `contentBinding` 补全 |
| **L3 像素层** | `SlideIR`（画布、版式、元素与几何） | `layoutEngine` 纯函数计算，**AI 永不介入** |

### 8 种版式 × 8 套主题

版式消费 `SlideContent` 槽位（bullets / layers / columns / metrics / phases / radial / summary / meta）。槽位缺失时由 `bindContent` 从大纲确定性补全 —— **任何路径都不允许回落到硬编码演示文案**。

版式：`title_cover` · `architecture_diagram` · `cards_grid` · `problem_solution` · `timeline_roadmap` · `stats_kpi` · `radial_center` · `summary_conclusion`

### 质量四维评分

| 维度 | 权重 | 看什么 |
|---|---|---|
| **Qs** 结构 | 0.3 | 画布比例异常、重复元素 ID |
| **Qv** 视觉 | 0.3 | 超出安全边距、卡片空间重叠碰撞 |
| **Qc** 内容 | 0.2 | 缺少标题概括、缺少核心结论（Key Takeaway） |
| **Qg** 一致性 | 0.2 | 页数过少、缺少封面引导页 |

### 前后端同源

`@ppt/core` 是**唯一一份**排版与渲染实现，前端预览与后端导出走同一套代码 —— 预览和交付不可能对不上。

### 增量编辑

AI 编辑返回 `IRPatch[]` 而非全量元素，由 `patchApplier` 统一施加并校验：token 降一个量级、可审计、可回放。

---

## API 一览

所有路由挂 `/api` 前缀，`/healthz`、`/readyz` 例外。

| 分组 | 端点 |
|---|---|
| **认证** | `POST /api/auth/register` · `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` |
| **项目** | `GET/POST /api/projects` · `GET/PATCH/DELETE /api/projects/:id` · `POST /:id/duplicate` · `POST /:id/import` |
| **大纲** | `PATCH /api/projects/:id/outline` · `POST /:id/outline/regenerate` |
| **编译** | `POST /api/projects/:id/compile` · `GET /:id/content` · `GET /:id/slides` · `GET/PATCH/DELETE /:id/slides/:slideId` |
| **AI** | `POST /api/ai/requirement` · `POST /api/ai/outline` · `POST /api/ai/edit-slide` · `POST /api/ai/slides/:slideId/suggest` |
| **质量** | `POST /api/quality/evaluate` · `POST /api/quality/auto-fix` |
| **导出** | `POST /api/exports` · `GET /:id` · `GET /:id/download` · `GET /:id/events`（SSE） |
| **模板** | `GET /api/templates` · `POST /api/templates/:id/apply` |
| **文档** | `GET /api/projects/:id/documents` · `GET /api/documents/:id/text` · `DELETE /api/documents/:id` |

**响应信封统一**：成功 `{ data, traceId }`，失败 `{ error: { code, message, details? }, traceId }`。

**认证走 HttpOnly Cookie**，跨租户隔离下别人的资源返回 `404` 而非 `403`（不泄露存在性）。

---

## 常用命令

| 命令 | 作用 |
|---|---|
| `bun run dev:all` | **一键启动前后端** |
| `bun run dev` / `bun run dev:web` | 只起后端 / 只起前端 |
| `bun run lint` | 类型检查（`tsc --noEmit`） |
| `bun test` | 全部单元测试 |
| `bun run test:core` / `test:api` | 按层跑 |
| `bun run test:e2e` | 前后端集成 E2E（Playwright，需前后端都起着） |
| `bun run coverage` | 覆盖率报告（判据执行 + 领域内核 + 应用层） |
| `bun run check:coverage` | **质量门禁** —— 领域内核行覆盖率 ≥ 90%，不达标即阻断 |
| `bun run spec` | **SPEC 全链路验证**（见下） |

---

## 测试与可执行规格

`docs/` 下的五份设计文档（架构 / 后端设计 / 后端特性 / 测试策略 / 测试用例）被拆成机器可读的契约层：

```
需求意图 → 行为契约 → 正确性判据 → 独立 Oracle → 可执行验证 → 执行证据
```

```bash
bun run spec                # 推荐：跑完整条链路
```

`bun run spec` 依次执行六步：

| 步骤 | 做什么 |
|---|---|
| ① Spec 结构校验 | `spec.yaml` 是否符合 `spec.schema.json`（JSON Schema 2020-12） |
| ② 类型检查 | 验证器代码自身的 `tsc --noEmit` |
| ③ 判据执行 | `spec/verify/` + 领域内核 + 应用层 + 覆盖率门禁 + 导出基准 |
| ④ 前后端集成 E2E | 真实浏览器 + 真实服务端（每轮换端口，绝不静默复用旧进程） |
| ⑤ 注入错误检查 | **验证器的元验证** —— 故意改坏实现，看验证器抓不抓得住 |
| ⑥ 生成追溯矩阵 | `spec/traceability.md`（条款 → 判据 → 证据） |

也可以单步执行：

```bash
bun run spec:schema         # 校验 spec.yaml 结构
bun run spec:test           # 执行全部验收判据
bun run spec:mutation       # 变异检查 —— 故意改坏实现，看验证器抓不抓得住
bun run spec:traceability   # 重新生成追溯矩阵
```

E2E 的判据全部落在**服务端状态**上（"UI 操作了什么 → 服务端库里到底存了什么"），只断言 UI 文本的话，把后端整个换成假实现也能通过 —— 那就证明不了前后端集成。

---

## 文档

| 文档 | 内容 |
|---|---|
| [`docs/development.md`](docs/development.md) | **本地开发** —— 一键启动、环境变量、排查 |
| [`docs/architecture.md`](docs/architecture.md) | 产品技术架构 · 分层 · IR 管线 · 12 条 ADR |
| [`docs/backend-design.md`](docs/backend-design.md) | 后端服务详细设计（端点、契约、数据模型、安全） |
| [`docs/backend-features.md`](docs/backend-features.md) | 后端特性清单 |
| [`docs/testing-strategy.md`](docs/testing-strategy.md) | 测试策略与发布门槛 |
| [`docs/test-cases.md`](docs/test-cases.md) | 测试用例清单 |
| [`spec/README.md`](spec/README.md) | 可执行规格说明 |

---

## 许可

源码头部标注 `SPDX-License-Identifier: Apache-2.0`。
