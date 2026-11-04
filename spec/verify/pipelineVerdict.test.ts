/**
 * 流水线退出码的**缺陷回放**
 * ---------------------------------------------------------------------------
 * 这不是「测一个工具好不好用」，而是**钉住一个已经发生的失败模式**：
 *
 *   2026-11-05 实测：`spec/verify/all.ts` 的文件头写着
 *   「退出码：0 = 全链路通过；1 = 有环节失败」，
 *   而实现里判据执行与 E2E 两步的失败被标成「预期内」——
 *   **退出码仍然是 0**，终端还打印「✅ 工具链全绿」。
 *
 *   也就是说：判据不满足（覆盖率跌破 90%、E2E 挂了），
 *   在流水线的出口处**没有留下任何痕迹**。
 *   而 docs/testing-strategy.md §7.1 写的是「Stage 2 任何失败 → 阻断、
 *   Stage 3 E2E 失败 → 阻断」，SPEC-GOV-001 写着「覆盖率不足 → 阻断发布」。
 *
 *   另一半同样要钉住：「E2E 的服务起不来」也是退出码 0 ——
 *   **没跑出结论**被当成了「验证通过」。
 *
 * 所以这里断言的是**判定语义**：
 *   · 跑完了、有结论、结论是坏的 → 退出码 1（阻断）
 *   · 没跑出结论（证据不是本轮产出的）→ 退出码 2（这一层不算数）
 *   · 全通过 → 退出码 0
 *   · 出口处的措辞不能把「没结论」说成「全绿」
 *
 * 最后一节是**真跑一遍**：拉真的子进程、写真的证据文件，
 * 证明这套判定不是纸上谈兵。
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  artifactFresh,
  artifactStamp,
  EXIT_CODE_MEANING,
  pipelineVerdict,
  stepReason,
  stepState,
  type StepInput,
} from './pipelineVerdict';
import { runPipeline, STEPS } from './all';

/** 造一个「某一步」 */
function step(over: Partial<StepInput> = {}): StepInput {
  return { name: '某一步', code: 0, ...over };
}

describe('一步的状态', () => {
  test('退出码 0 → 通过', () => {
    expect(stepState(step({ code: 0 }))).toBe('passed');
  });

  test('跑完了、有结论、结论是坏的 → 未通过（**不是**「预期内」）', () => {
    const s = step({ code: 1, artifact: 'spec/evidence/junit.xml', artifactFresh: true });
    expect(stepState(s)).toBe('failed');
  });

  test('证据不是本轮产出的 → 没跑出结论（旧证据不算数）', () => {
    const s = step({ code: 1, artifact: 'spec/evidence/junit-e2e.xml', artifactFresh: false });
    expect(stepState(s)).toBe('not-run');
  });

  test('没声明证据的步骤失败 → 没跑出结论（工具链坏了）', () => {
    expect(stepState(step({ code: 1 }))).toBe('not-run');
  });
});

describe('退出码', () => {
  test('全通过 → 0', () => {
    const v = pipelineVerdict([step({ code: 0 }), step({ code: 0 })]);
    expect(v.exitCode).toBe(0);
    expect(v.state).toBe('green');
    expect(v.headline).toContain('全链路通过');
  });

  test('**缺陷回放**：判据执行失败 → 退出码必须是 1，不能是 0', () => {
    // 旧契约：这一步被标成「预期内」，退出码 0 → 判据不满足也放行
    const v = pipelineVerdict([
      step({ name: '判据执行', code: 1, artifact: 'spec/evidence/junit.xml', artifactFresh: true, tolerateFailure: true }),
    ]);
    expect(v.exitCode).toBe(1);
    expect(v.state).toBe('red');
    expect(v.counts.failed).toBe(1);
  });

  test('**缺陷回放**：E2E 没跑出结论 → 退出码 2，不是 0', () => {
    // 旧契约：服务起不来 → 「预期内」→ 退出码 0 + 「✅ 工具链全绿」
    const v = pipelineVerdict([
      step({ name: '前后端集成 E2E', code: 1, artifact: 'spec/evidence/junit-e2e.xml', artifactFresh: false, tolerateFailure: true }),
    ]);
    expect(v.exitCode).toBe(2);
    expect(v.state).toBe('not-run');
    expect(v.counts.notRun).toBe(1);
  });

  test('tolerateFailure 不再影响退出码 —— 它只影响措辞', () => {
    const withFlag = pipelineVerdict([
      step({ code: 1, artifact: 'a.xml', artifactFresh: true, tolerateFailure: true }),
    ]);
    const withoutFlag = pipelineVerdict([
      step({ code: 1, artifact: 'a.xml', artifactFresh: true, tolerateFailure: false }),
    ]);
    expect(withFlag.exitCode).toBe(withoutFlag.exitCode);
    expect(withFlag.exitCode).toBe(1);
    // 措辞要能让人看出「红的是实现，不是工具」
    expect(withFlag.steps[0]!.reason).toContain('实现不满足判据');
    expect(withoutFlag.steps[0]!.reason).not.toContain('实现不满足判据');
  });

  test('没跑出结论优先于没通过 —— 前者连「哪里坏了」都说不出来', () => {
    const v = pipelineVerdict([
      step({ name: '判据执行', code: 1, artifact: 'a.xml', artifactFresh: true }),
      step({ name: 'E2E', code: 1, artifact: 'b.xml', artifactFresh: false }),
    ]);
    expect(v.exitCode).toBe(2);
    expect(v.counts.failed).toBe(1);
    expect(v.counts.notRun).toBe(1);
    // 两种红都要说清楚，不能只报一种
    expect(v.headline).toContain('没跑出结论');
    expect(v.headline).toContain('另有 1 个环节');
  });
});

describe('措辞', () => {
  test('有环节没跑出结论时，不许出现「全绿」这种话', () => {
    const v = pipelineVerdict([
      step({ name: 'E2E', code: 1, artifact: 'b.xml', artifactFresh: false, tolerateFailure: true }),
    ]);
    expect(v.headline).not.toContain('全绿');
    expect(v.headline).toContain('一律不算数');
  });

  test('「没跑出结论」要说清是哪份证据没更新', () => {
    const s = step({ name: 'E2E', code: 1, artifact: 'spec/evidence/junit-e2e.xml', artifactFresh: false });
    expect(stepReason(s, 'not-run')).toContain('spec/evidence/junit-e2e.xml');
    expect(stepReason(s, 'not-run')).toContain('旧证据不算数');
  });

  test('三种退出码都有确定的意思', () => {
    expect(EXIT_CODE_MEANING[0]).toContain('全链路通过');
    expect(EXIT_CODE_MEANING[1]).toContain('不该放行');
    expect(EXIT_CODE_MEANING[2]).toContain('不算数');
  });
});

describe('证据的新鲜度', () => {
  test('文件不存在 → 快照是 0', () => {
    expect(artifactStamp(() => null, 'x')).toBe(0);
  });

  test('证据被更新过 → 本轮产出', () => {
    expect(artifactFresh(1000, 2000)).toBe(true);
  });

  test('证据没动 → 不是本轮产出', () => {
    expect(artifactFresh(1000, 1000)).toBe(false);
  });

  test('跑之前文件不存在、跑之后有了 → 本轮产出', () => {
    expect(artifactFresh(0, 2000)).toBe(true);
  });
});

describe('真正在跑的步骤表', () => {
  test('产出结论的四步都要声明自己产出哪份证据', () => {
    const declared = STEPS.filter((s) => s.artifact).map((s) => s.artifact);
    expect(declared).toContain('spec/evidence/junit.xml');
    expect(declared).toContain('spec/evidence/junit-e2e.xml');
    expect(declared).toContain('spec/evidence/mutation-report.json');
    expect(declared).toContain('spec/traceability.md');
  });

  test('结构校验与类型检查不产出结论 —— 它们失败就是「没跑出结论」', () => {
    const toolish = STEPS.filter((s) => s.name.includes('结构校验') || s.name.includes('类型检查'));
    expect(toolish.length).toBeGreaterThan(0);
    for (const s of toolish) expect(s.artifact).toBeUndefined();
  });

  test('判据执行与 E2E 产出结论 —— 它们失败要阻断（退出码 1 或 2）', () => {
    for (const s of STEPS.filter((x) => x.name.includes('判据执行') || x.name.includes('E2E'))) {
      expect(s.artifact).toBeDefined();
      const v = pipelineVerdict([
        { name: s.name, code: 1, artifact: s.artifact, artifactFresh: true, tolerateFailure: s.tolerateFailure },
      ]);
      expect(v.exitCode).toBe(1);
    }
  });

  test('出口处不许再出现「全绿」这种话（注释里提旧行为不算）', () => {
    const src = readFileSync(new URL('./all.ts', import.meta.url), 'utf-8');
    // 只看**真的会执行到的代码** —— 注释里复述旧行为是允许的
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n');
    expect(code).not.toContain('全绿');
  });
});

describe('真跑一遍', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pipeline-verdict-'));

  test('判据执行真的失败了 → 退出码 1，而且**跑出了结论**', async () => {
    const testFile = join(dir, 'failing.test.ts');
    writeFileSync(
      testFile,
      "import { expect, test } from 'bun:test';\ntest('红灯', () => { expect(1).toBe(2); });\n"
    );
    const junit = join(dir, 'junit.xml');

    const verdict = await runPipeline(
      [
        {
          name: '判据执行（假的）',
          cmd: ['bun', 'test', testFile],
          tolerateFailure: true,
          artifact: junit,
          // 子进程的输出别混进测试报告 —— 它本来就该是红的
          quiet: true,
        },
      ],
      { quiet: true }
    );

    expect(verdict.exitCode).toBe(1);
    expect(verdict.steps[0]!.state).toBe('failed');
    // 证据确实产出了 —— 所以这是「有结论的坏结论」，不是「没结论」
    expect(readFileSync(junit, 'utf-8')).toContain('<testcase');
  });

  test('服务起不来（证据压根没更新）→ 退出码 2', async () => {
    const never = join(dir, 'never-written.xml');
    const verdict = await runPipeline(
      [
        {
          name: '前后端集成 E2E（假的）',
          cmd: ['bun', '-e', 'process.exit(1)'],
          tolerateFailure: true,
          artifact: never,
        },
      ],
      { quiet: true }
    );

    expect(verdict.exitCode).toBe(2);
    expect(verdict.steps[0]!.state).toBe('not-run');
    expect(verdict.headline).not.toContain('全绿');
  });

  test('跑完了、证据也更新了 → 退出码 0', async () => {
    const junit = join(dir, 'ok.xml');
    const verdict = await runPipeline(
      [
        {
          name: '判据执行（假的，但过的）',
          cmd: ['bun', '-e', `import {writeFileSync} from 'fs'; writeFileSync(${JSON.stringify(junit)}, '<testsuite/>');`],
          tolerateFailure: false,
          artifact: junit,
        },
      ],
      { quiet: true }
    );

    expect(verdict.exitCode).toBe(0);
    expect(verdict.steps[0]!.state).toBe('passed');
  });

  test('收尾：临时目录清掉', () => {
    rmSync(dir, { recursive: true, force: true });
  });
});
