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
  SVGRenderer,
  type ElementRole,
  type IRPatch,
  type SlideContent,
  type SlideElement,
  type SlideLayoutType,
  type TemplateTheme,
} from '@ppt/core';

import { ModelRouter, ModelUnavailableError } from '../modelRouter';
import { prompts } from '../../prompts/registry';
import type { EditDigestEntry } from '../../prompts/edit.v1';
import { toProviderSchema } from './schemaFor';

export interface EditAgentInput {
  slideId: string;
  instruction: string;
  layout: SlideLayoutType;
  currentContent: SlideContent;
  elementDigest: EditDigestEntry[];
  mode?: 'content' | 'style' | 'layout';
  /**
   * 模板主题 —— **只给本地降级用**，不进提示词。
   *
   * 本地降级要拿它把候选元素重新渲染一遍，确认改动**真的画得出来**
   * （排版盒装不下的块会被整块丢弃 —— 不验证就会出现"接口说改好了，页面没变"）。
   */
  theme?: TemplateTheme;
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

/* -------------------------------------------------------------------------- */
/* 目标选择                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * 内容类角色 —— 用户真正在看文字的地方，优先改这些。
 *
 * 注意：早先这里写的是 `['body','desc','content','text','bullets']`，
 * 而版式引擎产出的角色根本没有这五个（实际是
 * background / badge / title / subtitle / divider / card / layer / metric / annotation / footer），
 * 于是"最匹配角色"永远匹配不上，兜底落到 `elementDigest[0]` ——
 * 也就是**背景元素**。后果是：模型不可用时，AI 编辑把指令写进背景，
 * 页面上什么也没变，而返回的消息却说"已按指令更新「background」元素"。
 */
const CONTENT_ROLES = [
  'body',
  'desc',
  'content',
  'bullets',
  'card',
  'layer',
  'metric',
  'annotation',
  'text',
];

/** 标题类角色 —— 退而求其次 */
const TITLE_ROLES = ['title', 'subtitle', 'badge', 'footer', 'header', 'kicker'];

/** 角色优先级 —— 数字越小越优先；背景排在最后（改它等于什么都没改） */
export function roleRank(role: string): number {
  const r = role.toLowerCase();
  if (r === 'background') return 1000;
  const contentAt = CONTENT_ROLES.indexOf(r);
  if (contentAt >= 0) return contentAt;
  const titleAt = TITLE_ROLES.indexOf(r);
  if (titleAt >= 0) return 100 + titleAt;
  return 500;
}

/**
 * 挑出能承载这次改动的元素 —— **按优先级排好序**。
 *
 * 三条硬要求：
 *   1. **可编辑** —— 背景、装饰件改不动
 *   2. **有可见文本** —— 空文本元素改了也看不出差别
 *   3. **角色靠前** —— 内容类优先于标题类
 */
export function pickTargets(
  digest: EditDigestEntry[],
  predicate?: (e: EditDigestEntry) => boolean
): EditDigestEntry[] {
  return digest
    .filter((e) => e.editable !== false)
    .filter((e) => roleRank(e.role) < 1000)
    .filter((e) => e.text.trim().length > 0)
    .filter((e) => (predicate ? predicate(e) : true))
    .sort((a, b) => roleRank(a.role) - roleRank(b.role));
}

/** 第一个能承载这次改动的元素 */
export function pickTarget(
  digest: EditDigestEntry[],
  predicate?: (e: EditDigestEntry) => boolean
): EditDigestEntry | undefined {
  return pickTargets(digest, predicate)[0];
}

/* -------------------------------------------------------------------------- */
/* 内容改写 —— 保持原有结构                                                       */
/* -------------------------------------------------------------------------- */

/** 结构化内容里的字符串字段 */
const TEXT_FIELDS = ['text', 'title', 'desc', 'headline', 'subtitle', 'trend', 'value'];
/** 结构化内容里的字符串数组字段 */
const LIST_FIELDS = ['items', 'bullets', 'points', 'deliverables'];

/**
 * 在内容里追加一段说明 —— **保持原有结构**。
 *
 * 为什么必须保持结构：
 *   · `type: 'text'` 的元素（标题、副标题）渲染时只认字符串 ——
 *     把 content 换成 `{ text }`，标题会直接变成空白
 *   · 结构化内容（卡片 `{title, items[]}`）被换成 `{ text }` 会丢掉原有的条目
 */
export function appendToContent(content: unknown, text: string, addition: string): unknown {
  if (typeof content === 'string') return `${content}（${addition}）`;

  if (content && typeof content === 'object') {
    const c = { ...(content as Record<string, unknown>) };
    for (const key of LIST_FIELDS) {
      if (Array.isArray(c[key])) {
        return { ...c, [key]: [...(c[key] as unknown[]), addition] };
      }
    }
    for (const key of TEXT_FIELDS) {
      if (typeof c[key] === 'string') {
        return { ...c, [key]: `${c[key]}（${addition}）` };
      }
    }
  }

  // 摘要里没有原始结构（比如客户端自带摘要的端点）—— 退回纯字符串
  return `${text}（${addition}）`;
}

/** 在内容里做一次替换 —— 同样保持原有结构 */
export function replaceInContent(content: unknown, from: string, to: string): unknown {
  if (typeof content === 'string') return content.split(from).join(to);

  if (content && typeof content === 'object') {
    const c = { ...(content as Record<string, unknown>) };
    for (const key of LIST_FIELDS) {
      if (Array.isArray(c[key])) {
        return {
          ...c,
          [key]: (c[key] as unknown[]).map((v) =>
            typeof v === 'string' ? v.split(from).join(to) : v
          ),
        };
      }
    }
    for (const key of TEXT_FIELDS) {
      if (typeof c[key] === 'string') {
        return { ...c, [key]: (c[key] as string).split(from).join(to) };
      }
    }
  }

  return content;
}

/**
 * 把候选元素按新内容重新渲染一遍，确认这段文字**真的画得出来**
 * ---------------------------------------------------------------------------
 * 为什么必须验：
 *   排版盒装不下的块会被整块丢弃，超长的行会被截断补省略号。
 *   于是「IR 里有这段文字」≠「页面上看得见这段文字」。
 *   不验证就直接提交补丁，用户会看到「接口说改好了，页面却一点没变」。
 *
 * 没有主题就验不了 —— 此时保守放行（保持旧行为）。
 */
function rendersAfter(
  entry: EditDigestEntry,
  nextContent: unknown,
  needle: string,
  theme: TemplateTheme | undefined
): boolean {
  if (!theme) return true;
  if (!entry.type || !entry.geometry) return false;

  const candidate: SlideElement = {
    id: entry.id,
    role: entry.role as ElementRole,
    type: entry.type,
    content: nextContent,
    geometry: entry.geometry,
    style: entry.style ?? {},
    editable: entry.editable !== false,
    zIndex: 0,
  };

  return SVGRenderer.rendersText(candidate, theme, needle);
}

/**
 * 本地确定性改写
 * ---------------------------------------------------------------------------
 * 1) 指令里出现明确的替换模式 → 对文本包含 `from` 的元素产出 update_element 补丁
 * 2) 否则 → 把指令作为补充说明追加到最匹配角色的元素
 *
 * 两条路径都遵守同三条底线：
 *   · **不改不可编辑的元素**（背景、装饰件）
 *   · **保持内容结构**（字符串还是字符串，对象还是对象）
 *   · **只提交画得出来的改动** —— 候选元素按优先级一个个试，
 *     装不下就换下一个；一个都装不下就如实说"没改"，不谎报成功
 */
export function localEdit(input: EditAgentInput): { patches: IRPatch[]; message: string } {
  const theme = input.theme;
  const replace = parseReplaceInstruction(input.instruction);

  if (replace) {
    for (const target of pickTargets(input.elementDigest, (e) => e.text.includes(replace.from))) {
      const nextContent = replaceInContent(
        target.content !== undefined ? target.content : target.text,
        replace.from,
        replace.to
      );
      if (!rendersAfter(target, nextContent, replace.to, theme)) continue;

      return {
        patches: [
          {
            operation: 'update_element',
            targetId: target.id,
            changes: { content: nextContent },
            reason: `本地降级：按指令替换「${replace.from}」`,
          },
        ],
        message: `已将「${replace.from}」替换为「${replace.to}」（本地降级执行）`,
      };
    }
  }

  // 通用降级：追加到最匹配角色的元素
  const addition = input.instruction.trim();

  for (const target of pickTargets(input.elementDigest)) {
    const nextContent = appendToContent(
      target.content !== undefined ? target.content : target.text,
      target.text,
      addition
    );
    if (!rendersAfter(target, nextContent, addition, theme)) continue;

    return {
      patches: [
        {
          operation: 'update_element',
          targetId: target.id,
          changes: { content: nextContent },
          reason: '本地降级：按指令追加补充说明',
        },
      ],
      message: `已按指令更新「${target.role}」元素（本地降级执行）`,
    };
  }

  return {
    patches: [],
    message: '本地降级：当前页没有能显示这次改动的文本元素，未产生补丁',
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
