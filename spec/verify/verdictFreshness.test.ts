/**
 * 主证据新鲜度的**缺陷回放**
 * ---------------------------------------------------------------------------
 * 这不是「测一个工具好不好用」，而是**钉住一个已经发生的失败模式**：
 *
 *   2026-11-05 实测：`spec/evidence/junit.xml` 生成于 02:00，
 *   之后 `qualityEngine.ts` / `layoutEngine.ts` / `textMetrics.ts` 等
 *   **六个源文件**被改过 —— 而追溯矩阵照旧写着「PASS 65 / FAIL 0」。
 *
 *   读者没有任何办法知道：那 65 条 PASS 里有几条，
 *   说的是**改之前**的那一版代码。
 *
 * 所以这里断言的是**判定语义**：
 *   · 依赖的文件在证据之后被动过 → stale；
 *   · 依赖扫不干净（本地 import 解析不了）→ unknown，**不能**是 fresh；
 *   · 依赖的文件不在树里了 → file-missing；
 *   · 一条都没动 → fresh。
 *
 * 关键的一条：**unknown ≠ fresh** —— 说不清依赖，就不能说结论还成立。
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  assessVerdict,
  dependencyClosure,
  expandDataDeps,
  groupStale,
  importSpecifiers,
  looksLocal,
  parseDataDeps,
  renderVerdictFreshnessSection,
  resolveLocalPath,
  summarizeVerdicts,
  verdictFreshnessQualifier,
  type MtimeOf,
  type ReadFile,
} from './verdictFreshness';

/** 一个内存里的「文件系统」：路径 → 内容 */
const FILES: Record<string, string> = {
  'spec/verify/demo.test.ts': "import { engine } from '../../packages/core/src/engine/qualityEngine';\nimport { helper } from './helpers';\n",
  'spec/verify/helpers.ts': 'export const helper = 1;\n',
  'packages/core/src/engine/qualityEngine.ts': "import { rules } from './qualityRules';\nexport const engine = rules;\n",
  'packages/core/src/engine/qualityRules.ts': 'export const rules = [];\n',
  'packages/core/src/index.ts': "export { engine } from './engine/qualityEngine';\n",
};

function reader(files: Record<string, string> = FILES): ReadFile {
  return (rel: string) => files[rel] ?? null;
}

function existsIn(files: Record<string, string> = FILES) {
  return (rel: string) => Object.prototype.hasOwnProperty.call(files, rel);
}

/** 修改时间表：不在表里的文件一律视为「很久以前」 */
function mtimeIn(table: Record<string, number>): MtimeOf {
  return (rel: string) => table[rel] ?? 1000;
}

const EVIDENCE_AT = 2000;

describe('import 说明符', () => {
  test('四种写法都要抓到', () => {
    const src = [
      "import a from './a';",
      "export { b } from './b';",
      "import './side-effect';",
      "const c = await import('./dynamic');",
      "const d = require('./required');",
    ].join('\n');
    const specs = importSpecifiers(src);
    for (const s of ['./a', './b', './side-effect', './dynamic', './required']) {
      expect(specs).toContain(s);
    }
  });

  test('import.meta 不该被当成模块说明符', () => {
    expect(importSpecifiers('if (import.meta.main) { main(); }')).not.toContain('import.meta.main');
  });

  test('外部包不算本地依赖', () => {
    expect(looksLocal('bun:test')).toBe(false);
    expect(looksLocal('node:fs')).toBe(false);
    expect(looksLocal('hono')).toBe(false);
    expect(looksLocal('./x')).toBe(true);
    expect(looksLocal('../x')).toBe(true);
    expect(looksLocal('@/x')).toBe(true);
    expect(looksLocal('@ppt/core')).toBe(true);
  });
});

describe('本地路径解析', () => {
  test('相对路径按被导入文件所在目录解析', () => {
    expect(resolveLocalPath('./helpers', 'spec/verify/demo.test.ts', existsIn())).toBe(
      'spec/verify/helpers.ts'
    );
  });

  test('上跳目录要能归一化', () => {
    expect(
      resolveLocalPath(
        '../../packages/core/src/engine/qualityEngine',
        'spec/verify/demo.test.ts',
        existsIn()
      )
    ).toBe('packages/core/src/engine/qualityEngine.ts');
  });

  test('@ppt/core 指向内核入口', () => {
    expect(resolveLocalPath('@ppt/core', 'packages/core/tests/x.test.ts', existsIn())).toBe(
      'packages/core/src/index.ts'
    );
  });

  test('解析不出来就返回 null（不猜）', () => {
    expect(resolveLocalPath('./根本没有这个文件', 'spec/verify/demo.test.ts', existsIn())).toBeNull();
  });
});

describe('依赖闭包', () => {
  test('传递闭包要带上间接依赖', () => {
    const c = dependencyClosure(['spec/verify/demo.test.ts'], reader(), existsIn());
    expect(c.files).toContain('spec/verify/demo.test.ts');
    expect(c.files).toContain('packages/core/src/engine/qualityEngine.ts');
    expect(c.files).toContain('packages/core/src/engine/qualityRules.ts');
    expect(c.unresolved).toHaveLength(0);
  });

  test('本地 import 解析不了 → 记进 unresolved，不能装作依赖已扫干净', () => {
    const files = { 'a.test.ts': "import { x } from './不存在';\n" };
    const c = dependencyClosure(['a.test.ts'], reader(files), existsIn(files));
    expect(c.unresolved).toHaveLength(1);
    expect(c.unresolved[0]).toContain('./不存在');
  });
});

describe('一条结论的新鲜度', () => {
  test('依赖都没动 → fresh', () => {
    const a = assessVerdict(
      'spec/verify/demo.test.ts',
      EVIDENCE_AT,
      reader(),
      mtimeIn({}),
      existsIn()
    );
    expect(a.status).toBe('fresh');
  });

  test('依赖在证据之后被改过 → stale，并点名是哪个文件', () => {
    const a = assessVerdict(
      'spec/verify/demo.test.ts',
      EVIDENCE_AT,
      reader(),
      mtimeIn({ 'packages/core/src/engine/qualityEngine.ts': 3000 }),
      existsIn()
    );
    expect(a.status).toBe('stale');
    expect(a.changed).toContain('packages/core/src/engine/qualityEngine.ts');
    expect(a.reason).toContain('证据生成之后被改过');
  });

  test('验证器自己被改过 → stale', () => {
    const a = assessVerdict(
      'spec/verify/demo.test.ts',
      EVIDENCE_AT,
      reader(),
      mtimeIn({ 'spec/verify/demo.test.ts': 5000 }),
      existsIn()
    );
    expect(a.status).toBe('stale');
    expect(a.changed).toContain('spec/verify/demo.test.ts');
  });

  test('验证器文件不在树里了 → file-missing', () => {
    const a = assessVerdict(
      'spec/verify/demo.test.ts',
      EVIDENCE_AT,
      reader({}),
      mtimeIn({}),
      existsIn({})
    );
    expect(a.status).toBe('file-missing');
    expect(a.reason).toContain('验证器文件不在树里了');
  });

  test('依赖的文件不在树里了 → unknown（说清不了），**不能**是 fresh', () => {
    const files = { 'spec/verify/demo.test.ts': "import { x } from './gone';\n" };
    const a = assessVerdict(
      'spec/verify/demo.test.ts',
      EVIDENCE_AT,
      reader(files),
      mtimeIn({}),
      existsIn(files)
    );
    expect(a.status).toBe('unknown');
    expect(a.status).not.toBe('fresh');
    expect(a.unresolved[0]).toContain('./gone');
    expect(a.reason).toContain('说清不了');
  });

  test('动态 import 的路径不是字面量 → unknown（依赖扫不干净）', () => {
    const files = { 'a.test.ts': 'const m = await import(`./${name}.ts`);\n' };
    const a = assessVerdict('a.test.ts', EVIDENCE_AT, reader(files), mtimeIn({}), existsIn(files));
    expect(a.status).toBe('unknown');
    expect(a.computed).toBe(1);
    expect(a.reason).toContain('动态 import');
  });

  test('既扫不干净、又确实有依赖被改过 → stale（确定的事实优先）', () => {
    const files = { 'a.test.ts': "import { x } from './不存在';\n" };
    const a = assessVerdict(
      'a.test.ts',
      EVIDENCE_AT,
      reader(files),
      mtimeIn({ 'a.test.ts': 9000 }),
      existsIn(files)
    );
    expect(a.status).toBe('stale');
  });

  test('闭包之外、但确实依赖的文件被动过 → stale', () => {
    // E2E 的情形：规格文件不 import 前端代码，前端却实实在在被改了
    const files = {
      'e2e/a.spec.ts': 'export const x = 1;\n',
      'src/App.tsx': 'export const App = 1;\n',
    };
    const a = assessVerdict(
      'e2e/a.spec.ts',
      EVIDENCE_AT,
      reader(files),
      mtimeIn({ 'src/App.tsx': 3000 }),
      existsIn(files),
      { deps: ['src/App.tsx'], basis: 'E2E 走真实浏览器 + 服务端整条链' }
    );
    expect(a.status).toBe('stale');
    expect(a.changed).toContain('src/App.tsx');
    expect(a.reason).toContain('E2E 走真实浏览器 + 服务端整条链');
  });

  test('额外依赖里有一个文件不在树里了 → unknown（说清不了）', () => {
    const files = { 'e2e/a.spec.ts': 'export const x = 1;\n' };
    const a = assessVerdict(
      'e2e/a.spec.ts',
      EVIDENCE_AT,
      reader(files),
      mtimeIn({}),
      existsIn(files),
      { deps: ['src/没了.ts'] }
    );
    expect(a.status).toBe('unknown');
    expect(a.status).not.toBe('fresh');
    expect(a.missing).toContain('src/没了.ts');
  });
});

// ---------------------------------------------------------------------------
// 数据依赖 —— 闭包扫得到代码，扫不到数据
// ---------------------------------------------------------------------------
//
// **缺陷回放**（2026-11-05 实测）：
//   跑批 → 证据落地 → `gen-layout-snapshots.ts --force` 刷新了 64 个基线 JSON
//     ↓
//   那 64 个 JSON 是测试运行时 `readFile` 进来的，**不是 import 进来的**
//   → 按 import 扫的依赖闭包扫不到它们
//     ↓
//   矩阵照旧写「98 条结论全部仍然成立」
//
// 这是**漏报**：一条过期的 PASS 被当成当前代码的证明 ——
// 比多报危险得多（多报只是保守，漏报是撒谎）。
//
// 修法：验证器用 `// @verdict-deps:` 显式声明自己还依赖哪些数据文件，
// 声明写在**读它的那份代码旁边**，不写在别处，就不会忘记更新。

describe('数据依赖的声明与展开', () => {
  test('声明写在验证器旁边，要能抽出来', () => {
    const src = [
      '/**',
      ' * @verdict-deps: packages/core/tests/__snapshots__',
      ' */',
      "import { x } from './helpers';",
    ].join('\n');
    expect(parseDataDeps(src)).toEqual(['packages/core/tests/__snapshots__']);
  });

  test('一行可以声明多个（逗号分隔）', () => {
    expect(parseDataDeps('// @verdict-deps: a/b.json, c/d.json\n')).toEqual([
      'a/b.json',
      'c/d.json',
    ]);
  });

  test('没写声明的文件 → 没有数据依赖', () => {
    expect(parseDataDeps("import { x } from './helpers';\n")).toEqual([]);
  });

  test('字符串字面量里的声明不算数（免得凭空多出一堆依赖）', () => {
    // 文档和测试里经常出现这个字符串本身 ——
    // 宽松匹配会把它们当成声明，于是「假过期」又回来了。
    const src = [
      "const example = '// @verdict-deps: packages/core/tests/__snapshots__';",
      ' * 说明文字里提到 @verdict-deps: 这个词，但不是声明',
    ].join('\n');
    expect(parseDataDeps(src)).toEqual([]);
  });

  test('目录 → 其下所有文件；文件 → 它自己', () => {
    const tree: Record<string, string[]> = {
      'packages/core/tests/__snapshots__': [
        'packages/core/tests/__snapshots__/a.json',
        'packages/core/tests/__snapshots__/b.json',
      ],
    };
    const out = expandDataDeps(
      ['packages/core/tests/__snapshots__', 'fixtures/theme.json'],
      (rel) => rel === 'packages/core/tests/__snapshots__' || rel === 'fixtures/theme.json',
      (rel) => tree[rel] ?? []
    );
    expect(out).toEqual([
      'fixtures/theme.json',
      'packages/core/tests/__snapshots__/a.json',
      'packages/core/tests/__snapshots__/b.json',
    ]);
  });

  test('声明的路径在树里不存在 → 原样带出去（让调用方说清「声明了、找不到」）', () => {
    const out = expandDataDeps(['packages/core/tests/__snapshots__'], () => false, () => []);
    expect(out).toEqual(['packages/core/tests/__snapshots__']);
  });
});

describe('数据依赖进新鲜度判定', () => {
  const VERIFIER = 'packages/core/tests/layoutEngine.snapshot.test.ts';
  const SNAP_DIR = 'packages/core/tests/__snapshots__';
  const BASELINE = `${SNAP_DIR}/cards_grid__tpl_slate_dark.json`;

  /** 快照测试：基线是运行时 readFile 进来的，源码里只有一行 import */
  const SRC = [
    "import { makeSnapshot } from './fixtures';",
    '// @verdict-deps: packages/core/tests/__snapshots__',
    '',
  ].join('\n');

  function files(extra: Record<string, string> = {}) {
    return {
      [VERIFIER]: SRC,
      'packages/core/tests/fixtures.ts': 'export const makeSnapshot = 1;\n',
      [BASELINE]: '{"v":1}\n',
      ...extra,
    };
  }

  /** 这个假文件系统认得目录：目录本身不在表里，但它下面有文件 */
  function existsInTree(tree: Record<string, string>): (rel: string) => boolean {
    return (rel: string) =>
      rel in tree || Object.keys(tree).some((f) => f.startsWith(`${rel}/`));
  }

  /** 把声明展开成文件清单（目录 → 其下所有文件） */
  function declaredDeps(tree: Record<string, string>): string[] {
    const declared = parseDataDeps(tree[VERIFIER] ?? '');
    return expandDataDeps(
      declared,
      existsInTree(tree),
      (rel) => Object.keys(tree).filter((f) => f.startsWith(`${rel}/`))
    );
  }

  test('**缺陷回放**：基线在跑批之后被刷新 → 那条结论必须变成 stale', () => {
    const tree = files();
    const a = assessVerdict(
      VERIFIER,
      EVIDENCE_AT,
      reader(tree),
      mtimeIn({ [BASELINE]: 3000 }),
      existsInTree(tree),
      { deps: declaredDeps(tree), basis: '这条结论还依赖验证器声明的数据文件' }
    );
    expect(a.status).toBe('stale');
    expect(a.changed).toContain(BASELINE);
    expect(a.reason).toContain(BASELINE);
  });

  test('**对照**：基线没被动过 → 那条结论仍然成立', () => {
    const tree = files();
    const a = assessVerdict(
      VERIFIER,
      EVIDENCE_AT,
      reader(tree),
      mtimeIn({}),
      existsInTree(tree),
      { deps: declaredDeps(tree) }
    );
    expect(a.status).toBe('fresh');
  });

  test('**为什么必须声明**：没声明的话，闭包确实扫不到那个基线', () => {
    // 这一条钉住的是「漏报是怎么发生的」——
    // 基线被改过，但因为没声明，判定看不见它。
    const tree = files({ [VERIFIER]: "import { makeSnapshot } from './fixtures';\n" });
    const a = assessVerdict(
      VERIFIER,
      EVIDENCE_AT,
      reader(tree),
      mtimeIn({ [BASELINE]: 3000 }),
      existsInTree(tree)
    );
    expect(a.status).toBe('fresh'); // 盲区就在这里 —— 所以才要用声明把它堵上
    expect(declaredDeps(tree)).toEqual([]); // 没声明 → 没有数据依赖
  });

  test('声明的路径不在树里了 → 说清不了（不能是 fresh）', () => {
    // 整个快照目录连同基线都没了 —— 声明还在，但它指向的东西没了。
    const tree: Record<string, string> = {
      [VERIFIER]: SRC,
      'packages/core/tests/fixtures.ts': 'export const makeSnapshot = 1;\n',
    };
    const a = assessVerdict(
      VERIFIER,
      EVIDENCE_AT,
      reader(tree),
      mtimeIn({}),
      existsInTree(tree),
      { deps: declaredDeps(tree) }
    );
    expect(a.status).toBe('unknown');
    expect(a.status).not.toBe('fresh');
  });
});

describe('仓库里的声明（锚点）', () => {
  const REPO_ROOT = join(import.meta.dir, '..', '..');
  const VERIFIER = 'packages/core/tests/layoutEngine.snapshot.test.ts';
  const SNAP_DIR = join(REPO_ROOT, 'packages/core/tests/__snapshots__');

  test('快照测试必须声明它依赖那 64 个基线', () => {
    const src = readFileSync(join(REPO_ROOT, VERIFIER), 'utf-8');
    expect(parseDataDeps(src)).toContain('packages/core/tests/__snapshots__');
  });

  test('声明的那个目录里确实有基线（别声明了个空目录）', () => {
    const files = readdirSync(SNAP_DIR).filter((f) => f.endsWith('.json'));
    expect(files.length).toBe(64);
  });
});

describe('汇总与措辞', () => {
  const one = (criterion: string, status: 'fresh' | 'stale' | 'unknown') => ({
    criterion,
    assessment: {
      verifierFile: 'spec/verify/demo.test.ts',
      status,
      changed: status === 'stale' ? ['packages/core/src/engine/qualityEngine.ts'] : [],
      missing: [],
      unresolved: [],
      computed: 0,
      reason: '',
    },
  });

  test('过期与说清不了的判据要能被点名', () => {
    const s = summarizeVerdicts([one('AC-A', 'fresh'), one('AC-B', 'stale'), one('AC-C', 'unknown')]);
    expect(s.fresh).toBe(1);
    expect(s.stale).toBe(1);
    expect(s.unknown).toBe(1);
    expect(s.staleCriteria).toEqual(['AC-B']);
    expect(s.unknownCriteria).toEqual(['AC-C']);
  });

  test('矩阵那一节要说清「已过期不能当成对当前代码的证明」', () => {
    const s = summarizeVerdicts([one('AC-B', 'stale')]);
    const text = renderVerdictFreshnessSection(s, [{ label: '单元/集成证据', at: '2026-11-05 02:00' }]).join('\n');
    expect(text).toContain('AC-B');
    expect(text).toContain('已过期');
    expect(text).toContain('不能当成对当前代码的证明');
  });

  test('全部新鲜时说得干脆', () => {
    const s = summarizeVerdicts([one('AC-A', 'fresh')]);
    const text = renderVerdictFreshnessSection(s, [{ label: '单元/集成证据', at: '2026-11-05 02:00' }]).join('\n');
    expect(text).toContain('全部仍然成立');
    expect(verdictFreshnessQualifier(s)).toBe('');
  });

  test('限定语要带上「仍然成立 N 条 / 已过期 M 条」', () => {
    const s = summarizeVerdicts([one('AC-A', 'fresh'), one('AC-B', 'stale')]);
    const q = verdictFreshnessQualifier(s);
    expect(q).toContain('仍然成立 **1** 条');
    expect(q).toContain('已过期 **1** 条');
  });

  test('兜底清单要被说出来（运行时才读到的文件不在闭包里）', () => {
    const s = summarizeVerdicts([one('AC-A', 'fresh')]);
    const text = renderVerdictFreshnessSection(
      s,
      [{ label: '单元/集成证据', at: '2026-11-05 02:00' }],
      ['spec/verify/fixtures/slide.json']
    ).join('\n');
    expect(text).toContain('兜底');
    expect(text).toContain('spec/verify/fixtures/slide.json');
  });

  test('同一个验证器管着多条判据 → 归并成一行，判据写明 ×N', () => {
    const s = summarizeVerdicts([one('AC-A', 'stale'), one('AC-A', 'stale'), one('AC-B', 'stale')]);
    const groups = groupStale(s.staleDetails);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.criteria).toEqual([
      { criterion: 'AC-A', count: 2 },
      { criterion: 'AC-B', count: 1 },
    ]);
    const text = renderVerdictFreshnessSection(s, [
      { label: '单元/集成证据', at: '2026-11-05 02:00' },
    ]).join('\n');
    expect(text).toContain('AC-A ×2、AC-B');
  });
});
