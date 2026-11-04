/**
 * 证据集对账 —— **判据之外的用例也得有说法**
 * ---------------------------------------------------------------------------
 * 缺陷回放（2026-11-05）：
 *
 *   追溯矩阵 §2.2「失败明细」只列**挂了判据**的失败。
 *   一次跑批 337 个用例里，只有 98 个被某条判据点名；
 *   另外 239 个用例要是挂了 —— §2.2 会照常写「（无）」，
 *   而**是哪个用例挂了**，全报告没有第二处提。
 *
 *   （报告的「实际验证了什么」那节给的是**计数**：N 个用例、M 失败。
 *   计数说得出"有失败"，但说不出"哪个失败" ——
 *   而读者查失败时翻的正是「失败明细」那一节，那里说「没有」。）
 *
 *   流水线的退出码会拦（bun test 挂了 → 退出码 1），
 *   但报告是给人读的 —— 报告说绿，读者就不会去看退出码。
 *
 * 所以这里把整个证据集摊开对账：
 *   · 多少用例挂了判据、多少没挂；
 *   · 没挂判据的用例里有没有失败的 —— 有就**逐条点名**；
 *   · 判据点名的验证目标有没有在证据集里找不到。
 *
 * 纯函数、无副作用 —— 这样才能给它写「缺陷回放」用例。
 */

/** 证据集里的一个用例（与 junit.ts 的 JunitCase 同形） */
export interface LedgerCase {
  /** 用例名 */
  name: string;
  /** 用例所在的文件（仓库相对路径） */
  file: string;
  /** 是否失败 */
  failed: boolean;
  /** 来自哪一份 junit */
  evidence: string;
}

/** 一个失败 —— 不管它挂没挂判据 */
export interface LedgerFailure {
  file: string;
  name: string;
  evidence: string;
}

/** 一层证据（一份 junit） */
export interface LedgerLayer {
  /** 证据文件名 */
  evidence: string;
  total: number;
  failed: number;
}

/** 证据集对账的结果 */
export interface EvidenceLedger {
  /** 各层证据的规模 */
  layers: LedgerLayer[];
  /** 用例总数 */
  total: number;
  /** 被某条判据点名的用例数 */
  mapped: number;
  /** 没有判据点名的用例数 */
  unmapped: number;
  /** 证据集里的失败总数 */
  failed: number;
  /** 挂了判据的失败数 */
  mappedFailed: number;
  /** **没挂判据的失败** —— 它们以前在报告里是隐形的 */
  unmappedFailures: LedgerFailure[];
  /** 判据点名的验证目标总数（去重后） */
  targetsTotal: number;
  /** 点名了、但在这轮证据集里找不到的验证目标 */
  targetsNotFound: string[];
}

/** 用例的唯一标识 —— 与 spec.yaml 里 `target: "文件::用例名"` 的格式一致 */
export function caseKey(file: string, name: string): string {
  return `${file}::${name}`;
}

/**
 * 对账：把证据集里的用例与判据点名的验证目标对上。
 *
 * @param cases   这一轮的全部用例（两层证据合在一起）
 * @param targets 判据点名的验证目标，形如 `文件::用例名`
 */
export function buildEvidenceLedger(
  cases: LedgerCase[],
  targets: Iterable<string>
): EvidenceLedger {
  const targetSet = new Set(targets);
  const targetList = [...targetSet];

  // 各层证据的规模 —— 按证据文件归并，顺序按第一次出现的先后
  const layerMap = new Map<string, LedgerLayer>();
  for (const c of cases) {
    let layer = layerMap.get(c.evidence);
    if (!layer) {
      layer = { evidence: c.evidence, total: 0, failed: 0 };
      layerMap.set(c.evidence, layer);
    }
    layer.total += 1;
    if (c.failed) layer.failed += 1;
  }

  let mapped = 0;
  let unmapped = 0;
  let mappedFailed = 0;
  const unmappedFailures: LedgerFailure[] = [];
  const hitKeys = new Set<string>();

  for (const c of cases) {
    const key = caseKey(c.file, c.name);
    const isMapped = targetSet.has(key);
    if (isMapped) {
      mapped += 1;
      hitKeys.add(key);
    } else {
      unmapped += 1;
    }
    if (c.failed) {
      if (isMapped) mappedFailed += 1;
      else unmappedFailures.push({ file: c.file, name: c.name, evidence: c.evidence });
    }
  }

  const targetsNotFound = targetList.filter((t) => !hitKeys.has(t)).sort();

  return {
    layers: [...layerMap.values()],
    total: cases.length,
    mapped,
    unmapped,
    failed: mappedFailed + unmappedFailures.length,
    mappedFailed,
    unmappedFailures,
    targetsTotal: targetList.length,
    targetsNotFound,
  };
}

/**
 * §2.1 里的「证据集对账」那几行
 *
 * @param l        对账结果
 * @param failCrit 上表「FAIL」那一行的**判据数**
 *
 * **为什么这个数要传进来**：表里的 FAIL 数的是**判据**，
 * 账本里的 `mappedFailed` 数的是**失败用例** ——
 * 两条判据共用同一个验证目标时，同一个失败会让表里记 2、账本里记 1。
 * 报告里引用哪个数，得跟表里那个一致，否则「上表的 FAIL N」会跟表对不上。
 */
export function renderLedgerSummary(l: EvidenceLedger, failCrit: number = l.mappedFailed): string[] {
  const out: string[] = [];

  const layerText = l.layers.map((x) => `${x.evidence} ${x.total}`).join(' + ');
  out.push(
    `> **证据集对账**：这轮证据集共 ${l.total} 个用例（${layerText}），` +
      `其中 ${l.mapped} 个被某条判据点名、${l.unmapped} 个没有。`
  );

  if (l.unmappedFailures.length === 0) {
    out.push(
      `> 没有判据的 ${l.unmapped} 个用例里 **${l.unmappedFailures.length} 个失败** —— ` +
        `上表的「FAIL ${failCrit}」不是漏报：它们也都过了。`
    );
  } else {
    out.push(
      `> **没有判据的 ${l.unmapped} 个用例里有 ${l.unmappedFailures.length} 个失败** —— ` +
        `上表的「FAIL ${failCrit}」只数挂了判据的失败，` +
        `这 ${l.unmappedFailures.length} 个在 §2.2「未挂判据的失败」里逐条点名。`
    );
  }

  if (l.targetsNotFound.length > 0) {
    out.push(
      `> 判据点名的 ${l.targetsTotal} 个验证目标里，**${l.targetsNotFound.length} 个在这轮证据集里没找到**` +
        `（${l.targetsNotFound.map((t) => `\`${t}\``).join('、')}）—— ` +
        `挂不上验证目标的判据一律 INCONCLUSIVE，绝不按「通过」算（§2.5）。`
    );
  }

  return out;
}

/** §2.2 里的「未挂判据的失败」那一小节 */
export function renderUnmappedFailures(l: EvidenceLedger): string[] {
  const out: string[] = [];

  if (l.unmappedFailures.length === 0) {
    out.push(
      `（无）—— 没有判据的 ${l.unmapped} 个用例也全都过了。` +
        `这一节存在的意义是：**「没有失败」得说得出依据**，不能靠「没列」来暗示。`
    );
    return out;
  }

  out.push('| 文件 | 用例 | 出处 |');
  out.push('|---|---|---|');
  for (const f of l.unmappedFailures) {
    out.push(`| \`${f.file}\` | ${f.name} | \`${f.evidence}\` |`);
  }
  out.push('');
  out.push(
    `> 这 ${l.unmappedFailures.length} 个失败**不挂在任何判据上** —— 它们是判据点名之外的用例，` +
      `但失败是实打实的失败，不能因为「没有判据认领」就不算数。` +
      `原始报错见 \`spec/evidence/junit-output.txt\`（单元 / 集成）与 ` +
      `\`spec/evidence/junit-e2e-output.txt\`（E2E）—— Bun 的 junit 只写失败类型、不写错误信息。`
  );
  return out;
}
