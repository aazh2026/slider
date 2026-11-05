/**
 * 注入用例三档结论的单元测试 —— **纯逻辑，无 IO**
 * ---------------------------------------------------------------------------
 * 这套判定以前只看退出码，于是「树本来就是红的」会把结论说反：
 *   · 把「树坏了」说成「验证器抓不住」（冤枉验证器）
 *   · 把「注入那轮红」说成「抓到了」（冤枉验证器的反面 —— 给没证明过的事记功）
 *
 * 现在改成**差分**：只看「注入带来了哪些**新的**失败」。
 *
 * 下面钉住三件事：
 *   ① 每一条判定分支；
 *   ② **等值性**：树是绿的时候，新旧两套判定逐条相同 —— **这不是弱化校验**；
 *   ③ 缺陷重放：第 14 轮那次真实的误判，现在必须判成「没跑出结论」。
 */

import { describe, expect, test } from 'bun:test';

import {
  legacyMutationVerdictOf,
  mutationDiffOf,
  mutationExitCode,
  mutationRoundsOf,
  mutationVerdictOf,
  mutationVerdictReason,
  reportCaseVerdict,
  RUN_LEVEL_FAILURE,
  summarizeMutationCases,
  summarizeVerdicts,
  type MutationCaseLike,
  type MutationRound,
} from './mutationVerdict.ts';

/** 一轮观察 —— 失败的是哪几条用例 */
function round(failed: string[], noVerdict = false): MutationRound {
  return { failed, noVerdict };
}

/** 三轮观察 */
function caseOf(
  baseline: string[],
  mutated: string[],
  restored: string[],
  noVerdict = false
): MutationCaseLike {
  return {
    baseline: round(baseline, noVerdict),
    mutated: round(mutated, noVerdict),
    restored: round(restored, noVerdict),
  };
}

describe('差分判定', () => {
  test('树是绿的：注入被抓到且还原干净 → PASS', () => {
    const c = caseOf([], ['被注入弄坏的用例'], []);
    expect(mutationVerdictOf(c)).toBe('PASS');
    expect(mutationVerdictReason(c)).toContain('抓得住这个错');
  });

  test('树是绿的：注入之后仍然全部通过 → FAIL（验证器抓不住）', () => {
    const c = caseOf([], [], []);
    expect(mutationVerdictOf(c)).toBe('FAIL');
    expect(mutationVerdictReason(c)).toContain('抓不住这个错');
  });

  test('树是绿的：抓到了但还原之后仍多出失败 → FAIL（没还原干净）', () => {
    const c = caseOf([], ['被注入弄坏的用例'], ['被注入弄坏的用例']);
    expect(mutationVerdictOf(c)).toBe('FAIL');
    expect(mutationVerdictReason(c)).toContain('还原之后仍然多出');
  });

  test('有一轮没跑出结论 → INCONCLUSIVE', () => {
    const c = caseOf([], ['x'], []);
    c.mutated.noVerdict = true;
    expect(mutationVerdictOf(c)).toBe('INCONCLUSIVE');
    expect(mutationVerdictReason(c)).toContain('没跑出结论');
  });
});

describe('树本来就红的时候（这一轮修的核心）', () => {
  test('基线红 + 注入带来新的失败 + 还原后与基线一致 → PASS', () => {
    // 第 14 轮那次的真实形状：别人的在途改动让 19 条 api 用例失败，
    // 注入另外弄坏了一条 —— 注入**确实**被抓到了。
    const baseline = Array.from({ length: 19 }, (_, i) => `别人的用例${i}`);
    const c = caseOf(baseline, [...baseline, '被注入弄坏的用例'], baseline);
    expect(mutationVerdictOf(c)).toBe('PASS');
    expect(mutationVerdictReason(c)).toContain('抓得住这个错');
  });

  test('基线红 + 注入没带来新的失败 → INCONCLUSIVE（不是「验证器抓不住」）', () => {
    const baseline = ['别人的用例'];
    const c = caseOf(baseline, baseline, baseline);
    expect(mutationVerdictOf(c)).toBe('INCONCLUSIVE');
    const reason = mutationVerdictReason(c);
    expect(reason).toContain('没跑出结论');
    expect(reason).not.toContain('抓不住');
  });

  test('基线红 + 注入带来新的失败 + 还原后仍多出 → FAIL（还原不干净）', () => {
    const baseline = ['别人的用例'];
    const c = caseOf(baseline, [...baseline, '被注入弄坏的用例'], [...baseline, '残留']);
    expect(mutationVerdictOf(c)).toBe('FAIL');
    expect(mutationVerdictReason(c)).toContain('还原之后仍然多出');
  });

  test('基线红 + 注入那轮红得一模一样 → 不能记成「抓到了」（不给没证明过的事记功）', () => {
    // 旧逻辑：caught = !mutated.passed → 这一行会显示「抓到 ✓」——
    // 可它红的原因跟注入毫无关系。这是**冤枉验证器的反面**。
    const baseline = ['别人的用例'];
    const c = caseOf(baseline, baseline, baseline);
    expect(mutationVerdictOf(c)).not.toBe('PASS');
    expect(mutationDiffOf(c).caused).toEqual([]);
  });
});

describe('等值性 —— 树是绿的时候，新旧判定逐条相同（这不是弱化校验）', () => {
  // 旧协议：baseline_pass / caught / restored_pass 三个布尔量
  const combos: Array<[boolean, boolean, boolean]> = [
    [true, true, true],
    [true, true, false],
    [true, false, true],
    [true, false, false],
    [false, true, true],
    [false, true, false],
    [false, false, true],
    [false, false, false],
  ];

  test('基线是绿的四种组合，新旧判定完全相同', () => {
    for (const [baselinePass, caught, restoredPass] of combos) {
      if (!baselinePass) continue;
      // 旧协议的三个布尔量 → 三轮观察
      const c: MutationCaseLike = {
        baseline: round(baselinePass ? [] : ['x']),
        mutated: round(caught ? ['被注入弄坏的用例'] : []),
        restored: round(restoredPass ? [] : ['残留']),
      };
      const legacy = legacyMutationVerdictOf({
        baseline_pass: baselinePass,
        caught,
        restored_pass: restoredPass,
      });
      expect({ combo: [baselinePass, caught, restoredPass], v: mutationVerdictOf(c) }).toEqual({
        combo: [baselinePass, caught, restoredPass],
        v: legacy,
      });
    }
  });

  test('基线红的时候：新的判定只可能因为「有确定发现」才给 FAIL', () => {
    for (const [baselinePass, caught, restoredPass] of combos) {
      if (baselinePass) continue;
      const c: MutationCaseLike = {
        baseline: round(['别人的用例']),
        mutated: round(caught ? ['别人的用例', '被注入弄坏的用例'] : ['别人的用例']),
        restored: round(restoredPass ? ['别人的用例'] : ['别人的用例', '残留']),
      };
      const v = mutationVerdictOf(c);
      const d = mutationDiffOf(c);
      // FAIL 只在「还原之后仍多出失败」时出现 —— 那是一条**确定的**发现
      if (v === 'FAIL') expect(d.leftover.length).toBeGreaterThan(0);
      // PASS 只在「注入确实带来了新的失败」时出现
      if (v === 'PASS') expect(d.caused.length).toBeGreaterThan(0);
      // 绝不因为「基线红」就报 FAIL（那正是第 14 轮的冤枉）
      if (d.caused.length === 0 && d.leftover.length === 0) expect(v).not.toBe('FAIL');
    }
  });
});

describe('缺陷重放：第 14 轮那次真实的误判', () => {
  // 当时 AC-GOV-001 那一行的三个格子是 `基线 ✗ / 抓到 ✓ / 还原 ✓`，
  // 旧逻辑把它记成「不合格」，整轮报「存在抓不到注入错误的验证器」。
  //
  // 把它还原成「三轮各自失败了哪几条用例」：
  //   基线   = 19 条 api 用例（**别的作者的在途改动**弄红的）
  //   注入后 = 那 19 条 + 覆盖率门禁自己那条（注入把门槛抬到 99，门禁真的拦住了）
  //   还原后 = 那 19 条
  const baseline = Array.from({ length: 19 }, (_, i) => `api 用例${i}`);
  const observed = caseOf(baseline, [...baseline, '覆盖率门禁那条'], baseline);

  test('现在判成 PASS —— 注入确实被抓到了，而且归因说得清', () => {
    expect(mutationVerdictOf(observed)).toBe('PASS');
    expect(mutationVerdictReason(observed)).toContain('抓得住这个错');
  });

  test('差分把「归因于注入」和「树本来就红」分开了', () => {
    const d = mutationDiffOf(observed);
    expect(d.baselineFailed).toHaveLength(19);
    expect(d.caused).toEqual(['覆盖率门禁那条']);
    expect(d.leftover).toEqual([]);
  });

  test('基线红 + 注入那轮红得一模一样 → 判成 INCONCLUSIVE，不是「抓到了」', () => {
    // 这一条钉的是**冤枉验证器的反面**：旧逻辑 `caught = !mutated.passed`
    // 会给一个「其实什么都没证明」的验证器**记功**。
    const same = caseOf(baseline, baseline, baseline);
    expect(mutationVerdictOf(same)).toBe('INCONCLUSIVE');
    const reason = mutationVerdictReason(same);
    expect(reason).toContain('没跑出结论');
    expect(reason).not.toContain('抓不住');
  });

  test('旧协议对同一份观察给的是「不合格」—— 这条用例钉住了那个误判', () => {
    // 旧协议：基线红 → INCONCLUSIVE（第 15 轮的修法，把误判从 FAIL 降成「没结论」）
    expect(
      legacyMutationVerdictOf({ baseline_pass: false, caught: true, restored_pass: false })
    ).toBe('INCONCLUSIVE');
  });
});

describe('差分的中间量', () => {
  test('caused = 注入带来的新失败；leftover = 还原后仍多出的失败', () => {
    const c = caseOf(['a'], ['a', 'b'], ['a', 'b']);
    const d = mutationDiffOf(c);
    expect(d.baselineFailed).toEqual(['a']);
    expect(d.caused).toEqual(['b']);
    expect(d.leftover).toEqual(['b']);
  });

  test('整轮失败也算一条失败（测试文件加载不了时 Bun 根本不写 junit）', () => {
    const c = caseOf([], [RUN_LEVEL_FAILURE], []);
    expect(mutationVerdictOf(c)).toBe('PASS');
  });
});

describe('汇总与退出码', () => {
  const green = caseOf([], ['x'], []);
  const weak = caseOf([], [], []);
  const dirty = caseOf(['别人的用例'], ['别人的用例'], ['别人的用例']);

  test('全过 → 退出码 0', () => {
    expect(mutationExitCode(summarizeMutationCases([green, green]))).toBe(0);
  });

  test('有确定的 FAIL → 退出码 1', () => {
    expect(mutationExitCode(summarizeMutationCases([green, weak]))).toBe(1);
  });

  test('只有 INCONCLUSIVE → 退出码 2（没跑出结论 → 挡住放行）', () => {
    expect(mutationExitCode(summarizeMutationCases([green, dirty]))).toBe(2);
  });

  test('FAIL 与 INCONCLUSIVE 混在一起 → 退出码 1（确切的坏结论优先报）', () => {
    expect(mutationExitCode(summarizeMutationCases([weak, dirty]))).toBe(1);
  });

  test('一个用例都没有 → 退出码 2（没验过不是验过了）', () => {
    expect(mutationExitCode(summarizeMutationCases([]))).toBe(2);
  });

  test('汇总的计数与整体结论', () => {
    const s = summarizeMutationCases([green, weak, dirty]);
    expect(s.total).toBe(3);
    expect(s.pass).toBe(1);
    expect(s.fail).toBe(1);
    expect(s.inconclusive).toBe(1);
    expect(s.verdict).toBe('FAIL');
  });
});

describe('老报告的兜底', () => {
  test('老报告只有三个布尔量 → 走旧判定，不是「没跑出结论」', () => {
    const legacy = {
      criterion: 'AC-X',
      description: '',
      mutated_file: 'a.ts',
      verifier: 'a.test.ts',
      baseline_pass: true,
      caught: true,
      restored_pass: true,
    };
    expect(mutationRoundsOf(legacy)).toBeNull();
    expect(legacyMutationVerdictOf(legacy)).toBe('PASS');
  });

  test('新报告带三轮失败清单 → 走差分', () => {
    const modern = {
      criterion: 'AC-X',
      description: '',
      mutated_file: 'a.ts',
      verifier: 'a.test.ts',
      baseline: { failed: [] },
      mutated: { failed: ['x'] },
      restored: { failed: [] },
    };
    const rounds = mutationRoundsOf(modern);
    expect(rounds).not.toBeNull();
    expect(mutationVerdictOf(rounds!)).toBe('PASS');
  });
});

// ---------------------------------------------------------------------------
// 读报告 —— 两种格式并存
// ---------------------------------------------------------------------------

describe('读报告 —— 新旧两种格式并存', () => {
  const base = {
    criterion: 'AC-X',
    description: '',
    mutated_file: 'a.ts',
    verifier: 'a.test.ts',
  };

  test('新格式 → 走差分，并给出中间量', () => {
    const r = reportCaseVerdict({
      ...base,
      baseline: { failed: ['别人的用例'] },
      mutated: { failed: ['别人的用例', '被注入弄坏的'] },
      restored: { failed: ['别人的用例'] },
    });
    expect(r.legacy).toBe(false);
    expect(r.verdict).toBe('PASS');
    expect(r.diff?.caused).toEqual(['被注入弄坏的']);
    expect(r.reason).toContain('抓得住这个错');
  });

  test('老格式 → 走旧判定，并标出「这是老格式」', () => {
    const r = reportCaseVerdict({
      ...base,
      baseline_pass: true,
      caught: true,
      restored_pass: true,
    });
    expect(r.legacy).toBe(true);
    expect(r.verdict).toBe('PASS');
    expect(r.diff).toBeNull();
    // 老报告是**跑过**的 —— 不许把它说成「没跑出结论」
    expect(r.reason).not.toContain('没跑出结论');
  });

  test('老格式里基线红的 → 还是「没跑出结论」，但**不**说成「验证器弱」', () => {
    const r = reportCaseVerdict({
      ...base,
      baseline_pass: false,
      caught: true,
      restored_pass: true,
    });
    expect(r.verdict).toBe('INCONCLUSIVE');
    expect(r.reason).toContain('没跑出结论');
    expect(r.reason).not.toContain('验证器弱');
  });

  test('既没有清单也没有布尔量 → 无从判定，不许猜', () => {
    const r = reportCaseVerdict({ ...base });
    expect(r.verdict).toBe('INCONCLUSIVE');
    expect(r.reason).toContain('无从判定');
  });
});

describe('汇总一批结论 —— 混着两种格式也能汇', () => {
  test('总数 / 通过 / 不通过 / 没结论 分别计数', () => {
    const s = summarizeVerdicts(['PASS', 'PASS', 'FAIL', 'INCONCLUSIVE']);
    expect(s.total).toBe(4);
    expect(s.pass).toBe(2);
    expect(s.fail).toBe(1);
    expect(s.inconclusive).toBe(1);
    expect(s.verdict).toBe('FAIL');
  });

  test('一个结论都没有 → 「没验过」不是「验过了」', () => {
    const s = summarizeVerdicts([]);
    expect(s.total).toBe(0);
    expect(s.verdict).toBe('INCONCLUSIVE');
    expect(mutationExitCode(s)).toBe(2);
  });
});
