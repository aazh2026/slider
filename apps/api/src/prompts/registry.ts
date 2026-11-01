/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Prompt 注册表（docs/backend-design.md §6.3）
 * ---------------------------------------------------------------------------
 * Prompt 以代码形式版本化（不引额外平台），便于 code review 与回滚。
 * 每次调用都记录 `name@version` 到 `model_calls` 表。
 */

import type { PromptBundle } from './types';

import * as requirementV1 from './requirement.v1';
import * as outlineV1 from './outline.v1';
import * as editV1 from './edit.v1';
import * as extractV1 from './extract.v1';

export type { PromptBundle } from './types';
export { promptId } from './types';

export const prompts = {
  requirement: requirementV1.build,
  outline: outlineV1.build,
  edit: editV1.build,
  extract: extractV1.build,
} as const;

export type PromptName = keyof typeof prompts;

/** 列出所有已注册的 prompt 名与版本（用于 `/api/meta/models` 与运维排查） */
export function listPrompts(): Array<{ name: string; version: string }> {
  return [
    { name: 'requirement', version: 'v1' },
    { name: 'outline', version: 'v2' },
    { name: 'edit', version: 'v1' },
    { name: 'extract', version: 'v1' },
  ];
}

export type { PromptBundle as Bundle };
