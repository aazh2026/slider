/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Editing Agent（docs/backend-design.md §6.2 / §4.3）
 * ---------------------------------------------------------------------------
 * 职责：编辑指令 → IRPatch[]（增量补丁），由后端 patchApplier 统一施加
 *
 * 关键设计：**只传内容槽位摘要与元素摘要，不传整个 SlideIR**
 *   - token 省 10 倍以上
 *   - 模型不容易误改几何
 *
 * 降级：本地确定性改写（按 "把 A 改成 B" 模式匹配，其次追加到匹配角色的元素）
 */

import {
  PatchResponseSchema,
  type IRPatch,
  type SlideContent,
  type SlideLayoutType,
} from '@ppt/core';

import { ModelRouter, ModelUnavailableError } from '../modelRouter';
import { prompts } from '../../prompts/registry';
import { toProviderSchema } from './schemaFor';

export interface EditAgentInput {
  slideId: string;
  instruction: string;
  layout: SlideLayoutType;
  currentContent: SlideContent;
  elementDigest: Array<{ id: string; role: string; text: string }>;
  mode?: 'content' | 'style' | 'layout';
}

export interface EditAgentResult {
  patches: IRPatch[];
  message: string;
  source: 'model' | 'local';
  degraded: boolean;
  provider?: string;
  model?: string;
  degradeReason?: string;
}

export interface EditAgentDeps {
  router: ModelRouter;
}

/* -------------------------------------------------------------------------- */
/* 本地降级实现                                                                 */
/* -------------------------------------------------------------------------- */

/** 「把 A 改成 B」「将 A 替换为 B」「A → B」 */
const REPLACE_PATTERNS = [
  /(?:把|将)\s*["“]?(.+?)["”]?\s*(?:改成|改为|替换为|换成|变成)\s*["“]?(.+?)["”]?$/,
  /["“]?(.+?)["”]?\s*(?:→|->)\s*["“]?(.+?)["”]?$/,
];

export function parseReplaceInstruction(instruction: string): { from: string; to: string } | null {
  for (const re of REPLACE_PATTERNS) {
    const m = instruction.trim().match(re);
    if (m?.[1] && m[2]) {
      const from = m[1].trim();
      const to = m[2].trim();
      if (from.length > 0 && to.length > 0) return { from, to };
    }
  }
  return null;
}

/**
 * 本地确定性改写
 * ---------------------------------------------------------------------------
 * 1) 指令里出现明确的替换模式 → 对文本包含 `from` 的元素产出 update_element 补丁
 * 2) 否则 → 把指令作为补充说明追加到最匹配角色的元素（优先 body/desc 类角色）
 */
export function localEdit(input: EditAgentInput): { patches: IRPatch[]; message: string } {
  const replace = parseReplaceInstruction(input.instruction);

  if (replace) {
    const target = input.elementDigest.find((e) => e.text.includes(replace.from));
    if (target) {
      return {
        patches: [
          {
            operation: 'update_element',
            targetId: target.id,
            changes: { content: { text: target.text.split(replace.from).join(replace.to) } },
            reason: `本地降级：按指令替换「${replace.from}」`,
          },
        ],
        message: `已将「${replace.from}」替换为「${replace.to}」（本地降级执行）`,
      };
    }
  }

  // 通用降级：追加到最匹配角色的元素
  const preferredRoles = ['body', 'desc', 'content', 'text', 'bullets'];
  const target =
    input.elementDigest.find((e) => preferredRoles.includes(e.role.toLowerCase())) ??
    input.elementDigest[0];

  if (!target) {
    return {
      patches: [],
      message: '本地降级：当前页没有可编辑元素，未产生补丁',
    };
  }

  const addition = `${target.text}（${input.instruction.trim()}）`.trim();
  return {
    patches: [
      {
        operation: 'update_element',
        targetId: target.id,
        changes: { content: { text: addition } },
        reason: '本地降级：按指令追加补充说明',
      },
    ],
    message: `已按指令更新「${target.role}」元素（本地降级执行）`,
  };
}

/* -------------------------------------------------------------------------- */

export class EditAgent {
  constructor(private readonly deps: EditAgentDeps) {}

  async generate(input: EditAgentInput): Promise<EditAgentResult> {
    const bundle = prompts.edit(input);

    try {
      const res = await this.deps.router.invoke({
        agent: 'edit',
        messages: [
          { role: 'system', content: bundle.system },
          { role: 'user', content: bundle.user },
        ],
        responseSchema: toProviderSchema(PatchResponseSchema),
        parse: PatchResponseSchema,
        temperature: 0.4,
        maxTokens: 4096,
        cachePrefix: true,
      });

      const parsed = res.raw as { patches: IRPatch[]; message: string };
      return {
        patches: parsed.patches,
        message: parsed.message,
        source: 'model',
        degraded: false,
        provider: res.provider,
        model: res.model,
      };
    } catch (err) {
      if (err instanceof ModelUnavailableError) {
        const local = localEdit(input);
        return {
          ...local,
          source: 'local',
          degraded: true,
          degradeReason: err.message,
        };
      }
      throw err;
    }
  }
}
