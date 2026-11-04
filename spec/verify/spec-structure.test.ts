/**
 * Spec 自身的结构校验
 * ---------------------------------------------------------------------------
 * 目的：让 spec/spec.yaml 的**引用完整性**可机器检查 —— 避免出现
 * 「条款指向一个不存在的 ID」「判据指向一个不存在的测试」这类
 * 让追溯矩阵失效的悬空引用。
 *
 * spec/spec.schema.json 的**结构**校验由 spec/verify/spec-schema.py 负责
 * （JSON Schema draft 2020-12，依赖已装好的 python3 jsonschema）。
 */

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const SPEC_PATH = resolve(ROOT, 'spec/spec.yaml');

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
  meta: { sources: Array<{ doc: string; role: string }> };
  clauses: Clause[];
  ambiguities: Array<{ id: string; clause_ref?: string; blocks: string[] }>;
  conflicts: Array<{ id: string; clause_a: string; clause_b: string }>;
  decisions: Array<{ id: string; applies_to: string[] }>;
  known_gaps: Array<{ clause: string; reason: string }>;
}

const spec = Bun.YAML.parse(readFileSync(SPEC_PATH, 'utf-8')) as Spec;
const clauseIds = new Set(spec.clauses.map((c) => c.id));

describe('Spec 文件可解析', () => {
  test('spec-yaml-parses', () => {
    expect(Array.isArray(spec.clauses)).toBe(true);
    expect(spec.clauses.length).toBeGreaterThan(0);
  });
});

describe('ID 唯一性', () => {
  test('clause-ids-are-unique', () => {
    const ids = spec.clauses.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('acceptance-ids-are-unique', () => {
    const ids = spec.clauses.flatMap((c) => c.acceptance.map((a) => a.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('ambiguity-conflict-decision-ids-are-unique', () => {
    const amb = spec.ambiguities.map((a) => a.id);
    const conf = spec.conflicts.map((c) => c.id);
    const dec = spec.decisions.map((d) => d.id);
    expect(new Set(amb).size).toBe(amb.length);
    expect(new Set(conf).size).toBe(conf.length);
    expect(new Set(dec).size).toBe(dec.length);
  });
});

describe('引用完整性 —— 不允许悬空引用', () => {
  test('clause-cross-references-resolve', () => {
    const dangling: string[] = [];
    for (const c of spec.clauses) {
      if (c.derived_from && !clauseIds.has(c.derived_from)) {
        dangling.push(`${c.id}.derived_from → ${c.derived_from}`);
      }
      if (c.conflict && !spec.conflicts.some((x) => x.id === c.conflict)) {
        dangling.push(`${c.id}.conflict → ${c.conflict}`);
      }
    }
    for (const a of spec.ambiguities) {
      if (a.clause_ref && !clauseIds.has(a.clause_ref)) {
        dangling.push(`${a.id}.clause_ref → ${a.clause_ref}`);
      }
      for (const b of a.blocks) {
        if (!clauseIds.has(b)) dangling.push(`${a.id}.blocks → ${b}`);
      }
    }
    for (const c of spec.conflicts) {
      if (!clauseIds.has(c.clause_a)) dangling.push(`${c.id}.clause_a → ${c.clause_a}`);
      if (!clauseIds.has(c.clause_b)) dangling.push(`${c.id}.clause_b → ${c.clause_b}`);
    }
    for (const d of spec.decisions) {
      for (const t of d.applies_to) {
        if (!clauseIds.has(t)) dangling.push(`${d.id}.applies_to → ${t}`);
      }
    }
    for (const g of spec.known_gaps) {
      if (!clauseIds.has(g.clause)) dangling.push(`known_gaps → ${g.clause}`);
    }
    expect(dangling).toEqual([]);
  });
});

describe('每条条款都有可追溯的出处', () => {
  test('every-clause-has-source-doc-that-exists', () => {
    const missing: string[] = [];
    for (const c of spec.clauses) {
      if (!c.source?.doc || !c.source?.section || !c.source?.quote) {
        missing.push(`${c.id} 缺少 source 字段`);
        continue;
      }
      if (!existsSync(resolve(ROOT, c.source.doc))) {
        missing.push(`${c.id}.source.doc 不存在 → ${c.source.doc}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test('meta-sources-exist', () => {
    const missing = spec.meta.sources
      .filter((s) => !existsSync(resolve(ROOT, s.doc)))
      .map((s) => s.doc);
    expect(missing).toEqual([]);
  });
});

describe('验收判据与验证器一一对应', () => {
  test('automated-criteria-point-at-existing-test-files', () => {
    const missing: string[] = [];
    for (const c of spec.clauses) {
      for (const a of c.acceptance) {
        if (a.maturity !== 'automated') continue;
        const file = a.verification.target.split('::')[0]!;
        if (!existsSync(resolve(ROOT, file))) {
          missing.push(`${a.id} → 验证文件不存在 ${file}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test('every-verification-target-is-located-in-its-file', () => {
    const missing: string[] = [];
    for (const c of spec.clauses) {
      for (const a of c.acceptance) {
        // planned 判据指向的是**尚未建成**的验证器，不做存在性要求
        if (a.maturity !== 'automated') continue;
        const [file, caseName] = a.verification.target.split('::');
        if (!caseName) {
          missing.push(`${a.id} 的 target 缺少用例名 → ${a.verification.target}`);
          continue;
        }
        if (!existsSync(resolve(ROOT, file!))) {
          missing.push(`${a.id} → 验证文件不存在 ${file}`);
          continue;
        }
        const src = readFileSync(resolve(ROOT, file!), 'utf-8');
        if (!src.includes(`'${caseName}'`) && !src.includes(`"${caseName}"`)) {
          missing.push(`${a.id} → ${file} 中找不到用例 ${caseName}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test('planned-criteria-name-a-future-verifier', () => {
    // planned 判据必须写清楚「将来由哪个文件验」，且不得声称已可执行
    const bad: string[] = [];
    for (const c of spec.clauses) {
      for (const a of c.acceptance) {
        if (a.maturity !== 'none') continue;
        if (!a.verification.target.trim()) bad.push(`${a.id} 没有写 verification.target`);
        if (!a.verification.command.trim()) bad.push(`${a.id} 没有写 verification.command`);
      }
    }
    expect(bad).toEqual([]);
  });

  test('acceptance-command-matches-the-target-file', () => {
    const mismatches: string[] = [];
    for (const c of spec.clauses) {
      for (const a of c.acceptance) {
        const file = a.verification.target.split('::')[0]!;
        if (!a.verification.command.includes(file)) {
          mismatches.push(`${a.id} → command 未指向 ${file}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  test('commands-pointing-at-non-test-files-use-the-path-form', () => {
    // `bun test <path>` 有两种语义：
    //   · <path> 以 ./. 开头 → 按**路径**处理，一定跑到那个文件
    //   · <path> 不带前缀   → 按**过滤器**处理，只匹配 Bun 默认测试规则
    //                          （.test. / _test. / .spec. / _spec.）命中的文件
    // 于是 `bun test e2e/workbench.e2e.ts` 这种写法**一个用例都跑不到**，
    // 只会打印一句 "filters did not match any test files" 然后以退出码 1 结束。
    // 基准文件（*.bench.ts）与门禁文件（*.check.ts）都踩这个坑。
    //
    // 判据：命令里点名的文件若**不**匹配 Bun 的默认测试规则，
    //       命令就必须用 `./` 路径形式。
    const notATestFile = (file: string): boolean =>
      !/\.(test|spec)\.[cm]?[jt]sx?$/.test(file) && !/(_test|_spec)\./.test(file);

    const bad: string[] = [];
    for (const c of spec.clauses) {
      for (const a of c.acceptance) {
        const cmd = a.verification.command;
        for (const file of a.verification.target.split('::')) {
          if (!file || !existsSync(resolve(ROOT, file))) continue;
          if (!notATestFile(file)) continue;
          if (!cmd.includes(`./${file}`)) {
            bad.push(
              `${a.id} → ${file} 不是 Bun 默认测试规则命中的文件，命令必须写成 \`bun test ./${file}\`（当前：${cmd}）`
            );
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('Oracle 分级约束', () => {
  test('high-risk-active-clauses-have-a-non-self-derived-oracle', () => {
    const offenders: string[] = [];
    for (const c of spec.clauses) {
      if (c.status !== 'active' || c.risk !== 'high') continue;
      const ok = c.acceptance.some((a) => a.oracle.tier !== 'self-derived');
      if (!ok) offenders.push(`${c.id} 的所有判据都是 self-derived`);
    }
    expect(offenders).toEqual([]);
  });

  test('every-acceptance-declares-an-oracle-tier', () => {
    const tiers = new Set([
      'authoritative',
      'expert',
      'formal',
      'statistical',
      'human',
      'self-derived',
    ]);
    const bad: string[] = [];
    for (const c of spec.clauses) {
      for (const a of c.acceptance) {
        if (!tiers.has(a.oracle.tier)) bad.push(`${a.id} → ${a.oracle.tier}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('成熟度与判据的一致性', () => {
  test('automated-clauses-have-automated-criteria', () => {
    const bad: string[] = [];
    for (const c of spec.clauses) {
      if (c.maturity !== 'automated') continue;
      if (!c.acceptance.some((a) => a.maturity === 'automated')) {
        bad.push(`${c.id} 标为 automated 但没有 automated 判据`);
      }
    }
    expect(bad).toEqual([]);
  });

  test('planned-clauses-have-no-automated-criteria', () => {
    const bad: string[] = [];
    for (const c of spec.clauses) {
      if (c.maturity !== 'planned') continue;
      if (c.acceptance.some((a) => a.maturity === 'automated')) {
        bad.push(`${c.id} 标为 planned 却带 automated 判据`);
      }
    }
    expect(bad).toEqual([]);
  });

  test('every-automation-maturity-clause-is-covered-by-known-gaps-or-verified', () => {
    // 已知限制必须登记：凡是判据尚未建成的，都要在 known_gaps 里说明原因
    const gapClauses = new Set(spec.known_gaps.map((g) => g.clause));
    const bad: string[] = [];
    for (const c of spec.clauses) {
      if (c.maturity !== 'planned') continue;
      if (!gapClauses.has(c.id)) bad.push(`${c.id} 未登记 known_gaps`);
    }
    expect(bad).toEqual([]);
  });
});
