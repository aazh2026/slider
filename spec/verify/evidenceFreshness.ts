/**
 * 注入结论的**新鲜度** —— 这批结论还对当前代码成立吗？
 * ---------------------------------------------------------------------------
 * 「验证器抓得住这个错」不是一句永远成立的话，它是**某一版**验证器与
 * **某一版**实现之间的结论。跑完之后只要动过其中任何一边，这条结论
 * 就不再自动适用于当前代码 —— 而报告若不留下凭据，读者根本看不出来。
 *
 * 实测（2026-11-05）：一份 88 条、全绿的注入报告，在生成后的 20 分钟里
 * 就有 21 个源文件、1 个验证器被改过 —— **67 条结论已经对不上当前代码**。
 * 报告里写着「不合格 0 个」，追溯矩阵里写着「88 个注入用例，不合格 0 个」，
 * 读的人完全看不出这批结论已经过期。
 *
 * 这正是本项目一直在治的那个病，只是换了个马甲：
 *   · 「没跑过的验证不是通过」  —— 没跑
 *   · 「跑过但已经不是当前代码的验证，也不能当成当前的结论」 —— 跑过，但过期
 *
 * 所以报告里记下**文件指纹**（sha256），跑完之后逐条比对：
 *   · 指纹一致     → fresh     结论对当前代码仍然成立
 *   · 指纹不一致   → stale     验证器或被改的源文件在跑批之后被改过
 *   · 文件不见了   → missing   结论指向的文件已经不在树里
 *   · 报告没记指纹 → unknown   老格式报告，说不清对应哪一版代码
 *
 * **unknown 不等于 fresh** —— 说不出新鲜度，就不能说它成立。
 *
 * ── 数据依赖：光比代码是不够的 ─────────────────────────────────────────────
 *
 * 上面比的是「验证器」与「被改的源文件」两份**代码**。
 * 可有些验证器还依赖**运行时从磁盘读的数据文件** ——
 * 最典型的是黄金快照基线（`packages/core/tests/__snapshots__/*.json`）。
 *
 * 实测（2026-11-05）：改了**一个**黄金快照基线之后，
 *   · 主证据侧（§2.1.1，`verdictFreshness.ts`）判 **stale** —— 它看得见数据依赖；
 *   · 注入侧（本文件）判 **fresh**  —— 它只比代码，**看不见数据**。
 *
 * 同一个改动，两个地方说两套话。而 `AC-GOV-002` 那条注入用例
 * **正是靠这 64 个基线抓住错误的** —— 基线被动过之后，
 * 「验证器抓得住这个错」可能已经不成立，注入侧却说「仍然成立」。
 *
 * 所以报告里也要记下**数据依赖**的指纹，判定时一并比：
 *   · 数据依赖变了     → stale     （跟代码一样，是确定的）
 *   · 报告没记数据依赖 → unknown   （说清不了，就不能说它成立）
 *
 * 「怎么找数据依赖」的规则住在 `spec/verify/dataDeps.ts` —— 主证据侧共用同一套，
 * 否则同一个改动两边又会漂开。
 *
 * 纯逻辑与文件读写分开：判定函数只吃「当前指纹表」，
 * 于是整套语义可以在临时目录里被完整测一遍。
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** 一条注入结论 + 它在跑批时对应的文件指纹 */
export interface FingerprintedCase {
  /** 判据 ID */
  criterion: string;
  /** 承载该判据的验证器文件（相对仓库根） */
  verifierFile: string;
  /** 被改动的源文件（相对仓库根） */
  sourceFile: string;
  /** 跑批时验证器文件的 sha256（旧报告没有 → null） */
  verifierSha256?: string | null;
  /** 跑批时被改源文件的 sha256（旧报告没有 → null） */
  sourceSha256?: string | null;
  /**
   * 验证器**现在**依赖的数据文件清单（由调用方解析 `// @verdict-deps:` 并展开目录得到）。
   * 空数组 / 不给 = 这个验证器没有声明数据依赖。
   */
  dataDepFiles?: string[];
  /**
   * 跑批时记下的**数据依赖**指纹：路径 → sha256。
   *
   * `undefined` = 报告是旧格式，没记过数据依赖 —— 此时只要验证器**声明了**
   * 数据依赖，这条结论就判 **unknown**（说清不了），不能当成 fresh。
   */
  dataSha256?: Record<string, string | null>;
}

export type FreshnessVerdict = 'fresh' | 'stale' | 'file-missing' | 'unknown';

export interface Freshness {
  verdict: FreshnessVerdict;
  /** 变了的那些边：验证器 / 被改的源文件 / 数据依赖 */
  changed: Array<'verifier' | 'source' | 'data'>;
  /** 说人话的理由 */
  reason: string;
}

/** 文件内容的 sha256 */
export function sha256Of(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * 读当前文件并算指纹 —— 文件不在了就是 null。
 *
 * @param root 仓库根目录
 */
export function currentFingerprints(
  root: string,
  files: Iterable<string>
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const file of files) {
    try {
      out.set(file, sha256Of(readFileSync(resolve(root, file), 'utf-8')));
    } catch {
      out.set(file, null);
    }
  }
  return out;
}

/**
 * 判定一条注入结论的新鲜度
 * ---------------------------------------------------------------------------
 * @param c       结论与它的指纹
 * @param current 当前各文件的指纹（读不到 → null）
 */
export function assessCase(
  c: FingerprintedCase,
  current: ReadonlyMap<string, string | null>
): Freshness {
  // 报告没记指纹 → 说不出对应哪一版代码。
  // **不能当成 fresh** —— 「说不清」和「成立」是两回事。
  if (!c.verifierSha256 || !c.sourceSha256) {
    return {
      verdict: 'unknown',
      changed: [],
      reason: '报告没有记录文件指纹 —— 这条结论对应的是哪一版代码，说不清',
    };
  }

  const verifierNow = current.get(c.verifierFile);
  const sourceNow = current.get(c.sourceFile);

  if (verifierNow === null || verifierNow === undefined) {
    return {
      verdict: 'file-missing',
      changed: [],
      reason: `验证器文件不在树里了：${c.verifierFile}`,
    };
  }
  if (sourceNow === null || sourceNow === undefined) {
    return {
      verdict: 'file-missing',
      changed: [],
      reason: `被改动的源文件不在树里了：${c.sourceFile}`,
    };
  }

  const changed: Array<'verifier' | 'source' | 'data'> = [];
  if (verifierNow !== c.verifierSha256) changed.push('verifier');
  if (sourceNow !== c.sourceSha256) changed.push('source');

  // ---- 数据依赖 ----
  //
  // 验证器运行时读的文件（黄金快照基线之类）也是它的依赖 ——
  // 那些文件被动过之后，「验证器抓得住这个错」可能已经不成立。
  //
  // 比的是**当前声明 ∩ 跑批时记过**的那些：
  //   · 两边都有 → 比指纹，变了就是 stale
  //   · 跑批时没记 → unknown（报告是旧格式，说清不了）
  //   · 现在不声明了 → 验证器已经不读它了，不影响结论，不算过期
  const declared = c.dataDepFiles ?? [];
  const dataChanged: string[] = [];
  const dataUnknown: string[] = [];

  if (declared.length > 0 && c.dataSha256 === undefined) {
    // 报告没记数据依赖的指纹 —— 说清不了它对应的是哪一版数据。
    return {
      verdict: 'unknown',
      changed,
      reason:
        '报告没有记录数据依赖的指纹 —— 这条结论还依赖 ' +
        `${declared.join('、')}，说清它对应的是哪一版数据`,
    };
  }

  for (const dep of declared) {
    const recorded = c.dataSha256?.[dep];
    if (recorded === undefined) {
      dataUnknown.push(dep);
      continue;
    }
    const now = current.get(dep);
    if (now === null || now === undefined) {
      return {
        verdict: 'file-missing',
        changed,
        reason: `数据依赖文件不在树里了：${dep}`,
      };
    }
    if (now !== recorded) dataChanged.push(dep);
  }

  if (dataChanged.length > 0) changed.push('data');

  if (changed.length > 0) {
    const what = changed
      .map((k) =>
        k === 'verifier' ? '验证器' : k === 'source' ? '被改动的源文件' : '数据依赖'
      )
      .join('与');
    const extra = dataChanged.length > 0 ? `（${dataChanged.join('、')}）` : '';
    return {
      verdict: 'stale',
      changed,
      reason: `${what}在跑批之后被改过${extra} —— 这条结论对应的是旧版本`,
    };
  }

  if (dataUnknown.length > 0) {
    return {
      verdict: 'unknown',
      changed: [],
      reason: `报告没有记录这些数据依赖的指纹：${dataUnknown.join('、')} —— 说清不了`,
    };
  }

  return {
    verdict: 'fresh',
    changed: [],
    reason: '验证器、被改动的源文件与数据依赖都和跑批时一致',
  };
}

export interface FreshnessSummary {
  /** 一共多少条 */
  total: number;
  fresh: number;
  stale: number;
  missing: number;
  unknown: number;
  /** 已过期的判据（去重、排序） */
  staleCriteria: string[];
  /** 说不出新鲜度的判据（去重、排序） */
  unknownCriteria: string[];
  /** 已过期的逐条明细 */
  staleDetails: Array<{
    criterion: string;
    verifierFile: string;
    sourceFile: string;
    changed: Array<'verifier' | 'source' | 'data'>;
    reason: string;
  }>;
}

/** 汇总一批结论的新鲜度 */
export function summarize(
  cases: readonly FingerprintedCase[],
  current: ReadonlyMap<string, string | null>
): FreshnessSummary {
  const summary: FreshnessSummary = {
    total: cases.length,
    fresh: 0,
    stale: 0,
    missing: 0,
    unknown: 0,
    staleCriteria: [],
    unknownCriteria: [],
    staleDetails: [],
  };

  const staleSet = new Set<string>();
  const unknownSet = new Set<string>();

  for (const c of cases) {
    const f = assessCase(c, current);
    if (f.verdict === 'fresh') summary.fresh++;
    else if (f.verdict === 'stale') {
      summary.stale++;
      staleSet.add(c.criterion);
      summary.staleDetails.push({
        criterion: c.criterion,
        verifierFile: c.verifierFile,
        sourceFile: c.sourceFile,
        changed: f.changed,
        reason: f.reason,
      });
    } else if (f.verdict === 'file-missing') summary.missing++;
    else {
      summary.unknown++;
      unknownSet.add(c.criterion);
    }
  }

  summary.staleCriteria = [...staleSet].sort();
  summary.unknownCriteria = [...unknownSet].sort();
  return summary;
}

// ---------------------------------------------------------------------------
// 落到纸面上的措辞
// ---------------------------------------------------------------------------
//
// 判定语义在上面，**措辞**在这里 —— 两者放在一起，是因为措辞本身就是要被
// 审的东西：「说清不了」不能写成「成立」，「跑的时候」不能写成「现在」。
// 写成纯函数，才能被缺陷回放测住，而不是只在生成器里跑过一次。

/**
 * 追溯矩阵 §2.4.1「这批结论还对当前代码成立吗」这一节的文字。
 *
 * @param f           新鲜度汇总
 * @param generatedAt 报告生成时间（人话）
 */
export function renderFreshnessSection(f: FreshnessSummary, generatedAt: string): string[] {
  const out: string[] = [];

  out.push(
    `注入报告生成于 ${generatedAt}。` +
      '「验证器抓得住这个错」是**某一版**验证器与**某一版**实现之间的结论 —— ' +
      '跑完之后动过其中任何一边，这条结论就不再自动适用于当前代码。' +
      '下面按报告里记下的文件指纹逐条比对。'
  );
  out.push('');

  if (f.total === 0) {
    out.push('> 注入报告里没有用例 —— 没有结论可谈。');
  } else if (f.unknown === f.total) {
    out.push(
      `> ⚠️ **这份报告没有记录文件指纹** —— 说清不了这 ${f.total} 条结论对应的是哪一版代码。` +
        '**说清不了，就不能说它成立**：上表的「不合格 0 个」只说明**跑的时候**成立，' +
        '不说明对**当前**代码成立。重跑一次 `bun run spec/verify/mutation-check.ts` 之后，' +
        '这一节会逐条给出结论。'
    );
  } else if (f.stale > 0 || f.missing > 0) {
    out.push(
      `> 逐条比对了跑批时的文件指纹与当前的文件内容：**${f.fresh} 条仍然成立**，` +
        `**${f.stale} 条已过期**（验证器、被改的源文件或数据依赖在跑批之后被改过），` +
        `${f.missing} 条指向的文件已经不在树里。` +
        (f.unknown > 0 ? `另有 ${f.unknown} 条说清不了（报告没记指纹）。` : '')
    );
    out.push('');
    if (f.staleDetails.length > 0) {
      out.push('| 判据 | 验证器 | 被改动的源文件 | 变了哪边 |');
      out.push('|---|---|---|---|');
      for (const d of f.staleDetails) {
        const side = d.changed
          .map((c) => (c === 'verifier' ? '验证器' : c === 'source' ? '源文件' : '数据依赖'))
          .join('、');
        out.push(`| ${d.criterion} | \`${d.verifierFile}\` | \`${d.sourceFile}\` | ${side} |`);
      }
      out.push('');
    }
    out.push(
      '> **已过期的行不能当成对当前代码的证明** —— 它们只说明「那一版的验证器抓得住那一版的错」。' +
        '要让它们重新成立，重跑一次注入检查即可。'
    );
  } else {
    out.push(
      `> 逐条比对了跑批时的文件指纹与当前的文件内容：**${f.fresh} 条全部仍然成立**` +
        '（验证器、被改动的源文件与数据依赖都和跑批时一致）。'
    );
  }

  return out;
}

/**
 * 「实际验证了什么」那一条里，注入结论的一句话限定语。
 *
 * 单说「88 个注入用例，不合格 0 个」说不出范围 —— 那是**跑批那一刻**的结论。
 * 这句话必须带上「对当前代码还有几条成立」。
 */
export function freshnessQualifier(f: FreshnessSummary): string {
  if (f.total === 0) return '';

  // 说不出新鲜度时，措辞必须落在「说清不了」上，**不能落在「成立」上**。
  if (f.unknown === f.total) {
    return (
      ' —— 但**说清不了这批结论对应的是哪一版代码**（报告没记文件指纹）：' +
      '只说明**跑的时候**成立，不说明对**当前**代码成立（见 §2.4.1）'
    );
  }

  const parts = [`对**当前代码**仍然成立 **${f.fresh}** 条`, `已过期 **${f.stale}** 条`];
  if (f.missing > 0) parts.push(`指向的文件已不在树里 **${f.missing}** 条`);
  if (f.unknown > 0) parts.push(`说清不了 **${f.unknown}** 条`);
  return ` —— 其中${parts.join('、')}（见 §2.4.1）`;
}
