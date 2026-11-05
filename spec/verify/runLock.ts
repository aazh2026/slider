/**
 * 重跑批的**机器级互斥锁** —— 让「同一台机器上同时只跑一份重验证」成为可能
 * ---------------------------------------------------------------------------
 * 为什么需要它（2026-11-05 实测，跨了四轮）：
 *
 *   注入检查的判定在第 14 轮改成「超时 → 没跑出结论」之后，
 *   **抢 CPU 抢出来的超时已经不会再被说成「实现坏了」** ——
 *   那是这一族误诊里最贵的一半，治好了。
 *
 *   但代价还在：**那一轮什么结论都没产出**。
 *   实测（第 11 轮）：同一个文件、同一份代码，隔离复跑 **3.2 秒**全过，
 *   在流水线里耗了 **906 秒**并超时（限 5 秒）——
 *   差的是**有没有别的跑批在抢**。
 *   第 14 轮那次 `apps/api` 基线整片变红，同一个成因。
 *
 *   **为什么抢得到**：规矩要求「证据必须对着要推的那一版跑」，
 *   于是流水线**必须在隔离镜像里跑**；而同一个项目上**还有另一条循环**
 *   也在跑自己的隔离镜像 —— 两边跑在**同一台机器**上。
 *   而原来的锁 `spec/evidence/.mutation-check.lock` 锁在**工作树里**：
 *   两棵不同的树 → 两把不同的锁 → **互相看不见**。
 *
 *   所以这把锁的作用范围必须从「一棵工作树」提到「一台机器」。
 *
 * ---------------------------------------------------------------------------
 * 这把锁保护的是什么
 *
 *   保护的是**机器的 CPU**（顺带保护同一棵树里的源码）。
 *   两份跑批同时跑，后果有两个方向：
 *     · 慢的那份超时 → 结论变成「没跑出结论」（不误诊，但白费一轮）
 *     · 同一棵树里还会互相改源码又互相还原 → 结论直接是**错的**
 *   两种都指向同一件事：**同一台机器上同时只跑一份**。
 *
 *   锁放在 `~/.cache/slider/run.lock`（**不在工作树里**）：
 *   隔离镜像（`git archive` 出来的）连 `.git` 都没有，
 *   想按「项目身份」找锁都认不出亲 —— 干脆按「机器」认。
 *   （这台机器上只有这一个项目；就算有别的项目，抢的是同一份 CPU，
 *   串行也是对的。）
 *
 * ---------------------------------------------------------------------------
 * 抢不到锁怎么办：**等**，不是「拒绝启动」
 *
 *   原来的行为是「拿不到锁就退出（退出码 2）」。
 *   那个行为在「同一个工作树」这一层是对的（两批会互相踩源码，等也没用）。
 *   但在「同一台机器」这一层是错的：两批跑在**不同的树**里，
 *   等前一份跑完完全安全 —— 而拒绝启动会**白费一整轮**。
 *   所以这里改成：**在预算内等**，等不到才退出
 *   （退出码 2 = 「没跑出结论」，不说谎）。
 *
 * ---------------------------------------------------------------------------
 * 流水线与它自己起的子进程之间怎么不打架
 *
 *   流水线（`spec/verify/all.ts`）全程持锁，而它会**起一个子进程**跑注入检查
 *   （`spec/verify/mutation-check.ts`）—— 子进程若再去抢同一把锁，
 *   就会跟**自己的父进程**死等。
 *
 *   做法：父进程拿到锁后，把自己的 pid 写进环境变量
 *   `SLIDER_RUN_LOCK_HELD`；子进程读到它之后**不是**无条件相信，
 *   而是去核对**锁文件里记的 pid 是不是就是它** —— 对得上才认「父进程替我持着」。
 *   对不上（环境变量是陈的、或者锁已经被别人接管了）就照常自己抢。
 */

import { mkdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { acquireMutationLock, readLockHolder, type LockHolder } from './mutationLock';

/** 锁目录的环境变量（测试与「想换个作用域」时用） */
export const RUN_LOCK_DIR_ENV = 'SLIDER_RUN_LOCK_DIR';
/** 父进程把自己 pid 写进这个变量，子进程据此认「父进程替我持着锁」 */
export const RUN_LOCK_HELD_ENV = 'SLIDER_RUN_LOCK_HELD';
/** 最多等多久（毫秒） */
export const RUN_LOCK_WAIT_MS_ENV = 'SLIDER_RUN_LOCK_WAIT_MS';

/** 默认等待预算 —— 30 分钟 */
export const DEFAULT_WAIT_MS = 30 * 60 * 1000;

/**
 * 独立跑注入检查时的等待上限 —— 比流水线短。
 *
 * 流水线是一轮几十分钟的批量作业，等得起；
 * 而「我只想验一条判据」的诊断跑批等半小时没有意义 ——
 * 等不到就说明机器正忙，那次的结论本来就不可靠。
 */
export const STANDALONE_WAIT_MS = 10 * 60 * 1000;

/**
 * 锁的「最长可信年龄」—— 超过它就当废锁。
 *
 * 为什么要这条：废锁判定靠「持锁进程还活着吗」。
 * 而 **pid 会被复用** —— 持锁的进程早就死了，它的 pid 却在后来被别的进程捡走了，
 * 于是锁看起来「有人占着」，机器上再也起不了第二份跑批。
 * 跑批最长也只跑几十分钟，所以一把锁放了 6 小时以上就足以判定「持锁的不是它」。
 */
export const MAX_LOCK_AGE_MS = 6 * 60 * 60 * 1000;

/** 锁目录 —— 默认在用户目录下，**不在工作树里** */
export function runLockDir(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env[RUN_LOCK_DIR_ENV];
  if (typeof raw === 'string' && raw.trim()) return resolve(raw.trim());
  return join(homedir(), '.cache', 'slider');
}

/** 锁文件的全路径 */
export function runLockPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(runLockDir(env), 'run.lock');
}

/**
 * 等待预算（毫秒）。
 *
 * `cap` 是这一种跑批自己的上限（独立跑注入检查比整条流水线等得短）。
 * 环境变量 `SLIDER_RUN_LOCK_WAIT_MS` 可以改预算 ——
 * 设成 `0` 就是「不等，抢不到立刻退出」。
 */
export function waitBudgetMs(
  env: NodeJS.ProcessEnv = process.env,
  cap: number = Infinity
): number {
  const raw = env[RUN_LOCK_WAIT_MS_ENV];
  const parsed = Number(raw);
  const base = Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_WAIT_MS;
  return Math.min(base, cap);
}

/**
 * 锁是不是「放太久了」—— 该当废锁处理。
 *
 * 时间戳坏了（读不出来 / 不是 ISO 串）也算放太久 ——
 * 「不知道这把锁是谁的」与「锁太旧」一样，都不该把机器锁死。
 */
export function isLockExpired(holder: LockHolder, now: number): boolean {
  const started = Date.parse(holder.startedAt);
  if (!Number.isFinite(started)) return true;
  return now - started > MAX_LOCK_AGE_MS;
}

/**
 * 「父进程替我持着锁吗」——
 *
 * 只有**锁文件里记的 pid 就是环境变量里那个 pid** 才算。
 * 环境变量可以是被继承下来的陈货，锁文件才是当前事实。
 */
export function inheritedLockHolder(
  lockPath: string,
  env: NodeJS.ProcessEnv = process.env
): LockHolder | null {
  const raw = env[RUN_LOCK_HELD_ENV];
  const pid = Number(raw);
  if (!Number.isInteger(pid) || pid <= 0) return null;

  const current = readLockHolder(lockPath);
  if (!current || current.pid !== pid) return null;
  return current;
}

export interface RunLockHolder extends LockHolder {
  /** 持锁的是哪棵工作树（只给人看） */
  root?: string;
  /** 持锁的是哪一类跑批（只给人看） */
  what?: string;
}

export interface AcquireRunLockOptions {
  /** 锁文件路径 —— 默认 `runLockPath()` */
  lockPath?: string;
  /** 持锁者信息 */
  holder?: RunLockHolder;
  /** 最多等多久（毫秒）—— 默认 `waitBudgetMs()` */
  waitMs?: number;
  /** 每轮等多久（毫秒） */
  pollMs?: number;
  /** 等的时候每轮调一次（用来打印「还在等」） */
  onWait?: (info: { holder: LockHolder | null; waitedMs: number }) => void;
  /** 注入用的时钟与睡眠（测试用） */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface RunLockResult {
  /** 拿到锁了吗 */
  ok: boolean;
  /** 现在占着锁的是谁（拿不到锁时用来解释「在等谁」） */
  holder: LockHolder | null;
  /** 等了多久 */
  waitedMs: number;
  /** 释放锁（只删自己的那把） */
  release: () => void;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((res) => setTimeout(res, ms));

/**
 * 拿机器级跑批锁 —— 拿不到就在预算内**等**。
 *
 * 等的理由写在文件头：「不同树的两份跑批等前一份跑完是安全的，
 * 拒绝启动会白费一整轮」。
 */
export async function acquireRunLock(
  options: AcquireRunLockOptions = {}
): Promise<RunLockResult> {
  const lockPath = options.lockPath ?? runLockPath();
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? defaultSleep;
  const waitMs = options.waitMs ?? waitBudgetMs();
  const pollMs = options.pollMs ?? 15_000;
  const holder: RunLockHolder = options.holder ?? {
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };

  // 锁目录可能还不存在（第一次跑）—— 建出来，否则写锁文件会 ENOENT
  mkdirSync(dirname(lockPath), { recursive: true });

  const started = now();
  let waitedMs = 0;

  for (;;) {
    // 「放太久」的锁先清掉 —— 持锁的进程可能早就死了，pid 被别人捡走了
    const existing = readLockHolder(lockPath);
    if (existing && isLockExpired(existing, now())) {
      try {
        unlinkSync(lockPath);
      } catch {
        // 别人刚好也删了 —— 下一轮竞争会处理
      }
    }

    const got = acquireMutationLock(lockPath, holder);
    if (got.ok) {
      return { ok: true, holder, waitedMs, release: got.release };
    }

    if (waitedMs >= waitMs) {
      return { ok: false, holder: got.holder, waitedMs, release: () => {} };
    }

    options.onWait?.({ holder: got.holder, waitedMs });
    const slice = Math.min(pollMs, waitMs - waitedMs);
    await sleep(slice);
    waitedMs = now() - started;
  }
}

/**
 * 抢不到锁时给使用者看的说明 —— **说清楚在等谁、为什么等**。
 *
 * 「拿不到锁」这句话本身没用；有用的是「机器上已经有另一份跑批，
 * 两份一起跑会互相抢 CPU，超时是假的」。
 */
export function explainLockWait(holder: LockHolder | null, waitedMs: number): string {
  const seconds = Math.round(waitedMs / 1000);
  if (!holder) {
    return `机器上有另一份重跑批在跑（读不出持有者），已等 ${seconds} 秒。`;
  }
  const since = holder.startedAt ? `，开始于 ${holder.startedAt}` : '';
  return `机器上有另一份重跑批在跑（pid ${holder.pid}${since}），已等 ${seconds} 秒。`;
}
