/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Editing Agent Prompt · v1
 * ---------------------------------------------------------------------------
 * docs/backend-design.md §6.2：
 *   > **只传内容槽位摘要，不传整个 SlideIR**（含全部几何与样式），token 省 10 倍以上，
 *   > 且模型不容易误改几何。
 *
 * 输出是 IRPatch[]，由后端 patchApplier 统一施加（§4.3）。
 */

import type { PromptBundle } from './types';
import type { SlideContent, SlideLayoutType } from '@ppt/core';

export interface EditPromptContext {
  slideId: string;
  instruction: string;
  layout: SlideLayoutType;
  /** 当前内容槽位摘要 —— 只传内容，不传几何 */
  currentContent: SlideContent;
  /** 元素摘要 —— id + role + 文本，不含 geometry */
  elementDigest: Array<{ id: string; role: string; text: string }>;
  mode?: 'content' | 'style' | 'layout';
}

export const SYSTEM = `你是 AI PPT Studio 的页面编辑助手（Editing Agent）。

你根据用户的编辑指令，输出**增量补丁**（IRPatch），而不是整页重写。

## 补丁协议

{
  "patches": [
    { "operation": "update_element", "targetId": "<元素 id>", "changes": { "content": { "text": "新文案" } } },
    { "operation": "add_element", "targetId": "<新元素 id>", "changes": { "type": "text", "role": "body", "content": { "text": "..." }, "geometry": {"x":0,"y":0,"width":100,"height":40} } },
    { "operation": "remove_element", "targetId": "<元素 id>", "changes": {} },
    { "operation": "replace_group", "targetId": "<组 id>", "changes": { "elements": [...] } },
    { "operation": "restyle_slide", "changes": { "style": { "backgroundColor": "#ffffff" } } },
    { "operation": "reorder_elements", "changes": { "zIndex": { "<元素 id>": 3 } } }
  ],
  "message": "一句话说明改了什么"
}

## 硬约束

1. **只能改内容与样式，绝不能改几何坐标**（x / y / width / height）。除非指令明确要求调整位置，否则 changes 里不得出现 geometry。
2. targetId 必须来自下方给出的元素清单或明确的"新建" id，禁止编造不存在的 id。
3. 补丁要**最小化**：只改指令涉及的部分，没提到的元素一个都不要碰。
4. 只输出 JSON，不要解释文字。

## 版式参考

当前页版式为 ${'{{LAYOUT}}'}，内容槽位结构如下：`;

export function build(ctx: EditPromptContext): PromptBundle {
  const lines: string[] = [];

  lines.push(`## 当前页`);
  lines.push(`- slideId = ${ctx.slideId}`);
  lines.push(`- 版式 = ${ctx.layout}`);
  if (ctx.mode) lines.push(`- 编辑模式 = ${ctx.mode}`);

  lines.push('');
  lines.push('## 当前内容槽位（这是你可以改写的对象）');
  lines.push(JSON.stringify(ctx.currentContent, null, 2));

  lines.push('');
  lines.push('## 元素清单（只列出 id / 角色 / 文本 —— targetId 必须取自这里）');
  lines.push(
    ctx.elementDigest.length > 0
      ? JSON.stringify(ctx.elementDigest, null, 2)
      : '（当前页没有可编辑元素）'
  );

  lines.push('');
  lines.push('## 用户的编辑指令');
  lines.push(ctx.instruction);

  return {
    name: 'edit',
    version: 'v1',
    system: SYSTEM.replace('{{LAYOUT}}', ctx.layout),
    user: lines.join('\n'),
  };
}
