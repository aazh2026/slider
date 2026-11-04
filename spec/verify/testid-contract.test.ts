/**
 * E2E 与前端之间的 `data-testid` 契约 —— 静态对账
 * ---------------------------------------------------------------------------
 * 这个文件存在的原因：
 *
 *   2026-11-04 00:51，前端把创作中心的滑块从 `data-testid="page-count"`
 *   改名成 `data-testid="cc-page-count"`（和 cc-preset / cc-purpose 同一套前缀）。
 *   E2E 的 helper 还写着 `getByTestId('page-count')` —— 于是**整条工作台链死了**，
 *   而且死法很隐蔽：Playwright 的 `getByTestId` 是**全等匹配**，不是子串匹配，
 *   所以它不会"匹配到别的元素"，它只是**永远等不到**，
 *   每个用例都卡满 15 秒超时，看起来像"页面没加载出来"。
 *
 *   这类漂移的发现成本极高：
 *     · 单元测试全绿（前端改名不影响任何单测）；
 *     · 全量 E2E 要跑十几分钟，失败信息是 16 条一模一样的 TimeoutError，
 *       指向的是 helpers.ts 里的一行 —— 要把「改名」和「超时」连起来，
 *       得先想到"两者可能有关"，再回头去 diff 前端。
 *
 *   所以这里加一道**静态对账**：把前端提供的 testid 和 E2E 用到的 testid
 *   各解析一遍，逐一比对。**秒级**跑完，不开浏览器，不起服务。
 *
 * ---------------------------------------------------------------------------
 * **为什么断言写在 test 里，不写在 helper 里**：
 *   见 spec/README.md「验证器怎么写」第 1 条 —— 判定逻辑藏进 helper
 *   会导致失败时说不清是哪条判据挂了。
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../..');

/* -------------------------------------------------------------------------- */
/* 解析                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 前端提供的 testid。
 *
 * 只收两种写法：
 *   · `data-testid="字面量"`
 *   · `data-testid={`含 ${插值} 的模板`}`
 *
 * 第三种写法（`data-testid={某个变量}`）**静态解不出来** —— 不收，
 * 也不当成错误：解不出来不等于对不上，只是这一条无法静态判定。
 */
export function parseProvidedTestids(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/data-testid=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    const value = m[1] ?? m[2];
    if (value !== undefined) out.push(value);
  }
  return out;
}

/**
 * E2E 用到的 testid。
 *
 * 三种写法都算：
 *   · `getByTestId('X')`      —— 全等匹配
 *   · `[data-testid="X"]`     —— 全等匹配
 *   · `[data-testid^="X"]`    —— 前缀匹配
 *
 * 前缀用 `^=` 单独标出来：它的判定规则和全等不一样，
 * 混在一起比就会把"前端有 outline-item-${index}、E2E 用 ^="outline-item-""判成对不上。
 */
export interface TestidUsage {
  id: string;
  kind: 'exact' | 'prefix';
  /** id 里带 `${...}` —— 用法本身是模板，不是写死的值 */
  template: boolean;
}

export function parseUsedTestids(source: string): TestidUsage[] {
  const out: TestidUsage[] = [];
  for (const m of source.matchAll(/getByTestId\(\s*(['"`])([^'"`]+)\1\s*\)/g)) {
    out.push({ id: m[2]!, kind: 'exact', template: m[2]!.includes('${') });
  }
  for (const m of source.matchAll(/\[data-testid\^?=\\?["']([^"']+)\\?["']\]/g)) {
    out.push({
      id: m[1]!,
      kind: m[0]!.includes('^=') ? 'prefix' : 'exact',
      template: m[1]!.includes('${'),
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* 匹配                                                                        */
/* -------------------------------------------------------------------------- */

/** 模式 → 正则：`${...}` 变成「任意串」，其余部分按字面量转义；纯字面量则全等匹配 */
function toRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 转义之后 `${` 变成了 `\$\{`，插值正好长这样
  return new RegExp(`^${escaped.replace(/\\\$\\\{[^}]*\\\}/g, '[^]+')}$`);
}

/** 模板的「静态前缀」—— 第一个插值之前的部分 */
function staticPrefix(pattern: string): string {
  const at = pattern.indexOf('${');
  return at === -1 ? pattern : pattern.slice(0, at);
}

/**
 * 一个前端提供的 testid，能不能满足 E2E 的这一处用法。
 *
 * 四种组合都要认：
 *   前端字面量 × E2E 字面量 → 必须相等（**全等匹配，不是子串**）
 *   前端模板   × E2E 字面量 → 字面量要能落进模板的形状里
 *   前端字面量 × E2E 模板   → 字面量要能被模板吃掉
 *   前端模板   × E2E 模板   → 两边的静态部分要对得上
 *
 * 判定刻意保守：宁可放过可疑的，也不误报 ——
 * 一个天天误报的守卫，用不了两天就没人看它了。
 */
export function satisfies(provided: string[], usage: TestidUsage): boolean {
  for (const p of provided) {
    if (usage.kind === 'prefix') {
      // 前缀用法：DOM 上的值以 used.id 开头
      const sp = staticPrefix(p);
      if (sp.startsWith(usage.id) || usage.id.startsWith(sp)) return true;
      continue;
    }
    if (usage.template) {
      // E2E 侧是模板：看前端给的这个能不能被它吃掉
      if (toRegExp(usage.id).test(p)) return true;
    } else {
      // E2E 侧是写死的值：看前端给的这个能不能装下它
      if (toRegExp(p).test(usage.id)) return true;
    }
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* 扫仓库                                                                      */
/* -------------------------------------------------------------------------- */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (!['node_modules', '.git', 'dist', 'coverage'].includes(entry)) walk(p, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

/** 前端提供的 testid —— 连同它出现在哪个文件，便于报错时直接定位 */
export function scanProvided(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const file of walk(join(ROOT, 'src'))) {
    for (const id of parseProvidedTestids(readFileSync(file, 'utf-8'))) {
      const files = map.get(id) ?? [];
      files.push(relative(ROOT, file));
      map.set(id, files);
    }
  }
  return map;
}

/** E2E 用到的 testid —— 连同它出现在哪个文件 */
export function scanUsed(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const file of walk(join(ROOT, 'e2e'))) {
    for (const u of parseUsedTestids(readFileSync(file, 'utf-8'))) {
      const key = `${u.kind}:${u.template ? 'T' : 'L'}:${u.id}`;
      const files = map.get(key) ?? [];
      files.push(relative(ROOT, file));
      map.set(key, files);
    }
  }
  return map;
}

/* -------------------------------------------------------------------------- */
/* 判据                                                                        */
/* -------------------------------------------------------------------------- */

describe('E2E 用到的 testid，前端全都提供得出来', () => {
  const provided = [...scanProvided().keys()];
  const used = scanUsed();

  test('至少扫到一些 testid —— 扫描器没坏', () => {
    expect(provided.length).toBeGreaterThan(50);
    expect(used.size).toBeGreaterThan(20);
  });

  test('每一条 E2E 用法都有前端提供的 testid 对得上', () => {
    const missing: string[] = [];
    for (const [key, files] of used) {
      const [kind, tmpl, ...rest] = key.split(':');
      const usage: TestidUsage = {
        id: rest.join(':'),
        kind: kind === 'prefix' ? 'prefix' : 'exact',
        template: tmpl === 'T',
      };
      if (!satisfies(provided, usage)) {
        missing.push(`${usage.kind === 'prefix' ? '^=' : ''}${usage.id}  ← ${[...new Set(files)].join(', ')}`);
      }
    }
    // 一条都对不上时，报错要指名道姓 —— 「对不上」本身没有诊断价值
    expect(missing).toEqual([]);
  });
});

describe('匹配规则 —— 缺陷回放', () => {
  /** 现场：前端把 `page-count` 改名成 `cc-page-count`，E2E 还写着老的 */
  const RENAMED = ['cc-page-count', 'cc-preset-${idx}', 'topic-prompt'];
  const STALE: TestidUsage = { id: 'page-count', kind: 'exact', template: false };

  test('前端改名之后，老的 testid 判成对不上', () => {
    // **这就是出事的那一步**：改名之后 E2E 一直在等一个不存在的元素，
    // 每个用例卡满 15 秒，还看不出是改名造成的。
    expect(satisfies(RENAMED, STALE)).toBe(false);
  });

  test('新名字立刻对得上', () => {
    expect(satisfies(RENAMED, { id: 'cc-page-count', kind: 'exact', template: false })).toBe(true);
  });

  test('没被碰过的 testid 不受影响', () => {
    expect(satisfies(RENAMED, { id: 'topic-prompt', kind: 'exact', template: false })).toBe(true);
  });

  test('模板 testid 能对上具体的一个值', () => {
    expect(satisfies(RENAMED, { id: 'cc-preset-0', kind: 'exact', template: false })).toBe(true);
    expect(satisfies(RENAMED, { id: 'cc-preset', kind: 'exact', template: false })).toBe(false);
  });

  test('E2E 侧是模板时，前端的字面量也能对上', () => {
    // 现场：前端给的是 `export-format-png` 等五个写死的值，
    // E2E 侧写的是 `getByTestId(\`export-format-${format}\`)` —— 两边不是同一种形状。
    const provided = ['export-format-pptx', 'export-format-pdf', 'export-format-png'];
    expect(satisfies(provided, { id: 'export-format-${format}', kind: 'exact', template: true })).toBe(
      true
    );
    expect(satisfies(provided, { id: 'export-kind-${format}', kind: 'exact', template: true })).toBe(
      false
    );
  });

  test('前缀用法：前端是模板、E2E 用 ^= 也能对上', () => {
    const provided = ['outline-item-${index}'];
    expect(satisfies(provided, { id: 'outline-item-', kind: 'prefix', template: false })).toBe(true);
    expect(satisfies(provided, { id: 'outline-item-0', kind: 'prefix', template: false })).toBe(true);
    // 前缀对不上就是真的对不上
    expect(satisfies(provided, { id: 'outline-edit-', kind: 'prefix', template: false })).toBe(false);
  });

  test('空列表什么都对不上', () => {
    expect(satisfies([], STALE)).toBe(false);
  });
});

describe('解析器 —— 缺陷回放', () => {
  test('前端的字面量与模板都能收进来', () => {
    const src = `
      <input data-testid="cc-audience" />
      <button data-testid={\`wb-slide-delete-\${index}\`} />
    `;
    expect(parseProvidedTestids(src).sort()).toEqual(['cc-audience', 'wb-slide-delete-${index}']);
  });

  test('解不出来的写法不收，也不报错', () => {
    // data-testid={someVar} —— 静态解不出来，只能跳过
    expect(parseProvidedTestids('<div data-testid={dynamicId} />')).toEqual([]);
  });

  test('E2E 的三种写法都能收进来', () => {
    const src = `
      page.getByTestId('cc-page-count')
      page.getByTestId("outline-item-0")
      page.locator('[data-testid="project-card"]')
      page.locator('[data-testid^="outline-item-"]')
    `;
    const used = parseUsedTestids(src);
    expect(used.filter((u) => u.kind === 'exact').map((u) => u.id).sort()).toEqual([
      'cc-page-count',
      'outline-item-0',
      'project-card',
    ]);
    expect(used.filter((u) => u.kind === 'prefix').map((u) => u.id)).toEqual(['outline-item-']);
  });
});
