# Spec 条款模型

## 层级结构

```
文档条款 (§章节/段落)
   ↓ source{doc, section, quote}
Spec 条款 (SPEC-<AREA>-<NNN>)
   ↓ acceptance[]
验收判据 (AC-NNN)
   ↓ verification{...}
验证器 (测试文件::用例名)
   ↓ 执行
证据 (spec版本 + code版本 + test版本 + 输入 + 环境 + 实际结果)
```

**每一层都必须能向上和向下走通。** 断在任意一层，该层的结论就不可信。

### ID 规范

```
SPEC-<AREA>-<NNN>    条款，AREA 大写领域缩写
AC-<AREA>-<NNN>      验收判据
AMB-<NNN>            歧义 / 未决问题
CONF-<NNN>           文档内部冲突
EVD-<AREA>-<NNN>     一次验证执行的证据
```

> **编号一旦发布不再重排。** 删除条款时标 `status: withdrawn` 并写明原因，不要重排编号 —— 编号是引用锚点，重排会让历史结论全部失效。

---

## 条款字段

### 标识与分类

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✅ | 稳定 ID |
| `title` | ✅ | 一句话标题 |
| `type` | ✅ | `business` 业务契约 / `technical` 技术契约 / `quality` 质量属性 / `governance` 组织治理（流程、审批、审计） |
| `risk` | ✅ | `high` 影响正确性或安全 / `medium` 影响体验或可维护 / `low` 边缘 |
| `statement` | ✅ | **一句可判定的陈述**，不是"系统应该支持 X"这种整句 |
| `status` | | `draft` / `blocked` / `active` / `withdrawn` |

> `governance` 容易被忽略：审批流程、留痕要求、审计日志、变更管控 —— 这些也是要求，也需要追溯与验证（哪怕验证方式是人工评审）。

### 来源与不确定性

```yaml
source:
  doc: docs/backend-design.md
  section: "§3.2 认证与会话"
  quote: "密码长度至少 8 位"        # 原文摘录，便于复核
  clause_ref: "原文段落序号"          # 可选
derived_from: SPEC-AUTH-002         # 若为推导，写明从哪条推出
inference: "因为 §3.2 提到邮箱唯一，§4.2 的注册流程必须先查重"   # 推导依据
assumption: "密码强度下限与邮箱格式规则相同"                     # 若是假设，写明内容
conflict: CONF-001                  # 若与其他条款冲突
```

**规则**：
- `quote` 必填 —— 没有原文摘录的条款，来源不可复核。
- 推导与假设**不写进 `statement`**，写在独立字段。混在一起就变成了伪装成事实的猜测。

### 契约结构

```yaml
preconditions:            # 执行前必须成立的条件
  - "用户已登录且持有有效 session"
behaviors:                # 条件 → 结果
  - when: "提交的 patch 中含未知 operation"
    then: "抛出 UNKNOWN_OPERATION，SlideIR 不发生任何变更"
postconditions:           # 执行后必须成立
  - "版本号已递增"
  - "slide_versions 新增一行"
boundaries:               # 边界值与取舍（明确到具体数字）
  - "密码长度 = 8 通过；= 7 拒绝"
  - "元素 x+w = 1920 不算越界；= 1921 算越界"
failure:                  # 失败行为与可观察的错误标识
  - condition: "存储层不可用"
    observable: "返回 503 + 错误码 STORAGE_UNAVAILABLE，不返回 500"
    spec_ref: SPEC-SEC-004
invariants:               # 任何时刻都必须成立
  - "同一项目内所有元素 ID 全局唯一"
```

> `boundaries` 里写**具体数字**，不写"边界情况"。写不出具体数字，说明边界还没被想清楚。

### 验收判据

```yaml
acceptance:
  - id: AC-AUTH-001
    criterion: "POST /api/auth/register，body.password = '1234567' → HTTP 400 且 body.error.code = 'PASSWORD_TOO_WEAK'"
    oracle:
      tier: authoritative
      source: "docs/backend-design.md §3.2 原文：密码长度至少 8 位"
      confidence: high
    verification:
      kind: test
      target: "apps/api/tests/auth/register.test.ts::password-too-weak"
      command: "bun test apps/api/tests/auth/register.test.ts"
      pass_when: "退出码 0，且该用例未被 skip"
    maturity: automated
```

**`criterion` 必须是一条能机械执行的判定条件** —— 含输入、动作、期望输出。写成"验证密码强度校验生效"这种不可执行。

### Oracle 分级细则

| tier | 何时用 | 必须记录 |
|---|---|---|
| `authoritative` | 需求/法规/合同明确写死的规则 | 文档路径 + 原文 |
| `expert` | 领域专家确认的基准案例 | 谁确认的、何时、案例存哪 |
| `formal` | 类型、schema、不变量 | 形式化约束的表述 + 它覆盖/不覆盖什么 |
| `statistical` | 性能、分布、评分 | 阈值 + 测量方法 + 样本量 |
| `human` | 文案质量、设计好坏 | 量表 + 评审者 + 样本 + 一致性检查方式 |
| `self-derived` | 从现有实现反推 | **必须标注，且不能是关键条款的唯一依据** |

**置信度 `confidence`**：`high` / `medium` / `low`。`low` 的判据在报告里不得单独支撑 PASS。

### 成熟度

| maturity | 含义 |
|---|---|
| `automated` | 有可执行验证器，纳入 CI |
| `semi` | 部分自动，需人工复核（如"测试通过 + 截图抽查"） |
| `manual` | 只能人工评审，**必须有评审记录** |
| `none` | 尚无验证方式 —— **需在报告中列为未覆盖**，不得计入通过率 |

---

## 拆分方法

### 步骤

1. **通读一遍，不拆。** 先建立整体理解，避免拆出互相矛盾的条款。
2. **按维度切**（见 SKILL.md 阶段 B 的维度表），每个维度独立走一遍。
3. **原子化检查**：一条 clause 是否能用**一句** `when/then` 说清？不能 → 继续拆。
4. **去重合并**：语义相同的两条合并，保留来源列表（`source` 可为数组）。
5. **编号分配**：按领域分组，领域内顺序编号。
6. **来源回填**：每条填 `source.quote`。填不出 → 这条可能不是文档要求，是我们自己加的 → 标 `assumption` 或删掉。
7. **冲突扫描**：同领域内语义矛盾的条款并列保留，标 `CONF-NNN`。

### 粒度参考

| 太粗 ❌ | 合适 ✅ |
|---|---|
| "用户认证功能正常" | "密码长度 < 8 时注册返回 400 + PASSWORD_TOO_WEAK" |
| "支持并发编辑" | "两个客户端基于同一 baseVersionId 写入时，恰好一个成功，另一个返回 409 + SLIDE_VERSION_CONFLICT" |
| "导出要保真" | "导出的 PPTX 中 ppt/slides/slideN.xml 含 `<p:sp>` 且不含 `<p:pic>`" |

---

## 冲突与歧义处理

### 冲突（文档内部矛盾）

```yaml
# CONF-001
topic: 导出格式的默认行为
clause_a: SPEC-EXP-003  # "PDF 默认走矢量"
clause_b: SPEC-EXP-007  # "PDF 默认走位图"
source: { doc, section }
impact: 决定 PDF 产物的文本可选择性
resolution: BLOCKED          # 或 RESOLVED
note: "两者对同一场景给出互斥的默认行为；不自行裁决"
```

**不自行裁决的理由**：默认值选错会导致用户拿到错误产物，且这类错误在演示环境很难被发现。阻塞并上报，成本远低于事后返工。

### 歧义（文档没说清）

```yaml
# AMB-003
topic: 密码是否 trim 两端空白
clause_ref: SPEC-AUTH-001
question: "输入 ' abcdefgh ' 时，是按 10 字符拒绝，还是 trim 后按 8 字符通过？"
impact: correctness
blocks: [SPEC-AUTH-001]
proposed_default: "trim 后校验（多数系统惯例）"   # 仅供确认，非决定
status: OPEN
```

**阻塞范围最小化**：只阻塞受影响的条款，其余条款照常推进。整份 Spec 因为一处歧义停摆，比不停摆更糟。

### 决策记录

任何裁决都要留痕：

```yaml
# DEC-005
question: AMB-003
decision: "trim 后校验"
decided_by: "<用户 / 领域负责人>"
decided_at: "<日期>"
rationale: "与既有登录接口行为一致"
applies_to: [SPEC-AUTH-001]
```

---

## 追溯矩阵

映射链必须完整无断点：

| 文档条款 | Spec ID | 验收判据 | 验证器 | 证据 | 结论 |
|---|---|---|---|---|---|
| §3.2 密码长度 | SPEC-AUTH-001 | AC-AUTH-001 | `register.test.ts::password-too-weak` | EVD-AUTH-001 | PASS |
| §3.2 密码长度 | SPEC-AUTH-001 | AC-AUTH-002 | `register.test.ts::password-boundary-8` | EVD-AUTH-002 | PASS |
| §4.1 导出格式 | SPEC-EXP-003 | AC-EXP-003 | — | — | **INCONCLUSIVE（CONF-001 阻塞）** |

反向也要能查：**每个 Spec 条款是否都有验收判据？每个验证器是否都指向一个条款？** 两个方向的孤儿都要清掉。

---

## 自检清单

对 Spec 做一次专项检查：

**歧义与冲突**
- [ ] 有没有"大概""通常""合理地"这类不可判定的措辞？
- [ ] 有没有并列但未标记的冲突？
- [ ] 歧义是否都登记为 AMB，且标注了影响范围？

**可判定性**
- [ ] 每条 `criterion` 能否被一个函数判断真假？
- [ ] 有没有隐含依赖未声明的前置条件？
- [ ] 边界值是具体数字还是"边界情况"这种描述？

**Oracle 可信度**
- [ ] 关键条款（risk: high）是否有非 `self-derived` 的 Oracle？
- [ ] 有没有判据实际上只是"断言当前实现的行为"？
- [ ] `human` 类判据有没有评审记录与量表？

**可执行性**
- [ ] 每个 `verification.command` 是否真的能在仓库里跑起来？
- [ ] 有没有"写测试计划"而不是"写测试"的条目？
- [ ] `maturity: none` 的比例是多少？超过 30% 说明 Spec 没落地。

**覆盖完整性**
- [ ] 异常路径、权限边界、未知状态、失败恢复、并发、不变量是否都有条款？
- [ ] 文档里有但 Spec 里没有的段落，是否都在遗漏说明里列了？
- [ ] 显式非目标是否也被追溯了？

**防漂移**
- [ ] 有没有条款是为了让现有测试通过而写的？
- [ ] 阈值有没有出现单点下调？
- [ ] `assumption` 字段里躺着的结论，有没有混进 `statement`？
