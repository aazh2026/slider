/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 领域内核测试夹具
 * ---------------------------------------------------------------------------
 * 与 `spec/verify/helpers.ts` 有意保持同一套语义，但**不互相 import**：
 * `packages/core/tests` 属于产品代码的回归测试，不应依赖 spec 目录是否存在。
 */

import { LayoutEngine } from '../src/engine/layoutEngine';
import { BUILT_IN_TEMPLATES } from '../src/data/templates';
import type {
  SlideIR,
  SlideLayoutType,
  SlideOutlineItem,
  TemplateTheme,
} from '../src/types/slide';

/** 全部 8 种版式 */
export const ALL_LAYOUTS: SlideLayoutType[] = [
  'title_cover',
  'architecture_diagram',
  'cards_grid',
  'problem_solution',
  'timeline_roadmap',
  'stats_kpi',
  'radial_center',
  'summary_conclusion',
];

/** 全部 8 套主题 —— 来自 BUILT_IN_TEMPLATES */
export const ALL_THEMES: TemplateTheme[] = BUILT_IN_TEMPLATES.map((t) => t.theme);

/** 主题的稳定标识 —— 快照文件名用它，保证文件名不随数组顺序漂移 */
export const ALL_THEME_IDS: string[] = BUILT_IN_TEMPLATES.map((t) => t.templateId);

/** 8 版式 × 8 主题 = 64 组 */
export const ALL_COMBOS: Array<{ layout: SlideLayoutType; themeId: string; theme: TemplateTheme }> =
  ALL_LAYOUTS.flatMap((layout) =>
    BUILT_IN_TEMPLATES.map((t) => ({ layout, themeId: t.templateId, theme: t.theme }))
  );

/** 构造大纲夹具 —— 只覆盖传入字段，其余给确定性默认值 */
export function makeOutline(partial: Partial<SlideOutlineItem> = {}): SlideOutlineItem {
  return {
    slideId: 's1',
    order: 1,
    title: '黄金快照夹具标题',
    purpose: '黄金快照夹具目的',
    keyMessage: '黄金快照夹具核心结论',
    visualIntent: 'golden snapshot visual intent',
    layoutPreference: 'cards_grid',
    requiredElements: [],
    speakerNotes: '黄金快照夹具演讲者备注',
    bulletPoints: [
      '快照要点一',
      '快照要点二',
      '快照要点三',
      '快照要点四',
    ],
    ...partial,
  };
}

/** 抹掉时间戳类非确定性字段 —— 快照比较的前提（AC-GOV-002） */
export function stripVolatile(slide: SlideIR): SlideIR {
  const clone = structuredClone(slide);
  delete clone.versionId;
  delete clone.lastModified;
  return clone;
}

/** 快照序列化 —— 缩进 2 空格，键序由生成器决定，逐字节可比 */
export function serializeSnapshot(slide: SlideIR): string {
  return `${JSON.stringify(stripVolatile(slide), null, 2)}\n`;
}

/** 生成一页快照 */
export function makeSnapshot(
  layout: SlideLayoutType,
  theme: TemplateTheme,
  order = 1,
  total = 12
): SlideIR {
  return LayoutEngine.generateSlideIR(
    makeOutline({ layoutPreference: layout }),
    theme,
    order,
    total
  );
}
