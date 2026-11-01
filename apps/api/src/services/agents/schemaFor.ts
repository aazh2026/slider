/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Zod Schema → 厂商结构化输出 Schema
 * ---------------------------------------------------------------------------
 * docs/backend-design.md §4.4：一份 Schema，三处复用。
 *
 * `z.toJSONSchema()` 产出的是标准 JSON Schema，但厂商接口各有约束：
 *   - Gemini 不接受 `$schema` 顶层字段
 *   - Gemini 不接受 `additionalProperties`
 *   - Gemini 的 `responseSchema` 要求顶层是 object
 * 所以这里做一次净化，而不是把原始 JSON Schema 直接丢给厂商。
 */

import { z } from 'zod';

export function toProviderSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  const { $schema: _ignored, ...rest } = json;
  return asRecord(sanitize(rest));
}

function sanitize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitize);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === '$schema' || k === 'additionalProperties' || k === 'default') continue;
      out[k] = sanitize(v);
    }
    return out;
  }
  return node;
}

/** 顶层必须是 object —— Gemini 的 responseSchema 不接受数组或标量 */
function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { type: 'object', properties: { value: value as never } };
}
