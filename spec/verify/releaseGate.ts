/**
 * 发布闸门 —— 这批结论**能不能放行**
 * ---------------------------------------------------------------------------
 * 追溯矩阵是**一份报告**：它记下每条条款的 PASS / FAIL / INCONCLUSIVE，
 * 但报告本身**不拦人**。
 *
 * 实测（2026-11-05）：一轮跑批里矩阵写着「PASS 64　FAIL 2　INCONCLUSIVE 1」，
 * 而流水线末尾「生成追溯矩阵」那一步仍然显示 **✅ 通过** ——
 * 读的人只看见一行绿。矩阵里的 FAIL 与流水线里的 FAIL 不是一回事：
 * 前者没有出口。
 *
 * 这跟本项目一直在治的病是同一个：
 *   · 「没跑过的验证不是通过」 —— INCONCLUSIVE 没人拦，就等于没人管
 *   · 「跑过但已经不是当前代码的验证，也不能当成当前的结论」
 *
 * 闸门的判据只有三条，且**故意从简** —— 宁可粗一点，也不要出现
 * 「规矩太细于是没人用」的局面：
 *
 *   ① **FAIL 一律阻断** —— 判据不满足就是不该放行。
 *      「已知欠账」不能拿来给 FAIL 开门：欠账是「还没做」，
 *      FAIL 是「做了但不对」—— 后者是回归，不是债。
 *   ② **INCONCLUSIVE 阻断，除非已登记为已知欠账** ——
 *      没跑过的验证不是通过；但**说得出为什么没做、打算什么时候做**的，
 *      那正是 `spec.yaml` 的 `known_gaps` —— 它就是欠账登记表。
 *   ③ **连判据都没有的条款**：若它已经明说「这条暂时不做」
 *      （`status` 不是 active）就放过；若它还是 active 又没登记 ——
 *      那是**悬空条款**，阻断（质量战略 波 3 ③：
 *      每条要么补判据、要么降级并写明原因）。
 *
 * 闸门只有两个出口：**放行**或**不放行**，理由逐条写清。
 * 纯逻辑（不含 IO）—— 于是整套判据能在几毫秒内被完整测一遍。
 */

/** 条款的判定结果 */
export type GateVerdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';

export interface GateClause {
  /** 条款 ID（如 SPEC-GOV-003） */
  id: string;
  /** 这条条款的判定结果 */
  verdict: GateVerdict;
  /** 这条条款**有没有判据** —— 没有就是「连要测什么都没确定」 */
  hasCriteria: boolean;
  /** 条款状态（active / blocked / withdrawn …）；没写按 active 算 */
  status?: string;
}

export interface GateInput {
  /** 全部条款的判定结果 */
  clauses: GateClause[];
  /** 已在 `spec.yaml` 的 `known_gaps` 里登记的条款 ID */
  knownGapClauses: string[];
}

/** 挡住放行的那一条 */
export interface BlockingClause {
  id: string;
  verdict: GateVerdict;
  /** 为什么它挡住放行 —— 说人话 */
  reason: string;
}

/** 放行但**说清楚为什么**的那一条 */
export interface ToleratedClause {
  id: string;
  verdict: GateVerdict;
  /** 为什么它没挡住放行 */
  why: string;
}

export interface GateResult {
  /** 挡住放行的条款 */
  blocking: BlockingClause[];
  /** 放行、但要说清楚原因的条款 */
  tolerated: ToleratedClause[];
  /** 能不能放行 —— 没有 blocking 才能放行 */
  canRelease: boolean;
}

/** 条款是不是「还写着要做」 */
function isActive(clause: GateClause): boolean {
  const s = (clause.status ?? 'active').trim().toLowerCase();
  return s === 'active' || s === '';
}

/**
 * 判一次放行。
 *
 * 三条判据见文件头的说明：
 *   ① FAIL 一律阻断；
 *   ② INCONCLUSIVE 阻断，除非登记为已知欠账；
 *   ③ 没有判据的条款：非 active 就放过，active 且没登记就阻断。
 */
export function evaluateReleaseGate(input: GateInput): GateResult {
  const gaps = new Set(input.knownGapClauses);
  const blocking: BlockingClause[] = [];
  const tolerated: ToleratedClause[] = [];

  for (const c of input.clauses) {
    if (c.verdict === 'PASS') continue;

    if (c.verdict === 'FAIL') {
      blocking.push({
        id: c.id,
        verdict: c.verdict,
        reason:
          '判据不通过 —— 实现不满足判据。' +
          '「已知欠账」不能拿来给 FAIL 开门：欠账是「还没做」，FAIL 是「做了但不对」——' +
          '**那是回归，不是债**。',
      });
      continue;
    }

    // INCONCLUSIVE
    if (!c.hasCriteria) {
      // ③ 连判据都没有 —— 悬空条款
      if (!isActive(c)) {
        tolerated.push({
          id: c.id,
          verdict: c.verdict,
          why: `没有判据，但条款状态是「${c.status ?? 'active'}」—— 已经明说这条暂时不做`,
        });
      } else if (gaps.has(c.id)) {
        tolerated.push({
          id: c.id,
          verdict: c.verdict,
          why: '没有判据，但已登记为已知欠账（spec.yaml 的 known_gaps）',
        });
      } else {
        blocking.push({
          id: c.id,
          verdict: c.verdict,
          reason:
            '既没有判据，也还没登记为已知欠账 —— 这是**悬空条款**：' +
            '要么补上判据，要么降级（status 改成 blocked / withdrawn）并在 known_gaps 里写明原因。',
        });
      }
      continue;
    }

    // ② 有判据但给不出结论
    if (gaps.has(c.id)) {
      tolerated.push({
        id: c.id,
        verdict: c.verdict,
        why: '给不出结论，但已登记为已知欠账（spec.yaml 的 known_gaps）—— 欠账是明账',
      });
    } else {
      blocking.push({
        id: c.id,
        verdict: c.verdict,
        reason:
          '给不出结论，且未登记为已知欠账 —— 没跑过的验证不是通过。' +
          '要么让验证器跑出结论，要么把它登记进 known_gaps 并写明为什么。',
      });
    }
  }

  blocking.sort((a, b) => a.id.localeCompare(b.id));
  tolerated.sort((a, b) => a.id.localeCompare(b.id));

  return { blocking, tolerated, canRelease: blocking.length === 0 };
}

/**
 * 闸门结论的那一段话（落到矩阵里）。
 *
 * @param result 闸门判定
 */
export function renderGateSection(result: GateResult): string[] {
  const out: string[] = [];

  if (result.canRelease) {
    out.push(
      `> ✅ **可以放行** —— ${result.tolerated.length} 条给不出结论或没有判据的条款，` +
        '但都**有明账**（已登记为已知欠账，或条款自己已经降级）。'
    );
    if (result.tolerated.length > 0) {
      out.push('');
      out.push('| 条款 | 判定 | 为什么没挡住放行 |');
      out.push('|---|---|---|');
      for (const t of result.tolerated) {
        out.push(`| ${t.id} | ${t.verdict} | ${t.why} |`);
      }
    }
    return out;
  }

  out.push(
    `> ❌ **不放行** —— 有 **${result.blocking.length}** 条条款的结论挡住放行。` +
      '矩阵里的 FAIL / INCONCLUSIVE 从此**有出口**：它会让流水线的退出码变成 1。'
  );
  out.push('');
  out.push('| 条款 | 判定 | 为什么挡住放行 |');
  out.push('|---|---|---|');
  for (const b of result.blocking) {
    out.push(`| ${b.id} | ${b.verdict} | ${b.reason} |`);
  }
  if (result.tolerated.length > 0) {
    out.push('');
    out.push(
      `> 另有 ${result.tolerated.length} 条欠账已登记（known_gaps），不挡放行 —— 但它们是**明账**，不是「没人看见」。`
    );
  }
  return out;
}
