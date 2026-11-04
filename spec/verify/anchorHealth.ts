/**
 * 注入证据的**对账** —— 这批用例现在还跑得起来吗？
 * ---------------------------------------------------------------------------
 * 「验证器抓得住这个错」是一条**跑批那一刻**的结论。跑完之后实现被改了，
 * 锚点可能已经失配 —— 那条结论就**连重跑都跑不出来**了。
 *
 * 实测（2026-11-05）：质量引擎把扣分幅度搬进规则表之后，
 * 8 条 AC-QLT-* 注入用例的锚点全部失配。
 * 而全量报告里写着的仍然是「88 个注入用例，不合格 0 个」——
 * **报告说全绿，其中 8 条其实一条都跑不起来**。
 * 追溯矩阵照抄这句话，整条证据链看上去毫无破绽。
 *
 * 这跟本项目一直在治的病是同一个：
 *   · 「没跑过的验证不是通过」
 *   · 「跑过但已经不是当前代码的验证，也不能当成当前的结论」
 *   · 「**报过但现在跑不起来的验证，连报都没报过**」 ← 这一条
 *
 * 所以这里做一次**静态**对账（不注入、不起服务、不开浏览器，毫秒级）：
 *   · 定义里有、报告里没有 → 这条用例还没进过全量证据
 *   · 报告里有、定义里没有 → 报告里多了孤儿（定义被删/改名了）
 *   · 两边都有但锚点失配   → 这条结论现在**跑不出来**
 *
 * 纯逻辑与文件读写分开：判定只吃一个「读文件」的函数，
 * 于是整套语义可以在临时目录里被完整测一遍。
 */

/** 一条注入用例的定义（来自 spec/verify/mutation-check.ts 的 MUTATIONS） */
export interface MutationDefinition {
  criterion: string;
  description: string;
  file: string;
  find: string;
  extraEdits?: Array<{ file?: string; find: string; replace: string }>;
}

/** 报告里的一条结论（来自 spec/evidence/mutation-report.json） */
export interface ReportCase {
  criterion: string;
  description: string;
  mutated_file: string;
}

/**
 * 锚点的健康状况。
 *
 * - `ok`            —— 锚点还在，且**只出现一次**（注入会落在唯一的那个位置）
 * - `missing`       —— 锚点找不到了（实现改了，这段文本没了）
 * - `ambiguous`     —— 锚点出现多次（注入只会落到第一处，可能与被测路径无关）
 * - `file-missing`  —— 被改动的文件不在树里了
 */
export type AnchorStatus = 'ok' | 'missing' | 'ambiguous' | 'file-missing';

export interface AnchorCheck {
  criterion: string;
  description: string;
  file: string;
  status: AnchorStatus;
  /** 出问题的那一段锚点原文（健康时为 null） */
  anchor: string | null;
  /** 说人话的理由 */
  detail: string;
}

/** 读一个仓库相对路径下的文件 —— 读不到返回 null */
export type ReadFile = (relPath: string) => string | null;

/** 统计子串出现次数 */
export function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

/** 一条定义里的全部锚点 —— 主锚点 + 附加锚点 */
export function anchorsOf(def: MutationDefinition): Array<{ file: string; text: string }> {
  return [
    { file: def.file, text: def.find },
    ...(def.extraEdits ?? []).map((e) => ({ file: e.file ?? def.file, text: e.find })),
  ];
}

/**
 * 检查一条定义的锚点还在不在、是不是唯一的。
 *
 * 判定规则跟注入检查本身**一致**（那里也是：锚点必须命中，且必须唯一）——
 * 两处规则不一样的话，这个检查就会说「跑得起来」而实际跑不起来。
 */
export function checkAnchors(
  def: MutationDefinition,
  read: ReadFile
): AnchorCheck {
  for (const a of anchorsOf(def)) {
    const content = read(a.file);
    if (content === null) {
      return {
        criterion: def.criterion,
        description: def.description,
        file: a.file,
        status: 'file-missing',
        anchor: a.text,
        detail: `被改动的文件不在树里了：${a.file}`,
      };
    }
    const count = countOccurrences(content, a.text);
    if (count === 0) {
      return {
        criterion: def.criterion,
        description: def.description,
        file: a.file,
        status: 'missing',
        anchor: a.text,
        detail: `${a.file} 里找不到待替换文本 —— 注入执行不了，这条用例现在跑不起来`,
      };
    }
    if (count > 1) {
      return {
        criterion: def.criterion,
        description: def.description,
        file: a.file,
        status: 'ambiguous',
        anchor: a.text,
        detail: `${a.file} 里该文本出现 ${count} 次 —— 注入只会落到第一处，这条用例现在跑不对`,
      };
    }
  }
  return {
    criterion: def.criterion,
    description: def.description,
    file: def.file,
    status: 'ok',
    anchor: null,
    detail: '锚点命中且唯一',
  };
}

/** 定义与报告的对账结果 */
export interface Reconciliation {
  /** 定义里的用例总数 */
  defined: number;
  /** 报告里的用例总数 */
  reported: number;
  /** 定义里有、报告里没有 —— 还没进过全量证据 */
  notInReport: Array<{ criterion: string; description: string }>;
  /** 报告里有、定义里没有 —— 报告里的孤儿条目 */
  orphanInReport: Array<{ criterion: string; description: string }>;
  /** 逐条的锚点健康状况 */
  checks: AnchorCheck[];
  /** 现在跑不起来的那些 */
  broken: AnchorCheck[];
  /** 报告里、但现在跑不起来的那几条（这些结论是**确定不成立**的） */
  brokenAndReported: AnchorCheck[];
}

/** 用例的匹配键 —— 判据 + 描述（同一个判据可能有多条用例） */
function keyOf(criterion: string, description: string): string {
  return `${criterion}::${description}`;
}

/**
 * 定义 ↔ 报告 ↔ 当前代码，三方对账。
 *
 * @param defs    当前的注入用例定义
 * @param reported 全量报告里的用例
 * @param read    读文件的函数
 */
export function reconcile(
  defs: readonly MutationDefinition[],
  reported: readonly ReportCase[],
  read: ReadFile
): Reconciliation {
  const reportedKeys = new Set(reported.map((c) => keyOf(c.criterion, c.description)));
  const definedKeys = new Set(defs.map((d) => keyOf(d.criterion, d.description)));

  const notInReport = defs
    .filter((d) => !reportedKeys.has(keyOf(d.criterion, d.description)))
    .map((d) => ({ criterion: d.criterion, description: d.description }));

  const orphanInReport = reported
    .filter((c) => !definedKeys.has(keyOf(c.criterion, c.description)))
    .map((c) => ({ criterion: c.criterion, description: c.description }));

  const checks = defs.map((d) => checkAnchors(d, read));
  const broken = checks.filter((c) => c.status !== 'ok');
  const brokenAndReported = broken.filter((c) => reportedKeys.has(keyOf(c.criterion, c.description)));

  return {
    defined: defs.length,
    reported: reported.length,
    notInReport,
    orphanInReport,
    checks,
    broken,
    brokenAndReported,
  };
}

/**
 * 把对账结果渲染成追溯矩阵里的一节。
 *
 * 单独抽出来是为了**可测**：说清「哪些结论不能算数」这件事，
 * 跟判定本身一样要紧 —— 一句含糊的话能让整节证据重新变成自证。
 *
 * @param rec 对账结果
 */
export function renderReconciliationSection(rec: Reconciliation): string[] {
  if (rec.defined === 0 && rec.reported === 0) {
    return ['当前代码里没有定义注入用例，报告里也没有 —— 这一节没有内容。'];
  }

  const lines: string[] = [];
  lines.push(
    `当前代码里定义了 **${rec.defined}** 条注入用例，全量报告里有 **${rec.reported}** 条。`
  );

  if (
    rec.broken.length === 0 &&
    rec.notInReport.length === 0 &&
    rec.orphanInReport.length === 0
  ) {
    lines.push('');
    lines.push(
      `> 全部 ${rec.defined} 条都在报告里，锚点**命中且唯一** —— 现在重跑还跑得起来，报告里的结论没有过期。`
    );
    return lines;
  }

  if (rec.broken.length > 0) {
    lines.push('');
    lines.push(
      `**${rec.broken.length} 条现在跑不起来**（锚点失配 = 注入执行不了，这条用例连重跑都重跑不出来）：`
    );
    lines.push('');
    lines.push('| 判据 | 注入的错误 | 文件 | 原因 |');
    lines.push('|---|---|---|---|');
    for (const b of rec.broken) {
      lines.push(`| ${b.criterion} | ${b.description} | \`${b.file}\` | ${b.detail} |`);
    }
  }

  if (rec.brokenAndReported.length > 0) {
    lines.push('');
    lines.push(
      `> ⚠️ 其中 **${rec.brokenAndReported.length} 条在报告里有结论** —— 报告里「不合格 0 个」对这些条**不能算数**：它们根本跑不起来，「验证器抓得住这个错」从来就没人验证过。`
    );
  }

  if (rec.notInReport.length > 0) {
    lines.push('');
    lines.push(
      `**${rec.notInReport.length} 条定义了但还没进过全量证据**（报告里没有它们的结论）：`
    );
    lines.push('');
    for (const n of rec.notInReport) {
      const chk = rec.checks.find(
        (c) => c.criterion === n.criterion && c.description === n.description
      );
      const tail = chk && chk.status !== 'ok' ? '（而且锚点已经失配，现在也跑不起来）' : '';
      lines.push(`- \`${n.criterion}\` ${n.description}${tail}`);
    }
  }

  if (rec.orphanInReport.length > 0) {
    lines.push('');
    lines.push(
      `**${rec.orphanInReport.length} 条报告里有、当前定义里没有**（孤儿 —— 定义被删掉或改名了，报告里那条结论无从核对）：`
    );
    lines.push('');
    for (const o of rec.orphanInReport) {
      lines.push(`- \`${o.criterion}\` ${o.description}`);
    }
  }

  if (rec.broken.length > 0) {
    lines.push('');
    lines.push(
      '> 跑不起来的用例，它的结论一律不算数 —— **报过但现在跑不起来的验证，连报都没报过**。'
    );
  }
  if (rec.notInReport.length > 0) {
    lines.push('');
    lines.push(
      '> 还没进过全量证据的用例，同样不能算「验证器抓得住错」—— **没人跑过它们**。'
    );
  }

  return lines;
}

/**
 * 一句话限定语 —— 给「注入检查：N 个用例，不合格 M 个」这种汇总句加尾巴。
 *
 * 锚点全好时返回空串（不啰嗦）；有跑不起来的时候必须说清楚，
 * 否则汇报口径里那句「不合格 0 个」会被当成对**当前**代码的结论。
 */
export function reconciliationQualifier(rec: Reconciliation): string {
  if (rec.brokenAndReported.length === 0) return '';
  const n = rec.brokenAndReported.length;
  return ` —— 但其中 **${n} 条现在跑不起来**（锚点失配），这 ${n} 条的「不合格 0 个」**不能算数**（见 §2.4.2）`;
}
