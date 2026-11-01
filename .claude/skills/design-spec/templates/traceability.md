# 追溯矩阵与验证报告模板

复制以下两块到仓库的 `spec/` 目录。

---

## 一、追溯矩阵

### 1.1 文档条款 → Spec → 验证器 → 证据

| 文档章节 | Spec ID | 类型 | 风险 | 验收判据 | 验证器 | Oracle tier | 证据 | 结论 |
|---|---|---|---|---|---|---|---|---|
| §3.2 认证与会话 | SPEC-AUTH-001 | business | high | AC-AUTH-001, AC-AUTH-002 | `auth/register.test.ts` | authoritative | EVD-AUTH-001, EVD-AUTH-002 | PASS |
| §5.2 版式契约 | SPEC-SLD-004 | technical | high | AC-SLD-004 | `layoutEngine.test.ts` | formal | EVD-SLD-004 | PASS |
| §7.2 导出格式 | SPEC-EXP-003 | business | medium | — | — | — | — | **INCONCLUSIVE**（CONF-001 阻塞） |

**列的用法**：

- `文档章节` —— 必须能定位到原文位置。留空 = 无法追溯。
- `验收判据` —— 多个用逗号分隔。空 = 该条款未被验证（在下方"未覆盖"中列出）。
- `Oracle tier` —— `self-derived` 出现在 `risk: high` 的行上时，该行结论不得单独支撑 PASS。
- `结论` —— 只有 `PASS` / `FAIL` / `INCONCLUSIVE` 三种取值。

### 1.2 反向孤儿检查

| 检查 | 查询方式 | 期望 |
|---|---|---|
| 有没有条款没有验收判据？ | `clauses` 中 `acceptance: []` | 全部出现在"未覆盖"清单，或状态为 `blocked` |
| 有没有验收判据没有对应条款？ | 判据 ID 集合 ⊄ 条款 ID 集合 | 0 |
| 有没有验证器没有对应条款？ | 验证器 target 反查不到 clause | 0 |
| 有没有文档段落没有对应条款？ | 逐节扫描源文档 | 全部列在"遗漏说明"中 |
| 有没有 `maturity: none` 的条款？ | 统计 | 超过 30% → 报告警示 |

### 1.3 未覆盖清单

| Spec ID | 未覆盖原因 | 影响 | 计划 |
|---|---|---|---|
| SPEC-EXP-003 | CONF-001 阻塞，默认输出形态未裁决 | PDF 产物形态待定 | 待 §7.2 决策后补齐 |

### 1.4 遗漏说明（源文档有、Spec 无）

| 文档章节 | 内容摘要 | 未纳入原因 |
|---|---|---|
| §9.4 部署运维 | "生产环境由运维团队手工执行数据库迁移" | 组织流程，非产品行为；改为 governance 条款或单列运维手册 |

> **遗漏必须显式说明。** 静默丢弃的段落，是"覆盖率 100%"假象的主要来源。

---

## 二、验证报告

### 2.1 结论汇总

| 结论 | 条款数 | 判据数 | 占比 |
|---|---|---|---|
| PASS | — | — | — |
| FAIL | — | — | — |
| INCONCLUSIVE | — | — | — |
| 未覆盖（无判据） | — | — | — |
| **合计** | — | — | 100% |

> 结论为 PASS 的判据，**每一个**都必须能在 §2.3 找到对应的证据记录。

### 2.2 失败明细

| Spec ID | 判据 | 现象 | 根因 | 归属 |
|---|---|---|---|---|
| SPEC-XXX-001 | AC-XXX-001 | 实际返回 500，期望 400 + XXX_CODE | 错误处理分支未覆盖存储异常 | 实现缺陷 |

### 2.3 证据清单

每条 PASS / FAIL 都要有一条：

```
EVD-AUTH-001
  clause:        SPEC-AUTH-001
  acceptance:    AC-AUTH-001
  verdict:       PASS
  spec_version:  1.2
  code_version:  a1b2c3d
  test_version:  a1b2c3d
  input_data:    apps/api/tests/fixtures/auth/register-case.json#password-too-weak
  environment:   bun 1.3.11 / macOS 15 / PGlite in-memory
  command:       bun test apps/api/tests/auth/register.test.ts
  result:        1 pass, 0 fail, 0 skip (exit 0)
  oracle_tier:   authoritative
  oracle_source: docs/<design-doc>.md §3.2
  timestamp:     2026-11-01T10:22:31Z
```

### 2.4 注入错误检查（验证器的元验证）

| 条款 | 注入的错误 | 期望检出 | 实际 | 检出者 |
|---|---|---|---|---|
| SPEC-SLD-004 | 移除 slideId 前缀，制造跨页 ID 重复 | ✅ | DETECTED | `ids-unique-across-slides` |
| SPEC-XXX-001 | 把错误码从 `X_WEAK` 改成 `X_INVALID` | ✅ | **MISSED** | — |

> `MISSED` 的行必须在报告中单列 —— 这意味着该条款的"通过"不构成证据，需要补强验证器或降低 confidence。

### 2.5 证据不足的结论（INCONCLUSIVE）

| 条款 | 缺什么 | 为什么不能用 PASS 代替 |
|---|---|---|
| SPEC-EXP-003 | 判据不可信 —— 默认行为未裁决 | 判据本身不存在，无法判定 |
| SPEC-XXX-002 | 验证未执行 —— 环境缺 PGlite | 未跑过的验证不是通过 |
| SPEC-XXX-003 | 判据来自实现反推（self-derived） | 实现不能证明自己正确 |

### 2.6 已知限制

| 限制 | 影响面 | 是否可接受 | 缓解方式 |
|---|---|---|---|
| LLM 评估存在随机性 | 评估套件指标有 ±2% 波动 | 是 | 固定温度 + 多次采样取中位数 |
| 主观文案质量未自动化 | EXP / EDT 类条款需人工 | 是 | 盲评量表 + 定期校准 |

---

## 三、汇报口径

最终报告按这四段写，**不要写成流水账**：

### 生成了什么
- 列出交付文件与各自作用
- 覆盖了多少条款 / 多少判据 / 覆盖了源文档的哪些章节

### 覆盖了什么
- 哪些章节全覆盖、哪些只覆盖了部分、哪些没覆盖及原因
- 条款总数与各类型的分布

### 实际验证了什么
- **真的跑了什么**：命令、通过数、失败数、跳过的用例
- 证据文件在哪
- 注入错误检查的结果（检出 / 漏检）

### 哪些结论仍不可信
- INCONCLUSIVE 的条款与缺什么
- `self-derived` 判据支撑的结论
- `maturity: none` 与人工评审的部分
- 未做的验证（说清楚是没做、还是做不了）

### 下一步最值得解决的一个问题
只给**一个**。按"阻塞程度 × 修复成本"排序，通常是：

1. 阻塞了最多下游条款的歧义（AMB）
2. 判据不可信的关键条款（self-derived 唯一来源）
3. 覆盖率最低的领域

---

## 四、常见问题

**Q：追溯矩阵里"文档章节"列写什么粒度？**
写能定位到原文位置的最小粒度：章节号 + 段落主题。写不出位置的条款，说明 source.quote 没填好。

**Q：一条条款有多个判据，结论怎么算？**
取**最差**结论。有一个判据 FAIL，整条就是 FAIL。

**Q：证据里的 code_version 和 test_version 可以相同吗？**
可以（同一次提交）。但如果测试代码独立演进，要分开记 —— 否则无法区分"实现变了"还是"测试变了"。

**Q：人工评审的证据怎么记？**
记评审者、评审时间、量表版本、样本清单、评审结论与理由。`maturity: manual` 的条款在追溯矩阵里必须填 `Oracle tier = human`。

**Q：能不能把"暂时没测"写成 PASS？**
不能。写 INCONCLUSIVE，并在"证据不足"里写清缺什么。
