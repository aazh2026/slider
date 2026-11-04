/**
 * 注入检查跑批互斥锁的**缺陷回放**
 * ---------------------------------------------------------------------------
 * 这不是"测一个工具好不好用"，而是**钉住一个已经发生过的失败模式**：
 *
 *   2026-11-05 实测：两个注入检查跑批同时在一个工作树里跑，
 *   一轮报「验证器抓不到注入错误」（冤枉了验证器），
 *   另一轮报「还原后没有重新 PASS」（假的失败）——
 *   两种症状的共同原因都是**源码被另一个跑批抢走了**。
 *
 *   所以这里断言的是**互斥语义**：
 *   锁在别人手里时必须抢不到；持锁进程死了必须能接管；
 *   坏锁不能把仓库锁死；释放只能删自己的锁。
 *
 * 用临时目录跑，不碰仓库里的真实锁文件。
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { acquireMutationLock, isProcessAlive, readLockHolder } from './mutationLock';

const dirs: string[] = [];

function lockPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mutation-lock-'));
  dirs.push(dir);
  return join(dir, '.mutation-check.lock');
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('注入检查跑批互斥锁', () => {
  test('锁在别人手里时抢不到（并且说得清是谁占着）', () => {
    const path = lockPath();
    const first = acquireMutationLock(path, { pid: process.pid, startedAt: '2026-11-05T00:00:00Z' });
    expect(first.ok).toBe(true);

    const second = acquireMutationLock(path, { pid: process.pid + 1, startedAt: '2026-11-05T00:01:00Z' });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      // 必须指出持有者 —— 否则使用者只知道"拿不到锁"，不知道怎么破
      expect(second.holder?.pid).toBe(process.pid);
    }
  });

  test('持锁进程死了 → 废锁可以被接管（一次 Ctrl-C 不能把仓库锁死）', () => {
    const path = lockPath();
    // 找一个几乎肯定不存在的 pid
    const deadPid = 999_999;
    writeFileSync(path, `${JSON.stringify({ pid: deadPid, startedAt: 'x' })}\n`, 'utf-8');

    const got = acquireMutationLock(path, { pid: process.pid, startedAt: 'now' });
    expect(got.ok).toBe(true);
    expect(readLockHolder(path)?.pid).toBe(process.pid);
  });

  test('坏锁文件不能把仓库锁死（拿不到持有者 = 无人持有）', () => {
    const path = lockPath();
    writeFileSync(path, '这不是 JSON', 'utf-8');

    const got = acquireMutationLock(path, { pid: process.pid, startedAt: 'now' });
    expect(got.ok).toBe(true);
  });

  test('释放只能删自己的锁（不能把别人的锁删掉）', () => {
    const path = lockPath();
    const mine = acquireMutationLock(path, { pid: process.pid, startedAt: 'now' });
    expect(mine.ok).toBe(true);

    // 假装锁被别人接管了
    writeFileSync(path, `${JSON.stringify({ pid: process.pid + 7, startedAt: 'other' })}\n`, 'utf-8');
    if (mine.ok) mine.release();

    // 别人的锁必须还在
    expect(readLockHolder(path)?.pid).toBe(process.pid + 7);
  });

  test('释放后可以再拿（跑批结束后不留残余）', () => {
    const path = lockPath();
    const first = acquireMutationLock(path, { pid: process.pid, startedAt: 'now' });
    expect(first.ok).toBe(true);
    if (first.ok) first.release();

    const second = acquireMutationLock(path, { pid: process.pid, startedAt: 'now' });
    expect(second.ok).toBe(true);
    if (second.ok) second.release();
  });

  test('进程探活：自己在，999999 不在', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(999_999)).toBe(false);
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
  });

  test('锁文件内容能被人读懂（要能看出是谁、什么时候开始的）', () => {
    const path = lockPath();
    const got = acquireMutationLock(path, { pid: process.pid, startedAt: '2026-11-05T01:00:00Z' });
    expect(got.ok).toBe(true);

    const raw = readFileSync(path, 'utf-8');
    expect(raw).toContain(String(process.pid));
    expect(raw).toContain('2026-11-05T01:00:00Z');
  });
});
