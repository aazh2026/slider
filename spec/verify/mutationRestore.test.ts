/**
 * 注入检查「还原」策略的**缺陷回放**
 * ---------------------------------------------------------------------------
 * 这不是"测一个工具好不好用"，而是**钉住一个已经会发生的失败模式**：
 *
 *   同一个工作树里还有别人在改代码时，注入检查的还原步骤以前是
 *   `writeFileSync(file, originals.get(file))` —— 无条件覆盖。
 *   别人的改动会被**静默回滚**，症状是「对方的改动凭空没了」，
 *   而跑批日志一切正常，没有任何报错。
 *
 *   讽刺的是，这个文件里**已经有**「环境完整性」检查：
 *   跑批期间源码被别人动过 → 整轮作废、不落报告。
 *   它能**发现**这件事 —— 但发现之后的 `finally` 仍然无条件覆盖，
 *   于是「发现了」并没有「没造成损失」。
 *
 *   所以这里断言的是**还原语义**：
 *   没人动过 → 写回原文；
 *   别人动过（改在别处）→ 反向打补丁，去掉注入、**保留对方的改动**；
 *   别人动过（改在注入段里）→ **不写**，把当前内容备份下来。
 *
 * 原则只有一条：**宁可留脏，不许毁人。**
 */

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { planRestore, restoreFile, restoreFiles } from './mutationRestore';
import { assessVerdict } from './verdictFreshness';

/** 被注入的那一段（原文） */
const FIND = '  const visible = lines.slice(0, maxLines);\n';
/** 注入后的样子 */
const REPLACE = '  const visible = lines.slice();\n';
/** 注入前的整份文件 */
const ORIGINAL = `function truncateLines(lines) {\n${FIND}  return visible;\n}\n`;
/** 注入后的整份文件 */
const INJECTED = `function truncateLines(lines) {\n${REPLACE}  return visible;\n}\n`;

const EDITS = [{ find: FIND, replace: REPLACE }];

describe('注入检查的还原策略', () => {
  test('没人动过这个文件 → 直接写回原文', () => {
    const plan = planRestore(ORIGINAL, INJECTED, INJECTED, EDITS);
    expect(plan.action).toBe('restore-original');
    expect(plan.content).toBe(ORIGINAL);
  });

  test('磁盘上的内容已经等于原文（有人替我们还原过）→ 写回原文即可', () => {
    const plan = planRestore(ORIGINAL, INJECTED, ORIGINAL, EDITS);
    expect(plan.action).toBe('restore-original');
    expect(plan.content).toBe(ORIGINAL);
  });

  test('别人在别处改了 → 反向打补丁：去掉注入，保住对方的改动', () => {
    // 对方在注入段**之前**加了一行
    const foreign = `// 对方新加的一行\n${INJECTED}`;
    const plan = planRestore(ORIGINAL, INJECTED, foreign, EDITS);
    expect(plan.action).toBe('inverse-patch');
    // 注入必须没了
    expect(plan.content).not.toContain('lines.slice();');
    // 对方的改动必须还在
    expect(plan.content).toContain('// 对方新加的一行');
    // 原文也必须还在
    expect(plan.content).toContain(FIND);
  });

  test('对方改写了注入段本身 → 冲突：一个字节都不写', () => {
    // 对方把注入的那一行换成了自己的写法 —— 注入的痕迹已经认不出来了
    const foreign = INJECTED.replace(REPLACE, '  const visible = lines.slice(0, 999);\n');
    const plan = planRestore(ORIGINAL, INJECTED, foreign, EDITS);
    expect(plan.action).toBe('conflict');
    expect(plan.content).toBeNull();
    // 冲突必须说清楚为什么
    expect(plan.reason).toContain('0 次');
  });

  test('注入片段在当前文件里出现多次 → 冲突：不敢猜该改哪一处', () => {
    const foreign = `${INJECTED}\n${REPLACE}`;
    const plan = planRestore(ORIGINAL, INJECTED, foreign, EDITS);
    expect(plan.action).toBe('conflict');
    expect(plan.content).toBeNull();
    expect(plan.reason).toContain('2 次');
  });

  test('同一文件里多处编辑 → 必须**倒序**反向还原', () => {
    // 两处编辑，前一处的替换结果正好是后一处的锚点 ——
    // 还原顺序错了就还原不回原文（先还原 edit1 的话根本找不到它的锚点）。
    const original = 'const v = 1;\n';
    const injected = 'const v = 22;\n';
    const edits = [
      { find: 'const v = 1;', replace: 'const v = 2;' },
      { find: 'const v = 2;', replace: 'const v = 22;' },
    ];

    // 有人在别处改了这个文件 → 走反向打补丁那条路
    const foreign = `${injected}// 对方的改动\n`;
    const plan = planRestore(original, injected, foreign, edits);
    expect(plan.action).toBe('inverse-patch');
    expect(plan.content).toBe('const v = 1;\n// 对方的改动\n');
  });

  test('还原后文件里不能残留注入的痕迹', () => {
    const plan = planRestore(ORIGINAL, INJECTED, `${INJECTED}`, EDITS);
    expect(plan.content).not.toContain('lines.slice();');
    expect(plan.content).toContain('lines.slice(0, maxLines);');
  });
});

describe('还原落盘', () => {
  test('正常路径：把文件写回原文', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mutation-restore-'));
    try {
      const path = join(dir, 'sample.ts');
      writeFileSync(path, INJECTED, 'utf-8');

      const res = restoreFile({
        path,
        original: ORIGINAL,
        injected: INJECTED,
        current: INJECTED,
        edits: EDITS,
      });

      expect(res.plan.action).toBe('restore-original');
      expect(readFileSync(path, 'utf-8')).toBe(ORIGINAL);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('冲突路径：源文件**不被改写**，当前内容被备份下来', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mutation-restore-'));
    try {
      const path = join(dir, 'sample.ts');
      const backup = join(dir, 'backup', 'sample.ts.bak');
      // 对方把注入段改掉了
      const foreign = INJECTED.replace(REPLACE, '  const visible = lines.slice(0, 999);\n');
      writeFileSync(path, foreign, 'utf-8');

      const res = restoreFile({
        path,
        original: ORIGINAL,
        injected: INJECTED,
        current: foreign,
        edits: EDITS,
        backupPath: backup,
      });

      expect(res.plan.action).toBe('conflict');
      // **没有写** —— 对方的改动一个字都不能动
      expect(readFileSync(path, 'utf-8')).toBe(foreign);
      expect(res.written).toBeNull();
      // 但当前内容留了底 —— 对方的改动不至于找不回来
      expect(res.backupPath).toBe(backup);
      expect(readFileSync(backup, 'utf-8')).toBe(foreign);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('端到端：注入 → 对方改了别处 → 还原，文件里既有原文也有对方的改动', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mutation-restore-'));
    try {
      const path = join(dir, 'sample.ts');
      writeFileSync(path, ORIGINAL, 'utf-8');

      // 注入
      const injected = ORIGINAL.replace(FIND, REPLACE);
      writeFileSync(path, injected, 'utf-8');

      // 对方在注入期间改了同一个文件（改在别处）
      const foreign = `// 对方的改动\n${injected}`;
      writeFileSync(path, foreign, 'utf-8');

      const res = restoreFile({
        path,
        original: ORIGINAL,
        injected,
        current: foreign,
        edits: EDITS,
      });

      expect(res.plan.action).toBe('inverse-patch');
      const after = readFileSync(path, 'utf-8');
      expect(after).toContain('// 对方的改动');
      expect(after).toContain(FIND);
      expect(after).not.toContain('lines.slice();');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('整批还原（跑批收尾走的就是这条路）', () => {
  test('没人动过 → 文件写回原文，没有外来改动也没有冲突', () => {
    const root = mkdtempSync(join(tmpdir(), 'mutation-restore-'));
    try {
      const path = join(root, 'sample.ts');
      writeFileSync(path, INJECTED, 'utf-8');

      const res = restoreFiles({
        root,
        files: ['sample.ts'],
        originals: new Map([['sample.ts', ORIGINAL]]),
        injected: new Map([['sample.ts', INJECTED]]),
        edits: [{ file: 'sample.ts', find: FIND, replace: REPLACE }],
      });

      expect(res.foreignEdits).toEqual([]);
      expect(res.conflicts).toEqual([]);
      expect(readFileSync(path, 'utf-8')).toBe(ORIGINAL);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('别人改了别处 → 文件里有原文也有对方的改动，并被记成「外来改动」', () => {
    const root = mkdtempSync(join(tmpdir(), 'mutation-restore-'));
    try {
      const path = join(root, 'sample.ts');
      const foreign = `// 对方的改动\n${INJECTED}`;
      writeFileSync(path, foreign, 'utf-8');

      const res = restoreFiles({
        root,
        files: ['sample.ts'],
        originals: new Map([['sample.ts', ORIGINAL]]),
        injected: new Map([['sample.ts', INJECTED]]),
        edits: [{ file: 'sample.ts', find: FIND, replace: REPLACE }],
      });

      expect(res.conflicts).toEqual([]);
      expect(res.foreignEdits).toEqual(['sample.ts']);
      const after = readFileSync(path, 'utf-8');
      expect(after).toContain('// 对方的改动');
      expect(after).toContain(FIND);
      expect(after).not.toContain('lines.slice();');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('冲突 → 文件一个字节都不动，当前内容备份到 backupDir', () => {
    const root = mkdtempSync(join(tmpdir(), 'mutation-restore-'));
    try {
      const path = join(root, 'sample.ts');
      const foreign = INJECTED.replace(REPLACE, '  const visible = lines.slice(0, 999);\n');
      writeFileSync(path, foreign, 'utf-8');

      const res = restoreFiles({
        root,
        files: ['sample.ts'],
        originals: new Map([['sample.ts', ORIGINAL]]),
        injected: new Map([['sample.ts', INJECTED]]),
        edits: [{ file: 'sample.ts', find: FIND, replace: REPLACE }],
        backupDir: 'backups',
        backupSuffix: '1234',
      });

      expect(res.conflicts.length).toBe(1);
      expect(res.conflicts[0]).toContain('sample.ts');
      // 源文件没被改写
      expect(readFileSync(path, 'utf-8')).toBe(foreign);
      // 备份留了底 —— 对方的改动不至于找不回来
      const backup = join(root, 'backups', 'sample.ts.1234');
      expect(readFileSync(backup, 'utf-8')).toBe(foreign);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('我们没写过的文件 → 一个字节都不动（哪怕别人改了它）', () => {
    const root = mkdtempSync(join(tmpdir(), 'mutation-restore-'));
    try {
      const path = join(root, 'other.ts');
      const foreign = '// 对方的改动\n';
      writeFileSync(path, foreign, 'utf-8');

      const res = restoreFiles({
        root,
        files: ['other.ts'],
        originals: new Map([['other.ts', ORIGINAL]]),
        // 我们**没有**写过这个文件 —— 注入表里没有它
        injected: new Map(),
        edits: [],
      });

      expect(res.files).toEqual([]);
      expect(res.foreignEdits).toEqual([]);
      expect(res.conflicts).toEqual([]);
      expect(readFileSync(path, 'utf-8')).toBe(foreign);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 还原还得把**修改时间**还原回去
// ---------------------------------------------------------------------------
//
// 缺陷回放（2026-11-05）：
//
//   注入检查把源文件改坏 → 跑验证器 → 还原（内容回来了，时间戳是新的）
//     ↓
//   追溯矩阵的新鲜度判定看的是「依赖的文件在证据之后有没有被动过」
//     ↓
//   源文件被动过（其实是我们自己动的，内容一个字节没变）
//     ↓
//   **矩阵说：这 98 条结论对当前代码全部过期** —— 而流水线刚跑完全绿。
//
// 而且它**每次都这样**：这一行永远写「全过期」，读者看久了就不看了，
// 于是某次**真的**过期也跟着被忽略。
//
// 修法：内容还原成逐字节相同，时间戳也还原回去。
// 但**内容真的变了的时候不许还原**（反向打补丁那条路）——
// 那时候文件确实变了，把「有人在跑批期间动过它」藏起来才是危险的。

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('还原的时间戳', () => {
  test('**缺陷回放**：内容还原成原样 → 修改时间也必须还原回去', () => {
    const root = mkdtempSync(join(tmpdir(), 'mutation-restore-mtime-'));
    try {
      const path = join(root, 'sample.ts');
      writeFileSync(path, ORIGINAL, 'utf-8');
      const originalMtime = statSync(path).mtimeMs;

      // 注入
      writeFileSync(path, INJECTED, 'utf-8');
      const res = restoreFile({
        path,
        original: ORIGINAL,
        injected: INJECTED,
        current: INJECTED,
        edits: EDITS,
        originalMtime,
      });

      expect(res.plan.action).toBe('restore-original');
      expect(readFileSync(path, 'utf-8')).toBe(ORIGINAL);
      // 内容回到原样了 —— 时间戳也必须回到原样
      expect(Math.abs(statSync(path).mtimeMs - originalMtime)).toBeLessThan(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('内容真的变了（反向打补丁）→ 时间戳必须留在新的那一边', () => {
    // 对方在注入期间改了同一个文件 —— 还原之后文件**确实**变了。
    // 这时候把时间戳还原回去，就等于把「有人在跑批期间动过它」藏起来 ——
    // 追溯矩阵的过期判定会漏报，而漏报比多报危险得多。
    const root = mkdtempSync(join(tmpdir(), 'mutation-restore-mtime-'));
    try {
      const path = join(root, 'sample.ts');
      writeFileSync(path, ORIGINAL, 'utf-8');
      const originalMtime = statSync(path).mtimeMs;

      const foreign = `// 对方的改动\n${INJECTED}`;
      writeFileSync(path, foreign, 'utf-8');

      const res = restoreFile({
        path,
        original: ORIGINAL,
        injected: INJECTED,
        current: foreign,
        edits: EDITS,
        originalMtime,
      });

      expect(res.plan.action).toBe('inverse-patch');
      expect(readFileSync(path, 'utf-8')).toContain('// 对方的改动');
      // 内容变了 → 时间戳必须是新的
      expect(statSync(path).mtimeMs).toBeGreaterThan(originalMtime);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('没给原始时间戳 → 只还原内容，不动时间戳（老调用方不受影响）', () => {
    const root = mkdtempSync(join(tmpdir(), 'mutation-restore-mtime-'));
    try {
      const path = join(root, 'sample.ts');
      writeFileSync(path, ORIGINAL, 'utf-8');
      const before = statSync(path).mtimeMs;

      writeFileSync(path, INJECTED, 'utf-8');
      restoreFile({
        path,
        original: ORIGINAL,
        injected: INJECTED,
        current: INJECTED,
        edits: EDITS,
      });

      expect(readFileSync(path, 'utf-8')).toBe(ORIGINAL);
      expect(statSync(path).mtimeMs).toBeGreaterThanOrEqual(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('**端到端**：还原之后，追溯矩阵的新鲜度判定仍然说「结论成立」', async () => {
    // 这一条才是要害：前面几条钉的是行为，这条钉的是**后果**。
    // 复刻真实的流水线顺序：判据执行（证据落地）→ 注入检查（改坏 → 还原）→ 判定新鲜度。
    const root = mkdtempSync(join(tmpdir(), 'mutation-restore-freshness-'));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      mkdirSync(join(root, 'verify'), { recursive: true });
      mkdirSync(join(root, 'spec/evidence'), { recursive: true });

      const srcPath = join(root, 'src/engine.ts');
      writeFileSync(srcPath, ORIGINAL, 'utf-8');
      writeFileSync(
        join(root, 'verify/engine.test.ts'),
        "import { render } from '../src/engine';\n",
        'utf-8'
      );

      // 判据执行 → 证据落地。证据的 mtime 就是「跑批那一刻」。
      await sleep(30);
      const evidencePath = join(root, 'spec/evidence/junit.xml');
      writeFileSync(evidencePath, '<testsuite/>', 'utf-8');
      const evidenceAtMs = statSync(evidencePath).mtimeMs;

      // 注入检查：改坏 → 还原
      await sleep(30);
      const originalMtime = statSync(srcPath).mtimeMs;
      writeFileSync(srcPath, INJECTED, 'utf-8');
      restoreFiles({
        root,
        files: ['src/engine.ts'],
        originals: new Map([['src/engine.ts', ORIGINAL]]),
        originalMtimes: new Map([['src/engine.ts', originalMtime]]),
        injected: new Map([['src/engine.ts', INJECTED]]),
        edits: [{ file: 'src/engine.ts', find: FIND, replace: REPLACE }],
      });

      // 追溯矩阵的新鲜度判定（就是它给矩阵写「对当前代码仍然成立 N 条」）
      const read = (rel: string): string | null => {
        try {
          return readFileSync(join(root, rel), 'utf-8');
        } catch {
          return null;
        }
      };
      const mtime = (rel: string): number | null => {
        try {
          return statSync(join(root, rel)).mtimeMs;
        } catch {
          return null;
        }
      };
      const exists = (rel: string): boolean => {
        try {
          statSync(join(root, rel));
          return true;
        } catch {
          return false;
        }
      };

      const verdict = assessVerdict('verify/engine.test.ts', evidenceAtMs, read, mtime, exists);
      // 内容一个字节没变 → 结论对当前代码仍然成立
      expect(verdict.status).toBe('fresh');
      expect(verdict.reason).toContain('都没有被改过');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('**对照**：不还原时间戳的话，同一条结论会被判成「过期」', async () => {
    // 反面用例 —— 把时间戳还原去掉，判定必须翻脸。
    // 少了这一条，上面的端到端用例就可能只是「碰巧绿」。
    const root = mkdtempSync(join(tmpdir(), 'mutation-restore-freshness-'));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      mkdirSync(join(root, 'verify'), { recursive: true });
      mkdirSync(join(root, 'spec/evidence'), { recursive: true });

      const srcPath = join(root, 'src/engine.ts');
      writeFileSync(srcPath, ORIGINAL, 'utf-8');
      writeFileSync(
        join(root, 'verify/engine.test.ts'),
        "import { render } from '../src/engine';\n",
        'utf-8'
      );

      await sleep(30);
      const evidencePath = join(root, 'spec/evidence/junit.xml');
      writeFileSync(evidencePath, '<testsuite/>', 'utf-8');
      const evidenceAtMs = statSync(evidencePath).mtimeMs;

      await sleep(30);
      // 注入 → 还原，但**不传** originalMtimes（老行为）
      writeFileSync(srcPath, INJECTED, 'utf-8');
      restoreFiles({
        root,
        files: ['src/engine.ts'],
        originals: new Map([['src/engine.ts', ORIGINAL]]),
        injected: new Map([['src/engine.ts', INJECTED]]),
        edits: [{ file: 'src/engine.ts', find: FIND, replace: REPLACE }],
      });

      const read = (rel: string): string | null => {
        try {
          return readFileSync(join(root, rel), 'utf-8');
        } catch {
          return null;
        }
      };
      const mtime = (rel: string): number | null => {
        try {
          return statSync(join(root, rel)).mtimeMs;
        } catch {
          return null;
        }
      };
      const exists = (rel: string): boolean => {
        try {
          statSync(join(root, rel));
          return true;
        } catch {
          return false;
        }
      };

      const verdict = assessVerdict('verify/engine.test.ts', evidenceAtMs, read, mtime, exists);
      // 内容一模一样，判定却是「过期」—— 这就是注入检查自己造出来的假信号
      expect(readFileSync(srcPath, 'utf-8')).toBe(ORIGINAL);
      expect(verdict.status).toBe('stale');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
