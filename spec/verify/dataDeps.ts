/**
 * 验证器的**数据依赖** —— 它运行时从磁盘读、而不是 import 进来的那些文件。
 * ---------------------------------------------------------------------------
 * 依赖闭包是按 import 扫的 —— 代码扫得到，**运行时读的数据文件扫不到**。
 * 最典型的是黄金快照基线（`packages/core/tests/__snapshots__/*.json`）：
 * 那 64 个 JSON 是测试运行时 `readFile` 读进来的。
 *
 * 后果（实测 2026-11-05）：
 *   跑批 → 证据落地 → 有人刷新了快照基线（`gen-layout-snapshots.ts --force`）
 *     ↓
 *   闭包里没有那些 JSON，判定看不见它们被动过
 *     ↓
 *   矩阵照旧写「98 条结论全部仍然成立」
 *
 * 所以验证器文件可以**显式声明**自己还依赖哪些数据文件：
 *
 *     // @verdict-deps: packages/core/tests/__snapshots__
 *
 * 路径是**仓库相对路径**，可以是文件，也可以是目录（目录取其下所有文件）。
 * 声明写在**读它的那份代码旁边** —— 不写在别处，就不会忘记更新。
 *
 * ── 为什么单独成一个模块 ──────────────────────────────────────────────────
 *
 * 新鲜度判定有**两处**，它们必须用**同一套**「怎么找数据依赖」的规则：
 *
 *   · 主证据侧（§2.1.1）—— `verdictFreshness.ts` 判一条 PASS 是否还对当前代码成立
 *   · 注入侧（§2.4.1）—— `evidenceFreshness.ts` 判「验证器抓得住这个错」是否还成立
 *
 * 实测（2026-11-05）：改了**一个**黄金快照基线，主证据侧判 **stale**，
 * 注入侧却判 **fresh** —— 同一个改动，两个地方说两套话。
 * 而 `AC-GOV-002` 那条注入用例**正是靠这 64 个基线抓住错误的**：
 * 基线被动过之后，「验证器抓得住这个错」可能已经不成立，注入侧却说「仍然成立」。
 *
 * 规则只有一份，两边共用 —— 否则修好了一边，另一边还会自己漂走。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/** 数据依赖的声明前缀 */
export const DATA_DEP_DIRECTIVE = '@verdict-deps:';

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

/** 一个验证器的数据依赖：声明了什么、展开成哪些文件 */
export interface DataDeps {
  /** 验证器里声明的路径（原文） */
  declared: string[];
  /** 展开后的文件清单（仓库相对，已排序） */
  files: string[];
}

/**
 * 读一个验证器文件，得出它的数据依赖。
 *
 * 读不到文件 → 没有声明（空）。**不是**「未知」——
 * 读不到验证器文件这件事，由调用方自己判（文件不在树里是另一回事）。
 *
 * @param verifierFile 验证器文件（仓库相对）
 * @param read         读文件；读不到返回 null
 * @param exists       判断路径在不在树里
 * @param listDir      列目录下的文件（仓库相对路径）；不是目录就返回空数组
 */
export function dataDepsOf(
  verifierFile: string,
  read: (rel: string) => string | null,
  exists: (rel: string) => boolean,
  listDir: (rel: string) => string[]
): DataDeps {
  const content = read(verifierFile);
  const declared = content === null ? [] : parseDataDeps(content);
  return { declared, files: expandDataDeps(declared, exists, listDir) };
}

// ---------------------------------------------------------------------------
// 带 IO 的那一半 —— 上面是规则，这里是「怎么在真实的仓库里落地」
// ---------------------------------------------------------------------------

/**
 * 列出一个仓库相对目录下的全部文件（递归，仓库相对路径）。
 *
 * 不是目录 / 不存在 → 空数组。
 */
export function listFilesUnder(root: string, rel: string): string[] {
  const out: string[] = [];
  let entries;
  try {
    entries = readdirSync(resolve(root, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) out.push(...listFilesUnder(root, child));
    else out.push(child);
  }
  return out.sort();
}

/**
 * 一个验证器的数据依赖 —— **连 IO 的**便捷版。
 *
 * @param root         仓库根目录
 * @param verifierFile 验证器文件（仓库相对）
 */
export function dataDepsOfFile(root: string, verifierFile: string): DataDeps {
  return dataDepsOf(
    verifierFile,
    (rel) => {
      try {
        return readFileSync(resolve(root, rel), 'utf-8');
      } catch {
        return null;
      }
    },
    (rel) => {
      try {
        statSync(resolve(root, rel));
        return true;
      } catch {
        return false;
      }
    },
    (rel) => listFilesUnder(root, rel)
  );
}
