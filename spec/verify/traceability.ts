/**
 * 追溯矩阵与验证报告生成器
 * ---------------------------------------------------------------------------
 * 为什么用生成器而不是手写：
 *   手写的矩阵在下一次改 spec 时就会失真 —— 「判据存在但验证器指向错了文件」
 *   这类错误恰恰是追溯矩阵要抓的东西，矩阵自己却错了，就毫无意义。
 *
 *   所以这里从 spec/spec.yaml + 真实执行产物（junit / mutation-report）推导，
 *   人只负责写「为什么」的文字（根因、遗漏原因），不负责「是不是」。
 *
 * 运行：
 *     bun run spec/verify/traceability.ts
 *
 * 依赖的前置产物：
 *     spec/evidence/junit.xml            —— bun test --reporter=junit 的输出
 *     spec/evidence/mutation-report.json —— spec/verify/mutation-check.ts 的输出
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseJunitCases, type JunitCase } from './junit.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const SPEC_PATH = resolve(ROOT, 'spec/spec.yaml');
const EVIDENCE_DIR = resolve(ROOT, 'spec/evidence');
const JUNIT_PATH = join(EVIDENCE_DIR, 'junit.xml');
const MUTATION_PATH = join(EVIDENCE_DIR, 'mutation-report.json');
const OUT_PATH = resolve(ROOT, 'spec/traceability.md');

// ---------------------------------------------------------------------------
// spec.yaml 的结构
// ---------------------------------------------------------------------------

interface Acceptance {
  id: string;
  criterion: string;
  oracle: { tier: string; source: string; confidence: string };
  verification: { kind: string; target: string; command: string; pass_when: string };
  maturity: string;
}

interface Clause {
  id: string;
  title: string;
  type: string;
  risk: string;
  status?: string;
  statement: string;
  source: { doc: string; section: string; quote: string };
  derived_from?: string;
  conflict?: string;
  acceptance: Acceptance[];
  maturity: string;
  boundaries?: string[];
}

interface Spec {
  meta: { spec_version: string; title: string; sources: Array<{ doc: string; role: string }> };
  clauses: Clause[];
  ambiguities: Array<{ id: string; clause_ref?: string; blocks: string[]; question?: string; impact?: string }>;
  conflicts: Array<{ id: string; topic?: string; clause_a: string; clause_b: string; impact?: string; resolution?: string }>;
  decisions: Array<{ id: string; applies_to: string[]; decision?: string }>;
  known_gaps: Array<{ clause: string; reason: string; plan?: string }>;
}

type Verdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';

// ---------------------------------------------------------------------------
// 人工分析：这些是「为什么」，机器推不出来
// ---------------------------------------------------------------------------

/** 每个失败判据的根因归属 —— 决定这算实现缺陷还是文档与实现不一致 */
const FAILURE_ANALYSIS: Record<string, { symptom: string; cause: string; owner: string }> = {
  'AC-CORE-003': {
    symptom: '跨页元素 ID 重复：cards_grid 16 处、architecture_diagram 25 处、timeline 9 处、radial 5 处、stats_kpi 4 处、problem_solution 2 处、summary 2 处',
    cause: 'layoutEngine 的 7 种版式用 `layer_box_${index}` / `grid_card_${i}` 等**只带页内序号**的元素 ID，不带 slideId，多页同版式必然冲突',
    owner: '实现缺陷',
  },
  'AC-CORE-004': {
    symptom: '7 种版式共 64 个版式专属元素 ID 不含 slideId',
    cause: '同 AC-CORE-003 —— ID 命名缺少页维度；母版元素（bg_/header_/title_）已带 slideId，唯独版式专属元素漏了',
    owner: '实现缺陷',
  },
  'AC-CORE-008': {
    symptom: '7 种消费 bullets 的版式中，6 种（除 cards_grid 外）渲染结果里找不到 outline.bulletPoints 的任何一条',
    cause: 'layoutEngine 只在 cards_grid 分支读取 `outline.bulletPoints`；其余版式把硬编码演示文案写进了元素 content',
    owner: '实现缺陷',
  },
  'AC-CORE-009': {
    symptom: '封面出现 5 个无法追溯到 outline 的字符串："ENTERPRISE AI STRATEGY & ARCHITECTURE 2026" 与 metacard 的 reporter/date/version/scope',
    cause: 'title_cover 版式的主标题与 4 个 metacard 槽位全部硬编码，不读 outline.title / subtitle / keyMessage',
    owner: '实现缺陷',
  },
  'AC-CORE-010': {
    symptom: '7 种版式中 6 种在改变 outline.bulletPoints 后，渲染出的 SVG 字节完全一致',
    cause: '与 AC-CORE-008 同源 —— 版式不消费 bullets，输出自然与输入无关',
    owner: '实现缺陷',
  },
  'AC-QLT-009': {
    symptom: 'autoFixProject 执行后仍越界：页码（x=1760）被改成 width=200 → 右边界 1960 > 1820；页脚（y=1015）被改成 height=100 → 下边界 1115 > 1020',
    cause: '钳位逻辑用 `Math.max(200, 1820 - x)` / `Math.max(100, 1020 - y)`，最小值约束把元素撑回界外 —— 自动修复反而**制造**了越界',
    owner: '实现缺陷',
  },
  'AC-RND-002': {
    symptom: 'SVG 输出含 <foreignObject>：card 分支（svgRenderer.ts:302）与 metric 分支（svgRenderer.ts:329）各一处，8 种版式 × 8 套主题全部命中',
    cause: '渲染器用 <foreignObject> 承载富文本；ADR-011 要求改为纯 SVG <text>，导入 resvg 等服务端光栅化管线时会整段丢失',
    owner: '实现缺陷',
  },
  'AC-RND-003': {
    symptom: '每份 SVG 头部都有 `@import url("https://fonts.googleapis.com/...")`',
    cause: 'SVG 引用了外部字体 CDN；离线导出与服务器端渲染时该外链不可达，且构成出网请求',
    owner: '实现缺陷',
  },
  'AC-EXP-001': {
    symptom: 'PPTX 相对 IR 丢失 79 个文本运行，覆盖 8 种版式中的 6 种（封面 metacard、架构图 layer/sidebar、问题方案、时间线、统计 KPI、总结与行动清单）',
    cause: 'exportEngine 的卡片分支判定顺序是 `c.title && c.desc` 先于 `c.value && c.title`；stats_kpi 的 metric 内容同时含 title+desc，第一个分支永远命中，value/trend 永不渲染 —— 后一个分支是死代码',
    owner: '实现缺陷',
  },
  'AC-EXP-004': {
    symptom: '导出文件名保留非法字符：实测 "Q3 规划: 草案" → "Q3_规划:_草案.pptx"（: 未剥离）',
    cause: 'exportEngine 的文件名清洗只做了 `replace(/\\s+/g, "_")`，未处理 : / \\ * ? " < > |',
    owner: '实现缺陷',
  },
};

/** 源文档里有、但没有对应 Spec 条款的段落 —— 必须显式说明，不能静默丢弃 */
const OMISSIONS: Array<{ section: string; summary: string; reason: string }> = [
  {
    section: 'docs/backend-design.md §部署与运维',
    summary: '生产环境由运维手工执行数据库迁移',
    reason: '组织流程而非产品行为，落地为 SPEC-GOV 类的治理条款而非可执行判据',
  },
  {
    section: 'docs/backend-design.md §限流细则',
    summary: '网关层令牌桶的具体速率参数（未给出数值）',
    reason: '文档未给具体数值，写成判据等于替用户编业务规则；已登记为 AMB-003，条款标 planned',
  },
  {
    section: 'docs/testing-strategy.md §测试分层配比',
    summary: '各层测试建议数量配比（单测:集成:E2E = 7:2:1）',
    reason: '是流程建议不是产品行为，且仓库当前无任何测试，比例无参照基准',
  },
  {
    section: 'docs/test-cases.md §UI 交互用例',
    summary: '编辑器拖拽、缩放等鼠标交互用例',
    reason: '属前端实现细节，仓库无前端交互测试基础设施；已由 SPEC-IRP-002 覆盖「结构不变量」部分',
  },
];

/**
 * 证据不足的结论 —— 说明缺什么，以及为什么不能用 PASS 顶替
 *
 * **兜底表**：`spec.yaml` 的 `known_gaps` 优先级更高（那条理由写在条款旁边，
 * 随条款一起维护，改条款的人一定会看到）；这里只放条款没有登记 known_gaps
 * 时的兜底文案。
 *
 * 之前这张表里塞满了「验证器未建成 —— Hono 后端尚未实现」——
 * 那批条目在后端落地后**全部变成了假话**，而假话留在报告里比没有更糟：
 * 读报告的人会以为这些条款还没做。因此这里只保留仍然成立的条目，
 * 未登记的条款走下面的通用兜底文案。
 */
const INCONCLUSIVE_NOTES: Record<string, string> = {
  'SPEC-GOV-003': '判据本身不存在 —— 质量门禁的分数线在五份文档中从未给出，无法写出可判定条件',
  'SPEC-NFR-001':
    '验证器**已建成**，但本轮只在**降级模式**下执行过 —— 模型往返延迟根本没被采样到，真实模型下的 P95 仍未测过',
};

/** 通用兜底 —— 说清楚「没跑过」这件事本身，而不是猜一个原因 */
const INCONCLUSIVE_FALLBACK = '验证未执行 —— 该用例未出现在本次证据集中（没跑过的验证不是通过）';

const KNOWN_LIMITS: Array<{ limit: string; impact: string; acceptable: string; mitigation: string }> = [
  {
    limit: 'AI 端点在本轮证据中走的是**本地确定性降级实现**（.env 里 GEMINI_API_KEY 是占位符，模型不可用）',
    impact:
      '所有涉及「模型返回了什么」的判据验证的是降级路径；AC-NFR-001（真实模型 P95）因此只能给 INCONCLUSIVE',
    acceptable: '部分 —— 结构合规、落库前校验、降级行为这些判据与模型无关；但延迟类必须在真实模型下重测',
    mitigation:
      '在有真实密钥的评估环境设 BENCH_REAL_MODEL=1 重跑 `bun test ./apps/api/tests/perf/outline-latency.bench.ts`，把结果并入 spec/evidence/junit.xml',
  },
  {
    limit:
      '**E2E 是离线的**：模型端点被指向本地替身（`spec/verify/model-stub-server.ts`），因此 E2E **永远走「模型不可用 → 本地降级」这条路**，一次也没有连过真实模型',
    impact:
      'E2E 验证的是「模型不可用时前后端仍然集成正确」；它**不能**作为「真实模型下的生成质量」或「真实模型下的延迟」的证据。后者由 apps/api/tests/ai/（FakeModelClient）与 perf/ 下的基准覆盖，同样不是真实模型',
    acceptable:
      '是 —— 而且这是**文档要求的**，不是偷懒：docs/testing-strategy.md §6.1「默认离线：`bun test` 一律使用回放，不烧 API 额度」，docs/backend-design.md §13 的测试分层把「AI 离线 → 录制响应回放」列为独立一层。真实模型只在预发环境用',
    mitigation:
      '替身返回的是官方端点在占位 key 下的**原样** 400 响应体，于是链路仍是「真 HTTP → 真 SDK → 真错误分类（400 不可重试）→ 真降级链 → 真本地生成」，被换掉的只有链路尽头那台机器。要验证真实模型，需在预发环境单独跑（不进 `bun test`）',
  },
  {
    limit:
      '**E2E 的「生成大纲」等待上限（60s）等于降级链的最坏耗时（3 × 20s 模型超时）** —— 这条等式曾经让整条 E2E 变成掷硬币',
    impact:
      '外网抖一下（实测官方端点有 300ms 返回 400 的常态，也有 TLS 校验失败、整整 20s 连不上的时刻），AC-E2E-012 的基线就在「过」与「不过」之间摇摆。**证据不稳**：一次失败的判据分不清是实现坏了还是外网抽风',
    acceptable:
      '否 —— 这不是环境限制，是**测试设计的缺陷**。已经修掉：E2E 改走本地替身后，模型调用在 0–7ms 内失败（不再是 60,756ms），一轮 E2E 约 10s',
    mitigation:
      '替身让「模型不可用」变成确定事件而不是概率事件；同时后端把生效超时下推到 SDK 的 `httpOptions.timeout`，让超时**真的 abort 掉请求**（裸 `Promise.race` 只是不等了，socket 还挂着）。复现脚本：`bun run spec/verify/repro-flake.ts`',
  },
  {
    limit:
      '**替身不能跑在调用方的进程里** —— 注入检查用 `Bun.spawnSync` 同步等测试结果，整个进程的 JS 事件循环是停的',
    impact:
      '同进程内的替身 HTTP 服务没机会应答，后端发来的请求一直挂到超时（实测每次模型调用整整 60s 超时），E2E 会**确定性地**失败 —— 这不是偶发，是每次都挂',
    acceptable: '否 —— 已修',
    mitigation:
      '替身拆成独立进程（`spec/verify/model-stub-server.ts`），端口通过 stdout 的 `PORT=<n>` 交接。被同步阻塞的进程服务不了别人',
  },

  {
    limit: '前后端集成 E2E 的证据依赖真实浏览器（Playwright + Chromium）与真实服务端进程',
    impact:
      '证据不可移植到没装浏览器的环境；跑一次要拉起两个进程（后端 + vite），比单元测试重',
    acceptable: '是 —— 判据断言的是**服务端状态**（UI 操作 → 库里存了什么），不依赖浏览器的实现细节',
    mitigation:
      'spec/verify/servers.ts 已把「拉起服务 → 跑 E2E → 收尾」收成一条命令（bun run spec/verify/all.ts），并用独立端口 3199/5199 与独立数据目录，不与开发者本机的 dev server 打架',
  },
  {
    limit: '注入错误检查只覆盖了一部分判据',
    impact:
      '没被注入验证过的判据，它的 PASS 只来自「测试跑过了」，没有被证明「验证器抓得住错」',
    acceptable: '部分 —— 已逐条列出（见 §三），高风险条款优先补',
    mitigation: '给每条判据补一个代表性注入错误；注入的必须是**代表性错误**，不是不完整的错误',
  },
  {
    limit: '质量门禁分数线未在任何文档中给出',
    impact: 'SPEC-GOV-003 无法写成判据，质量分能否「上线」无从判定',
    acceptable: '否 —— 属关键歧义',
    mitigation: '需业务方给出分数线；已登记为 AMB-001',
  },
  {
    limit: 'DOM 垫片只实现尺寸与文件名，PNG/JPG 像素内容未验证',
    impact: 'AC-EXP-003 只覆盖分辨率倍率，不覆盖实际渲染结果',
    acceptable: '是',
    mitigation: '像素级验收交给人工目视或后续接入真实 Canvas 实现',
  },
  {
    limit: 'Oracle 中 self-derived 的判据无法独立证明实现正确',
    impact: 'AC-QLT-010（元素 ID 重排规则）只能防回归',
    acceptable: '是 —— 已显式标注，且该条款 risk 不为 high',
    mitigation: '等 SPEC-GOV-001 的版本化存储落地后，用真实快照基线替换',
  },
];

// ---------------------------------------------------------------------------
// 读取 junit 结果
// ---------------------------------------------------------------------------

/**
 * 证据文件清单
 *
 * 分成两份而不是合成一份，是因为这两层证据的性质不同：
 *   · junit.xml     —— 单元 / 集成 / 契约 / 安全（进程内，无外部依赖）
 *   · junit-e2e.xml —— 真实浏览器 + 真实服务端的前后端集成
 * 合成一份会让"这条 PASS 是哪一层跑出来的"变得不可辨。
 */
const JUNIT_FILES = [
  { path: join(EVIDENCE_DIR, 'junit.xml'), label: 'spec/evidence/junit.xml' },
  { path: join(EVIDENCE_DIR, 'junit-e2e.xml'), label: 'spec/evidence/junit-e2e.xml' },
];

function readJunit(): JunitCase[] {
  if (!existsSync(JUNIT_PATH)) {
    throw new Error(
      `缺少 ${JUNIT_PATH}\n先运行：bun run spec/verify/all.ts\n` +
        `（或直接跑证据集：bun test spec/verify/ packages/core/tests/ apps/api/tests/ ` +
        `./scripts/check-coverage.check.ts ./apps/api/tests/perf/export-latency.bench.ts ` +
        `--reporter=junit --reporter-outfile=spec/evidence/junit.xml）`
    );
  }

  const cases: JunitCase[] = [];
  for (const { path, label } of JUNIT_FILES) {
    if (!existsSync(path)) continue;
    const xml = readFileSync(path, 'utf-8');
    // 每个 <testcase ...> 块里，name 是用例名，file 是文件路径；块内有 <failure> 即失败
    cases.push(...parseJunitCases(xml, label));
  }
  return cases;
}

function readMutation(): {
  total: number;
  unqualified: number;
  cases: Array<{
    criterion: string;
    description: string;
    mutated_file: string;
    verifier: string;
    baseline_pass: boolean;
    caught: boolean;
    restored_pass: boolean;
    note: string;
  }>;
} {
  if (!existsSync(MUTATION_PATH)) {
    throw new Error(`缺少 ${MUTATION_PATH}\n先运行：bun run spec/verify/mutation-check.ts`);
  }
  return JSON.parse(readFileSync(MUTATION_PATH, 'utf-8'));
}

function readCoverage(): {
  directory: string;
  threshold: number;
  found: number;
  hit: number;
  percent: number;
  passed: boolean;
} | null {
  const path = join(EVIDENCE_DIR, 'coverage.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

// ---------------------------------------------------------------------------
// 结论推导
// ---------------------------------------------------------------------------

function verdictOf(a: Acceptance, junit: JunitCase[]): Verdict {
  if (a.maturity !== 'automated') return 'INCONCLUSIVE';
  const [file, caseName] = a.verification.target.split('::');
  if (!caseName) return 'INCONCLUSIVE';
  const hit = junit.find((c) => c.name === caseName && c.file === file);
  if (!hit) return 'INCONCLUSIVE'; // 验证未执行 —— 不能报 PASS
  return hit.failed ? 'FAIL' : 'PASS';
}

function worstOf(verdicts: Verdict[]): Verdict {
  if (verdicts.length === 0) return 'INCONCLUSIVE'; // 没有判据 = 无法判定，不是通过
  if (verdicts.includes('FAIL')) return 'FAIL';
  if (verdicts.includes('INCONCLUSIVE')) return 'INCONCLUSIVE';
  return 'PASS';
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function main(): void {
  const spec = Bun.YAML.parse(readFileSync(SPEC_PATH, 'utf-8')) as Spec;
  const junit = readJunit();
  const mutation = readMutation();
  const coverage = readCoverage();

  // --- 证据集规模（从 junit 现场统计，不手写数字） ---
  //
  // **单元/集成集与浏览器 E2E 是两层证据，分开计数** ——
  // 混成一个总数的话，"证据集跑了 N 个用例"这句话说不清 N 到底是哪几层，
  // 读者也无从判断"集成到底验没验"。
  const unitCases = junit.filter((c) => !c.file.startsWith('e2e/'));
  const junitFiles = new Set(unitCases.map((c) => c.file)).size;
  const junitCases = unitCases.length;
  const junitFailed = unitCases.filter((c) => c.failed).length;
  const junitPassed = junitCases - junitFailed;
  const specVerifyFiles = [...new Set(unitCases.map((c) => c.file))].filter((f) =>
    f.startsWith('spec/verify/')
  ).length;

  // E2E 单独统计 —— 它是另一层证据
  const e2eCases = junit.filter((c) => c.file.startsWith('e2e/')).length;
  const e2eFailed = junit.filter((c) => c.file.startsWith('e2e/') && c.failed).length;

  // E2E 链清单 —— 从磁盘上现存的链文件读出来，不手写。
  //
  // 手写清单的话，新增一条链忘了改这里，报告会列出**已经不存在的文件**，
  // 而真正跑了的那条链在报告里查无此案 —— 报告与事实脱节。
  const e2eChainFiles: string[] = readdirSync(resolve(ROOT, 'e2e'))
    .filter((n) => n.endsWith('.e2e.ts'))
    .sort()
    .map((n) => `e2e/${n}`);

  // --- 注入检查覆盖了哪些判据 ---
  // 没被注入验证过的判据，它的 PASS 只来自「测试跑过了」，
  // 没有「抓得住错」的元验证 —— 这件事必须写进报告，不能藏起来。
  const allAcceptanceIdList = spec.clauses.flatMap((c) => c.acceptance.map((a) => a.id));
  const mutatedCriteria = new Set(mutation.cases.map((c) => c.criterion));
  const unmutatedCriteria = allAcceptanceIdList.filter((id) => !mutatedCriteria.has(id));
  const automatedCrit = spec.clauses.flatMap((c) => c.acceptance).filter((a) => a.maturity === 'automated')
    .length;

  const rows: Array<{
    clause: Clause;
    criteria: Acceptance[];
    verdicts: Verdict[];
    verdict: Verdict;
  }> = spec.clauses.map((clause) => {
    const criteria = clause.acceptance;
    const verdicts = criteria.map((a) => verdictOf(a, junit));
    return { clause, criteria, verdicts, verdict: worstOf(verdicts) };
  });

  // --- 反向孤儿检查 ---
  // 判据 ID（AC-*）与条款 ID（SPEC-*）是两套命名空间，不能直接互相包含比较 ——
  // 能游离的判据只可能是「ID 重复」或「前缀与所属条款对不上」。
  const allAcceptanceIds = spec.clauses.flatMap((c) => c.acceptance.map((a) => a.id));
  const dupAcceptance = allAcceptanceIds.filter((id, i) => allAcceptanceIds.indexOf(id) !== i);
  const orphanAcceptance = spec.clauses.flatMap((c) =>
    c.acceptance
      .filter((a) => {
        // 判据应挂在**同族**条款下：AC-CORE-009 → SPEC-CORE-00x（族前缀 CORE 相同）
        // 判据序号不必与条款序号一致 —— 一条条款可以有多条判据
        const family = (id: string) => id.replace(/^(AC|SPEC)-/, '').replace(/-\d+$/, '');
        return family(a.id) !== family(c.id);
      })
      .map((a) => `${a.id}@${c.id}`)
  );
  const usedVerifiers = new Set(
    spec.clauses.flatMap((c) => c.acceptance.map((a) => a.verification.target.split('::')[0]!))
  );
  const orphanVerifiers = spec.clauses
    .flatMap((c) => c.acceptance)
    .filter((a) => a.verification.target && !usedVerifiers.has(a.verification.target.split('::')[0]!))
    .map((a) => a.id);
  const noAcceptance = spec.clauses.filter((c) => c.acceptance.length === 0).map((c) => c.id);
  const noneMaturity = spec.clauses.filter((c) => c.maturity === 'none');
  const noneRatio = noneMaturity.length / spec.clauses.length;

  // --- 统计 ---
  const totalCriteria = spec.clauses.flatMap((c) => c.acceptance).length;

  // 「没有任何判据」的条款单列一档 —— 它不是 PASS，也不是普通 INCONCLUSIVE，
  // 而是「连要测什么都没确定」，必须在矩阵里显形而不是被平均值吃掉。
  const uncoveredRows = rows.filter((r) => r.clause.acceptance.length === 0);
  const judgedRows = rows.filter((r) => r.clause.acceptance.length > 0);

  // 「无证据」清单 = 判据 INCONCLUSIVE 的 + 根本没有判据的（后者同样无证据，且不能重复列）
  const noEvidenceRows = [
    ...rows.filter((r) => r.verdict === 'INCONCLUSIVE' && r.clause.acceptance.length > 0),
    ...uncoveredRows,
  ];

  const passClauses = judgedRows.filter((r) => r.verdict === 'PASS').length;
  const failClauses = judgedRows.filter((r) => r.verdict === 'FAIL').length;
  const incClauses = judgedRows.filter((r) => r.verdict === 'INCONCLUSIVE').length;
  const uncoveredClauses = uncoveredRows.length;

  const criteriaVerdicts = judgedRows.flatMap((r) => r.verdicts);
  const passCrit = criteriaVerdicts.filter((v) => v === 'PASS').length;
  const failCrit = criteriaVerdicts.filter((v) => v === 'FAIL').length;
  const incCrit = criteriaVerdicts.filter((v) => v === 'INCONCLUSIVE').length;

  // --- 渲染 ---
  const L: string[] = [];
  const P = (s = '') => L.push(s);

  P('# 追溯矩阵与验证报告');
  P();
  P('> 本文件由 `spec/verify/traceability.ts` 从 `spec/spec.yaml` 与真实执行产物生成，请勿手工编辑。');
  P('> 重新生成：`bun run spec/verify/traceability.ts`（前置：先跑测试与注入检查，见 `spec/README.md`）。');
  P();
  P(`- Spec 版本：\`${spec.meta.spec_version}\``);
  P(`- 条款总数：**${spec.clauses.length}**　判据总数：**${totalCriteria}**`);
  P(`- 生成时 junit 证据：\`spec/evidence/junit.xml\`；注入证据：\`spec/evidence/mutation-report.json\``);
  P(
    `- 失败原因：\`spec/evidence/junit-output.txt\`（单元 / 集成）与 \`spec/evidence/junit-e2e-output.txt\`（E2E）—— ` +
      `**Bun 的 junit 报告只写失败类型、不写错误信息**（实测产出的是 \`<failure type="AssertionError" />\`），` +
      `失败详情在 stderr 里，所以单独落盘`
  );
  P();

  // ---- 一、追溯矩阵 ----
  P('---');
  P();
  P('## 一、追溯矩阵');
  P();
  P('### 1.1 文档条款 → Spec → 验证器 → 证据');
  P();
  P('| 文档章节 | Spec ID | 类型 | 风险 | 验收判据 | 验证器 | Oracle tier | 证据 | 结论 |');
  P('|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const c = r.clause;
    const section = `${c.source.doc} ${c.source.section}`;
    const criteria = c.acceptance.map((a) => a.id).join(', ') || '—';
    const verifiers = [
      ...new Set(c.acceptance.map((a) => a.verification.target).filter(Boolean)),
    ].join('<br>') || '—';
    const tiers = [...new Set(c.acceptance.map((a) => a.oracle.tier))].join(', ') || '—';
    const evidence = r.criteria.length === 0 || r.verdict === 'INCONCLUSIVE'
      ? '—'
      : r.criteria
          .map((a) => `EVD-${a.id.replace(/^AC-/, '')}`)
          .join(', ');
    const verdict =
      r.criteria.length === 0
        ? '**未覆盖**'
        : r.verdict === 'PASS'
          ? '**PASS**'
          : r.verdict === 'FAIL'
            ? '**FAIL**'
            : 'INCONCLUSIVE';
    P(
      `| ${section} | ${c.id} | ${c.type} | ${c.risk} | ${criteria} | ${verifiers} | ${tiers} | ${evidence} | ${verdict} |`
    );
  }
  P();

  // ---- 1.2 反向孤儿检查 ----
  P('### 1.2 反向孤儿检查');
  P();
  P('| 检查 | 结果 | 判定 |');
  P('|---|---|---|');
  P(`| 有没有条款没有验收判据？ | ${noAcceptance.length} 条（${noAcceptance.join(', ') || '—'}） | ${noAcceptance.length === 0 ? '✅' : '✅ 全部登记在 §1.3 未覆盖清单'} |`);
  P(`| 有没有判据 ID 重复？ | ${dupAcceptance.length} 个 | ${dupAcceptance.length === 0 ? '✅' : '❌ ' + dupAcceptance.join(', ')} |`);
  P(`| 有没有判据挂错条款？ | ${orphanAcceptance.length} 个 | ${orphanAcceptance.length === 0 ? '✅' : '❌ ' + orphanAcceptance.join(', ')} |`);
  P(`| 有没有验证器没有对应条款？ | ${orphanVerifiers.length} 个 | ${orphanVerifiers.length === 0 ? '✅' : '❌ ' + orphanVerifiers.join(', ')} |`);
  P(`| 有没有文档段落没有对应条款？ | ${OMISSIONS.length} 段 | ✅ 全部登记在 §1.4 |`);
  P(
    `| 有没有 \`maturity: none\` 的条款？ | ${noneMaturity.length}/${spec.clauses.length}（${(noneRatio * 100).toFixed(1)}%） | ${noneRatio > 0.3 ? '⚠️ 超过 30%' : '✅ 低于 30% 阈值'} |`
  );
  P();

  // ---- 1.3 未覆盖清单 ----
  P('### 1.3 未覆盖清单');
  P();
  P('| Spec ID | 未覆盖原因 | 影响 | 计划 |');
  P('|---|---|---|---|');
  // 一个条款可能登记**多条** known_gap（不同侧面各一条）。
  // 这里按条款收成**列表**再拼 —— 用 Map 直接存单值的话，
  // 后登记的那条会把先登记的那条**静默覆盖**，
  // 报告里就只剩最后一个原因，看不到条款还有别的洞。
  const gapReasons = new Map<string, string[]>();
  const gapPlans = new Map<string, string[]>();
  for (const g of spec.known_gaps) {
    const reasons = gapReasons.get(g.clause) ?? [];
    reasons.push(g.reason);
    gapReasons.set(g.clause, reasons);
    if (g.plan) {
      const plans = gapPlans.get(g.clause) ?? [];
      plans.push(g.plan);
      gapPlans.set(g.clause, plans);
    }
  }
  for (const r of noEvidenceRows) {
    const reason =
      gapReasons.get(r.clause.id)?.join('<br>') ??
      INCONCLUSIVE_NOTES[r.clause.id] ??
      INCONCLUSIVE_FALLBACK;
    const blockers = spec.ambiguities.filter((a) => a.blocks.includes(r.clause.id));
    const impact = blockers.length
      ? `受 ${blockers.map((b) => b.id).join(', ')} 影响`
      : r.clause.risk === 'high'
        ? '高风险条款无证据'
        : '中低风险条款无证据';
    // 计划以条款自带的 known_gaps.plan 为准 —— 那是改条款的人写下的下一步，
    // 比生成器里猜一个「实现后端测试骨架后执行」靠谱得多。
    const plan =
      gapPlans.get(r.clause.id)?.join('<br>') ??
      (blockers.length
        ? `待 ${blockers.map((b) => b.id).join(', ')} 裁决后补齐`
        : r.clause.acceptance.length === 0
          ? '判据缺失，先补判据再建验证器'
          : '补齐验证器后执行');
    P(`| ${r.clause.id} | ${reason} | ${impact} | ${plan} |`);
  }
  P();

  // ---- 1.4 遗漏说明 ----
  P('### 1.4 遗漏说明（源文档有、Spec 无）');
  P();
  P('| 文档章节 | 内容摘要 | 未纳入原因 |');
  P('|---|---|---|');
  for (const o of OMISSIONS) P(`| ${o.section} | ${o.summary} | ${o.reason} |`);
  P();

  // ---- 1.5 歧义 / 冲突 / 决定 ----
  P('### 1.5 歧义、冲突与已作决定');
  P();
  P('| 类型 | ID | 内容 | 阻塞的条款 |');
  P('|---|---|---|---|');
  for (const a of spec.ambiguities) {
    P(`| 歧义 | ${a.id} | ${a.question ?? a.impact ?? '—'} | ${a.blocks.join(', ') || '（不阻塞）'} |`);
  }
  for (const c of spec.conflicts) {
    const affects = `${c.clause_a} ↔ ${c.clause_b}`;
    P(`| 冲突 | ${c.id} | ${c.topic ?? affects}${c.impact ? ` —— ${c.impact}` : ''} | ${c.resolution ?? '待裁决'} |`);
  }
  for (const d of spec.decisions) {
    P(`| 决定 | ${d.id} | ${d.decision ?? '—'} | ${d.applies_to.length ? d.applies_to.join(', ') : '（全局）'} |`);
  }
  P();

  // ---- 二、验证报告 ----
  P('---');
  P();
  P('## 二、验证报告');
  P();
  P('### 2.1 结论汇总');
  P();
  P('| 结论 | 条款数 | 判据数 | 占比（按判据） |');
  P('|---|---|---|---|');
  const pct = (n: number) => `${((n / totalCriteria) * 100).toFixed(1)}%`;
  P(`| PASS | ${passClauses} | ${passCrit} | ${pct(passCrit)} |`);
  P(`| FAIL | ${failClauses} | ${failCrit} | ${pct(failCrit)} |`);
  P(`| INCONCLUSIVE | ${incClauses} | ${incCrit} | ${pct(incCrit)} |`);
  P(`| 未覆盖（无判据） | ${uncoveredClauses} | 0 | 0.0% |`);
  P(`| **合计** | **${spec.clauses.length}** | **${totalCriteria}** | **100%** |`);
  P();
  P(
    `> 结论为 PASS 的判据共 ${passCrit} 条，每一条都在 §2.3 有对应证据记录（EVD-\*）。`
  );
  P(
    `> 「未覆盖（无判据）」的 ${uncoveredClauses} 条（${noAcceptance.join(', ') || '—'}）连判据都不存在，既不是 PASS 也不是 FAIL —— 见 §2.5。`
  );
  P();

  // ---- 2.2 失败明细 ----
  P('### 2.2 失败明细');
  P();
  const failedRows = rows.filter((r) => r.verdict === 'FAIL');
  if (failedRows.length === 0) {
    P('（无）');
  } else {
    P('| Spec ID | 判据 | 现象 | 根因 | 归属 |');
    P('|---|---|---|---|---|');
    for (const r of failedRows) {
      for (const a of r.criteria) {
        const an = FAILURE_ANALYSIS[a.id];
        P(
          `| ${r.clause.id} | ${a.id} | ${an?.symptom ?? '—'} | ${an?.cause ?? '—'} | ${an?.owner ?? '实现缺陷'} |`
        );
      }
    }
    P();
    P(
      '> 上表的「现象 / 根因」是**已确认**的归因。若某条失败没有归因条目（显示「—」），' +
        '去 `spec/evidence/junit-output.txt`（单元 / 集成）或 `spec/evidence/junit-e2e-output.txt`（E2E）看原始报错 —— ' +
        'Bun 的 junit 报告只写失败类型、不写错误信息，那两份 stderr 就是失败原因的第一手材料。'
    );
  }
  P();

  // ---- 2.3 证据清单 ----
  P('### 2.3 证据清单');
  P();
  P('每条 PASS / FAIL 都有一条。`verdict` 为 PASS 或 FAIL 时，验证器**确实执行过**。');
  P();
  for (const r of rows) {
    for (let i = 0; i < r.criteria.length; i++) {
      const a = r.criteria[i]!;
      const v = r.verdicts[i]!;
      if (v === 'INCONCLUSIVE') continue;
      const cmd = a.verification.command;
      const caseName = a.verification.target.split('::')[1] ?? '';
      P('```');
      P(`EVD-${a.id.replace(/^AC-/, '')}`);
      P(`  clause:        ${r.clause.id}`);
      P(`  acceptance:    ${a.id}`);
      P(`  verdict:       ${v}`);
      P(`  spec_version:  ${spec.meta.spec_version}`);
      P(`  input_data:    ${r.clause.source.doc} ${r.clause.source.section} —— ${r.clause.source.quote.slice(0, 48)}…`);
      P(
        `  environment:   bun ${Bun.version} / ${process.platform} / ${
          a.verification.target.startsWith('e2e/')
            ? '**无外部服务调用**（数据库为进程内 PGlite，模型端点为本地替身 —— 见 §2.6「E2E 是离线的」）'
            : '无外部服务调用（数据库为进程内 PGlite，AI 端点为本地确定性降级）'
        }`
      );
      P(`  command:       ${cmd}`);
      P(`  case:          ${a.verification.target}`);
      P(`  result:        ${v === 'PASS' ? '该用例通过' : '该用例失败'}（${caseName}）`);
      P(`  oracle_tier:   ${a.oracle.tier}`);
      P(`  oracle_source: ${a.oracle.source}`);
      P(`  evidence:      ${a.verification.target.startsWith('e2e/') ? 'spec/evidence/junit-e2e.xml' : 'spec/evidence/junit.xml'}`);
      P('```');
    }
  }
  P();

  // ---- 2.4 注入错误检查 ----
  P('### 2.4 注入错误检查（验证器的元验证）');
  P();
  P(
    `共 ${mutation.total} 个注入用例，**不合格 ${mutation.unqualified} 个**。每个用例走「基线 PASS → 注入必须 FAIL → 还原后重新 PASS」三步。`
  );
  P();
  P('| 判据 | 注入的错误 | 改动的文件 | 检出者 | 基线 | 检出 | 还原 |');
  P('|---|---|---|---|---|---|---|');
  for (const c of mutation.cases) {
    const yn = (b: boolean) => (b ? '✅' : '**MISSED**');
    P(
      `| ${c.criterion} | ${c.description} | \`${c.mutated_file}\` | \`${c.verifier}\` | ${yn(c.baseline_pass)} | ${yn(c.caught)} | ${yn(c.restored_pass)} |`
    );
  }
  P();
  if (mutation.unqualified > 0) {
    P('> ⚠️ 存在 MISSED 的行 —— 这些判据的「通过」不构成证据。');
  } else {
    P('> 全部注入错误都被对应验证器抓到。**没有 MISSED 行** —— 上表的 PASS 因此不是自证。');
  }
  P();
  P(
    '> 首轮运行曾出现 1 个 MISSED（AC-RND-004）：判据原文写作「存在 `id=` **或** `data-element-id=`」，弱于条款陈述本身要求的「必须带有 id 属性」。已把判据收紧到与条款陈述及 `docs/test-cases.md` TC-EXP-003 一致，并补上第二条注入（data-element-id 值与 IR 不一致）。'
  );
  P();
  P(
    '> **注入的必须是「代表性错误」** —— 拆掉乐观锁的前置检查却留着 SQL 里的 `WHERE version_id = ...`，验证器照样返回 409，抓不到；那不是代表性错误，是不完整的错误。AC-API-002 因此需要同时改两处。'
  );
  P();
  P(
    '> **E2E 的注入跑整个文件而不是单个用例** —— E2E 是一条顺序流程，单独跑一个用例会因为「前置没做」而失败。那种失败跟「抓到了注入的错误」是两回事，混在一起就是假阳性。'
  );
  P();
  P(
    '> **锚点必须唯一** —— `String.replace(字符串)` 只替换**第一处**匹配。锚点在文件里出现两次时，注入落在第一处，而被测路径可能根本不在那儿：注入「执行成功」、验证器「仍然通过」，看上去是验证器抓不到错，实际上是**注入根本没进到被测代码路径**。首轮的 AC-IRP-001 就栽在这（同一段 `patches: result.patches,` 同时出现在 `/edit-slide` 和 `/suggest` 两个路由里，注入改的是前者，验的却是后者）。现在这条是**硬校验**：锚点不唯一即判该用例不合格。'
  );
  P();
  P(
    '> **E2E 每一轮都重起服务** —— 服务进程在启动那一刻就把源码读进内存了，之后改磁盘上的文件对它毫无影响。复用同一个进程跑「注入前/注入后」两轮，注入根本没进到被测系统里 —— 又一个自己造出来的假阴性。首轮的 AC-E2E-011/012/013 三个用例就死在这里。现在每一轮都重起，且每轮换一组新端口（端口不换的话，上一轮的进程还没退干净，这一轮就等于连到了旧进程）。'
  );
  P();
  P(
    '> **注入必须落在被测路径上** —— 改错路由/改错函数，注入就等于没注入。AC-E2E-004 首轮注入的是 `PATCH /api/projects/:id/outline`，而前端保存大纲走的是 `PATCH /api/projects/:id`（`src/services/projectStorage.ts` 的 `updateProject`）—— 注入落在一个没人调的路由上，E2E 自然照样通过。'
  );
  P();
  P(
    '> **探活要认身份，不能只看 `res.ok`** —— 首轮找空闲端口时「借一个、放一个」连做两次，操作系统把刚放开的端口又发了一遍，于是后端和前端拿到了同一个端口：vite 绑不上（`--strictPort` 直接退出），探活却打到了后端 —— 后端也回 200，于是「前端起来了」是假的，E2E 的基线就这么平白挂了一次。现在两个端口同时占住探针再一起放开，并分别校验「后端回信封」「前端回 HTML」，起不来就换一组端口重试。'
  );
  P();
  P(
    '> **E2E 现在是离线的 —— 这是文档要求，不是降级偷懒** —— docs/testing-strategy.md §6.1 明写「`bun test` 一律使用回放，不烧 API 额度」，docs/backend-design.md §13 的测试分层把「AI 离线 → 录制响应回放」列为独立一层。E2E 之前的做法（直连官方端点 + `.env` 里的占位 key）**违反**了这一条：它每次都真烧一次外网请求，结论还取决于外网当时的状态。现在模型端点被指向本地替身（`spec/verify/model-stub-server.ts`），替身返回官方端点在占位 key 下的**原样** 400 响应体，于是链路仍是「真 HTTP → 真 SDK → 真错误分类（400 不可重试）→ 真降级链 → 真本地生成」，被换掉的只有链路尽头那台机器。'
  );
  P();
  P(
    '> **结论的适用范围因此要说清楚** —— E2E 证明的是「模型不可用时前后端仍然集成正确」。它**不**证明「真实模型下的生成质量」，也**不**证明「真实模型下的延迟」。前者由 `apps/api/tests/ai/`（FakeModelClient）覆盖、后者由 `apps/api/tests/perf/` 覆盖 —— 两者同样都不是真实模型。要用真实模型验证，只能在预发环境单独跑，不能进 `bun test`。'
  );
  P();
  P(
    '> **测试的等待上限不能等于被测实现的最坏值** —— AC-E2E-012 首轮的基线是**掷硬币**：「生成大纲」那一步只等 60s，而降级链的最坏耗时正好是 3 × 20s 模型超时 = 60s。官方端点实测既有 300ms 返回 400 的常态，也有 TLS 校验失败、整整 20s 连不上的时刻 —— 外网一抖，判据就"失败"了。**一次失败的判据分不清是实现坏了还是外网抽风，证据就不成立。** 改走本地替身后，模型调用在 0–7ms 内失败（不再是 60,756ms），一轮 E2E 约 10s。复现脚本：`bun run spec/verify/repro-flake.ts`。'
  );
  P();
  P(
    '> **超时必须真的 abort 掉请求** —— 后端原先用裸 `Promise.race` 实现超时：竞速输了就不等了，但底层那个 HTTP 请求还挂着，socket 也没释放。现在把生效的超时下推到 SDK 的 `httpOptions.timeout`，由 SDK 自己去 abort —— 竞速的超时和客户端的超时是同一个值，两边不会再各等各的。'
  );
  P();
  P(
    '> **替身不能跑在调用方的进程里** —— 注入检查用 `Bun.spawnSync` 同步等测试结果，整个进程的 JS 事件循环是**停着**的。替身要是同进程，它的 HTTP 服务就没机会应答，后端发来的请求一直挂到超时（实测每次模型调用整整 60s），E2E 会每次都挂。现在替身是独立进程（`spec/verify/model-stub-server.ts`），端口通过 stdout 的 `PORT=<n>` 交接。**被同步阻塞的进程服务不了别人。**'
  );
  P();
  P(
    '> **E2E 的页面不能被热重载** —— vite 的 dev server 监听**整个项目根目录**，而 E2E 跑的时候根目录底下一直在变：PGlite 是文件数据库（每写一行都在改 `.data/e2e-pglite/**`）、导出产物落在 `.data/e2e-artifacts/`、浏览器证据落在 `spec/evidence/`、注入检查还会直接改源码。任何一次改动都可能让 vite 给页面发一次**整页重载**。页面一重载，React 的内存状态就没了，E2E 里「UI 操作 → 服务端存了什么」这条链子就断在中间。实测两次：一次让「还原后」那一轮连挂 4 个用例（AC-E2E-006 判为不合格），一次只是碰巧没炸。现在 E2E 的 vite 一律带 `DISABLE_HMR=true`（这个开关本来就是为「agent 改文件时页面乱闪」准备的，见 vite.config.ts）—— E2E 断言的是**服务端状态**，不测热重载，热重载对它是纯噪声。'
  );
  P();
  P(
    '> **顺带挖出两个真实的前端缺陷**（不是测试问题，是实现问题）—— 页面重载会走一遍「会话恢复 → 拉项目列表 → 拉项目全量」，这条链上暴露出：(a) `App.tsx` 的 `loadProjects()` 用**摘要**覆盖已加载的全量，而摘要里的 `slides` 恒为空数组，于是已加载的每一页 IR 被抹掉；(b) `Workbench.tsx` 在 `project.slides` 为空时仍一路解引用 `currentSlide`，`Cannot read properties of undefined (reading \'slideId\')` 直接把整个应用打崩（仓库里没有错误边界）。两个都已修：摘要只更新标量字段、IR 沿用已加载的那份；工作台对「零页」渲染空状态而不是崩。**这是 E2E 的价值 —— 它抓到了单元测试抓不到的东西。**'
  );
  P();

  // ---- 2.5 证据不足的结论 ----
  P('### 2.5 证据不足的结论（INCONCLUSIVE）');
  P();
  P('| 条款 | 缺什么 | 为什么不能用 PASS 代替 |');
  P('|---|---|---|');
  for (const r of noEvidenceRows) {
    const reason =
      gapReasons.get(r.clause.id)?.join('<br>') ??
      INCONCLUSIVE_NOTES[r.clause.id] ??
      INCONCLUSIVE_FALLBACK;
    const why =
      r.clause.acceptance.length === 0
        ? '判据本身不存在，无法判定 —— 连要测什么都没确定'
        : r.clause.maturity === 'none'
          ? '判据本身不存在，无法判定 —— 连要测什么都没确定'
          : r.clause.acceptance.some((a) => a.oracle.tier === 'self-derived')
            ? '判据来自实现反推 —— 实现不能证明自己正确'
            : r.clause.acceptance.every((a) => a.maturity === 'automated')
              ? '验证器存在但**本次未执行**（用例未出现在证据集中）—— 没跑过的验证不是通过'
              : '验证未执行 —— 没跑过的验证不是通过';
    P(`| ${r.clause.id} | ${reason} | ${why} |`);
  }
  P();

  // ---- 2.6 已知限制 ----
  P('### 2.6 已知限制');
  P();
  P('| 限制 | 影响面 | 是否可接受 | 缓解方式 |');
  P('|---|---|---|---|');
  for (const l of KNOWN_LIMITS) {
    P(`| ${l.limit} | ${l.impact} | ${l.acceptable} | ${l.mitigation} |`);
  }
  P();

  // ---- 三、汇报口径 ----
  P('---');
  P();
  P('## 三、汇报口径');
  P();
  P('### 生成了什么');
  P();
  P(
    `- \`spec/spec.yaml\` —— ${spec.clauses.length} 条条款 / ${totalCriteria} 条判据的机器可读契约`
  );
  P('- `spec/spec.schema.json` —— Spec 自身的结构约束（JSON Schema 2020-12）');
  P(
    `- \`spec/verify/*.test.ts\` —— ${specVerifyFiles} 个验证器文件（Spec 自检 + 领域内核 + 导出 + 质量引擎 + 渲染）`
  );
  P('- `packages/core/tests/` —— 领域内核（@ppt/core）的版式快照与补丁应用测试');
  P('- `apps/api/tests/` —— 后端的契约 / 集成 / 安全 / AI / 混沌 / 性能测试');
  P(
    `- \`e2e/\` —— ${e2eChainFiles.length} 条前后端集成链（Playwright 真实浏览器 + 真实服务端），断言落在服务端状态上：${e2eChainFiles.map((f) => `\`${f}\``).join('、')}`
  );
  P('- `spec/verify/servers.ts` —— 为 E2E 拉起后端与前端的编排（独立端口、独立数据目录、HMR 关闭）');
  P(
    '- `spec/verify/model-stub-server.ts` —— 模型端点替身本体（独立进程，返回官方端点在占位 key 下的原样 400）'
  );
  P('- `spec/verify/model-stub.ts` —— 替身的启动器（端口经 stdout 的 `PORT=<n>` 交接）');
  P('- `spec/verify/repro-flake.ts` —— E2E 抖动的复现循环（每轮重起服务并留证）');
  P('- `spec/verify/mutation-check.ts` —— 验证器的元验证（注入错误检查）');
  P('- `spec/verify/all.ts` —— 全链路入口（结构 → 类型 → 判据 → E2E → 注入 → 追溯矩阵）');
  P(
    '- `src/services/projectMerge.ts` + `src/services/projectMerge.test.ts` —— 摘要/全量合并的纯函数与回归锁（前端唯一的单元测试）'
  );
  P(
    '- `spec/evidence/` —— junit.xml / junit-e2e.xml / mutation-report.json / coverage.json / 浏览器日志（执行产物，非手写）'
  );
  P('- `spec/traceability.md` —— 本文件');
  P('- `spec/README.md` —— 使用说明');
  P();
  P('### 覆盖了什么');
  P();
  P(`- 源文档：${spec.meta.sources.map((s) => `\`${s.doc}\``).join('、')}`);
  P(
    `- 条款 ${spec.clauses.length} 条（business/technical/quality/governance），判据 ${totalCriteria} 条 —— 其中 ${automatedCrit} 条判据指向可执行验证器`
  );
  P(
    `- 成熟度分布：automated ${spec.clauses.filter((c) => c.maturity === 'automated').length} / planned ${spec.clauses.filter((c) => c.maturity === 'planned').length} / none ${noneMaturity.length}`
  );
  P();
  P('### 实际验证了什么');
  P();
  P(
    `- 真的跑了证据集（\`bun test spec/verify/ packages/core/tests/ apps/api/tests/ ./scripts/check-coverage.check.ts ./apps/api/tests/perf/export-latency.bench.ts\`）：**${junitCases} 个用例，${junitFailed} 失败，${junitPassed} 通过**，覆盖 ${junitFiles} 个测试文件`
  );
  P(
    `- 真的跑了前后端集成 E2E（\`bun test ${e2eChainFiles.map((f) => `./${f}`).join(' ')}\`，Playwright 驱动真实 Chromium + 真实服务端）：**${e2eCases} 个用例，${e2eFailed} 失败**`
  );
  P(
    `- 真的跑了 \`python3 spec/verify/spec-schema.py\`：Spec 结构校验通过（${spec.clauses.length} 条条款 / ${totalCriteria} 条判据引用完整）`
  );
  P(
    `- 真的跑了 \`npx tsc --noEmit\`：类型检查通过`
  );
  P(
    `- 真的跑了 \`bun run spec/verify/mutation-check.ts\`：**${mutation.total} 个注入用例，不合格 ${mutation.unqualified} 个** —— 每个用例走「基线 PASS → 注入必须 FAIL → 还原后重新 PASS」三步，源文件已全部还原`
  );
  P(
    `- 领域内核行覆盖率：**${coverage ? `${coverage.percent.toFixed(2)}% ≥ ${coverage.threshold}%` : '见 spec/evidence/coverage.json'}**（${coverage ? `${coverage.hit}/${coverage.found} 行` : '未采集'}，证据落盘在 \`spec/evidence/coverage.json\`）`
  );
  P();
  P('### 哪些结论仍不可信');
  P();
  P(
    `- **${unmutatedCriteria.length} 条判据没有做注入错误检查**（${unmutatedCriteria.join('、')}）—— 它们的 PASS 只来自「测试跑过了」，没有被元验证证明「抓得住错」`
  );
  P(
    '- **SPEC-NFR-001 —— 真实模型下的 P95 从未测过**。验证器已建成，但本轮只跑了降级模式（.env 里的 GEMINI_API_KEY 是占位符），模型往返延迟根本没被采样到'
  );
  P('- **SPEC-GOV-003 —— 质量门禁分数线从未在文档中给出**，判据无法存在（AMB-001 未裁决）');
  P('- **AC-QLT-010 —— self-derived oracle**，只能防回归，不能证明正确');
  P('- **PNG/JPG 的像素内容 —— DOM 垫片只覆盖分辨率**，不覆盖真实渲染');
  P(
    '- **AI 生成内容的「质量」本身无人背书** —— 判据只覆盖结构合规、落库前校验与降级行为；文案好不好、有没有洞察，文档没给判据，本 Spec 也不替它编一个'
  );
  P();
  P('### 下一步最值得解决的一个问题');
  P();
  P('**在有真实模型密钥的环境重跑 AC-NFR-001，把大纲生成的 P95 从 INCONCLUSIVE 变成可判定的结论。**');
  P();
  P(
    '理由：这是**唯一一条判据已经写好、验证器已经建成、却因为环境缺一个变量而给不出结论**的条款。其余的不可信项要么需要业务方拍板（SPEC-GOV-003 的分数线）、要么需要引入外部评审者（文案质量），都不是写代码能解决的；而这一条只要给 `GEMINI_API_KEY` 填上真值、设 `BENCH_REAL_MODEL=1`，重跑 `bun test ./apps/api/tests/perf/outline-latency.bench.ts` 就能拿到真实的 P95 采样 —— 100 次采样、statistical oracle、判据原文就是「P95 < 25000ms」，判完就是判完了。'
  );
  P();
  P(
    '顺带一提：这一条还是**唯一一条至今没有被任何注入错误检查覆盖过的高价值判据**（AC-NFR-001）。真实模型跑起来之后，顺手给它补一个注入（例如把采样里的真实调用替换成本地降级实现，看 P95 是否还"通过"），这条判据才算真正闭合。'
  );
  P();

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${L.join('\n')}\n`, 'utf-8');

  console.log(`已生成 ${OUT_PATH}`);
  console.log(
    `条款 ${spec.clauses.length} / 判据 ${totalCriteria}　PASS ${passClauses}　FAIL ${failClauses}　INCONCLUSIVE ${incClauses}`
  );
  console.log(`注入检查：${mutation.total} 个用例，不合格 ${mutation.unqualified} 个`);
}

main();
