/**
 * 注入检查的**跑批互斥锁** —— 纯逻辑，无副作用（文件读写都在函数里显式传路径）
 * ---------------------------------------------------------------------------
 * 为什么需要它（2026-11-05 实测）：
 *
 *   注入检查的本质是「**改坏源码 → 跑验证器 → 还原源码**」。
 *   两个跑批同时在**同一个工作树**里跑，会互相踩：
 *
 *     跑批 A 注入（把 src/App.tsx 改成「前端只改本地 state，不落服务端」）
 *     跑批 B 还原 —— 把 A 的注入覆盖掉，源码回到干净状态
 *     跑批 A 启动浏览器 → 页面里跑的是**没被注入的代码**
 *     → A 的验证器当然通过 → A 记下「验证器抓不到这个错」
 *
 *   这条结论是**冤枉验证器**的：验证器没毛病，是环境被人抢了。
 *   方向反了也一样坏：跑批 B 的注入还留在树上时，
 *   A 的覆盖率门禁会跑出一个**假的失败**
 *   （实测症状：软删除的项目居然还能打开，期望 404 拿到 200），
 *   于是「还原后必须重新 PASS」那一步挂掉 —— 整轮流水线变红。
 *
 *   两种症状都指向同一件事：**结论不可信，而且不知道该怪谁**。
 *   追溯矩阵会把「验证器抓不到这个错」如实写进去 ——
 *   读的人会以为那条判据的验证器有毛病，下一步就是去"修"一个没毛病的验证器。
 *
 *   所以：**同一个工作树里同时只许有一个注入检查在跑**。
 *   锁放在工作树里（不是 /tmp）—— 要防的正是「同一个工作树」。
 *
 * ---------------------------------------------------------------------------
 * 锁文件里记 pid —— 进程没了（被 kill / 崩了）就自动作废，
 * 免得一次 Ctrl-C 就把仓库锁死。
 */

import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';

export interface LockHolder {
  /** 持锁进程的 pid */
  pid: number;
  /** 什么时候开始的（ISO 串，只给人看） */
  startedAt: string;
}

export type AcquireResult =
  | { ok: true; release: () => void }
  | { ok: false; holder: LockHolder | null };

/**
 * 进程还活着吗？
 *
 * `process.kill(pid, 0)` 不发信号，只探活：
 *   - 不抛错 → 进程在
 *   - ESRCH   → 没有这个进程（死了）
 *   - EPERM   → 进程在，但不属于当前用户 —— 仍然算「活着」，
 *               不然会把一个正在跑的跑批的锁当成废锁给抢了
 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * 读锁文件里记的持有者。
 *
 * 文件不存在或内容坏了都返回 null —— 坏锁不能把仓库锁死：
 * 拿不到持有者就意味着「不知道是谁」，按无人持有处理（可以被接管）。
 */
export function readLockHolder(lockPath: string): LockHolder | null {
  let raw: string;
  try {
    // 用同步读 —— 调用方是启动路径，不值得为它引入异步
    raw = readFileSync(lockPath, 'utf-8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<LockHolder>;
    if (typeof parsed.pid !== 'number') return null;
    return { pid: parsed.pid, startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : '' };
  } catch {
    return null;
  }
}

/**
 * 拿锁。
 *
 * 用 `flag: 'wx'` 原子创建 —— 两个进程同时抢，只有一个能建成功，
 * 不会出现「两个都以为自己拿到了」。
 *
 * 已存在的锁：
 *   - 持有者还活着 → 抢不到（ok: false）
 *   - 持有者已经死了 → 当作废锁接管（但先核对内容没被别人换掉）
 */
export function acquireMutationLock(lockPath: string, holder: LockHolder): AcquireResult {
  const payload = `${JSON.stringify(holder)}\n`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(lockPath, payload, { flag: 'wx' });
      return {
        ok: true,
        release: () => {
          // 只删**自己**的锁 —— 万一锁被别人接管了，别把人家的删了
          const current = readLockHolder(lockPath);
          if (current && current.pid !== holder.pid) return;
          try {
            unlinkSync(lockPath);
          } catch {
            // 已经不在了 —— 没什么要做的
          }
        },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }

    // 锁已存在：看持有者还在不在
    const current = readLockHolder(lockPath);
    if (current && isProcessAlive(current.pid)) {
      return { ok: false, holder: current };
    }

    // 废锁（进程没了）或坏锁 —— 删掉重试一次
    try {
      unlinkSync(lockPath);
    } catch {
      // 别人刚好也删了 —— 下一轮循环会重新竞争
    }
  }

  return { ok: false, holder: readLockHolder(lockPath) };
}
