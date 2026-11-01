# 验证器设计与证据

## 验证器必须满足的四条

一个合格的验证器要有：

1. **明确的执行入口** —— 一条能粘贴到终端跑起来的命令
2. **明确的通过条件** —— 退出码、断言数、覆盖率阈值中的哪一个算通过
3. **确定的输入** —— fixture 或数据集，可复现
4. **确定的输出** —— PASS / FAIL / INCONCLUSIVE 三态，不是布尔

写不出这四条，说明它还只是"测试计划"，不是验证器。**自然语言的测试计划不算验证器。**

---

## 验证器选型

### 按需求性质选

| 需求性质 | 验证器 | 例子 |
|---|---|---|
| 输入 → 明确输出 | 单元 / 契约测试，精确断言 | "密码 7 位 → 400 + PASSWORD_TOO_WEAK" |
| 跨端点响应一致性 | 契约测试（Schema 驱动） | 响应体必须通过 `ProjectResponseSchema.parse()` |
| 不变量、往返、单调性 | 属性测试 | "任意 patch 施加两次结果相同" |
| 关系型正确性 | 蜕变测试 | "元素顺序重排后，内容集合不变" |
| 有可比对象 | 差分测试 | 新旧实现对同一输入产出等价结果 |
| 历史缺陷 | 缺陷回放 | 复现线上 issue 的输入，断言不再复现 |
| 主观质量 | 人工盲评 | 文案是否切题、版式是否失衡 |
| 性能、容量 | 基准测试 + 阈值 | P95 延迟 < 目标值 |
| 结构合法性 | Schema 校验 | Spec 文件自身通过 JSON Schema |

### 属性测试的写法

定义三件事，缺一不可：

```ts
// 输入空间
const pts = fc.array(fc.string({minLength: 1}), { minLength: 0, maxLength: 20 });

// 性质
it('patch 施加两次是幂等的', () => {
  fc.assert(fc.property(pts, (p) => {
    const once  = applyPatches(slide, [mkPatch(p)]);
    const twice = applyPatches(once,  [mkPatch(p)]);
    expect(twice).toEqual(once);
  }));
});
```

- **输入空间**：要有明确的边界（空数组、超长、特殊字符、emoji、零宽字符）
- **性质**：可判定、无副作用
- **边界**：单独列出被测边界值，别指望随机生成器覆盖到

> 属性测试最常见的失败是**性质写得太弱**（如"不崩溃"）。弱性质通过率 100%，但什么也没验证。写性质时问："如果实现错了，这条性质会失败吗？"

### 蜕变测试的常见变形

| 变形 | 期望 |
|---|---|
| 输入元素重排 | 输出语义不变（顺序敏感的场景除外） |
| 输入加空白 | 输出不变 |
| 输入重复 N 次 | 结果幂等 |
| 两个独立项交换 | 结果对称 |
| 数值放大 2 倍 | 对应输出同比放大（线性场景） |

### 差分测试的注意点

- 参考实现必须**真的独立**（不是同一份代码换个调用方式）
- 比对的是**语义等价**，不是字符串相等 —— 顺序、ID、时间戳通常要归一化
- 差分只能证明"两者一致"，不能证明"两者正确"。仍需独立的 authoritative Oracle 兜底

---

## 注入错误检查（验证器的元验证）

**这是整个流程里信息量最大、也最容易被跳过的一步。**

### 怎么做

对每条**关键**判据，故意把实现改错，看验证器是否失败：

```ts
// 故意把元素 ID 改回不含 slideId 的形式（F8 的反向注入）
const broken = slides.map(s => ({
  ...s,
  elements: s.elements.map(e => ({ ...e, id: e.id.replace(/^[^_]+_s\d+_/, '') })),
}));

// 预期：跨页 ID 唯一的断言必须失败
expect(() => assertUniqueIds(broken)).toThrow();
```

### 结论

| 注入结果 | 含义 | 动作 |
|---|---|---|
| 验证器失败 | ✅ 判据有效 | 继续 |
| 验证器通过 | ❌ **判据无效** | 补强验证器，或降级该条款的 confidence |
| 验证器报错但原因不对 | ⚠️ 假阳性 | 收紧断言，避免误报 |

### 记录

每次注入都记一条：

```yaml
# EVD-MUTATION-003
clause: SPEC-SLD-004
injection: "移除 slideId 前缀，制造跨页 ID 重复"
expected_detection: true
result: DETECTED
detected_by: "apps/api/tests/integration/ids.test.ts::unique-across-slides"
notes: ""
```

**没做注入检查的关键条款，在报告里必须标为 confidence 未验证**，不能按已验证计。

---

## 证据格式

一次验证执行产出一条证据。证据必须能回答："这个 PASS 是谁、凭什么、在什么环境下得出的？"

```yaml
id: EVD-AUTH-001
clause: SPEC-AUTH-001
acceptance: AC-AUTH-001
verdict: PASS               # PASS | FAIL | INCONCLUSIVE

spec_version: "1.2"          # Spec 文件版本 / 提交
code_version: "$(git rev-parse --short HEAD)"   # 代码版本
test_version: "$(git rev-parse --short HEAD)"   # 测试版本（可与代码同）
input_data: "apps/api/tests/fixtures/auth/register-case.json#password-too-weak"
environment: "bun 1.3.11 / macOS 15 / PGlite in-memory"
command: "bun test apps/api/tests/auth/register.test.ts"
result: "1 pass, 0 fail, 0 skip (exit 0)"
oracle_tier: authoritative
oracle_source: "docs/backend-design.md §3.2"
timestamp: "<ISO8601>"
notes: ""
```

### 三态的判定规则

| 结论 | 条件 |
|---|---|
| `PASS` | 验证器**实际执行过** + 判据可信（oracle 非 `self-derived`，或 `self-derived` 但有独立佐证）+ 证据完整 + 未被 skip |
| `FAIL` | 验证器实际执行过，未满足判据 |
| `INCONCLUSIVE` | 缺证据 / 未执行 / 判据不可信 / 环境缺失 / 用例被 skip / 被上游歧义阻塞 |

**硬规则**：

- 验证未执行 → `INCONCLUSIVE`，措辞里不能出现"通过"
- 用例被 skip → `INCONCLUSIVE`
- 判据是 `self-derived` 且是关键条款的唯一依据 → `INCONCLUSIVE`
- 环境缺失导致无法执行 → `INCONCLUSIVE`，并写清缺什么

> 报告里每个 PASS 都要能当场指出：哪条判据、哪个测试文件、哪次执行。指不出来的，就不是 PASS。

---

## CI 集成

### 分层

| 层 | 触发 | 时长目标 | 阻断 |
|---|---|---|---|
| Spec 结构校验 | 每次提交 | < 5s | ✅ |
| 单元 / 契约 | 每次提交 | < 60s | ✅ |
| 属性 / 蜕变 | 每日 / PR | < 5min | ✅ |
| 集成（真实 DB） | 每日 / PR | < 10min | ✅ |
| 评估套件（LLM） | 每日 + 模型变更时 | < 20min | ✅（阈值门禁） |
| 注入错误检查 | 每周 | < 10min | ⚠️ 报告不阻断 |

### 门禁

```
spec.schema.json 校验失败        → 阻断
关键条款无验收判据               → 阻断
关键条款的验证器被 skip          → 阻断
评估指标低于阈值                 → 阻断
maturity: none 比例 > 30%        → 警告
注入错误未被检出                 → 警告 + 建 Issue
```

**阈值只能改严不能改松**，且改动必须走 `DEC-` 记录。

---

## 常见反模式

| 反模式 | 为什么不行 | 正确做法 |
|---|---|---|
| 测试断言等于当前实现的输出 | 不验证任何东西，只防回归 | 从权威规则推导期望值 |
| 一个大测试文件覆盖 50 条条款 | 失败时定位不到 | 按条款分文件/分组，测试名带条款 ID |
| 用 `skip` 让 CI 变绿 | 把失败藏起来 | 标 INCONCLUSIVE 并建 Issue |
| 把 LLM Judge 当唯一 Oracle | 不可复现、不稳定 | 只作辅助信号，需与人评校准 |
| 降低阈值直到通过 | 标准漂移 | 记录决策，或修实现 |
| 只有 happy path | 异常路径才是缺陷来源 | 异常/权限/并发/边界必须各有用例 |
| 快照当唯一验证 | 快照只记录"现在是什么样" | 快照 + 独立判据断言 |
| 在测试里写 `expect(x).toBe(x)` | 空断言 | 检查断言是否真的约束了行为 |
| 依赖测试执行顺序 | 并行/CI 上随机失败 | 每个用例独立、幂等 |
| 用固定时间/随机数导致偶发失败 | 不可复现 | 注入可控时钟与随机源 |

---

## 快速判定：这个验证器合格吗？

逐条自问：

1. 我能粘贴一条命令跑起来吗？
2. 跑完我知道它算不算过吗？
3. 换一个环境跑，结果一样吗？
4. 如果实现写错了，它会失败吗？（**注入检查**）
5. 失败的输出能直接指向是哪条条款吗？
6. 这个"正确答案"是从被测系统之外来的吗？

有任何一条答不上来，这个验证器就还没建好。
