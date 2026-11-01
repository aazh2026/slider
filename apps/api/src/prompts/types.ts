/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Prompt 类型定义（docs/backend-design.md §6.3）
 * ---------------------------------------------------------------------------
 * 每个 Prompt 带 `name + version`，写进 `model_calls` 表，出问题可精确回放。
 */

export interface PromptBundle {
  /** 稳定名 —— 如 `outline` */
  name: string;
  /** 版本 —— 如 `v2` */
  version: string;
  /** 系统提示（稳定前缀 → 适合开 prompt caching） */
  system: string;
  /** 用户提示（动态内容） */
  user: string;
}

/** 组合后的标识 —— 落库用 */
export function promptId(bundle: PromptBundle): string {
  return `${bundle.name}@${bundle.version}`;
}
