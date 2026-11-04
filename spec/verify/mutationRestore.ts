/**
 * 注入检查的「还原」策略 —— **绝不覆盖别人的改动**
 * ---------------------------------------------------------------------------
 * 注入检查的本质是「**改坏源码 → 跑验证器 → 还原源码**」。
 * 还原这一步以前是：
 *
 *     for (const f of files) writeFileSync(f, originals.get(f), 'utf-8');
 *
 * —— 无条件把文件覆盖回跑批开始前的样子。
 * 在**只有一个人**的工作树里这是对的；在**多个人共用同一个工作树**里，
 * 它是「静默毁掉别人改动」的那一步：
 *
 *     别人在跑批期间改了 packages/core/src/engine/svgRenderer.ts
 *       ↓
 *     还原把整个文件覆盖回跑批前的快照
 *       ↓
 *     别人的改动凭空消失，**没有任何报错**
 *     （症状：对方的改动「莫名其妙没了」，而日志里一切正常）
 *
 * 讽刺的是，这个文件里**已经有**一段「环境完整性」检查（跑批期间源码被
 * 别人动过 → 整轮作废、不落报告）。它能**发现**这件事 ——
 * 但发现之后的 `finally` 仍然无条件覆盖，把别人的改动一起抹掉。
 * 「发现了」不等于「没造成损失」。
 *
 * 所以这里把还原拆成三步，并且**写死的原则是：宁可留脏，不许毁人**：
 *
 *   1. 没人动过这个文件        → 直接写回原文（原来的行为，安全的）
 *   2. 别人动过（改在别处）    → **反向打补丁**：把注入的那段换回原文，
 *                                对方的改动**原样保留**
 *   3. 别人动过（改在注入段里）→ **冲突**：**不写这个文件**，
 *                                把当前内容备份下来并大声报出来
 *
 * 第 3 步为什么不「尽力还原」：注入段本身被人改过时，我们已经分不清
 * 哪几行是对方的、哪几行是我们的 —— 硬写下去就是把两份改动搅成一锅。
 * 留脏 + 备份 + 报错，是唯一不丢信息的做法。
 *
 * 纯逻辑与文件读写都**显式传路径**（与 `spec/verify/mutationLock.ts` 同款），
 * 于是这一整套策略可以在临时目录里被完整测一遍。
 *
 * ---------------------------------------------------------------------------
 * 还原还得把**修改时间**还原回去（2026-11-05 加）
 * ---------------------------------------------------------------------------
 * 还原这一步以前只管内容，不管时间戳。于是：
 *
 *   注入检查把源文件改坏 → 跑验证器 → 还原（内容回来了，时间戳是新的）
 *     ↓
 *   追溯矩阵的新鲜度判定看的是「依赖的文件在证据之后有没有被动过」
 *     ↓
 *   源文件被动过（其实是我们自己动的，内容一个字节没变）
 *     ↓
 *   **矩阵说：这 98 条结论对当前代码全部过期**
 *
 * 而流水线刚刚跑完这 98 条判据、全绿。矩阵在同一份文件里既说「判据全过」
 * 又说「没有一条结论对当前代码成立」—— 自相矛盾。
 *
 * 更糟的是它**每次都这样**：这一行永远写着「全过期」，读者看久了就不看了，
 * 于是某次**真的**过期（有人在跑批之后改了源文件）也一起被忽略。
 * 「宁可多报过期」这个原则是对的，但**自己造成的假过期不算多报** ——
 * 那是把自己的工具的副作用算到了别人头上。
 *
 * 所以：**内容还原成逐字节相同，时间戳也还原回去**。
 * 只有内容真的变了（反向打补丁那条路，保住了别人的改动）才不还原时间戳 ——
 * 那时候文件确实变了，把「有人在跑批期间动过它」藏起来才是危险的。
 */

import { mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** 一次替换 —— 注入时把 `find` 换成 `replace` */
export interface RestoreEdit {
  /** 注入时被替换掉的原文 */
  find: string;
  /** 注入时替换进去的内容 */
  replace: string;
}

/**
 * 还原方案
 * ---------------------------------------------------------------------------
 * `content` 就是要写回磁盘的内容；`conflict` 的 `content` 恒为 null ——
 * **冲突时一个字节都不写**。
 */
export type RestorePlan =
  | { action: 'restore-original'; content: string; reason: string }
  | { action: 'inverse-patch'; content: string; reason: string }
  | { action: 'conflict'; content: null; reason: string };

/**
 * 统计子串出现次数 —— 判定反向打补丁会不会打错地方
 */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    count++;
    from = at + needle.length;
  }
  return count;
}

/**
 * 决定「这个文件该怎么还原」
 * ---------------------------------------------------------------------------
 * @param original 跑批开始前的内容（快照）
 * @param injected 我们写进去的注入版内容
 * @param current  此刻磁盘上的内容（可能含别人的改动）
 * @param edits    这个文件涉及的所有替换（按注入顺序）
 */
export function planRestore(
  original: string,
  injected: string,
  current: string,
  edits: readonly RestoreEdit[]
): RestorePlan {
  // 情况 0：磁盘上的内容已经等于原文 —— 有人替我们还原过了（或者注入是空操作）。
  // 这时候写回原文等于什么都不做，安全。
  if (current === original) {
    return {
      action: 'restore-original',
      content: original,
      reason: '磁盘上的内容已经等于注入前的样子',
    };
  }

  // 情况 1：磁盘上的内容就是我们写进去的那份 —— 注入期间没人动过这个文件。
  if (current === injected) {
    return {
      action: 'restore-original',
      content: original,
      reason: '注入期间没有人动过这个文件',
    };
  }

  // 情况 2：有人动过。试着**反向打补丁** —— 把注入替换进去的内容换回原文。
  //
  // 必须**倒序**还原：注入时是按顺序替换的，反过来就得按相反顺序换回去，
  // 否则后一次替换可能顶掉前一次的位置。
  let patched = current;
  for (const edit of [...edits].reverse()) {
    const occurrences = countOccurrences(patched, edit.replace);
    if (occurrences !== 1) {
      return {
        action: 'conflict',
        content: null,
        reason:
          `注入片段在当前文件里出现 ${occurrences} 次` +
          `（要还原的片段是 ${JSON.stringify(edit.replace.slice(0, 40))}…）` +
          '—— 无法确定该改哪一处，不敢动这个文件',
      };
    }
    patched = patched.replace(edit.replace, edit.find);
  }

  return {
    action: 'inverse-patch',
    content: patched,
    reason: '有人在注入期间改过这个文件 —— 已反向还原注入，保留对方的改动',
  };
}

export interface RestoreFileArgs {
  /** 文件在磁盘上的路径 */
  path: string;
  /** 注入前的原文 */
  original: string;
  /** 我们写进去的注入版内容 */
  injected: string;
  /** 此刻磁盘上的内容 */
  current: string;
  /** 这个文件涉及的所有替换（按注入顺序） */
  edits: readonly RestoreEdit[];
  /**
   * 冲突时把当前内容备份到哪儿。
   *
   * 给 null 就**不备份** —— 但那样对方的改动就只剩磁盘上那份（含注入残留），
   * 所以调用方应当总是给一个路径。
   */
  backupPath?: string | null;
  /**
   * 注入前这个文件的修改时间（毫秒）—— 还原时一并还原回去。
   *
   * 给 null / 不给 → 只还原内容，时间戳保持新的。
   */
  originalMtime?: number | null;
}

export interface RestoreFileResult {
  /** 还原方案 */
  plan: RestorePlan;
  /** 实际写回的内容；冲突时为 null（**没写**） */
  written: string | null;
  /** 冲突时写下的备份路径 */
  backupPath: string | null;
}

/**
 * 把修改时间还原回注入前的值。
 *
 * **只在「写回去的内容与快照逐字节相同」时才做** ——
 * 内容变了（反向打补丁那条路，保住了别人的改动），文件就**真的**变了，
 * 时间戳必须是新的：把「有人在跑批期间改过这个文件」藏起来，
 * 会让追溯矩阵的过期判定漏报 —— 那比多报一条要坏得多。
 *
 * 还原不了时间戳**不算失败**：内容已经还原了，
 * 顶多让新鲜度判定保守一点（多报过期），不会漏报。
 */
function restoreMtime(
  path: string,
  original: string,
  written: string,
  originalMtime: number | null | undefined
): void {
  if (originalMtime === null || originalMtime === undefined) return;
  if (written !== original) return;

  try {
    const atime = statSync(path).atimeMs;
    utimesSync(path, atime / 1000, originalMtime / 1000);
  } catch {
    /* 时间戳还原不了 —— 内容已经还原了，不算失败 */
  }
}

/**
 * 按方案真正落盘
 * ---------------------------------------------------------------------------
 * 冲突时：**不写源文件**，只把当前内容备份下来。
 */
export function restoreFile(args: RestoreFileArgs): RestoreFileResult {
  const plan = planRestore(args.original, args.injected, args.current, args.edits);

  if (plan.action === 'conflict') {
    let backupPath: string | null = null;
    if (args.backupPath) {
      mkdirSync(dirname(args.backupPath), { recursive: true });
      writeFileSync(args.backupPath, args.current, 'utf-8');
      backupPath = args.backupPath;
    }
    return { plan, written: null, backupPath };
  }

  writeFileSync(args.path, plan.content, 'utf-8');
  restoreMtime(args.path, args.original, plan.content, args.originalMtime);
  return { plan, written: plan.content, backupPath: null };
}

/** 一次替换 —— 带文件名（跑批层面的形态） */
export interface FileEdit extends RestoreEdit {
  /** 被改动的文件（相对仓库根） */
  file: string;
}

export interface RestoreFilesArgs {
  /** 仓库根目录 */
  root: string;
  /** 本轮涉及的文件（相对 root） */
  files: readonly string[];
  /** 注入前的原文 */
  originals: ReadonlyMap<string, string>;
  /**
   * 注入前各文件的修改时间（毫秒）—— 还原时一并还原回去。
   *
   * 不给就只还原内容 —— 时间戳会停在「还原那一刻」，
   * 于是追溯矩阵的新鲜度判定会把注入检查自己造成的假改动当成真改动。
   */
  originalMtimes?: ReadonlyMap<string, number>;
  /** 我们写进去的内容 —— 只有写过的文件才该被还原 */
  injected: ReadonlyMap<string, string>;
  /** 本轮所有替换 */
  edits: readonly FileEdit[];
  /**
   * 冲突备份目录（相对 root）。
   *
   * 给 null 就不备份 —— 那样对方的改动只剩磁盘上那份（含注入残留），
   * 所以调用方应当总是给一个目录。
   */
  backupDir?: string | null;
  /** 备份文件名后缀 —— 通常是跑批的 pid，免得两轮跑批互相覆盖备份 */
  backupSuffix?: string;
}

export interface RestoreFilesResult {
  /** 逐个文件的还原结果 */
  files: Array<{
    file: string;
    action: RestorePlan['action'];
    reason: string;
    backupPath: string | null;
  }>;
  /**
   * 有人在跑批期间动过这些文件 —— **这一轮的结论不可信**。
   *
   * 注意：这些文件**已经被安全还原了**（对方的改动保住了），
   * 这里记下来只是为了让跑批方知道结论要作废。
   */
  foreignEdits: string[];
  /** 撞上冲突、**没能还原**的文件 —— 需要人工处理 */
  conflicts: string[];
}

/**
 * 还原一批文件 —— 跑批收尾时调用的那一步
 * ---------------------------------------------------------------------------
 * 逐个文件做决定，逐个文件处理：
 *   · 我们没写过的文件 → **不碰**（里面的一切都不是我们的）
 *   · 没人动过         → 写回原文
 *   · 别人动过（别处） → 反向打补丁，保留对方的改动
 *   · 别人动过（冲突） → 不写，备份 + 记进 conflicts
 */
export function restoreFiles(args: RestoreFilesArgs): RestoreFilesResult {
  const result: RestoreFilesResult = { files: [], foreignEdits: [], conflicts: [] };

  for (const file of args.files) {
    // 我们没写过这个文件 —— 里面的一切都不是我们的，别碰
    if (!args.injected.has(file)) continue;

    const path = resolve(args.root, file);
    let current: string;
    try {
      current = readFileSync(path, 'utf-8');
    } catch {
      // 文件没了 —— 有人把它删了？不动它，交给上层报告
      result.conflicts.push(`${file} —— 文件在还原时已经不在磁盘上`);
      continue;
    }

    const backupPath = args.backupDir
      ? resolve(
          args.root,
          args.backupDir,
          `${file.replace(/[\\/]/g, '__')}.${args.backupSuffix ?? 'bak'}`
        )
      : null;

    const res = restoreFile({
      path,
      original: args.originals.get(file) ?? current,
      injected: args.injected.get(file)!,
      current,
      edits: args.edits.filter((e) => e.file === file),
      backupPath,
      originalMtime: args.originalMtimes?.get(file),
    });

    result.files.push({
      file,
      action: res.plan.action,
      reason: res.plan.reason,
      backupPath: res.backupPath,
    });

    if (res.plan.action === 'conflict') {
      result.conflicts.push(`${file} —— ${res.plan.reason}`);
    } else if (res.plan.action === 'inverse-patch') {
      result.foreignEdits.push(file);
    }
  }

  return result;
}
