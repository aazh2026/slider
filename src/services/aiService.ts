/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AI 服务 —— 全部走后端 Agent
 * ---------------------------------------------------------------------------
 *   POST /api/ai/requirement            需求结构化
 *   POST /api/ai/outline                大纲 + 内容槽位生成
 *   POST /api/ai/slides/:slideId/suggest 单页内容重写（补丁协议）
 *
 * ---------------------------------------------------------------------------
 * **前端不再自己"兜底编内容"**
 *
 * 旧版前端在请求失败时直接返回一份写死的「企业 AI Agent 技术架构规划」六页大纲 ——
 * 那正是 docs/architecture.md §7.2 点名的反模式：
 *
 *   > 本地实现必须按 requirement.topic **动态生成**，
 *   > 不能像现状那样对所有主题返回同一份"企业 AI Agent 技术架构规划"大纲。
 *
 * 现在降级逻辑在**服务端**（`generateLocalOutline`），按 topic 动态生成。
 * 前端拿到的 `degraded: true` 是**真实的服务端降级结果**，不是前端伪造的兜底。
 * 服务端连不上时前端**如实报错**—— 编一份看起来像样的大纲，
 * 只会在用户把方案讲出去之后才暴露问题。
 *
 * ---------------------------------------------------------------------------
 * **AI 编辑返回的是补丁，不是全量元素**
 *
 * docs/backend-design.md §4.3：AI 返回 `{ patches: IRPatch[], message }`，
 * 由后端 `patchApplier.ts` 统一施加。前端拿到的是补丁列表 + 施加后的 IR，
 * 不再自己"改元素数组"。
 */

import type {
  IRPatch,
  PresentationRequirement,
  SlideContent,
  SlideOutlineItem,
} from '@ppt/core';

import { api } from './apiClient';

export interface AISourceInfo {
  /** 'model' | 'local' —— 内容来自模型还是本地降级 */
  source: string;
  /** 是否走了降级链 */
  degraded: boolean;
}

export interface ElementDigestEntry {
  id: string;
  role: string;
  text: string;
}

export const AIService = {
  /**
   * 需求结构化
   */
  async extractRequirement(
    prompt: string,
    options: {
      documentText?: string;
      audience?: string;
      purpose?: string;
      pageCount?: number;
      style?: string;
      depth?: string;
    } = {}
  ): Promise<{ requirement: PresentationRequirement } & AISourceInfo> {
    return api.post<{ requirement: PresentationRequirement } & AISourceInfo>(
      '/api/ai/requirement',
      {
        prompt,
        documentText: options.documentText,
        audience: options.audience,
        purpose: options.purpose,
        pageCount: options.pageCount,
        style: options.style,
        depth: options.depth,
      }
    );
  },

  /**
   * 大纲生成
   */
  async generateOutline(
    requirement: PresentationRequirement
  ): Promise<{ outline: SlideOutlineItem[] } & AISourceInfo> {
    return api.post<{ outline: SlideOutlineItem[] } & AISourceInfo>('/api/ai/outline', {
      requirement,
    });
  },

  /**
   * 单页内容重写 —— 返回增量补丁
   */
  async suggestSlideEdits(input: {
    slideId: string;
    instruction: string;
    layout?: string;
    currentContent?: SlideContent;
    elementDigest?: ElementDigestEntry[];
  }): Promise<{ patches: IRPatch[]; message: string } & AISourceInfo> {
    return api.post<{ patches: IRPatch[]; message: string } & AISourceInfo>(
      `/api/ai/slides/${input.slideId}/suggest`,
      {
        slideId: input.slideId,
        instruction: input.instruction,
        layout: input.layout,
        currentContent: input.currentContent ?? { bullets: [] },
        elementDigest: input.elementDigest ?? [],
      }
    );
  },
};
