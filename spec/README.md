# AI PPT Studio · 可执行规格（Spec）

本目录把 `docs/` 下的五份设计文档拆成了**结构化、可执行、可验证、可追溯**的契约层。

```
需求意图 → 行为契约 → 正确性判据 → 独立 Oracle → 可执行验证 → 执行证据
```

任何一环断了，Spec 就退化成「看起来很完整的文档」。本目录的每个文件都服务于这条链路上的一环。

---

## 快速开始

```bash
bun run spec/verify/all.ts      # 跑完整条链路（推荐）
```

等价的分步命令：

| 命令 | 作用 |
|---|---|
| `bun run spec:schema` | 校验 `spec/spec.yaml` 是否符合 `spec/spec.schema.json` |
| `bun run spec:test` | 执行全部验收判据（`bun test spec/verify/`） |
| `bun run spec:mutation` | 注入错误检查 —— 验证器抓不抓得住错 |
| `bun run spec:traceability` | 从 `spec.yaml` + 执行产物重新生成 `spec/traceability.md` |

调试注入检查时可以只跑指定的判据（**正式出报告必须跑全量**）：

```bash
MUTATION_CHECK_DRY_RUN=1 bun run spec/verify/mutation-check.ts          # 只校验锚点，不注入
MUTATION_CHECK_ONLY=AC-E2E-011 bun run spec/verify/mutation-check.ts   # 只跑一条
```

**依赖**：Bun ≥ 1.3.11（`bun test` 内置）、Python 3 + `jsonschema`（仅用于结构校验）、Node 侧的 `typescript`（类型检查）。
`jszip` 与 `bun-types` 是 devDependency —— 前者用于**回读** PPTX 产物（pptxgenjs 自己写包用的就是它），后者只为类型检查。

---

## 目录结构

| 文件 | 作用 | 性质 |
|---|---|---|
| `spec.yaml` | 条款 / 判据的机器可读契约（当前 49 条条款 / 64 条判据） | **手写** —— 唯一的事实来源 |
| `spec.schema.json` | Spec 自身的结构约束（JSON Schema 2020-12） | 手写 |
| `verify/spec-schema.py` | 结构校验器 | 手写 |
| `verify/spec-structure.test.ts` | 引用完整性（悬空 ID、判据与验证器对不上、成熟度自洽） | 手写 |
| `verify/helpers.ts` | 夹具与取文本的公共工具 —— 只搭台子，判定逻辑一律写在各自的 test 里 | 手写 |
| `verify/core-layout.test.ts` | 版式引擎契约（画布、越界、ID 唯一、纯函数、母版） | 手写 |
| `verify/core-content.test.ts` | 内容绑定契约（版式是否真的消费 outline） | 手写 |
| `verify/quality-engine.test.ts` | 质量评分契约（公式权重与各项扣分） | 手写 |
| `verify/render-svg.test.ts` | SVG 渲染契约（转义、foreignObject、外链字体、元素 ID、四层结构） | 手写 |
| `verify/export-pptx.test.ts` | 导出契约（PPTX 文本保真、演讲者备注、PNG 倍率、文件名清洗） | 手写 |
| `verify/servers.ts` | 为 E2E 拉起后端 + 前端的编排（**每轮换端口**，绝不静默复用旧进程） | 手写 |
| `verify/model-stub.ts` | 模型端点替身的启动器（**独立进程** —— 见下方「为什么替身不能同进程」） | 手写 |
| `verify/model-stub-server.ts` | 模型端点替身本体（独立进程，返回官方端点在占位 key 下的原样 400） | 手写 |
| `verify/repro-flake.ts` | E2E 抖动的复现循环（每轮重起服务，抓服务端日志与浏览器日志） | 手写 |
| `verify/mutation-check.ts` | **验证器的元验证** —— 故意改坏实现，看验证器报不报错 | 手写 |
| `verify/traceability.ts` | 追溯矩阵与验证报告生成器 | 手写 |
| `verify/all.ts` | 全链路入口 | 手写 |
| `traceability.md` | 追溯矩阵 + 验证报告 | **生成** —— 不要手改 |
| `evidence/junit.xml` | 单元 / 集成判据执行的原始证据 | 生成 |
| `evidence/junit-e2e.xml` | 前后端集成 E2E 的原始证据 | 生成 |
| `evidence/mutation-report.json` | 注入检查的原始证据 | 生成 |
| `evidence/coverage.json` | 领域内核覆盖率的原始证据 | 生成 |
| `evidence/e2e-browser.log` | E2E 浏览器侧证据（console / 请求失败 / 4xx+ 响应） | 生成 |
| `evidence/e2e-browser-<判据>-<轮次>.log` | 注入检查每轮的浏览器侧证据（每轮单独一份，不互相覆盖） | 生成 |
| `evidence/flake-repro.log` | E2E 抖动复现的每轮输出 | 生成 |

Spec 目录之外，判据的验证器还包括：

| 位置 | 作用 |
|---|---|
| `packages/core/tests/` | 领域内核（`@ppt/core`）的版式快照与补丁应用测试 |
| `apps/api/tests/` | 后端的契约 / 集成 / 安全 / AI / 混沌 / 性能测试 |
| `src/services/projectMerge.test.ts` | 前端唯一的单元测试 —— 摘要/全量合并的回归锁（`bun test` 默认规则会扫到） |
| `e2e/integration.e2e.ts` | 前后端集成 —— Playwright 驱动真实 Chromium + 真实服务端 |
| `scripts/check-coverage.check.ts` | 覆盖率门禁的可执行判据（SPEC-GOV-001） |

---

## 怎么读 `spec.yaml`

一条 clause = **一个可以独立写出一条验收判据的原子要求**。

```yaml
- id: SPEC-CORE-003              # 编号发布后不再重排
  title: 元素 ID 在整个项目内全局唯一
  type: technical                # business | technical | quality | governance
  risk: high                     # high | medium | low
  statement: "同一项目内所有元素的 id 必须两两不同"
  source:                        # 必填 —— 必须能定位回原文
    doc: "docs/architecture.md"
    section: "§12 ADR-012"
    quote: "……"
  acceptance:                    # 每条判据必须可机械执行
    - id: AC-CORE-003
      criterion: "……"
      oracle:                    # 必填 —— 「正确答案」从哪来
        tier: formal             # authoritative | expert | formal | statistical | human | self-derived
        source: "……"
        confidence: high
      verification:
        kind: test
        target: "spec/verify/core-layout.test.ts::element-ids-unique-across-slides"
        command: "bun test spec/verify/core-layout.test.ts"
        pass_when: "退出码 0，且该用例未被 skip"
      maturity: automated        # automated | semi | manual | none
  maturity: automated
```

### Oracle tier 怎么看

| tier | 含义 | 能不能单独支撑一条 high 风险条款的 PASS |
|---|---|---|
| `authoritative` | 权威业务规则原文（需求文档明确条款） | 能 |
| `expert` | 专家 / 领域负责人确认的基准案例 | 能 |
| `formal` | 类型、schema、不变量等形式化约束 | 能 |
| `statistical` | 统计评估、分布性判据 | 需辅以其他 tier |
| `human` | 人工评审 / 盲评（须记录评审者与量表） | 需辅以其他 tier |
| `self-derived` | **从被测实现反推出来的** | **不能** |

`self-derived` 不是不能写，但必须显式标注 —— 它只能防回归，不能证明实现正确。

### 成熟度不等于结论

- `maturity: automated` —— 判据**有**可执行验证器
- `maturity: planned` —— 判据写好了，验证器**还没建**（≠「已通过」）
- `maturity: none` —— 判据根本写不出来（如阈值未给出）

**真实结论看 `spec/traceability.md`**，三态：`PASS` / `FAIL` / `INCONCLUSIVE`。没跑过的验证一律 `INCONCLUSIVE`。

---

## 改 Spec 的流程

1. 改 `spec/spec.yaml`（条款、判据、oracle、成熟度）
2. `bun run spec:schema` —— 结构合法性
3. `bun test spec/verify/` —— 新判据是否真的被执行、是否真的能抓到错
4. `bun run spec:mutation` —— 为新的关键判据补一个注入用例
5. `bun run spec:traceability` —— 重新生成矩阵

第 4 步不能省。**「测试通过」本身不证明测试有效** —— 只有「把实现改坏，验证器报错」才能证明。

---

## 验证器怎么写

三条规矩：

1. **断言写在 test 文件里，不写在 helper 里。** helper 只造夹具、抽文本。判定逻辑藏进 helper 会导致失败时说不清是哪条判据挂了。
2. **验产物，不信返回值。** PPTX 导出要解包回读 XML；SVG 要读真实字符串；不要断言「导出函数返回了一个我们传进去的东西」。
3. **用外部可辨识标记，不要用「不等于空」这种弱断言。** `helpers.ts` 里的 `MARKER = 'ZQ7MARKER'` 就是干这个的 —— 任何硬编码演示文案都不可能命中它。

---

## 已知的状态

**具体数字请看 `spec/traceability.md`**（由 `spec/verify/traceability.ts` 从执行产物现场生成，不手写）。
本节只写**不会随代码变动的实质事实**：

- 后端（`apps/api`：Hono + Drizzle + PGlite + ModelRouter + 鉴权 + 导出）**已实现**，
  领域内核抽在 `packages/core`（`@ppt/core`），前端已接到真实后端上。
- **目前没有 FAIL 判据**。追溯矩阵 §2.2 为空即为证据。
- **1 条判据被修订过 —— `AC-EXP-001`，记录在 `spec.yaml` DEC-003。**
  原写法「每个 IR 字符串完整出现在某一个 `<a:t>` 运行里」对**含换行**的 IR 字符串永远不可满足
  （PPTX 段落以换行为界，pptxgenjs 见到 `\n` 必定拆段，DrawingML 的 `<a:t>` 里也不存在字面换行）。
  判据改为以「行」为单位，并追加**集合相等**这一更强的不变式（既不缺正文、也不多出固定文案、
  任何两行不得拼在同一运行里）。判据的权威来源（EXP-15 / EXP-17「回读产物校验关键文本存在」）未动。
  **这不是降标准换绿 —— 唯一被放宽的是那个格式上不可能的『一个字符串一个运行』，
  同时被收紧的是反串行能力。**
- **1 条条款无判据**（SPEC-GOV-003）—— 质量闸门分数线在五份文档中从未给出，判据无法成立（AMB-001）。
- **AC-NFR-001 是 INCONCLUSIVE** —— 验证器已建成，但本轮只跑了降级模式（`.env` 里的
  `GEMINI_API_KEY` 是占位符），真实模型下的 P95 从未被采样到。
  **没跑过的验证不是通过** —— 这一条不能用降级模式的结果顶替。
- **E2E 是离线的 —— 这是文档要求，不是偷懒。**
  `docs/testing-strategy.md` §6.1 明写「`bun test` 一律使用回放，不烧 API 额度」，
  `docs/backend-design.md` §13 的测试分层把「AI 离线 → 录制响应回放」列为独立一层。
  E2E 之前直连官方端点（`.env` 里是占位 key），**违反**了这一条。
  现在模型端点被指向本地替身 `spec/verify/model-stub-server.ts`，
  它返回官方端点在占位 key 下的**原样** 400 响应体 ——
  链路仍是「真 HTTP → 真 SDK → 真错误分类（400 不可重试）→ 真降级链 → 真本地生成」，
  被换掉的只有链路尽头那台机器。
  **结论的适用范围**：E2E 证明的是「模型不可用时前后端仍然集成正确」，
  **不**证明真实模型下的生成质量或延迟（那两项由 `apps/api/tests/ai/`、`apps/api/tests/perf/` 覆盖，
  同样不是真实模型；要用真实模型验证只能去预发环境单独跑，不能进 `bun test`）。
- **AC-E2E-012 的基线曾经是掷硬币** —— 「生成大纲」那一步只等 60s，
  而降级链的最坏耗时正好是 3 × 20s 模型超时 = 60s。官方端点实测既有 300ms 返回 400 的常态，
  也有 TLS 校验失败、整整 20s 连不上的时刻 —— 外网一抖，判据就"失败"了。
  **一次失败的判据分不清是实现坏了还是外网抽风，证据就不成立。**
  改走本地替身后模型调用在 0–7ms 内失败（不再是 60,756ms），一轮 E2E 约 10s。
  复现脚本：`bun run spec/verify/repro-flake.ts`。
- **注入检查本身也被查过多次**，每一次都发现了元验证框架自己的缺陷：
  锚点不唯一导致注入落到别的代码路径；E2E 复用同一个服务进程导致注入根本没进到被测系统里；
  端口撞车 + 探活只看 `res.ok` 导致「前端起来了」是假的；
  替身跑在调用方进程里（`Bun.spawnSync` 阻塞事件循环，同进程的 HTTP 服务应答不了）；
  E2E 的页面被 vite 热重载（dev server 监听整个项目根目录，PGlite 一直在改文件），
  重载把 React 的内存状态清空，E2E 断链。现在 E2E 的 vite 一律带 `DISABLE_HMR=true`。
  修复过程与理由写在 `spec/traceability.md` §2.4 的说明段里。
- **E2E 顺带挖出两个真实的前端缺陷**（已修）：
  `App.tsx` 的 `loadProjects()` 用**摘要**覆盖已加载的全量，而摘要里的 `slides` 恒为空数组
  —— 已加载的每一页 IR 被抹掉；`Workbench.tsx` 在 `project.slides` 为空时仍一路解引用
  `currentSlide`，`Cannot read properties of undefined (reading 'slideId')` 直接把整个应用打崩
  （仓库里没有错误边界）。这是 E2E 的价值 —— 它抓到了单元测试抓不到的东西。
  合并逻辑抽成了纯函数 `src/services/projectMerge.ts`，并配了回归测试
  `src/services/projectMerge.test.ts`（断言用可辨识标记，不靠「不等于空」）。
- **4 处源文档段落未纳入**，理由见 `spec/traceability.md` §1.4。
  遗漏必须显式说明 —— 静默丢弃的段落是「覆盖率 100%」假象的主要来源。

---

## 改实现的顺序

按 `spec/traceability.md` §2.2 的根因逐条修，修完跑 `bun run spec/verify/all.ts`。
**不要通过删判据、降阈值、缩覆盖来让测试变绿** —— 那是本任务最严重的失败模式。

修完实现后，**还要补一条注入用例**证明新验证器抓得住错 —— 见上文「改 Spec 的流程」第 4 步。

