/**
 * 主证据（junit）的新鲜度 —— 这批 PASS/FAIL 结论还对当前代码成立吗？
 * ---------------------------------------------------------------------------
 * 追溯矩阵的每一个 PASS/FAIL，都来自 `spec/evidence/junit*.xml` ——
 * 一份**静态文件**。它记录的是**跑批那一刻**的结论。
 *
 * 实测（2026-11-05）：`junit.xml` 生成于 02:00，之后
 * `qualityEngine.ts` / `layoutEngine.ts` / `textMetrics.ts` /
 * `contentBinding.ts` / `layoutIntents.ts` / `packages/core/src/index.ts`
 * 六个源文件被改过 —— 而矩阵照旧写着「PASS 65 / FAIL 0」。
 *
 * 读者没有任何办法知道：那 65 条 PASS 里有几条，
 * 说的是**改之前**的那一版代码。
 *
 * 这跟本项目一直在治的病是同一个：
 *   · 「没跑过的验证不是通过」
 *   · 「跑过但已经不是当前代码的验证，也不能当成当前的结论」
 *   · 「报过但现在跑不起来的验证，连报都没报过」
 *
 * 注入报告那边已经用**文件指纹**治过一次（`evidenceFreshness.ts`）。
 * 主证据这边不能直接照抄 —— junit 是 Bun 的 reporter 生成的，
 * 我们控制不了它的格式，**没有指纹可读**。
 *
 * 所以这里用两个能拿到的东西：
 *
 *   ① **修改时间** —— 证据文件自己的 mtime 就是「跑批那一刻」。
 *      某个依赖文件的 mtime 比它新，就说明那个文件在跑批之后被动过。
 *      mtime 的方向是**保守**的：它会把「碰过但内容没变」也算成变了，
 *      于是宁可多报过期，不漏报。**漏报才是危险的** ——
 *      一条过期的 PASS 被当成当前代码的证明，比多报一条要坏得多。
 *
 *   ② **import 闭包** —— 「这条用例依赖哪些本地文件」不能靠猜。
 *      静态扫出每个验证器文件的本地 import，做传递闭包，
 *      才知道哪些源文件的改动会波及这条结论。
 *
 * 闭包扫不干净的时候（本地 import 解析不到对应文件），
 * 判 **unknown** 而不是 fresh —— **说不清依赖，就不能说结论还成立**。
 *
 * 闭包还有一个盲区：**它只扫得到代码，看不到数据**（见下面「数据依赖」）。
 *
 * 纯逻辑与文件读写分开：判定只吃「读文件」与「取修改时间」两个函数，
 * 于是整套语义可以在内存里被完整测一遍。
 */

/** 读一个仓库相对路径的文件 —— 读不到返回 null */
export type ReadFile = (relPath: string) => string | null;

/** 取一个仓库相对路径的文件的修改时间（毫秒）—— 不在树里返回 null */
export type MtimeOf = (relPath: string) => number | null;

/** 判断一个路径在不在树里 */
export type Exists = (relPath: string) => boolean;

// ---------------------------------------------------------------------------
// 一、抽出 import 说明符
// ---------------------------------------------------------------------------

/**
 * 抽出源码里全部的模块说明符。
 *
 * 覆盖四种写法：
 *   import x from 'a'   export x from 'a'   import 'a'   import('a')   require('a')
 *
 * `import.meta` 不会误命中 —— 它的后面不是引号。
 */
export function importSpecifiers(source: string): string[] {
  const out: string[] = [];
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g, // import x from 'a' / export x from 'a'
    /\bimport\s*['"]([^'"]+)['"]/g, // import 'a'（副作用导入）
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // import('a')（动态）
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // require('a')
  ];
  for (const re of patterns) {
    for (const m of source.matchAll(re)) {
      const spec = m[1];
      if (spec) out.push(spec);
    }
  }
  return out;
}

/**
 * 这个说明符是不是指向**本仓库里的文件**。
 *
 * 外部包（`bun:test`、`node:fs`、`hono`…）不归我们管 ——
 * 它们的版本由 package.json / lockfile 管，不在「代码被改过」的范围内。
 */
export function looksLocal(spec: string): boolean {
  return (
    spec.startsWith('./') ||
    spec.startsWith('../') ||
    spec === '.' ||
    spec === '..' ||
    spec.startsWith('@/') ||
    spec === '@ppt/core' ||
    spec.startsWith('@ppt/core/')
  );
}

/**
 * 动态 import 的说明符**不是字面量**的次数 —— `import(\`./${x}.ts\`)`。
 *
 * 这种依赖扫不出来：扫不出来就不能说「依赖的文件都没被改过」。
 * 所以它把结论从 fresh 降级成 unknown。
 *
 * 实测本仓库当前为 0 处 —— 但机制留着：哪天有人写了动态 import，
 * 相关的结论会自动变成「说清不了」，而不是被误判成「仍然成立」。
 */
export function computedImportCount(source: string): number {
  let n = 0;
  for (const re of [/\bimport\s*\(\s*[^'")]/g, /\brequire\s*\(\s*[^'")]/g]) {
    n += [...source.matchAll(re)].length;
  }
  return n;
}

// ---------------------------------------------------------------------------
// 二、解析成本地路径
// ---------------------------------------------------------------------------

/** 仓库相对路径的归一化（去掉 ./ 与 ../） */
function normalizeRepoPath(p: string): string {
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join('/');
}

/**
 * 把一个本地说明符解析成仓库相对路径；解析不出来返回 null。
 *
 * 支持的写法：
 *   ./x  ../x         —— 相对被导入的文件
 *   @/x                —— 仓库根（tsconfig paths）
 *   @ppt/core          —— packages/core/src/index.ts
 *   @ppt/core/x        —— packages/core/src/x
 *
 * 扩展名按「原样 → .ts → .tsx → /index.ts → /index.tsx」依次试。
 */
export function resolveLocalPath(
  spec: string,
  fromFile: string,
  exists: Exists
): string | null {
  const dir = fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/')) : '';

  let base: string | null = null;
  if (spec.startsWith('./') || spec.startsWith('../')) {
    base = `${dir}/${spec}`;
  } else if (spec.startsWith('@/')) {
    base = spec.slice(2);
  } else if (spec === '@ppt/core') {
    base = 'packages/core/src/index.ts';
  } else if (spec.startsWith('@ppt/core/')) {
    base = `packages/core/src/${spec.slice('@ppt/core/'.length)}`;
  }
  if (base === null) return null;

  const norm = normalizeRepoPath(base);
  const candidates = [
    norm,
    `${norm}.ts`,
    `${norm}.tsx`,
    `${norm}/index.ts`,
    `${norm}/index.tsx`,
  ];
  // TS 的 ESM 写法常写 `./foo.js` 指向 `./foo.ts` —— 顺手试一下，
  // 免得把「写法不同」误判成「文件没了」。
  const jsLike = /\.(js|jsx|mjs)$/.exec(norm);
  if (jsLike) {
    const stem = norm.slice(0, -jsLike[0].length);
    candidates.push(`${stem}.ts`, `${stem}.tsx`);
  }
  for (const c of candidates) {
    if (exists(c)) return c;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 三、依赖闭包
// ---------------------------------------------------------------------------

export interface Closure {
  /** 闭包里的文件（都读到了内容） */
  files: string[];
  /** 读不到的文件 */
  missing: string[];
  /** 解析不出对应文件的本地 import —— 形如 `a.ts → './b'` */
  unresolved: string[];
  /** 动态 import 的说明符不是字面量的次数 */
  computed: number;
}

/**
 * 一个验证器文件真正依赖哪些本地文件 —— 传递闭包。
 *
 * @param entries 起点（通常是验证器文件本身）
 * @param read    读文件
 * @param exists  判断路径在不在树里
 */
export function dependencyClosure(
  entries: string[],
  read: ReadFile,
  exists: Exists
): Closure {
  const files: string[] = [];
  const missing: string[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();
  const queue = [...entries];
  let computed = 0;

  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);

    const content = read(file);
    if (content === null) {
      missing.push(file);
      continue;
    }
    files.push(file);
    computed += computedImportCount(content);

    for (const spec of importSpecifiers(content)) {
      if (!looksLocal(spec)) continue; // 外部包，不归我们管
      const resolved = resolveLocalPath(spec, file, exists);
      if (resolved === null) unresolved.push(`${file} → ${spec}`);
      else queue.push(resolved);
    }
  }

  return { files, missing, unresolved, computed };
}

// ---------------------------------------------------------------------------
// 三又二分之一、数据依赖 —— 闭包扫得到代码，扫不到数据
// ---------------------------------------------------------------------------
//
// import 闭包有一个盲区：**它只看得到被 import 的东西**。
// 而有些结论依赖的是**运行时从磁盘读的数据文件** ——
// 最典型的是黄金快照基线（`packages/core/tests/__snapshots__/*.json`）：
// 那 64 个 JSON 是测试运行时读进来的，不是 import 进来的。
//
// 后果（实测 2026-11-05）：
//   跑批 → 证据落地 → 有人刷新了快照基线（`gen-layout-snapshots.ts --force`）
//     ↓
//   闭包里没有那些 JSON，判定看不见它们被动过
//     ↓
//   矩阵照旧写「98 条结论全部仍然成立」
//
// 这是**漏报**方向 —— 一条过期的 PASS 被当成当前代码的证明，
// 比多报一条坏得多（多报只是保守，漏报是撒谎）。
//
// 所以验证器文件可以**显式声明**自己还依赖哪些数据文件：
//
//     // @verdict-deps: packages/core/tests/__snapshots__
//
// 路径是**仓库相对路径**，可以是文件，也可以是目录（目录取其下所有文件）。
// 声明写在**读它的那份代码旁边** —— 不写在别处，就不会忘记更新。

/** 数据依赖的声明前缀 */
const DATA_DEP_DIRECTIVE = '@verdict-deps:';

/**
 * 声明行的形状 —— **必须是注释，而且注释在行首**。
 *
 * 为什么卡这么严：说明文档、测试用例里经常会出现 `@verdict-deps:` 这个**字符串**。
 * 宽松匹配会把那些字符串当成声明 —— 于是「这个验证器依赖 64 个基线」凭空冒出来，
 * 基线一被动过，那条结论就**假过期**。那是刚修掉的那个失败模式，换个方向又犯一遍。
 */
const DATA_DEP_LINE = new RegExp(`^\\s*(?:\\/\\/|\\*)\\s*${DATA_DEP_DIRECTIVE}\\s*(.*)$`);

/**
 * 抽出验证器文件里声明的数据依赖。
 *
 * 一行可以写多个（逗号分隔）；行尾可能还挂着块注释的收尾符号。
 */
export function parseDataDeps(content: string): string[] {
  const out: string[] = [];
  for (const line of content.split('\n')) {
    const m = DATA_DEP_LINE.exec(line);
    if (!m) continue;
    const rest = (m[1] ?? '').replace(/\*\/\s*$/, '');
    for (const part of rest.split(',')) {
      const p = part.trim();
      if (p) out.push(p);
    }
  }
  return out;
}

/**
 * 把声明的路径展开成**文件清单**。
 *
 * 目录 → 其下所有文件（递归）；文件 → 它自己；
 * 声明的路径在树里不存在 → 原样带出去 ——
 * 让调用方能说清「声明了、但找不到」，而不是悄悄少一个依赖。
 *
 * @param declared 声明的路径（仓库相对）
 * @param exists   判断路径在不在树里
 * @param listDir  列目录下的文件（仓库相对路径）；不是目录就返回空数组
 */
export function expandDataDeps(
  declared: readonly string[],
  exists: (rel: string) => boolean,
  listDir: (rel: string) => string[]
): string[] {
  const out = new Set<string>();
  for (const d of declared) {
    if (!exists(d)) {
      out.add(d);
      continue;
    }
    const files = listDir(d);
    if (files.length > 0) for (const f of files) out.add(f);
    else out.add(d);
  }
  return [...out].sort();
}

// ---------------------------------------------------------------------------
// 四、判定一条结论的新鲜度
// ---------------------------------------------------------------------------
export type VerdictStatus = 'fresh' | 'stale' | 'unknown' | 'file-missing';

export interface VerdictAssessment {
  /** 承载这条结论的验证器文件 */
  verifierFile: string;
  status: VerdictStatus;
  /** 在证据之后被改过的依赖文件 */
  changed: string[];
  /** 已经不在树里的文件 */
  missing: string[];
  /** 扫不出依赖的本地 import */
  unresolved: string[];
  /** 扫不出依赖的动态 import 次数 */
  computed: number;
  /** 说人话的理由 */
  reason: string;
}

/**
 * 闭包之外、但这条结论确实依赖的文件。
 *
 * 为什么需要它：E2E 的用例是 Playwright 规格 —— 它**不 import** 前端代码，
 * 而是通过浏览器操作页面、通过 HTTP 打到服务端。所以它的 import 闭包里
 * 只有 e2e/ 下的规格文件，前端与服务端源码**根本不在闭包里**。
 *
 * 只按闭包判，E2E 结论会在前端改过之后仍然被判成「fresh」——
 * 那是最危险的一种假绿：看上去有证据，实际上证据描述的是改之前那版页面。
 *
 * 所以 E2E 的依赖基础要**显式声明**：整条链（前端 + 服务端 + 领域内核）都是它的依赖，
 * 归因到文件级是做不到的 —— 这里只能说「这些文件被动过，所以 E2E 结论已过期」。
 */
export interface VerdictExtra {
  /** 额外的依赖文件（仓库相对路径） */
  deps?: string[];
  /** 依赖基础的说明，出现在理由里 */
  basis?: string;
}

/**
 * 判定一条结论的新鲜度。
 *
 * 判定顺序是**从确定到不确定**：
 *   · 依赖被改过   → stale    （确定过期）
 *   · 依赖扫不干净 → unknown  （说清不了，不能算成立）
 *   · 都没发生     → fresh
 *
 * @param verifierFile 验证器文件（仓库相对路径）
 * @param evidenceAtMs 证据生成时间（毫秒）
 * @param read         读文件
 * @param mtime        取修改时间
 * @param exists       判断路径在不在树里
 * @param extra        闭包之外的依赖（见 VerdictExtra）
 */
export function assessVerdict(
  verifierFile: string,
  evidenceAtMs: number,
  read: ReadFile,
  mtime: MtimeOf,
  exists: Exists,
  extra?: VerdictExtra
): VerdictAssessment {
  const closure = dependencyClosure([verifierFile], read, exists);

  if (closure.missing.includes(verifierFile)) {
    return {
      verifierFile,
      status: 'file-missing',
      changed: [],
      missing: closure.missing,
      unresolved: closure.unresolved,
      computed: closure.computed,
      reason: `验证器文件不在树里了：${verifierFile}`,
    };
  }

  // 闭包之外、但确实依赖的文件 —— 一并纳入判定。
  for (const dep of extra?.deps ?? []) {
    if (closure.files.includes(dep) || closure.missing.includes(dep)) continue;
    if (exists(dep)) closure.files.push(dep);
    else closure.missing.push(dep);
  }

  // 依赖的文件不在树里了 → 说清这条结论对应当前的什么。
  if (closure.missing.length > 0) {
    return {
      verifierFile,
      status: 'unknown',
      changed: [],
      missing: closure.missing,
      unresolved: closure.unresolved,
      computed: closure.computed,
      reason: `依赖的文件不在树里了（${closure.missing.join('、')}）—— 说清不了它对应当前代码`,
    };
  }

  // 依赖文件在证据之后被动过 → 这条结论描述的是旧版本。
  const changed = closure.files.filter((f) => {
    const t = mtime(f);
    return t !== null && t > evidenceAtMs;
  });

  if (changed.length > 0) {
    return {
      verifierFile,
      status: 'stale',
      changed,
      missing: [],
      unresolved: closure.unresolved,
      computed: closure.computed,
      reason:
        (extra?.basis ? `${extra.basis}；` : '') +
        `依赖的文件在证据生成之后被改过：${changed.join('、')}`,
    };
  }

  // 依赖扫不干净 → 说不出这条结论依赖了什么 → 不能说它还成立。
  if (closure.unresolved.length > 0) {
    return {
      verifierFile,
      status: 'unknown',
      changed: [],
      missing: [],
      unresolved: closure.unresolved,
      computed: closure.computed,
      reason: `有依赖扫不出来（${closure.unresolved.join('、')}）—— 说清不了它对应当前代码`,
    };
  }
  if (closure.computed > 0) {
    return {
      verifierFile,
      status: 'unknown',
      changed: [],
      missing: [],
      unresolved: [],
      computed: closure.computed,
      reason: `有 ${closure.computed} 处动态 import 的路径不是字面量 —— 依赖扫不干净，说清不了它对应当前代码`,
    };
  }

  return {
    verifierFile,
    status: 'fresh',
    changed: [],
    missing: [],
    unresolved: [],
    computed: 0,
    reason: '依赖的文件在证据生成之后都没有被改过',
  };
}

// ---------------------------------------------------------------------------
// 五、汇总
// ---------------------------------------------------------------------------

export interface VerdictFreshnessSummary {
  total: number;
  fresh: number;
  stale: number;
  unknown: number;
  missing: number;
  /** 仍然成立的判据（去重、排序） */
  freshCriteria: string[];
  /** 已过期的判据（去重、排序） */
  staleCriteria: string[];
  /** 说不出新鲜度的判据（去重、排序） */
  unknownCriteria: string[];
  /** 已过期的逐条明细 */
  staleDetails: Array<{
    criterion: string;
    verifierFile: string;
    changed: string[];
    reason: string;
  }>;
}

/** 汇总一批结论的新鲜度 */
export function summarizeVerdicts(
  assessments: ReadonlyArray<{ criterion: string; assessment: VerdictAssessment }>
): VerdictFreshnessSummary {
  const summary: VerdictFreshnessSummary = {
    total: assessments.length,
    fresh: 0,
    stale: 0,
    unknown: 0,
    missing: 0,
    freshCriteria: [],
    staleCriteria: [],
    unknownCriteria: [],
    staleDetails: [],
  };

  const freshSet = new Set<string>();
  const staleSet = new Set<string>();
  const unknownSet = new Set<string>();

  for (const { criterion, assessment } of assessments) {
    const s = assessment.status;
    if (s === 'fresh') {
      summary.fresh++;
      freshSet.add(criterion);
    }
    else if (s === 'stale') {
      summary.stale++;
      staleSet.add(criterion);
      summary.staleDetails.push({
        criterion,
        verifierFile: assessment.verifierFile,
        changed: assessment.changed,
        reason: assessment.reason,
      });
    } else if (s === 'file-missing') {
      summary.missing++;
      unknownSet.add(criterion);
    } else {
      summary.unknown++;
      unknownSet.add(criterion);
    }
  }

  summary.freshCriteria = [...freshSet].sort();
  summary.staleCriteria = [...staleSet].sort();
  summary.unknownCriteria = [...unknownSet].sort();
  return summary;
}

// ---------------------------------------------------------------------------
// 六、落到纸面上的措辞
// ---------------------------------------------------------------------------
//
// 措辞本身就是要被审的东西：「说清不了」不能写成「成立」，
// 「跑的时候」不能写成「现在」。写成纯函数，才能被缺陷回放测住。

/** 一份证据：叫什么、什么时候生成的（人话） */
export interface EvidenceSource {
  label: string;
  at: string;
}

/** 表格里最多列出几个改动过的文件 —— 剩下的用「等 N 个」收着 */
const MAX_LISTED = 5;

/** 把一串文件渲染成 `a`、`b`、`c` 等 N 个 —— 太长就收起来 */
export function listFiles(files: string[], max = MAX_LISTED): string {
  const shown = files.slice(0, max).map((f) => `\`${f}\``);
  if (files.length > max) shown.push(`等 ${files.length} 个`);
  return shown.join('、');
}

/**
 * 把已过期的明细按「验证器 + 改动的依赖」归并成几行。
 *
 * 95 条判据常常只落在十来个验证器文件上 —— 逐条列出来是一张没人读的表，
 * 而**一个验证器文件管着哪几条判据**才是读者要问的问题。
 */
export interface StaleGroup {
  /** 验证器文件 */
  verifierFile: string;
  /** 依赖它的判据（同名判据合并计数） */
  criteria: Array<{ criterion: string; count: number }>;
  /** 证据之后被改过的依赖 */
  changed: string[];
}

export function groupStale(details: VerdictFreshnessSummary['staleDetails']): StaleGroup[] {
  const groups = new Map<
    string,
    { verifierFile: string; changed: string[]; counts: Map<string, number> }
  >();
  for (const d of details) {
    const key = `${d.verifierFile} :: ${d.changed.join(' :: ')}`;
    let g = groups.get(key);
    if (!g) {
      g = { verifierFile: d.verifierFile, changed: d.changed, counts: new Map() };
      groups.set(key, g);
    }
    g.counts.set(d.criterion, (g.counts.get(d.criterion) ?? 0) + 1);
  }
  return [...groups.values()].map((g) => ({
    verifierFile: g.verifierFile,
    changed: g.changed,
    criteria: [...g.counts.entries()].map(([criterion, count]) => ({ criterion, count })),
  }));
}

/**
 * 追溯矩阵「这批结论对应的是哪一版代码」这一节的文字。
 *
 * @param s            新鲜度汇总
 * @param sources      证据清单（各是什么、什么时候生成的）
 * @param otherChanged 兜底：证据之后被动过、但不属于任何一条结论的文件
 */
export function renderVerdictFreshnessSection(
  s: VerdictFreshnessSummary,
  sources: EvidenceSource[],
  otherChanged: string[] = []
): string[] {
  const out: string[] = [];

  out.push(
    `这些证据生成于：${sources.map((x) => `${x.label} ${x.at}`).join('、')}。` +
      '每一条 PASS/FAIL 都是**跑批那一刻**的结论 —— ' +
      '跑完之后动过它依赖的文件，这条结论就不再自动适用于当前代码。' +
      '下面按「这条结论依赖的文件有没有在证据之后被改过」逐条判定。'
  );
  out.push('');

  if (s.total === 0) {
    out.push('> 没有可判定的结论 —— 这一节没有内容。');
    return out;
  }

  if (s.stale === 0 && s.unknown === 0 && s.missing === 0) {
    out.push(
      `> **${s.total} 条结论全部仍然成立** —— 它们依赖的文件在证据生成之后都没有被改过。`
    );
  } else {
    if (s.freshCriteria.length > 0) {
      out.push(
        `> 仍然成立的是：${s.freshCriteria.join('、')} —— 其余 ${s.total - s.fresh} 条见下表。`
      );
      out.push('');
    }
    out.push(
      `> 逐条比对了证据生成时间与依赖文件的修改时间：**${s.fresh} 条仍然成立**，` +
        `**${s.stale} 条已过期**（依赖的文件在证据之后被改过），` +
        `${s.unknown} 条说清不了（依赖扫不干净），` +
        `${s.missing} 条依赖的文件已经不在树里。`
    );
    out.push('');
    if (s.staleDetails.length > 0) {
      out.push('| 判据 | 验证器 | 证据之后被改过的依赖 |');
      out.push('|---|---|---|');
      for (const g of groupStale(s.staleDetails)) {
        const criteria = g.criteria
          .map((c) => (c.count > 1 ? `${c.criterion} ×${c.count}` : c.criterion))
          .join('、');
        out.push(`| ${criteria} | \`${g.verifierFile}\` | ${listFiles(g.changed)} |`);
      }
      out.push('');
    }
    out.push(
      '> **已过期的行不能当成对当前代码的证明** —— 它们只说明「那一版的实现被那一版的验证器验过」。' +
        '要让它们重新成立，重跑一次证据集即可。' +
        '（表按验证器归并：同一个验证器管着多条判据时合成一行。）'
    );
  }

  if (otherChanged.length > 0) {
    out.push('');
    out.push(
      `> **兜底**：另有 ${otherChanged.length} 个文件（源码或数据）在证据之后被改过，` +
        '但它们不在任何一条结论的依赖闭包里 —— ' +
        '有的闭包本来就扫不到（运行时才读到的夹具、样式表、配置之类），' +
        '有的则是**谁都没声明**（该声明却没声明）。' +
        '上面的逐条归属因此是**保守**的：漏掉的那些，至少在这里露着。'
    );
    out.push('');
    for (const f of otherChanged) out.push(`- ${listFiles([f], 1)}`);
  }

  return out;
}

/**
 * 「实际验证了什么」那一条里，主证据的一句话限定语。
 *
 * 单说「239 个用例，零失败」说不出范围 —— 那是**跑批那一刻**的结论。
 */
export function verdictFreshnessQualifier(s: VerdictFreshnessSummary): string {
  if (s.total === 0) return '';
  if (s.stale === 0 && s.unknown === 0 && s.missing === 0) return '';

  const parts = [`对**当前代码**仍然成立 **${s.fresh}** 条`, `已过期 **${s.stale}** 条`];
  if (s.unknown > 0) parts.push(`说清不了 **${s.unknown}** 条`);
  if (s.missing > 0) parts.push(`依赖的文件已不在树里 **${s.missing}** 条`);
  return ` —— 其中${parts.join('、')}（见 §2.1.1）`;
}
