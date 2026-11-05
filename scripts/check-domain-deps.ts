#!/usr/bin/env bun
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SPEC-GOV-005 —— 领域层零依赖门禁
 * ---------------------------------------------------------------------------
 * docs/testing-strategy.md §3 L0 门禁表里写着、但一直没做的那一条：
 *   > | 领域层零依赖检查 | 自定义脚本扫描 packages/core 不得 import 模型 SDK / IO | 违规即失败 |
 *
 * 验证目标（spec/spec.yaml）：
 *   scripts/check-domain-deps.check.ts::domain-layer-has-no-unregistered-host-dependency
 *   判据：AC-GOV-005 ——「扫描 packages/core/src，断言领域层没有依赖宿主环境的
 *   地方：模型 SDK / 文件 IO / 网络 / DOM / Node 运行时；已有的违规必须登记在
 *   欠账账本里，且不得超出账本记的上限」
 *
 * ---------------------------------------------------------------------------
 * **为什么「import 模型 SDK / IO」这一条要扩成「宿主环境」**
 *
 * 文档原话只提了两类（模型 SDK、IO）。但真正让领域内核跑不起来的是**宿主**：
 * 浏览器里的 `document`、Node 里的 `process`、还有网络。
 * 只查 import 会漏掉最常见的一种 —— `document.createElement` 这种
 * **根本没有 import 的宿主依赖**。所以这里查两件事：
 *   ① import 的模块说明符（模型 SDK / IO 库 / 网络库 / DOM 模拟器 / Node 运行时）
 *   ② 自由使用的主机全局标识符（document / window / fetch / process / Buffer …）
 *
 * ---------------------------------------------------------------------------
 * **为什么用自己写的词法分析，而不是正则**
 *
 * 正则分不清「代码里的 import」和「注释里的 import」——
 * packages/core/src/index.ts 的文件头注释里就写着
 * `import { LayoutEngine } from '@ppt/core'`，正则扫过去会当成真的 import。
 * 同理，正则也分不清「字符串里的 document」和「代码里的 document」，
 * 而 exportEngine.ts 里就有 `/[\s/\\:*?"<>|]/g` 这种**正则字面量**，
 * 它里面带一个引号 —— 用朴素的字符串扫描会把后面半行代码都吞进「字符串」里，
 * 于是真正的违规反而被藏起来（漏报比误报更危险）。
 *
 * 所以这里带一个**小词法分析器**：注释、字符串、模板字面量、正则字面量
 * 各自成段，只有真正��代码段才参与判定。
 * 词法分析器只做「切段」这一件事，不做语法分析 —— 语法分析要的是解析器，
 * 而解析器会把「这个标识符是不是局部的」也一起判掉，那已经是另一门学问。
 *
 * ---------------------------------------------------------------------------
 * **门禁不是「一次都不能有」，是「不许再长」**
 *
 * 现在领域层里就有三处真实的宿主依赖：exportEngine.ts 引了 pptxgenjs 与 jspdf，
 * 还直接用了 document / Image。它们是真的债 —— 导出引擎本来就该住在
 * adapters 层，而 adapters 层还没建。
 *
 * 门禁不能装作没有这笔债（那就是假绿），也不能让债继续涨（那就是没门禁）。
 * 于是用**欠账账本**（spec/domain-deps-baseline.json）把现状钉住：
 *   · 账本里没有的违规      → 新增的债 → **失败**
 *   · 超过账本记的上限次数  → 债在长大   → **失败**
 *   · 账本里有、现在没有的  → 债还清了   → **失败**（必须把那条删掉）
 * 三个方向都失败，账本才不会烂成一张万能赦免状。
 *
 * **上限次数为什么不要求精确相等**：
 * 精确相等会让「少用了一次 document」也变成红灯，而少用是好事 ——
 * 逼着人去改账本不是门禁该干的事。上限语义下，
 * 少用不红（上限只是天花板）、多用必红（要涨就得改账本，改账本是有意识的动作）。
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// 词法分析
// ---------------------------------------------------------------------------

export type TokenKind = 'ident' | 'string' | 'template' | 'regex' | 'comment' | 'punct' | 'number';

export interface Token {
  kind: TokenKind;
  /** 原始文本（含引号 / 含注释符号） */
  text: string;
  /** 字符串字面量的内容（不含引号） */
  value?: string;
  /** 起始偏移 */
  start: number;
  /** 结束偏移（不含） */
  end: number;
  /** 行号，1 起 */
  line: number;
}

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_$]/.test(ch);
}

function isIdentPart(ch: string): boolean {
  return /[A-Za-z0-9_$]/.test(ch);
}

/** 这些关键字之后可以跟一个正则字面量（`return /x/.test(s)`） */
const REGEX_AFTER_KEYWORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'case',
  'do',
  'else',
  'yield',
  'await',
  'throw',
]);

/** 两字符的标点（`=>` `?.` 等）—— 单独记，免得 `?.` 被当成 `.` + `?` */
const TWO_CHAR_PUNCT = new Set([
  '=>',
  '?.',
  '??',
  '&&',
  '||',
  '++',
  '--',
  '==',
  '!=',
  '===',
  '!==',
  '<=',
  '>=',
  '**',
]);

function lineOf(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') line++;
  }
  return line;
}

/**
 * 切一个正则字面量出来。
 *
 * 返回字面量的长度；不是正则字面量（除号）返回 0。
 *
 * 字符类里的 `/` 不算结束（`/[\s/]/`），转义过的字符也不算。
 * 正则不能跨行 —— 遇到换行就放弃（那说明这是除号）。
 */
export function matchRegexLiteral(source: string, from: number, to: number): number {
  let i = from + 1; // 跳过开头的 `/`
  let inClass = false;
  while (i < to) {
    const ch = source[i]!;
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '\n') return 0;
    if (ch === '[') {
      inClass = true;
      i++;
      continue;
    }
    if (ch === ']') {
      inClass = false;
      i++;
      continue;
    }
    if (ch === '/' && !inClass) {
      i++;
      while (i < to && /[a-z]/.test(source[i]!)) i++;
      return i - from;
    }
    i++;
  }
  return 0;
}

/** 上一个 token 之后能不能出现正则字面量 */
function regexAllowedAfter(prev: Token | null): boolean {
  if (!prev) return true;
  if (prev.kind === 'ident') return REGEX_AFTER_KEYWORDS.has(prev.text);
  if (prev.kind === 'number' || prev.kind === 'string' || prev.kind === 'template' || prev.kind === 'regex') {
    return false;
  }
  // 标点：`)` `]` 后面通常是除法，`}` 后面通常是新语句
  if (prev.text === ')' || prev.text === ']') return false;
  return true;
}

/**
 * 把源码切成 token。
 *
 * 只切不判 —— 「这个标识符是不是局部的」交给调用方（见 collectShadowed）。
 */
export function lex(source: string): Token[] {
  const tokens: Token[] = [];
  lexRange(source, 0, source.length, tokens, false);
  return tokens;
}

/**
 * 切一段源码。
 *
 * `stopAtBrace` = true 时，遇到**最外层**的 `}` 就停下并返回它的下一个位置 ——
 * 模板字面量的 `${…}` 靠这个找到配对的右花括号。
 */
function lexRange(
  source: string,
  from: number,
  to: number,
  out: Token[],
  stopAtBrace: boolean
): number {
  let i = from;
  let depth = 0;
  let prev: Token | null = null;

  const push = (kind: TokenKind, text: string, start: number, end: number, value?: string): Token => {
    const token: Token = { kind, text, start, end, line: lineOf(source, start) };
    if (value !== undefined) token.value = value;
    out.push(token);
    if (kind !== 'comment') prev = token;
    return token;
  };

  while (i < to) {
    const ch = source[i]!;

    // 空白
    if (ch === '\n' || ch === ' ' || ch === '\t' || ch === '\r') {
      i++;
      continue;
    }

    // 行注释
    if (ch === '/' && source[i + 1] === '/') {
      const start = i;
      while (i < to && source[i] !== '\n') i++;
      push('comment', source.slice(start, i), start, i);
      continue;
    }

    // 块注释
    if (ch === '/' && source[i + 1] === '*') {
      const start = i;
      i += 2;
      while (i < to && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i = Math.min(i + 2, to);
      push('comment', source.slice(start, i), start, i);
      continue;
    }

    // 字符串字面量
    if (ch === '"' || ch === "'") {
      const start = i;
      i++;
      let value = '';
      while (i < to) {
        const c = source[i]!;
        if (c === '\\') {
          value += source[i + 1] ?? '';
          i += 2;
          continue;
        }
        if (c === ch) {
          i++;
          break;
        }
        value += c;
        i++;
      }
      push('string', source.slice(start, i), start, i, value);
      continue;
    }

    // 模板字面量（`…` 与其中的 `${…}` 表达式）
    if (ch === '`') {
      const start = i;
      i++;
      while (i < to) {
        const c = source[i]!;
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === '`') {
          i++;
          break;
        }
        if (c === '$' && source[i + 1] === '{') {
          i += 2;
          // 模板里的表达式是真正的代码 —— 里面的标识符要参与判定
          i = lexRange(source, i, to, out, true);
          continue;
        }
        i++;
      }
      push('template', source.slice(start, i), start, i);
      continue;
    }

    // 除号 / 正则字面量
    if (ch === '/') {
      if (regexAllowedAfter(prev)) {
        const len = matchRegexLiteral(source, i, to);
        if (len > 0) {
          push('regex', source.slice(i, i + len), i, i + len);
          i += len;
          continue;
        }
      }
      push('punct', '/', i, i + 1);
      i++;
      continue;
    }

    // 标识符 / 关键字
    if (isIdentStart(ch)) {
      const start = i;
      i++;
      while (i < to && isIdentPart(source[i]!)) i++;
      push('ident', source.slice(start, i), start, i);
      continue;
    }

    // 数字
    if (ch >= '0' && ch <= '9') {
      const start = i;
      while (i < to && /[0-9a-zA-Z._]/.test(source[i]!)) i++;
      push('number', source.slice(start, i), start, i);
      continue;
    }

    // 标点
    const two = source.slice(i, i + 2);
    if (TWO_CHAR_PUNCT.has(two)) {
      push('punct', two, i, i + 2);
      i += 2;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') {
      if (depth === 0 && stopAtBrace) {
        push('punct', '}', i, i + 1);
        return i + 1;
      }
      depth--;
    }
    push('punct', ch, i, i + 1);
    i++;
  }

  return i;
}

// ---------------------------------------------------------------------------
// 规则表
// ---------------------------------------------------------------------------

export type ViolationKind = 'model-sdk' | 'io' | 'network' | 'dom' | 'node-runtime';

export interface ImportRule {
  kind: ViolationKind;
  /** 精确匹配的模块说明符 */
  exact: string[];
  /** 前缀匹配（`@langchain/` 这样的包族） */
  prefixes?: string[];
}

/**
 * 领域层不许碰的模块。
 *
 * `node:` 前缀单独处理（见 matchImportRule）——
 * Node 内置模块里也有纯函数库（path / util / url），
 * 把它们和 fs / child_process 一起禁掉既不准确也会逼人绕过门禁。
 */
export const IMPORT_RULES: ImportRule[] = [
  {
    kind: 'model-sdk',
    exact: [
      'openai',
      'google-generativeai',
      'ollama',
      'cohere-ai',
      'groq-sdk',
      'replicate',
      'mistralai',
      'transformers',
      'langchain',
      'langgraph',
      'llamaindex',
      'ai',
    ],
    prefixes: [
      '@anthropic-ai/',
      '@google/genai',
      '@google/generative-ai',
      '@google-cloud/vertexai',
      '@google-cloud/aiplatform',
      '@azure/openai',
      '@mistralai/',
      '@huggingface/',
      '@xenova/',
      '@ai-sdk/',
      '@langchain/',
      '@langgraph/',
      '@llamaindex/',
      '@replicate/',
      'onnxruntime',
    ],
  },
  {
    kind: 'io',
    exact: [
      'pptxgenjs',
      'jspdf',
      'pdfkit',
      'pdf-lib',
      'exceljs',
      'xlsx',
      'jszip',
      'archiver',
      'adm-zip',
      'unzipper',
      'tar',
      'sharp',
      'canvas',
      'jimp',
      'glob',
      'fast-glob',
      'globby',
      'chokidar',
      'fs-extra',
      'mkdirp',
      'rimraf',
      'tmp',
    ],
    prefixes: ['@napi-rs/canvas'],
  },
  {
    kind: 'network',
    exact: [
      'axios',
      'node-fetch',
      'undici',
      'got',
      'superagent',
      'request',
      'ky',
      'ws',
      'socket.io',
      'sockjs',
    ],
    prefixes: [],
  },
  {
    kind: 'dom',
    exact: [
      'jsdom',
      'happy-dom',
      'linkedom',
      'domino',
      'puppeteer',
      'puppeteer-core',
      'playwright',
      'playwright-core',
      'cheerio',
    ],
    prefixes: ['@playwright/test'],
  },
];

/**
 * Node 内置模块里**允许**在领域层出现的纯函数库。
 *
 * 剩下的 `node:*` 一律算「碰了 Node 运行时」。
 */
export const NODE_BUILTIN_ALLOW: string[] = [
  'node:util',
  'node:path',
  'node:url',
  'node:buffer',
  'node:events',
  'node:assert',
  'node:querystring',
  'node:string_decoder',
];

/**
 * 领域层不许自由使用的主机全局。
 *
 * **用 Map 而不是普通对象**：普通对象会从 Object.prototype 上继承属性 ——
 * `GLOBAL_RULES['constructor']` 取到的是 `Object` 函数本身（truthy），
 * 于是任何叫 `constructor` 的标识符都会被当成「用了宿主全局」。
 * 这种坑不会报错，只会悄悄判错 —— 所以这里用 Map。
 */
export const GLOBAL_RULES = new Map<string, ViolationKind>([
  // 浏览器
  ['document', 'dom'],
  ['window', 'dom'],
  ['navigator', 'dom'],
  ['localStorage', 'dom'],
  ['sessionStorage', 'dom'],
  ['location', 'dom'],
  ['history', 'dom'],
  ['screen', 'dom'],
  ['alert', 'dom'],
  ['confirm', 'dom'],
  ['prompt', 'dom'],
  ['XMLHttpRequest', 'dom'],
  ['WebSocket', 'dom'],
  ['EventSource', 'dom'],
  ['IntersectionObserver', 'dom'],
  ['MutationObserver', 'dom'],
  ['ResizeObserver', 'dom'],
  ['requestAnimationFrame', 'dom'],
  ['cancelAnimationFrame', 'dom'],
  ['getComputedStyle', 'dom'],
  ['matchMedia', 'dom'],
  ['FileReader', 'dom'],
  ['Image', 'dom'],
  ['Audio', 'dom'],
  ['HTMLElement', 'dom'],
  ['FormData', 'dom'],
  ['OffscreenCanvas', 'dom'],
  // 网络
  ['fetch', 'network'],
  // Node 运行时
  ['process', 'node-runtime'],
  ['Buffer', 'node-runtime'],
  ['__dirname', 'node-runtime'],
  ['__filename', 'node-runtime'],
]);

// ---------------------------------------------------------------------------
// 违规的识别
// ---------------------------------------------------------------------------

export interface Violation {
  /** 相对仓库根的路径 */
  file: string;
  kind: ViolationKind;
  /** import 的模块说明符，或全局标识符的名字 */
  symbol: string;
  /** 出现次数 */
  count: number;
  /** 出现的行号 */
  lines: number[];
}

/** 一个模块说明符命中了哪条规则 */
export function matchImportRule(specifier: string): { kind: ViolationKind } | null {
  // 相对路径与绝对路径不是依赖 —— 本仓内部的引用不算
  if (specifier.startsWith('.') || specifier.startsWith('/')) return null;

  if (specifier.startsWith('node:')) {
    if (NODE_BUILTIN_ALLOW.includes(specifier)) return null;
    return { kind: 'node-runtime' };
  }

  for (const rule of IMPORT_RULES) {
    if (rule.exact.includes(specifier)) return { kind: rule.kind };
    if (rule.prefixes?.some((p) => specifier === p || specifier.startsWith(p))) {
      return { kind: rule.kind };
    }
  }
  return null;
}

/** 下一个「有效」token（跳过注释） */
function nextCode(tokens: Token[], from: number): Token | null {
  for (let i = from; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind === 'comment') continue;
    return t;
  }
  return null;
}

/** 上一个「有效」token（跳过注释） */
function prevCode(tokens: Token[], from: number): Token | null {
  for (let i = from; i >= 0; i--) {
    const t = tokens[i]!;
    if (t.kind === 'comment') continue;
    return t;
  }
  return null;
}

/**
 * 找出所有 import 的模块说明符。
 *
 * 覆盖四种写法：
 *   import x from 'm' / export … from 'm'  —— 由 `from` 认
 *   import 'm'                             —— 副作用导入
 *   import('m')                            —— 动态导入
 *   require('m')                           —— CommonJS
 */
export function findImportSpecifiers(tokens: Token[]): Array<{ specifier: string; line: number }> {
  const found: Array<{ specifier: string; line: number }> = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind !== 'ident') continue;

    // 属性访问上的同名标识符不算（obj.require(…) / obj.from）
    const prev = prevCode(tokens, i - 1);
    if (prev && prev.kind === 'punct' && (prev.text === '.' || prev.text === '?.')) continue;

    if (t.text === 'from') {
      const next = nextCode(tokens, i + 1);
      if (next && next.kind === 'string') found.push({ specifier: next.value!, line: next.line });
      continue;
    }

    if (t.text === 'import') {
      const next = nextCode(tokens, i + 1);
      if (!next) continue;
      if (next.kind === 'string') {
        found.push({ specifier: next.value!, line: next.line });
        continue;
      }
      if (next.kind === 'punct' && next.text === '(') {
        const arg = nextCode(tokens, i + 2);
        if (arg && arg.kind === 'string') found.push({ specifier: arg.value!, line: arg.line });
      }
      continue;
    }

    if (t.text === 'require') {
      const next = nextCode(tokens, i + 1);
      if (next && next.kind === 'punct' && next.text === '(') {
        const arg = nextCode(tokens, i + 2);
        if (arg && arg.kind === 'string') found.push({ specifier: arg.value!, line: arg.line });
      }
      continue;
    }
  }

  return found;
}

/**
 * 收集被局部声明遮蔽的名字。
 *
 * 领域层里不该出现叫 `document` 的局部变量 —— 但真出现了，
 * 门禁不该报「用了宿主全局」，那是指控错了对象。
 */
export function collectShadowed(tokens: Token[]): Set<string> {
  const shadowed = new Set<string>();
  const declKeywords = new Set(['const', 'let', 'var', 'function', 'class']);

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind !== 'ident' || !declKeywords.has(t.text)) continue;

    // 声明名可能隔着类型注解：`const document: Foo = …`
    let j = i + 1;
    let name = nextCode(tokens, j);
    if (!name) continue;

    if (name.kind === 'ident') {
      shadowed.add(name.text);
      continue;
    }

    // 解构：`const { document } = props` / `const [a] = arr`
    if (name.kind === 'punct' && (name.text === '{' || name.text === '[')) {
      const close = name.text === '{' ? '}' : ']';
      let depth = 0;
      for (let k = j; k < tokens.length; k++) {
        const tk = tokens[k]!;
        if (tk.kind !== 'punct') continue;
        if (tk.text === name.text) depth++;
        else if (tk.text === close) {
          depth--;
          if (depth === 0) break;
        }
      }
      // 模式里的标识符（跳过 `a: b` 里的 `b` 之前的默认值等）
      for (let k = j + 1; k < tokens.length; k++) {
        const tk = tokens[k]!;
        if (tk.kind === 'punct' && tk.text === close) break;
        if (tk.kind === 'ident') shadowed.add(tk.text);
      }
    }
  }

  return shadowed;
}

/**
 * 找出自由使用的主机全局。
 *
 * 「自由使用」= 不是属性访问（`obj.document`）、不是声明的名字、
 * 并且出现在真正用它的位置上：成员访问的基座（`document.createElement`）、
 * 调用（`fetch(url)`）、或 `new` 之后（`new Image()`）。
 */
export function findHostGlobals(tokens: Token[]): Array<{ symbol: string; kind: ViolationKind; line: number }> {
  const shadowed = collectShadowed(tokens);
  const found: Array<{ symbol: string; kind: ViolationKind; line: number }> = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind !== 'ident') continue;
    const kind = GLOBAL_RULES.get(t.text);
    if (!kind) continue;
    if (shadowed.has(t.text)) continue;

    const prev = prevCode(tokens, i - 1);
    const next = nextCode(tokens, i + 1);

    // 属性访问 —— `obj.document` 不是宿主依赖
    if (prev && prev.kind === 'punct' && (prev.text === '.' || prev.text === '?.')) continue;
    // 对象字面量的键 / 类型注解的标签 —— `const o = { document: 1 }`
    if (next && next.kind === 'punct' && next.text === ':') continue;

    const memberAccess = !!next && next.kind === 'punct' && (next.text === '.' || next.text === '?.');
    const call = !!next && next.kind === 'punct' && next.text === '(';
    const constructed = !!prev && prev.kind === 'ident' && prev.text === 'new';
    if (!memberAccess && !call && !constructed) continue;

    found.push({ symbol: t.text, kind, line: t.line });
  }

  return found;
}

/** 扫一个文件，返回它里面的违规 */
export function scanSource(file: string, source: string): Violation[] {
  const tokens = lex(source);
  const byKey = new Map<string, Violation>();

  const record = (kind: ViolationKind, symbol: string, line: number) => {
    const key = `${kind}|${symbol}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count++;
      existing.lines.push(line);
      return;
    }
    byKey.set(key, { file, kind, symbol, count: 1, lines: [line] });
  };

  for (const { specifier, line } of findImportSpecifiers(tokens)) {
    const hit = matchImportRule(specifier);
    if (hit) record(hit.kind, specifier, line);
  }

  for (const { symbol, kind, line } of findHostGlobals(tokens)) {
    record(kind, symbol, line);
  }

  return [...byKey.values()].sort((a, b) =>
    a.kind === b.kind ? a.symbol.localeCompare(b.symbol) : a.kind.localeCompare(b.kind)
  );
}

// ---------------------------------------------------------------------------
// 欠账账本
// ---------------------------------------------------------------------------

export interface LedgerEntry {
  /** 相对仓库根的路径 */
  file: string;
  kind: ViolationKind;
  /** import 的模块说明符，或全局标识符的名字 */
  symbol: string;
  /** 允许出现的次数上限 */
  maxCount: number;
  /** 这笔债为什么还在（写给下一个人看） */
  reason?: string;
}

export interface Ledger {
  scannedRoot: string;
  note?: string;
  entries: LedgerEntry[];
}

export interface LedgerComparison {
  /** 账本外的新违规 */
  added: Violation[];
  /** 超出账本上限的违规 */
  exceeded: Array<{ violation: Violation; maxCount: number }>;
  /** 账本里有、现在却找不到了的条目（债还清了，必须删掉） */
  stale: LedgerEntry[];
  passed: boolean;
}

function ledgerKey(file: string, kind: string, symbol: string): string {
  return `${file}|${kind}|${symbol}`;
}

/**
 * 把扫出来的违规和账本对账。
 *
 * 三个方向都要失败 —— 见文件头的说明。
 */
export function compareToLedger(found: Violation[], ledger: Ledger): LedgerComparison {
  const foundByKey = new Map<string, Violation>();
  for (const v of found) foundByKey.set(ledgerKey(v.file, v.kind, v.symbol), v);

  const ledgerByKey = new Map<string, LedgerEntry>();
  for (const e of ledger.entries) ledgerByKey.set(ledgerKey(e.file, e.kind, e.symbol), e);

  const added: Violation[] = [];
  const exceeded: Array<{ violation: Violation; maxCount: number }> = [];
  const stale: LedgerEntry[] = [];

  for (const [key, violation] of foundByKey) {
    const entry = ledgerByKey.get(key);
    if (!entry) {
      added.push(violation);
      continue;
    }
    if (violation.count > entry.maxCount) exceeded.push({ violation, maxCount: entry.maxCount });
  }

  for (const [key, entry] of ledgerByKey) {
    if (!foundByKey.has(key)) stale.push(entry);
  }

  return {
    added,
    exceeded,
    stale,
    passed: added.length === 0 && exceeded.length === 0 && stale.length === 0,
  };
}

// ---------------------------------------------------------------------------
// 门禁本体
// ---------------------------------------------------------------------------

/** 被扫描的目录（相对仓库根） */
export const SCANNED_ROOT = 'packages/core/src';

/** 欠账账本（相对仓库根） */
export const LEDGER_PATH = 'spec/domain-deps-baseline.json';

/** 证据落盘位置 */
export const EVIDENCE_PATH = 'spec/evidence/domain-deps.json';

/**
 * 列目录 —— 目录不存在就当空目录。
 *
 * 返回类型写成结构化的形状而不是 `Dirent`：
 * `readdirSync` 有多个重载，`ReturnType<typeof readdirSync>` 会挑到
 * Buffer 那个重载（`Dirent<NonSharedBuffer>[]`），于是每个 `entry.name`
 * 都被推成 Buffer —— 类型检查直接报错。
 */
function safeReaddir(
  dir: string
): Array<{ name: string; isDirectory(): boolean; isFile(): boolean }> {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** 递归列出目录下的 .ts 文件（跳过 .d.ts） */
export function listSourceFiles(dir: string, root: string): string[] {
  const out: string[] = [];
  for (const entry of safeReaddir(dir)) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(full, root));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.d.ts')) continue;
    out.push(relative(root, full).split('\\').join('/'));
  }
  return out.sort();
}

export interface ScanResult {
  scannedRoot: string;
  filesScanned: number;
  violations: Violation[];
  comparison: LedgerComparison;
}

/** 扫整棵领域层，并与账本对账 */
export function scanTree(repoRoot: string, ledger: Ledger): ScanResult {
  const violations: Violation[] = [];
  const files = listSourceFiles(resolve(repoRoot, SCANNED_ROOT), repoRoot);
  for (const file of files) {
    const source = readFileSync(resolve(repoRoot, file), 'utf-8');
    violations.push(...scanSource(file, source));
  }
  violations.sort((a, b) =>
    a.file === b.file
      ? a.kind === b.kind
        ? a.symbol.localeCompare(b.symbol)
        : a.kind.localeCompare(b.kind)
      : a.file.localeCompare(b.file)
  );
  return {
    scannedRoot: SCANNED_ROOT,
    filesScanned: files.length,
    violations,
    comparison: compareToLedger(violations, ledger),
  };
}

/** 读账本 */
export function readLedger(repoRoot: string): Ledger {
  const path = resolve(repoRoot, LEDGER_PATH);
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as Ledger;
  if (!parsed || !Array.isArray(parsed.entries)) {
    throw new Error(`欠账账本格式不对：${LEDGER_PATH} 缺少 entries 数组`);
  }
  return parsed;
}

export interface GateOptions {
  /** 只算不落盘（自测用） */
  writeEvidence?: boolean;
}

export async function main(opts: GateOptions = {}): Promise<number> {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

  let ledger: Ledger;
  try {
    ledger = readLedger(repoRoot);
  } catch (err) {
    console.error(`[domain-deps] ✗ 读不到欠账账本 ${LEDGER_PATH}：${String(err)}`);
    return 1;
  }

  const result = scanTree(repoRoot, ledger);
  const { added, exceeded, stale, passed } = result.comparison;

  console.log('');
  console.log(`[domain-deps] 扫描目录：${SCANNED_ROOT}（${result.filesScanned} 个文件）`);
  console.log(`[domain-deps] 已登记的欠账：${ledger.entries.length} 条`);
  console.log('');

  if (result.violations.length > 0) {
    const labels = result.violations.map((v) => `${v.file} · ${v.symbol}`);
    const width = Math.max(24, ...labels.map((l) => l.length + 2));
    console.log(`[domain-deps] ${'位置'.padEnd(width)}${'类别'.padEnd(14)}${'次数'.padStart(6)}`);
    console.log(`[domain-deps] ${'-'.repeat(width + 20)}`);
    for (const [i, v] of result.violations.entries()) {
      console.log(
        `[domain-deps] ${labels[i]!.padEnd(width)}${v.kind.padEnd(14)}${String(v.count).padStart(6)}`
      );
    }
    console.log(`[domain-deps] ${'-'.repeat(width + 20)}`);
    console.log('');
  }

  let failed = false;

  if (added.length > 0) {
    failed = true;
    console.error('[domain-deps] ✗ 新增了未登记的宿主依赖（账本里没有的新债）：');
    for (const v of added) {
      console.error(`[domain-deps]   ${v.file} · ${v.symbol}（${v.kind}）× ${v.count}`);
    }
    console.error(`[domain-deps]   处理：把领域层改成不依赖它；确实要留就登记进 ${LEDGER_PATH}。`);
  }

  if (exceeded.length > 0) {
    failed = true;
    console.error('[domain-deps] ✗ 欠账在长大（超出了账本记的上限）：');
    for (const { violation, maxCount } of exceeded) {
      console.error(
        `[domain-deps]   ${violation.file} · ${violation.symbol}（${violation.kind}）：上限 ${maxCount} 次，实际 ${violation.count} 次`
      );
    }
    console.error(`[domain-deps]   处理：改回不依赖它，或把 ${LEDGER_PATH} 里的上限改大（这是有意识的决定）。`);
  }

  if (stale.length > 0) {
    failed = true;
    console.error('[domain-deps] ✗ 账本里有已经还清的债（必须把条目删掉）：');
    for (const e of stale) {
      console.error(`[domain-deps]   ${e.file} · ${e.symbol}（${e.kind}）上限 ${e.maxCount} 次，现在找不到`);
    }
    console.error(`[domain-deps]   处理：把 ${LEDGER_PATH} 里对应的条目删掉 —— 账本只记「现在还欠着的」。`);
  }

  const evidence = {
    scannedRoot: result.scannedRoot,
    filesScanned: result.filesScanned,
    ledgerPath: LEDGER_PATH,
    violations: result.violations,
    baseline: ledger.entries,
    added,
    exceeded,
    stale,
    passed,
  };

  if (opts.writeEvidence ?? true) {
    const outPath = resolve(repoRoot, EVIDENCE_PATH);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf-8');
    console.log(`[domain-deps] 证据已写入：${EVIDENCE_PATH}`);
  }

  if (failed) {
    console.error('[domain-deps] ✗ 领域层零依赖检查未通过 —— 阻断');
    return 1;
  }

  console.log(
    `[domain-deps] ✓ 领域层没有新增的宿主依赖；已登记的欠账 ${result.violations.length} 条，都在账本上限之内`
  );
  return 0;
}

if (import.meta.main) {
  const code = await main();
  process.exit(code);
}
