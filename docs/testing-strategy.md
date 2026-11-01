# AI PPT Studio · 测试策略

> 配套文档：[`architecture.md`](./architecture.md) · [`backend-design.md`](./backend-design.md) · [`backend-features.md`](./backend-features.md)
> 版本：v1.0 · 2026-11-01
> 现状基线：**测试基建为零** —— 无测试文件、无 CI、无覆盖率工具、无测试依赖

---

## 1. 测试目标

### 1.1 必须被证明的三类断言

| 断言类型 | 定义 | 判定方式 | 覆盖的层 |
|---|---|---|---|
| **确定性正确性** | 给定相同输入，输出必须**逐字节一致** | 黄金快照比对 | 领域内核（`@ppt/core`） |
| **契约一致性** | 前后端、API 与模型厂商对同一份 IR / Schema 的解释必须一致 | 契约测试 + Schema 快照 | 契约层 + 应用层 |
| **概率质量** | AI 生成的内容必须**达标且可度量** | 评估套件（eval）+ 质量闸门 | 编排层 |

**这个系统的特殊性**：前两类断言是传统工程范式，第三类不是。AI 组件无法用"断言输出等于期望值"来测——它需要**指标 + 阈值 + 趋势**的评估范式。因此本策略把 AI 质量当作一等公民的测试对象，而不是"能跑通就算过"。

### 1.2 可发布门槛（Definition of Done）

一个版本可发布，必须同时满足：

```
□ 领域内核行覆盖率 ≥ 90%
□ 黄金快照全部一致（64 组：8 版式 × 8 主题）
□ API 契约快照无未审变更
□ eval: schema_valid_rate = 100%（100 次生成）
□ eval: slot_completeness ≥ 95%
□ 导出产物验证全部通过（含中文 PDF 文本可读性检查）
□ 越权用例 100% 拦截
□ 降级路径：主模型完全故障时端点仍返回合法内容
□ 零 P0/P1 缺陷未关闭
```

---

## 2. 测试分层总览

| 层 | 名称 | 数量级 | 执行时长 | 触发时机 | 是否门禁 |
|---|---|---|---|---|---|
| L0 | 静态检查（类型 + lint） | 全量 | < 30s | 每次 push | ✅ 阻断 |
| L1 | 单元测试 | ~400 用例 | < 20s | 每次 push | ✅ 阻断 |
| L2 | **黄金快照测试** | 64 快照 | < 15s | 每次 push | ✅ 阻断（需人工审 diff） |
| L3 | **契约测试** | ~60 用例 | < 15s | 每次 push | ✅ 阻断 |
| L4 | 集成测试（DB/队列/HTTP） | ~150 用例 | < 90s | 每次 push | ✅ 阻断 |
| L5 | **AI 回放测试** | ~80 用例 | < 60s | 每次 push | ✅ 阻断 |
| L6 | **AI 评估（eval）** | 30 case | 3–8 min | PR + 每晚 | ✅ PR 阻断（阈值） |
| L7 | **导出产物验证** | ~20 用例 | < 60s | 每次 push | ✅ 阻断 |
| L8 | E2E | ~15 场景 | < 5 min | 每次 push | ✅ 阻断 |
| L9 | 安全专项 | ~40 用例 | < 60s | 每次 push | ✅ 阻断 |
| L10 | 性能与容量 | 6 基准 | < 10 min | 每晚 + 预发 | ⚠️ 告警 |
| L11 | 混沌与故障注入 | ~12 场景 | < 5 min | 每晚 + 预发 | ⚠️ 告警 |

**总计约 830 个测试 / 用例**，其中 **AI 相关（L5+L6）占 13%**，但承担了"产品是否真的有用"的判定责任。

### 2.1 分层配比的原则

```
        ▲ 数量
    L0  │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  静态检查（免费且快）
    L1  │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  单元测试
    L2  │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  黄金快照 ★
    L3  │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  契约测试 ★
    L4  │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  集成测试
    L5  │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  AI 回放 ★
    L6  │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  AI 评估 ★
    L7  │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  导出验证 ★
    L8  │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  E2E
    L9  │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  安全
    L10 │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  性能
    L11 │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  混沌
        └──────────────────────────────────────────────────────► 时间
         0s        30s        2min        5min        10min        30min
```

★ 标记的六层是本项目的**差异化测试层**——它们针对的是这个产品特有的失败模式（版式回归、契约漂移、AI 不稳定、导出失真），通用测试金字塔不覆盖这些。

---

## 3. 分层详述

### L0 · 静态检查

| 项 | 配置 | 门禁 |
|---|---|---|
| 类型检查 | `tsc --noEmit`（strict + `exactOptionalPropertyTypes`） | 必须零错误 |
| 领域层零依赖检查 | 自定义脚本扫描 `packages/core` 不得 import 模型 SDK / IO | 违规即失败 |
| 未使用导出检查 | `knip` / `tsc --noUnusedLocals` | 零警告 |
| 依赖漏洞 | `bun audit` | 高危零容忍 |

> **"领域层零依赖"是一条可执行的架构约束**，必须由 CI 强制，否则架构会在无人察觉时腐化。

### L1 · 单元测试

**范围**：`@ppt/core` 的纯函数 + 应用层的小工具函数。

| 被测单元 | 关键断言 | 用例数 |
|---|---|---|
| `contentBinding.bindContent` | 缺失槽位从大纲补全；**任何输入都不产生硬编码演示文案** | 40 |
| `patchApplier.applyPatches` | 6 种 operation 各自正确；非法 patch 抛错而非静默忽略 | 45 |
| `qualityEngine.evaluatePresentation` | 4 个维度各自的扣分与边界（含 0 分下限、封面/页数规则） | 35 |
| `qualityEngine.autoFixProject` | 几何钳制到安全区；ID 重排后仍唯一 | 20 |
| `layoutEngine.generateSlideIR` | 8 版式各自产出元素数、zIndex、几何边界 | 60 |
| `svgRenderer.renderToString` | XML 转义、图层分组、滤镜定义 | 30 |
| ID 生成 / 复制映射 | 复制项目后 elementId 全局唯一 | 15 |
| 工具函数（时间、分页、签名） | — | 30 |

**约定**：领域层测试必须**无 IO、无网络、无时间依赖**。需要时间时注入 `clock`。

### L2 · 黄金快照测试（核心差异化层）

见 [§4.1](#41-黄金文件测试体系核心)。

### L3 · 契约测试（核心差异化层）

见 [§4.3](#43-契约与-schema-演进测试)。

### L4 · 集成测试

| 被测范围 | 方式 | 用例数 |
|---|---|---|
| 仓储层 CRUD | PGlite 内存库 | 40 |
| 乐观并发冲突 | 并发 PATCH 同版本 | 15 |
| 权限中间件 | 跨用户访问 | 20 |
| 任务队列 | 入队 / 领取 / 重试 / 幂等 / 取消 | 25 |
| HTTP 路由 | `app.request()` 直接调用（不起真实端口） | 35 |
| 对象存储适配器 | 内存实现 | 15 |

> 用 `app.request()` 而非起真实服务器 —— 快、无端口冲突、可并行。真实端口只留给 E2E。

### L5 · AI 回放测试（核心差异化层）

见 [§4.2](#42-ai-评估体系核心)。

### L6 · AI 评估（eval）

见 [§4.2](#42-ai-评估体系核心)。

### L7 · 导出产物验证（核心差异化层）

见 [§4.4](#44-导出保真验证)。

### L8 · E2E

Playwright 驱动真实浏览器 + 真实 API + 真实 DB（PGlite 或容器 PG）。

**核心场景（必须覆盖的 5 条主链路）**：

| # | 场景 | 断言 |
|---|---|---|
| E1 | 注册 → 登录 → 创建项目 → 生成大纲 → 编译页面 | 工作台显示 6 页，缩略图非空 |
| E2 | 编辑元素（拖拽/改文字）→ 刷新页面 | 修改保留（验证服务端持久化） |
| E3 | AI 改页 → 接受 → 查看版本历史 → 回滚 | 回滚后内容恢复原状 |
| E4 | 切换模板（深↔浅）→ 导出 PPTX | 导出文件存在、可解、页数正确 |
| E5 | 复制项目 → 修改副本 → 原项目不受影响 | 元素 ID 无冲突 |

**辅助场景**：模板提取上传、导出进度 SSE、限流触发、登录过期跳转。

### L9 · 安全专项

| 类别 | 用例 | 断言 |
|---|---|---|
| 越权 | 每个资源端点 × 2 用户 | 返回 404，响应体不含他人数据 |
| 提示注入 | 文档内含 "ignore previous instructions" 等 10 种载荷 | 生成内容仍为合法 SlideContent，无指令泄漏 |
| Schema 绕过 | 超长字段、未知字段、NaN、嵌套过深 | 400 + 明确错误码 |
| 文件上传 | 改扩展名、魔数不符、超大文件、zip bomb | 拒绝 + 不落盘 |
| XSS | 元素内容含 `<script>` / `"><img onerror>` | SVG 中已转义 |
| 速率限制 | 超阈值请求 | 429 + `Retry-After` |
| 越权枚举 | 遍历 UUID | 统一 404，无信息泄露 |

### L10 · 性能与容量

| 基准 | 目标 |
|---|---|
| 元素级更新 P95 | < 150ms |
| 需求抽取 P95 | < 8s |
| 大纲生成 P95（6 页） | < 25s |
| 单页 AI 编辑 P95 | < 12s |
| 整本 PPTX 导出（12 页） | < 45s |
| 单页 PNG 导出 | < 3s |
| 100 并发 × 1000 项目 | P99 不劣化超 20% |

### L11 · 混沌与故障注入

见 [§4.5](#45-降级与故障注入)。

---

## 4. 六个核心专项

### 4.1 黄金文件测试体系（核心）

**为什么这是本项目最重要的测试层**：版式引擎 877 行、8 种版式 × 8 套主题 = 64 种组合，每种产出 20–40 个带精确几何的元素。任何一次"顺手改个 padding"都可能悄悄改坏全部 64 种组合。人工回归不可能覆盖，快照测试是唯一可行的护栏。

#### 目录结构

```
packages/core/
├── src/engine/
│   └── __snapshots__/
│       ├── layoutEngine/          # 按版式分目录，每个目录 8 个主题快照
│       │   ├── title_cover/       (8)
│       │   │   ├── tpl_modern_light.json
│       │   │   ├── tpl_mckinsey_white.json
│       │   │   ├── ... (共 8 套主题)
│       │   │   └── tpl_crimson_strategy.json
│       │   ├── architecture_diagram/  (8)
│       │   ├── cards_grid/            (8)
│       │   ├── problem_solution/      (8)
│       │   ├── timeline_roadmap/      (8)
│       │   ├── stats_kpi/             (8)
│       │   ├── radial_center/         (8)
│       │   └── summary_conclusion/    (8)
│       ├── contentBinding/        # 槽位降级矩阵
│       ├── patchApplier/          # 6 种 operation 前后对比
│       └── qualityEngine/
│           └── quality_scenarios.json
└── tests/
    └── layoutEngine.snapshot.test.ts
```

#### 快照规范化（关键细节）

当前 `layoutEngine` 产出 `versionId: v_${Date.now()}` 与 `lastModified: Date.now()`——**直接快照会每次都不同**。必须在序列化前剥离所有非确定性字段：

```ts
// packages/core/tests/helpers/snapshot.ts
export function normalizeSlide(slide: SlideIR): NormalizedSlide {
  const { versionId, lastModified, ...rest } = slide;
  return {
    ...rest,
    // 元素按 id 排序，保证输出稳定
    elements: [...slide.elements]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((el) => ({
        ...el,
        // 剥离元素内的随机/时间字段
        metadata: el.metadata ? { ...el.metadata } : undefined,
      })),
  };
}
```

#### 测试代码

```ts
// packages/core/tests/layoutEngine.snapshot.test.ts
import { describe, expect, test } from 'bun:test';
import { LayoutEngine } from '../src/engine/layoutEngine';
import { bindContent } from '../src/engine/contentBinding';
import { BUILT_IN_TEMPLATES } from './fixtures/templates';
import { OUTLINE_FIXTURES } from './fixtures/outlines';
import { normalizeSlide } from './helpers/snapshot';
import { readSnapshot, writeSnapshot } from './helpers/snapshotStore';

const LAYOUTS = [
  'title_cover', 'architecture_diagram', 'cards_grid', 'problem_solution',
  'timeline_roadmap', 'stats_kpi', 'radial_center', 'summary_conclusion',
] as const;

describe('版式黄金快照', () => {
  for (const layout of LAYOUTS) {
    for (const template of BUILT_IN_TEMPLATES) {
      test(`${layout} × ${template.templateId}`, () => {
        const outline = OUTLINE_FIXTURES[layout];
        const content = bindContent(outline);          // 无 AI，纯确定性
        const slide = LayoutEngine.generateSlideIR(
          outline, template.theme, 1, 6
        );
        const normalized = normalizeSlide(slide);
        const key = `${layout}.${template.templateId}`;

        if (process.env.UPDATE_SNAPSHOTS) {
          writeSnapshot(key, normalized);
          return;
        }
        expect(normalized).toEqual(readSnapshot(key));
      });
    }
  }
});
```

#### 关键约束：快照必须"可审"

快照文件若只有 `toMatchSnapshot()` 的内联字符串，diff 不可读。**必须用独立 JSON 文件**，且：

- 元素按 `id` 排序 → diff 稳定
- 剥离时间戳 → 不产生噪声
- 快照文件纳入版本控制 → PR diff 直接呈现版式变化

#### 审阅流程（强制）

```
CI 检测到快照差异
   │
   ├─▶ 自动在 PR 评论中贴出 diff（按元素分组）
   │      "grid_card_2.geometry.width: 405 → 380"
   │      "grid_card_3.style.fontSize: 22 → 20"
   │
   ├─▶ 评审人必须逐项确认：这是预期改动吗？
   │
   └─▶ 确认后执行 `bun test -u` 更新快照并提交
```

**规则：快照变更不允许无声合入** —— 与 ADR-004 / QA-4 对应。

#### 补充：内容绑定降级快照

除了版式快照，还要为 `bindContent` 建**单独的降级矩阵快照**：

| 用例 | 输入 | 期望 |
|---|---|---|
| 槽位齐全 | 完整 `SlideContent` | 原样透传 |
| 缺 `layers` | 只有 `bullets` | 从 bullets 切分出 layers |
| 全缺 | 只有 `outline.bulletPoints` | 从大纲推导全部槽位 |
| 空大纲 | 无 bulletPoints | 产出**空内容**（而非硬编码文案）★ |

最后一条是回归防线：确保 `LAY-02` 的"任何路径都不得回落到硬编码演示文案"不被未来改动破坏。

### 4.2 AI 评估体系（核心）

AI 组件无法用传统断言测试。本层用 **30 个固定 case + 5 项指标 + 阈值门禁** 替代。

#### Case 设计

```
apps/api/src/eval/
├── cases/
│   ├── 001-agent-arch-cn.yaml       # 中文 · 企业架构 · 6 页
│   ├── 002-mckinsey-strategy.yaml   # 中文 · 战略咨询 · 咨询风格
│   ├── 003-vc-pitch.yaml            # 中文 · 商业计划 · 投资人
│   ├── 010-english-tech.yaml        # 英文 · 技术方案
│   ├── 020-long-doc.yaml            # 长文档输入（5000 字）
│   ├── 021-with-doc.yaml            # 带参考文档
│   ├── 030-min-pages.yaml           # 页数下限（4）
│   ├── 031-max-pages.yaml           # 页数上限（12）
│   ├── 040-empty-bullets.yaml       # 输入信息极少
│   ├── 041-adversarial.yaml         # 对抗性输入
│   └── ... (共 30 个)
├── golden/                          # 期望的结构约束（非逐字文本）
└── run.ts
```

**Case 格式**（YAML，可读、可评审、可增删）：

```yaml
# apps/api/src/eval/cases/001-agent-arch-cn.yaml
id: agent-arch-cn
agent: outline
input:
  requirement:
    topic: 企业 AI Agent 技术架构规划
    purpose: 面向技术管理层的架构演进与落地战略汇报
    audience: CTO、架构委员会与技术总监
    pageCount: 6
    style: 专业、科技感、克制简洁、分层严谨
    depth: 技术战略、企业架构、工程体系与实施路线
    aspectRatio: "16:9"
expect:
  slideCount: 6
  firstLayout: title_cover
  lastLayout: summary_conclusion
  # 每个版式所需的槽位必须齐全
  slotRequirements:
    title_cover: [title, subtitle]
    architecture_diagram: [layers]
    cards_grid: [bullets]
    problem_solution: [columns]
    timeline_roadmap: [phases]
    stats_kpi: [metrics]
    radial_center: [radial]
    summary_conclusion: [summary]
  # 语义约束（由 LLM 判定器 + 人工抽检共同把关）
  semantic:
    topicPreserved: true      # 标题必须包含主题关键词
    noPlaceholder: true       # 不得出现 "Lorem ipsum" / "示例" / "XX"
    languageConsistent: true  # 全篇语言统一
```

#### 五项指标

| 指标 | 定义 | 目标 | 判定方式 |
|---|---|---|---|
| `schema_valid_rate` | 输出通过 Zod 校验的比例 | **100%** | 确定性 |
| `slot_completeness` | 当前版式所需槽位被填充的比例 | **≥ 95%** | 确定性 |
| `layout_coherence` | `layoutPreference` 与产出结构自洽率 | **≥ 95%** | 确定性 |
| `outline_fidelity` | 内容确实来自输入主题（非通用套话） | **≥ 90%** | LLM 判定 + 人工抽检 20% |
| `cost_latency` | 平均 token / 费用 / 耗时 | 不超过基线 110% | 确定性 |

**前三项是确定性的**（可精确断言），后两项半自动。

#### LLM 判定器的诚实说明

`outline_fidelity` 用另一个模型做判定——**判定器本身也是概率性的**。处理方式：

1. 判定器用不同厂商的模型（避免自我确认偏误）
2. 判定器 prompt 固定并版本化
3. **人工抽检 20%** 的 case 建立判定器与人工的一致率基线
4. 一致率 < 85% 时，先修判定器再谈指标

> 不要把 LLM 判定当作真理。它的作用是**发现回归的信号源**，不是终审。

#### 回放机制（让 CI 不烧钱）

```
在线评估（每晚 / PR 手动触发）
   → 真实调用模型 → 保存响应到 recordings/
                              │
                              ▼
离线回放（每次 push，进 CI）
   → 读 recordings/ → 用录制响应替代真实调用 → 断言解析/校验/降级路径
```

**录制格式**：

```json
{
  "caseId": "agent-arch-cn",
  "agent": "outline",
  "recordedAt": "2026-11-01T08:00:00Z",
  "provider": "gemini",
  "model": "gemini-2.5-flash",
  "request": { "messages": [...], "responseSchema": {...} },
  "response": { "raw": { "outline": [...] } },
  "usage": { "inputTokens": 3120, "outputTokens": 1840 }
}
```

**录制规范**：
- 提交进版本控制（响应体积小，且是回归基线）
- 包含**失败用例**的录制（模型返回非法 JSON、超时）——这是降级路径的测试数据
- Prompt 变更时**不**自动重录（需显式 `bun run eval:record`），避免掩盖回归

#### 判定矩阵

| 输出形态 | 期望行为 | 测试点 |
|---|---|---|
| 合法 JSON | 正常解析并落库 | 主路径 |
| JSON 带多余字段 | Zod 剥离或拒绝（按 schema 配置） | 契约韧性 |
| JSON 语法错误 | 修复重试 → 降级 | 异常路径 |
| 超时 | 降级链切换 | 降级路径 |
| 空响应 | 降级链切换 | 降级路径 |
| 部分槽位缺失 | `bindContent` 补全 | 补全路径 |

后三种通过**故障注入**在回放中构造（见 §4.5）。

### 4.3 契约与 Schema 演进测试（核心）

**契约漂移是跨端系统的头号故障源**：前端以为返回 `{data}`，后端改了字段名，运行时才炸。

#### 三层契约

```
① Zod Schema（唯一真相）
        │  z.toJSONSchema()
        ├──────────────► ② OpenAPI 文档快照（CI 比对）
        │  responseSchema
        ▼
③ 模型厂商的结构化输出契约
        │
        ▼
   前端生成的 API client（类型由 ① 生成）
```

#### 契约测试实现

```ts
// apps/api/tests/contract/routes.contract.test.ts
import { describe, expect, test } from 'bun:test';
import { app } from '../../src/index';
import { ProjectResponseSchema } from '@ppt/core/contracts';

// 1. 响应必须符合 Schema
test('GET /api/projects/:id 响应符合契约', async () => {
  const res = await app.request('/api/projects/xxx', { headers: authHeaders });
  const body = await res.json();
  expect(() => ProjectResponseSchema.parse(body)).not.toThrow();
});

// 2. OpenAPI 快照无未审变更
test('OpenAPI 文档未发生未审变更', async () => {
  const spec = await app.request('/api/openapi.json').then(r => r.json());
  expect(spec).toMatchSnapshot();   // 变更需显式更新 + 评审
});

// 3. 契约与实现一致：每个声明的响应码都要真的存在
test('路由响应码与 OpenAPI 声明一致', async () => {
  const spec = await app.request('/api/openapi.json').then(r => r.json());
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (!op.responses['400']) {
        expect(op.responses['401'], `${method} ${path} 缺少 401 声明`).toBeDefined();
      }
    }
  }
});
```

#### Schema 演进规则

| 变更类型 | 允许？ | 要求 |
|---|---|---|
| 新增可选字段 | ✅ | 快照更新 + 客户端重新生成 |
| 新增必填字段 | ⚠️ | 必须同时更新前端类型，否则编译失败 |
| 删除字段 | ⚠️ | 需标 `deprecated` 一个版本后再删 |
| 改字段类型 | ❌ | 视为破坏性变更，需版本前缀 `/api/v2` |
| 改枚举值 | ⚠️ | 前端必须处理未知值（不得 `switch` 穷尽） |

**规则：前端的 `switch` 必须有 `default` 分支** —— 保证后端加枚举值时前端不崩。这条规则由 ESLint 规则强制。

### 4.4 导出保真验证（核心）

导出是用户最终拿到手的东西，也是最容易"看起来成功其实坏了"的地方。

#### 验证矩阵

| 格式 | 验证项 | 方法 |
|---|---|---|
| **SVG** | XML 合法、元素数一致、ID 保留、中文未转义错误 | `xmllint` + 解析计数 |
| **PNG/JPG** | 尺寸 = 3840×2160、非空白、非纯色 | `sharp` 读 metadata + 直方图 |
| **PDF** | 页数正确、页面尺寸 16:9、**中文可读**、非空白 | `pdfjs-dist` 抽文本 + 光栅化 |
| **PPTX** | 页数正确、**形状/文本框数量 = IR 元素数**、备注已写入 | 解 OOXML 检查 `ppt/slides/*.xml` |

#### 关键断言：中文可读性

前端现状用 `jspdf`（默认字体不含 CJK），这正是必须下沉服务端的原因。测试要显式证明服务端方案解决了它：

```ts
// apps/api/tests/export/pdf.test.ts
test('PDF 中的中文文本可被正确抽取（回归防线）', async () => {
  const { buffer } = await exportPdf(projectFixture, 'deck');
  const doc = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const page = await doc.getPage(1);
  const text = await page.getTextContent();

  const content = text.items.map(i => ('str' in i ? i.str : '')).join('');
  expect(content).toContain('企业 AI Agent 技术架构规划');   // 真实标题
  expect(content).not.toContain('�');                        // 无替换字符
  expect(content).not.toMatch(/[\x00-\x1F]{3,}/);             // 无乱码控制符
});
```

#### 关键断言：PPTX 可编辑性

```ts
test('PPTX 导出的是原生形状而非整页图片', async () => {
  const { buffer } = await exportPptx(projectFixture);
  const zip = await unzip(buffer);
  const slideXml = zip.readFileSync('ppt/slides/slide2.xml').toString();

  expect(slideXml).toContain('<p:sp>');                        // 存在原生形状
  expect(slideXml).not.toContain('<p:pic>');                   // 不含整页图片
  const textBoxes = slideXml.match(/<a:t>/g) ?? [];
  expect(textBoxes.length).toBeGreaterThan(3);                 // 文本被拆成文本框
});
```

**这条断言是产品级差异的守门人** —— "可编辑的 PPTX" 与 "PPTX 格式的图片" 是两回事。

#### 视觉回归（可选增强）

导出 PNG 与基线图做感知哈希（pHash）比对，容忍抗锯齿差异：

```
similarity = 1 - hammingDistance(pHash(actual), pHash(baseline))
expect(similarity).toBeGreaterThan(0.98)
```

> 该项对字体渲染环境敏感，建议只在固定容器内跑，且**阈值宽松**——它防的是"整体变白/变黑"这类灾难，不是像素级差异。

### 4.5 降级与故障注入

**产品承诺**：主模型完全不可用时，功能不中断。

#### 可测试性约束（架构要求）

ModelRouter 必须允许注入传输层，否则无法测降级：

```ts
// apps/api/src/services/modelRouter.ts
export interface ModelTransport {
  invoke(req: ModelRequest, signal?: AbortSignal): Promise<ModelResponse>;
}

export class ModelRouter implements ModelRouterPort {
  constructor(
    private transports: ModelTransport[],   // 降级链，按序尝试
    private fallback: () => DeterministicOutput,  // 最终确定性降级
  ) {}
}
```

> **这是架构为可测试性做的让步** —— 没有这个注入口，L11 混沌测试无从谈起。

#### 故障注入矩阵

| # | 注入点 | 期望行为 | 验证方式 |
|---|---|---|---|
| F1 | 主模型返回 500 | 切换 secondary | 断言 secondary 被调用 |
| F2 | 主模型返回 429 | 退避重试 2 次后切换 | 断言重试次数 = 2 |
| F3 | 主模型超时 | 切换 secondary | 断言未超出总超时预算 |
| F4 | 全部模型失败 | 走确定性降级 | 断言返回**合法**内容 |
| F5 | 模型返回非法 JSON | 修复重试 ×2 → 降级 | 断言走了修复路径 |
| F6 | 模型返回空响应 | 降级 | 断言内容非空且合法 |
| F7 | 模型返回多余字段 | Zod 剥离/拒绝 | 断言不污染 IR |
| F8 | 槽位缺失 | `bindContent` 补全 | 断言槽位齐全 |
| F9 | DB 不可用 | 503 + 明确错误 | 断言不 500 白屏 |
| F10 | 对象存储不可用 | 导出任务失败但可重试 | 断言任务状态与错误信息 |
| F11 | Worker 崩溃 | 任务超时后重新入队 | 断言任务最终完成 |
| F12 | 队列重复投递 | 幂等，不重复生成 | 断言产物只有一份 |

#### 确定性降级的正确性测试（关键）

```ts
test('降级输出随主题变化，不返回固定文案', () => {
  const a = deriveOutlineLocally({ topic: '供应链金融风控体系', ... });
  const b = deriveOutlineLocally({ topic: 'SaaS 平台商业计划', ... });

  expect(a[0].title).toContain('供应链金融');
  expect(b[0].title).toContain('SaaS');
  expect(a[0].title).not.toBe(b[0].title);
  // 回归防线：不得出现现状中的写死标题
  expect(a[0].title).not.toBe('企业 AI Agent 技术架构规划');
});
```

> **最后一行是本项目最容易被回归破坏的地方** —— 现状的 fallback 就是写死的"企业 AI Agent 技术架构规划"。必须有测试守住。

### 4.6 并发与乐观锁

```ts
test('基于旧版本号的写入被拒绝', async () => {
  const v1 = await getSlide(projectId, slideId);

  const ok = await patchSlide(projectId, slideId, { ...v1, baseVersionId: v1.versionId });
  expect(ok.status).toBe(200);

  // 用过期版本号再次写入 → 409
  const stale = await patchSlide(projectId, slideId, { ...v1, baseVersionId: v1.versionId });
  expect(stale.status).toBe(409);
  expect(stale.body.error.code).toBe('SLIDE_VERSION_CONFLICT');
});

test('并发写入只有一个成功', async () => {
  const results = await Promise.all(
    Array.from({ length: 10 }, () => patchSlide(projectId, slideId, { ...snapshot, baseVersionId: v }))
  );
  expect(results.filter(r => r.status === 200)).toHaveLength(1);
  expect(results.filter(r => r.status === 409)).toHaveLength(9);
});
```

**版本不可变测试**：

```ts
test('回滚生成新版本而非删除历史', async () => {
  const before = await listVersions(projectId, slideId);
  await rollback(projectId, slideId, before[2].versionId);
  const after = await listVersions(projectId, slideId);

  expect(after.length).toBe(before.length + 1);
  expect(after[0].description).toContain('回滚');
  // 原版本仍在
  expect(after.some(v => v.versionId === before[2].versionId)).toBe(true);
});
```

---

## 5. 测试数据策略

### 5.1 Fixture 目录

```
packages/core/tests/fixtures/
├── templates/            8 套主题（与 src/data/templates.ts 同源导出）
├── outlines/             每种版式一份固定大纲（确定性输入）
├── slides/               预生成的 SlideIR（跳过版式引擎，直接测下游）
├── documents/            参考文档样例（含中文、含表格、含极端长度）
├── adversarial/          对抗性输入集
└── golden/               期望输出（含损坏样本）

apps/api/tests/fixtures/
├── users.ts              测试账号
├── projects.ts           多状态项目（空项目 / 有大纲 / 有页面 / 有版本 / 有关联产物）
└── recordings/           AI 响应录制（见 §4.2）
```

**原则**：fixtures 必须**版本控制**、**只增不改**（改了要新文件名，避免旧测试悄悄跟着变）。

### 5.2 测试替身清单

| 替身 | 实现 | 用途 |
|---|---|---|
| `FakeTransport` | 可编程返回 / 抛错 / 延迟 | AI 故障注入 |
| `FrozenClock` | 固定时间 | 消除 `Date.now()` 依赖 |
| `DeterministicIds` | 递增序列 | 稳定 ID |
| `InMemoryObjectStore` | Map 实现 | 对象存储 |
| `PGlite` | 内存 Postgres | 集成测试 |
| `MemoryJobQueue` | 同步执行 | Worker 测试 |
| `MemoryRateLimiter` | 计数实现 | 限流测试 |
| `SnapshotSerializer` | 排序 + 剥离时间戳 | 快照稳定 |

### 5.3 边界与畸形输入集

必须覆盖的输入边界（不是"测一下"，而是**每个端点都要有**）：

| 类别 | 样例 |
|---|---|
| 空 | `""` / `[]` / `{}` / `null` |
| 极值 | 1 字符 / 10 万字符 / 0 页 / 100 页 |
| 类型错 | 数字传字符串、数组传对象、`NaN` / `Infinity` |
| 未知字段 | 多余的顶层字段、嵌套未知字段 |
| 深度 | 10 层嵌套 JSON |
| 特殊字符 | emoji、CJK、RTL、零宽字符、SQL 片段、模板字符串 `${}` |
| 注入载荷 | "忽略以上指令"、`<script>`、`'; DROP TABLE`、超长 base64 |
| 并发 | 同一版本号 10 并发写 |
| 时序 | 请求中途断开、SSE 客户端提前关闭 |

---

## 6. 环境与执行策略

### 6.1 三层环境

| 环境 | 用途 | 数据 | 模型 |
|---|---|---|---|
| **本地** | 开发自测 | fixtures + PGlite | 回放（默认）/ 真实（显式开启） |
| **CI** | 合并门禁 | fixtures + PGlite | 回放 + 每晚在线 eval |
| **预发** | 端到端与性能 | 容器化 PG + MinIO | 真实模型 |

**默认离线**：`bun test` 一律使用回放，**不烧 API 额度**。真实模型调用必须显式：

```bash
bun test                       # 全部离线（默认）
bun run test:live              # 真实模型（需 API key）
bun run eval                   # 在线评估
```

### 6.2 本地开发循环

```bash
bun test                          # 全量离线，约 90s
bun test packages/core            # 只测领域内核，约 20s
bun test --watch                  # 监听模式
bun test -u                       # 更新快照（需人工审 diff）
bun test -t "版式黄金快照"         # 按名字过滤
```

**反馈速度是测试价值的前提** —— 若全量跑一次要 5 分钟，开发者就会跳过它。因此：离线测试总时长目标 < 90s，在线 eval 独立成 nightly 任务。

---

## 7. CI 流水线

```
┌─────────────────────────────────────────────────────────────────┐
│  Stage 1 · 静态（并行，~30s）                                     │
│    typecheck │ lint │ domain-purity │ dep-audit │ secret-scan  │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Stage 2 · 快速测试（并行，~90s）                                  │
│    unit │ snapshot │ contract │ integration │ replay │ export    │
│    security                                                               │
│    ⛔ 任一失败即阻断，不进入 Stage 3                                │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Stage 3 · 集成（~5min）                                          │
│    e2e (Playwright) │ visual-regression                           │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Stage 4 · 夜间 / 发布前（~30min）                                 │
│    eval-online │ performance │ chaos │ migration-verify           │
│    ⛔ eval 指标低于阈值即阻断发布                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 7.1 门禁规则

| 阶段 | 阻断条件 | 可否重跑绕过 |
|---|---|---|
| Stage 1 | 任何错误 | 否 |
| Stage 2 | 任何失败 | 否（快照可显式 `-u` 提交） |
| Stage 3 | E2E 失败 | 否；视觉回归失败需人工确认可豁免 |
| Stage 4 | eval 指标低于阈值 / 性能劣化 > 20% | 否（需显式豁免记录 + 负责人签字） |

### 7.2 快照差异的 PR 呈现

CI 在 PR 上自动评论：

```markdown
## ⚠️ 版式黄金快照发生变化

| 组合 | 变化 |
|---|---|
| `cards_grid.tpl_modern_light` | `grid_card_2.geometry.width: 405 → 380`<br>`grid_card_2.style.fontSize: 22 → 20` |
| `stats_kpi.tpl_tech_blue` | `kpi_card_0.style.padding: 32 → 24` |

**评审要点**：
- [ ] 变更是预期的吗？
- [ ] 是否影响其他主题的观感一致性？
- [ ] 是否应同步更新设计规范文档？

确认无误后执行 `bun test -u && git commit`
```

---

## 8. 质量门禁指标

| 指标 | 目标 | 测量方式 | 不达标处理 |
|---|---|---|---|
| 领域层行覆盖率 | ≥ 90% | `bun test --coverage` | 阻断 |
| 应用层行覆盖率 | ≥ 75% | 同上 | 阻断 |
| 编排层行覆盖率 | ≥ 70% | 同上（靠回放） | 阻断 |
| 快照一致率 | 100% | CI | 阻断 |
| 契约一致率 | 100% | CI | 阻断 |
| `schema_valid_rate` | 100% | eval | 阻断发布 |
| `slot_completeness` | ≥ 95% | eval | 阻断发布 |
| `layout_coherence` | ≥ 95% | eval | 阻断发布 |
| `outline_fidelity` | ≥ 90% | eval + 人工抽检 | 阻断发布 |
| 导出产物通过率 | 100% | 导出验证 | 阻断 |
| 越权拦截率 | 100% | 安全专项 | 阻断 |
| 降级路径成功率 | 100% | 混沌测试 | 阻断 |
| 缺陷逃逸率 | < 5% | 线上问题 / 总缺陷 | 告警 |
| MTTR（生产） | < 2h | 事故记录 | 复盘 |

**覆盖率不是目的**：领域层是纯函数，90% 应该轻松达到并长期保持；编排层的低覆盖率要用回放补齐，而不是靠无意义的 mock 凑数。

---

## 9. 缺陷分级与响应

| 级别 | 定义 | 示例 | 响应 | 发布策略 |
|---|---|---|---|---|
| **P0** | 数据丢失 / 全站不可用 / 越权泄露 | 项目被他人读写 | 立即，1h 内 | 阻断发布 |
| **P1** | 核心链路中断 / 导出失真 / AI 内容不入版式 | PPTX 中文乱码 | 4h 内 | 阻断发布 |
| **P2** | 非核心功能异常 / 性能明显劣化 | 模板筛选失效 | 2 个工作日 | 可带病发布，需记录 |
| **P3** | 体验瑕疵 / 文案 / 边界表现 | 提示语不准确 | 迭代处理 | 可带病发布 |

**缺陷必须带最小复现**：
- 确定性缺陷 → 失败的测试用例（先写复现测试，再修）
- AI 相关缺陷 → 对应的 eval case + 录制响应

> **规则：修 bug 的第一步是写一个会失败的测试。** 没有复现用例的修复无法证明修好了，也无法防回归。

---

## 10. 职责分工

| 角色 | 职责 |
|---|---|
| **领域层**（前端/后端共同） | `packages/core` 的单测与快照；快照变更的评审 |
| **后端** | 应用层集成测试、契约测试、导出验证、安全专项、性能 |
| **AI 工程** | eval 套件维护、指标趋势、判定器校准、Prompt 版本管理 |
| **前端** | 组件测试、交互 E2E、状态管理行为 |
| **QA / 产品** | eval case 设计与评审、人工抽检、缺陷分级裁决、发布门禁签字 |

**评审责任矩阵**：

| 变更类型 | 必须评审人 |
|---|---|
| 领域内核 / 版式 | 领域层负责人 + QA |
| API 契约 | 后端 + 前端 |
| Prompt | AI 工程 + 产品 |
| 质量规则阈值 | QA + 产品 |
| 导出格式 | 后端 + QA（需人工看渲染图） |

---

## 11. 落地路线

与后端特性阶段（`backend-features.md`）对应：

| 阶段 | 建立的测试能力 | 交付物 |
|---|---|---|
| **S0** | 黄金快照体系 + 领域层单测骨架 | 64 组快照基线；`bun test` 可跑 |
| **S1** | 契约测试 + 集成测试（PGlite）+ CI Stage 1–2 | CI 全绿；契约快照基线；覆盖率门禁 |
| **S2** | AI 回放体系 + eval 套件 + 故障注入 | 30 个 eval case；判定器校准完成；降级路径测试 |
| **S3** | 导出产物验证 + 视觉回归 | 产物验证断言（含中文 PDF、PPTX 可编辑性） |
| **S4** | 并发与版本测试 + 安全专项 | 乐观锁冲突测试；越权用例全覆盖 |
| **S5** | 性能基准 + 混沌测试 | 性能基线报告；混沌场景集 |

**每阶段必须先建测试再写实现**（S0 除外——S0 是纯重构，快照先于重构落地即为基线）。

---

## 12. 风险

| # | 风险 | 影响 | 对策 |
|---|---|---|---|
| T1 | 快照太多导致评审疲劳，最终变成"闭眼点合并" | 高 | 快照按组合分文件；PR 评论按元素分组只显示差异行；超过 20 处差异强制要求设计评审 |
| T2 | eval 阈值定得太松，失去门禁意义 | 高 | 阈值从当前实测基线起步，每次发布只允许收紧不放宽；用历史数据回测 |
| T3 | LLM 判定器不可靠，指标失真 | 中 | 判定器跨厂商 + 人工抽检 20% 建基线；一致率 < 85% 先修判定器 |
| T4 | 视觉回归在 CI 与本地字体渲染不一致，频繁误报 | 中 | 只在固定容器内跑；阈值宽松（0.98）；仅告警不阻断，靠人工看渲染图 |
| T5 | 回放录制随 Prompt 变更失效，回放测试形同虚设 | 高 | Prompt 版本与录制绑定；Prompt 变更必须显式重录；CI 检查录制时效 |
| T6 | 测试替身与真实实现漂移 | 中 | 集成测试用真实 PG + 真实 HTTP 栈；替身只用于故障注入与边界 |
| T7 | 覆盖率成为 KPI，出现无意义测试 | 中 | 覆盖率只作门禁不作考核；评审关注断言有效性而非数量 |

---

## 13. 一页速查

```bash
# 日常
bun test                      # 全量离线（约 90s，不烧额度）
bun test packages/core        # 只测领域内核（约 20s）
bun test -u                   # 更新快照（务必人工审 diff）

# 专项
bun run eval                  # 在线评估（真实模型，需 key）
bun run eval:record           # 重录 AI 响应
bun run test:e2e              # 端到端（Playwright）
bun run test:chaos            # 故障注入
bun run test:perf             # 性能基准
bun run coverage              # 覆盖率报告

# CI 门禁
□ Stage1 静态 → □ Stage2 快速 → □ Stage3 集成 → □ Stage4 夜间
```

| 层 | 门禁 | 覆盖目标 |
|---|---|---|
| L0 静态 | ✅ 阻断 | — |
| L1 单元 | ✅ 阻断 | 领域层 ≥ 90% |
| L2 黄金快照 | ✅ 阻断（需人工审） | 64 组 |
| L3 契约 | ✅ 阻断 | 全部端点 |
| L4 集成 | ✅ 阻断 | 应用层 ≥ 75% |
| L5 AI 回放 | ✅ 阻断 | 编排层 ≥ 70% |
| L6 AI 评估 | ✅ 阻断发布 | 4 项指标达标 |
| L7 导出验证 | ✅ 阻断 | 5 种格式 |
| L8 E2E | ✅ 阻断 | 5 条主链路 |
| L9 安全 | ✅ 阻断 | 7 类 |
| L10 性能 | ⚠️ 告警 | 7 项基准 |
| L11 混沌 | ⚠️ 告警 | 12 场景 |

---

*文档版本 1.0 · 2026-11-01 · 与 `backend-features.md` 的 S0–S5 阶段同步维护*
