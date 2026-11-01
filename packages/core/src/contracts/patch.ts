/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * IRPatch 契约（docs/backend-design.md §4.3）
 */

import { z } from 'zod';

export const IRPatchOperationSchema = z.enum([
  'update_element',
  'replace_group',
  'add_element',
  'remove_element',
  'restyle_slide',
  'reorder_elements',
]);

export const IRPatchOperation = IRPatchOperationSchema.options;

export const IRPatchSchema = z.object({
  operation: IRPatchOperationSchema,
  targetId: z.string().min(1).optional(),
  /** 各 operation 的载荷不同，这里只做形状约束，语义校验在 patchApplier */
  changes: z.unknown(),
  preserveIds: z.array(z.string()).optional(),
  reason: z.string().optional(),
});

/** AI 编辑 Agent 的输出契约 */
export const PatchResponseSchema = z.object({
  patches: z.array(IRPatchSchema),
  message: z.string().default(''),
});

export type IRPatchInput = z.input<typeof IRPatchSchema>;
