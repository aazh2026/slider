/**
 * 流水线退出码的判定
 * ---------------------------------------------------------------------------
 * 这不是一个「工具」，是一份**契约**：
 *
 *   0 = 全链路通过（每一层都跑出了结论，且结论都是「通过」）
 *   1 = 有结论，结论是「不通过」 —— 判据不满足，不该放行
 *   2 = 有环节**没跑出结论** —— 工具链/环境坏了，这一层的结论一律不算数
 *
 * **为什么要有 2**
 *
 * 这一轮之前，`spec/verify/all.ts` 只有「失败」和「不失败」两分，
 * 而「没跑出结论」被当成了「通过」：
 *
 *   · 判据执行失败 → 标成「预期内：实现不满足判据」，退出码仍是 0；
 *   · E2E 的服务起不来 → 同样退出码 0，终端却打印「✅ 工具链全绿」。
 *
 * 而 docs/testing-strategy.md §7.1 写的是「Stage 2 任何失败 → 阻断、
 * Stage 3 E2E 失败 → 阻断」；SPEC-GOV-001 写着「覆盖率不足 → 阻断发布」。
 * 契约跟文档对不上时，**以能说真话为准**。
 *
 * 判定的依据只有一个：**这一步有没有在本轮产出结论证据**。
 *
 *   · 产出了 → 有结论；结论是好是坏看退出码（1）
 *   · 没产出 → 没结论（2）—— 「跑过」不等于「跑过这一版」，旧证据不算数
 *
 * **tolerateFailure 不再影响退出码**：判据不满足就是要阻断。
 * 它只影响**措辞** —— 让人知道红的是实现，不是工具。
 */

export type StepState = 'passed' | 'failed' | 'not-run';

export interface StepInput {
  /** 步骤名 */
  name: string;
  /** 步骤自己的退出码 */
  code: number;
  /**
   * 这一步产出的**结论证据**（相对仓库根，或绝对路径）。
   *
   * 没有它 —— 这一步压根不产出结论，失败即「没跑出结论」。
   */
  artifact?: string;
  /** 这个证据是不是本轮产出的（跑完之后被更新过） */
  artifactFresh?: boolean;
  /**
   * 失败是不是「实现不满足判据」（而不是工具链坏了）。
   *
   * 它**不影响退出码** —— 判据不满足就是要阻断 —— 只影响措辞。
   */
  tolerateFailure?: boolean;
}

export interface StepVerdict extends StepInput {
  state: StepState;
  /** 这一步为什么是这个状态（给人看的一句话） */
  reason: string;
}

export interface PipelineVerdict {
  exitCode: 0 | 1 | 2;
  state: 'green' | 'red' | 'not-run';
  steps: StepVerdict[];
  /** 逐行汇总（终端里那几行） */
  lines: string[];
  /** 一句话结论 */
  headline: string;
  counts: { passed: number; failed: number; notRun: number };
}

/** 退出码的含义 —— 文档与代码共用一份，免得各说各话 */
export const EXIT_CODE_MEANING: Record<0 | 1 | 2, string> = {
  0: '全链路通过：每一层都跑出了结论，结论都是「通过」',
  1: '有结论，结论是「不通过」：判据不满足，不该放行',
  2: '有环节没跑出结论：工具链/环境坏了，这一层的结论一律不算数',
};

/**
 * 一步是「通过」「没通过」还是「没跑出结论」。
 *
 * 判定只看两件事：**退出码**与**本轮有没有产出结论证据**。
 */
export function stepState(step: StepInput): StepState {
  if (step.code === 0) return 'passed';
  // 没有结论证据 → 这一步压根没跑出结论
  if (!step.artifact) return 'not-run';
  // 证据不是本轮产出的 → 这一步没跑出结论（旧的证据不算数）
  if (!step.artifactFresh) return 'not-run';
  // 跑完了，产出了结论 —— 结论是不通过
  return 'failed';
}

/** 这一步为什么是这个状态 —— 措辞要能区分「红的是实现」与「压根没跑」 */
export function stepReason(step: StepInput, state: StepState): string {
  if (state === 'passed') return '跑完了，结论是通过';
  if (state === 'failed') {
    return step.tolerateFailure
      ? '跑完了，产出了结论 —— 是**实现不满足判据**，不是工具链坏了'
      : '跑完了，产出了结论 —— 结论是不通过';
  }
  if (!step.artifact) return '这一步不产出结论证据 —— 工具链/环境坏了，没跑出结论';
  return `结论证据 ${step.artifact} 不是本轮产出的 —— 这一步没跑出结论，旧证据不算数`;
}

/**
 * 把一轮跑批的结论折算成退出码。
 *
 * 优先级：**没跑出结论 > 没通过 > 通过**。
 * 「没有结论」比「有坏结论」更严重 —— 前者连「哪里坏了」都说不出来。
 */
export function pipelineVerdict(steps: StepInput[]): PipelineVerdict {
  const verdicts: StepVerdict[] = steps.map((s) => {
    const state = stepState(s);
    return { ...s, state, reason: stepReason(s, state) };
  });

  const passed = verdicts.filter((v) => v.state === 'passed');
  const failed = verdicts.filter((v) => v.state === 'failed');
  const notRun = verdicts.filter((v) => v.state === 'not-run');

  const exitCode: 0 | 1 | 2 = notRun.length > 0 ? 2 : failed.length > 0 ? 1 : 0;

  let headline: string;
  if (exitCode === 0) {
    headline = `✅ 全链路通过（${passed.length} 个环节都跑出了结论，结论都是通过）。`;
  } else if (exitCode === 2) {
    headline =
      `❌ ${notRun.length} 个环节**没跑出结论**：${notRun.map((v) => v.name).join('；')}` +
      ` —— 这一层的结论一律不算数，旧的证据不能拿来当这一版的证明。`;
    if (failed.length > 0) {
      headline += `另有 ${failed.length} 个环节跑出了结论但没通过：${failed.map((v) => v.name).join('；')}。`;
    }
  } else {
    headline =
      `❌ ${failed.length} 个环节没通过：${failed.map((v) => v.name).join('；')}` +
      ` —— 判据不满足，**不该放行**。`;
  }

  const lines = verdicts.map((v) => {
    const tag =
      v.state === 'passed' ? '✅ 通过　　' : v.state === 'failed' ? '❌ 未通过　' : '❌ 没跑出结论';
    const code = v.code === 0 ? '' : `  (exit ${v.code})`;
    const why = v.state === 'passed' ? '' : `  —— ${v.reason}`;
    return `${tag}  ${v.name}${code}${why}`;
  });

  return {
    exitCode,
    state: exitCode === 0 ? 'green' : exitCode === 1 ? 'red' : 'not-run',
    steps: verdicts,
    lines,
    headline,
    counts: { passed: passed.length, failed: failed.length, notRun: notRun.length },
  };
}

/** 取一个文件的修改时间；文件不存在 → null（用来给证据拍「本轮之前」的快照） */
export type MtimeOf = (path: string) => number | null;

/**
 * 拍一张证据的时间快照。**跑之前拍一次，跑完再拍一次**，
 * 两次不一样才说明这一步真的产出了新的证据。
 */
export function artifactStamp(mtimeOf: MtimeOf, path: string): number {
  const m = mtimeOf(path);
  return typeof m === 'number' && Number.isFinite(m) ? m : 0;
}

/**
 * 证据是不是本轮产出的。
 *
 * 只看修改时间：**文件被重写，修改时间就会往前走**。
 * 一步跑完而证据没动 —— 说明它压根没写这份证据，
 * 这一步的结论**不算数**（哪怕退出码是 0 —— 那是另一回事）。
 */
export function artifactFresh(before: number, after: number): boolean {
  return after > before;
}
