/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Requirement Agent（docs/backend-design.md §6.2）
 * ---------------------------------------------------------------------------
 * 职责：自由文本 → 结构化需求规格（PresentationRequirement）
 *
 * 降级链：primary 模型 → secondary 模型 → 本地确定性解析（正则抽页数/受众/风格）
 * **降级结果的主题词来自用户输入**，不是写死的示例（AC-NFR-003 的同源要求）。
 */

import { PresentationRequirementSchema, type PresentationRequirement } from '@ppt/core';

import { ModelRouter, ModelUnavailableError } from '../modelRouter';
import { prompts } from '../../prompts/registry';
import { toProviderSchema } from './schemaFor';
import { generateLocalRequirement, type LocalRequirementContext } from './localRequirement';

export interface RequirementAgentResult {
  requirement: PresentationRequirement;
  source: 'model' | 'local';
  degraded: boolean;
  provider?: string;
  model?: string;
  degradeReason?: string;
}

export interface RequirementAgentDeps {
  router: ModelRouter;
}

export class RequirementAgent {
  constructor(private readonly deps: RequirementAgentDeps) {}

  async generate(input: LocalRequirementContext): Promise<RequirementAgentResult> {
    const bundle = prompts.requirement(input);

    try {
      const res = await this.deps.router.invoke({
        agent: 'requirement',
        messages: [
          { role: 'system', content: bundle.system },
          { role: 'user', content: bundle.user },
        ],
        responseSchema: toProviderSchema(PresentationRequirementSchema),
        parse: PresentationRequirementSchema,
        temperature: 0.3,
        maxTokens: 2048,
        cachePrefix: true,
      });

      return {
        requirement: res.raw as PresentationRequirement,
        source: 'model',
        degraded: false,
        provider: res.provider,
        model: res.model,
      };
    } catch (err) {
      if (err instanceof ModelUnavailableError) {
        return {
          requirement: generateLocalRequirement(input),
          source: 'local',
          degraded: true,
          degradeReason: err.message,
        };
      }
      throw err;
    }
  }
}
