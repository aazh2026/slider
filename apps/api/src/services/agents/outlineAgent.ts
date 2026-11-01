/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Outline Agent（docs/backend-design.md §6.2）
 * ---------------------------------------------------------------------------
 * 职责：需求 → 逐页大纲（每页带 SlideContent 内容槽位）
 *
 * 降级链：primary 模型 → secondary 模型 → **本地确定性实现**（按 topic 动态生成）
 * 硬约束：页数精确匹配；第 1 页 title_cover；至少 1 页 summary_conclusion
 */

import {
  OutlineResponseSchema,
  SlideOutlineItemSchema,
  type PresentationRequirement,
  type SlideContent,
  type SlideOutlineItem,
} from '@ppt/core';

import { ModelRouter, ModelUnavailableError } from '../modelRouter';
import { prompts } from '../../prompts/registry';
import { toProviderSchema } from './schemaFor';
import { generateLocalOutline } from './localOutline';

export interface OutlineAgentResult {
  outline: SlideOutlineItem[];
  /** 来源：模型 or 本地降级 */
  source: 'model' | 'local';
  /** 是否走了降级（降级链触发率是运维告警指标） */
  degraded: boolean;
  provider?: string;
  model?: string;
  /** 降级原因（不泄露密钥） */
  degradeReason?: string;
}

export interface OutlineAgentDeps {
  router: ModelRouter;
}

/** 让模型输出符合硬约束 */
export function conformOutline(
  raw: SlideOutlineItem[],
  requirement: PresentationRequirement
): SlideOutlineItem[] {
  const n = Math.max(1, requirement.pageCount);
  const items = raw.slice(0, n).map((o) => ({ ...o }));

  // 1) 首页必须是 title_cover
  if (items.length > 0 && items[0]!.layoutPreference !== 'title_cover') {
    const first = items[0]!;
    items[0] = {
      ...first,
      layoutPreference: 'title_cover',
      content: {
        ...(first.content ?? {}),
        bullets: first.content?.bullets ?? first.bulletPoints ?? [],
        meta: {
          ...(first.content?.meta ?? {}),
          visualIntent: first.content?.meta?.['visualIntent'] ?? first.visualIntent,
          purpose: first.content?.meta?.['purpose'] ?? first.purpose,
        },
      } as SlideContent,
    };
  }

  // 2) 页数不足 → 用本地生成的页面补齐
  if (items.length < n) {
    const local = generateLocalOutline({
      topic: requirement.topic,
      purpose: requirement.purpose,
      audience: requirement.audience,
      style: requirement.style,
      depth: requirement.depth,
      pageCount: n,
    });
    let li = 1; // 跳过本地的封面页
    for (let i = items.length; i < n; i++) {
      const donor = local[li];
      li += 1;
      if (!donor) break;
      items.push({
        ...donor,
        content: donor.content ? { ...donor.content } : undefined,
      });
    }
  }

  // 3) 至少一页 summary_conclusion
  if (items.length > 0 && !items.some((o) => o.layoutPreference === 'summary_conclusion')) {
    const idx = items.length - 1;
    const last = items[idx]!;
    items[idx] = {
      ...last,
      layoutPreference: 'summary_conclusion',
      content: {
        ...(last.content ?? {}),
        bullets: last.content?.bullets ?? last.bulletPoints ?? [],
        summary:
          last.content?.summary ??
          ({
            headline: last.keyMessage || last.title,
            points: last.bulletPoints.slice(0, 3),
            actions: [],
          } satisfies NonNullable<SlideContent>['summary']),
      } as SlideContent,
    };
  }

  // 4) 重排 slideId / order —— slideId 必须与顺序一致，否则前端与 IR 对不上
  return items.map((o, i) => ({
    ...o,
    slideId: `s${i + 1}`,
    order: i + 1,
  }));
}

export class OutlineAgent {
  constructor(private readonly deps: OutlineAgentDeps) {}

  async generate(requirement: PresentationRequirement): Promise<OutlineAgentResult> {
    const bundle = prompts.outline(requirement);

    try {
      const res = await this.deps.router.invoke({
        agent: 'outline',
        messages: [
          { role: 'system', content: bundle.system },
          { role: 'user', content: bundle.user },
        ],
        responseSchema: toProviderSchema(OutlineResponseSchema),
        parse: OutlineResponseSchema,
        temperature: 0.7,
        maxTokens: 8192,
        cachePrefix: true,
      });

      const parsed = res.raw as { outline: SlideOutlineItem[] };
      const outline = conformOutline(parsed.outline, requirement);

      // 模型输出必须再次过一遍单页 Schema —— 归一化可能引入非法值
      const validated = outline.map((o) => SlideOutlineItemSchema.parse(o));

      return {
        outline: validated,
        source: 'model',
        degraded: false,
        provider: res.provider,
        model: res.model,
      };
    } catch (err) {
      if (err instanceof ModelUnavailableError) {
        const outline = generateLocalOutline({
          topic: requirement.topic,
          purpose: requirement.purpose,
          audience: requirement.audience,
          style: requirement.style,
          depth: requirement.depth,
          pageCount: requirement.pageCount,
        });
        return {
          outline: outline.map((o) => SlideOutlineItemSchema.parse(o)),
          source: 'local',
          degraded: true,
          degradeReason: err.message,
        };
      }
      throw err;
    }
  }
}
