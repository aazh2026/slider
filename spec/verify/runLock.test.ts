/**
 * 机器级跑批互斥锁的**缺陷回放**
 * ---------------------------------------------------------------------------
 * 这不是"测一个工具好不好用"，而是**钉住一个已经发生过的失败模式**：
 *
 *   2026-11-05 实测（跨四轮）：
 *     同一个文件、同一份代码，隔离复跑 3.2 秒全过，
 *     在流水线里耗了 **906 秒**并超时（限 5 秒）——
 *     差的是**有没有别的跑批在抢**。
 *   第 14 轮那次 `apps/api` 基线整片变红，同一个成因。
 *
 *   根因：原来的锁锁在**工作树里**，而规矩要求流水线在**隔离镜像**里跑，
 *   同一个项目上还有另一条循环也在跑 —— 两棵不同的树、两把不同的锁，
 *   **互相看不见**。
 *
 *   所以这里断言的是**跨树互斥**的语义：
 *   锁在别人手里时必须**等**（不是拒绝启动 —— 拒绝会白费一整轮）；
 *   等到了就接着跑；等不到要说清楚在等谁；
 *   持锁进程死了必须能接管；锁放太久（pid 被复用）也必须能接管；
 *   父进程替子进程持锁时，子进程不能跟**自己的父进程**死等。
 *
 * 用临时目录跑，不碰真实锁文件。
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { acquireMutationLock, readLockHolder } from './mutationLock';
import {
  acquireRunLock,
  inheritedLockHolder,
  isLockExpired,
  MAX_LOCK_AGE_MS,
  RUN_LOCK_DIR_ENV,
  RUN_LOCK_HELD_ENV,
  runLockDir,
  runLockPath,
  waitBudgetMs,
} from './runLock';

const dirs: string[] = [];

function lockPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'run-lock-'));
  dirs.push(dir);
  return join(dir, 'run.lock');
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('机器级跑批互斥锁', () => {
  test('锁不在工作树里 —— 否则隔离镜像互相看不见', () => {
    const path = runLockPath({ [RUN_LOCK_DIR_ENV]: '/tmp/somewhere' });
    expect(path).toBe('/tmp/somewhere/run.lock');
    expect(path.startsWith(process.cwd())).toBe(false);

    // 默认落在用户目录下，不在仓库里
    const fallback = runLockPath({});
    expect(fallback.includes('/spec/evidence/')).toBe(false);
  });

  test('锁目录可以被环境变量改（测试与「想换个作用域」用）', () => {
    expect(runLockDir({ [RUN_LOCK_DIR_ENV]: '/tmp/abc' })).toBe('/tmp/abc');
    expect(runLockDir({})).toContain('.cache');
  });

  test('等待预算能改，默认 30 分钟', () => {
    expect(waitBudgetMs({})).toBe(30 * 60 * 1000);
    expect(waitBudgetMs({ SLIDER_RUN_LOCK_WAIT_MS: '1234' })).toBe(1234);
    // 坏值不采纳 —— 宁可等默认的，也不能等成 0（等于不等待）
    expect(waitBudgetMs({ SLIDER_RUN_LOCK_WAIT_MS: 'abc' })).toBe(30 * 60 * 1000);
  });

  test('锁空着的时候拿得到', async () => {
    const path = lockPath();
    const got = await acquireRunLock({
      lockPath: path,
      holder: { pid: process.pid, startedAt: new Date().toISOString() },
    });
    expect(got.ok).toBe(true);
    expect(readLockHolder(path)?.pid).toBe(process.pid);
    got.release();
  });

  test('锁在别人手里时**先等**，等到了就接着跑（不是拒绝启动）', async () => {
    const path = lockPath();
    const first = acquireMutationLock(path, {
      pid: process.pid,
      startedAt: new Date().toISOString(),
    });
    if (!first.ok) throw new Error('第一次拿锁本该成功');

    let clock = 0;
    const now = () => clock;
    const sleep = async (ms: number) => {
      clock += ms;
      // 模拟「前一份跑完了，放手」
      if (clock >= 500) first.release();
    };

    const second = await acquireRunLock({
      lockPath: path,
      waitMs: 5_000,
      pollMs: 100,
      now,
      sleep,
      holder: { pid: process.pid + 1, startedAt: '2026-11-05T00:00:00Z' },
    });

    expect(second.ok).toBe(true);
    expect(second.waitedMs).toBeGreaterThanOrEqual(500);
  });

  test('等到预算用完还拿不到 → 说清楚在等谁（退出码由调用方给 2）', async () => {
    const path = lockPath();
    const first = acquireMutationLock(path, {
      pid: process.pid,
      startedAt: new Date().toISOString(),
    });
    if (!first.ok) throw new Error('第一次拿锁本该成功');

    let clock = 0;
    const waits: number[] = [];
    const second = await acquireRunLock({
      lockPath: path,
      waitMs: 1_000,
      pollMs: 100,
      now: () => clock,
      sleep: async (ms: number) => {
        clock += ms;
      },
      onWait: (info) => waits.push(info.waitedMs),
      holder: { pid: process.pid + 1, startedAt: '2026-11-05T00:00:00Z' },
    });

    expect(second.ok).toBe(false);
    // 必须说得清在等谁 —— 否则使用者只知道"拿不到锁"，不知道怎么破
    expect(second.holder?.pid).toBe(process.pid);
    expect(waits.length).toBeGreaterThan(0);
    first.release();
  });

  test('持锁进程死了 → 废锁可以被接管（一次 Ctrl-C 不能把机器锁死）', async () => {
    const path = lockPath();
    writeFileSync(
      path,
      `${JSON.stringify({ pid: 999_999, startedAt: new Date().toISOString() })}\n`,
      'utf-8'
    );

    const got = await acquireRunLock({
      lockPath: path,
      holder: { pid: process.pid, startedAt: new Date().toISOString() },
    });
    expect(got.ok).toBe(true);
    got.release();
  });

  test('锁放太久 → 当废锁（持锁的进程早死了，pid 被别人捡走了）', async () => {
    const path = lockPath();
    // pid 是**活的**（就是我自己），但锁的年龄超过上限 ——
    // 这正是「pid 被复用」时的样子
    const ancient = new Date(Date.now() - MAX_LOCK_AGE_MS - 60_000).toISOString();
    writeFileSync(path, `${JSON.stringify({ pid: process.pid, startedAt: ancient })}\n`, 'utf-8');

    expect(isLockExpired({ pid: process.pid, startedAt: ancient }, Date.now())).toBe(true);
    // 时间戳坏了也算放太久 —— 「不知道是谁的锁」不该把机器锁死
    expect(isLockExpired({ pid: process.pid, startedAt: '不是时间' }, Date.now())).toBe(true);
    expect(isLockExpired({ pid: process.pid, startedAt: new Date().toISOString() }, Date.now())).toBe(
      false
    );

    const got = await acquireRunLock({
      lockPath: path,
      holder: { pid: process.pid + 1, startedAt: new Date().toISOString() },
    });
    expect(got.ok).toBe(true);
    got.release();
  });

  test('父进程替子进程持锁时，子进程不能跟自己的父进程死等', async () => {
    const path = lockPath();
    const parent = acquireMutationLock(path, {
      pid: process.pid,
      startedAt: new Date().toISOString(),
    });
    if (!parent.ok) throw new Error('第一次拿锁本该成功');

    // 环境变量说「父进程 pid 是我」，锁文件里记的也确实是它 → 认
    const inherited = inheritedLockHolder(path, { [RUN_LOCK_HELD_ENV]: String(process.pid) });
    expect(inherited?.pid).toBe(process.pid);

    // 环境变量是**陈的**（锁文件里的 pid 不是它）→ 不认，子进程照常自己抢
    expect(inheritedLockHolder(path, { [RUN_LOCK_HELD_ENV]: String(process.pid + 1) })).toBe(null);
    // 环境变量没有 → 不认
    expect(inheritedLockHolder(path, {})).toBe(null);

    parent.release();
  });
});
