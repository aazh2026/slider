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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { planRestore, restoreFile, restoreFiles } from './mutationRestore';

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
