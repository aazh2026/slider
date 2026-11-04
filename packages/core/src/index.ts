/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * @ppt/core —— 前后端共享的领域内核
 * ---------------------------------------------------------------------------
 * docs/backend-design.md §2.2：
 *
 *   > **`packages/core` 是整个方案的地基**：前端 `import { LayoutEngine } from '@ppt/core'`，
 *   > 后端 `import { LayoutEngine } from '@ppt/core'`。同一份源码，不可能漂移。
 *
 * 这里只导出**跨端共享**的东西。服务端专属（DB、鉴权、模型路由）留在 apps/api。
 */

// ---- 类型 ----
export type {
  SlideLayoutType,
  ElementRole,
  ElementType,
  ElementVariant,
  Geometry,
  ElementStyle,
  SlideElement,
  SlideIR,
  TemplateTheme,
  TemplateIR,
  SlideOutlineItem,
  PresentationRequirement,
  SlideVersion,
  IRPatch,
  QualityIssue,
  QualityReport,
  PresentationProject,
} from './types/slide';

export type { SlideContent } from './types/content';

// ---- 引擎 ----
export { LayoutEngine, splitBullet, contentBullets, distributeEvenly } from './engine/layoutEngine';
export {
  bindContent,
  isLayoutContentConsistent,
  validateContentForLayout,
} from './engine/contentBinding';
export type {
  ContentValidation,
  ContentIssue,
} from './engine/contentBinding';
export { QualityEngine } from './engine/qualityEngine';
export {
  QUALITY_RULES,
  ruleById,
  penaltyOf,
  fixableOf,
  rulesOfDimension,
} from './engine/qualityRules';
export type { QualityDimension, QualityRule } from './engine/qualityRules';
export { SVGRenderer } from './engine/svgRenderer';
export { ExportEngine } from './engine/exportEngine';
export {
  ELEMENT_VARIANTS,
  ALL_ELEMENT_VARIANTS,
  legacyVariantOf,
  variantOf,
  layerOf,
  followsAccentColor,
  idPrefixOf,
  withVariants,
} from './engine/elementVariant';
export type { ElementLayer, ElementVariantSpec } from './engine/elementVariant';
export { remapElementsToTheme, remapSlidesToTheme } from './engine/themeRemap';
export {
  applyPatches,
  applyPatch,
  PatchApplyError,
  deepEqual,
  isWithinCanvas,
} from './engine/patchApplier';
export type { PatchErrorCode } from './engine/patchApplier';

// ---- 契约（Zod）----
export {
  SlideLayoutTypeSchema,
  SLIDE_LAYOUT_TYPES,
  PresentationRequirementSchema,
  SlideContentSchema,
  SlideOutlineItemSchema,
  OutlineResponseSchema,
  RequirementRequestSchema,
  OutlineRequestSchema,
} from './contracts/outline';
export {
  IRPatchSchema,
  IRPatchOperationSchema,
  IRPatchOperation,
  PatchResponseSchema,
} from './contracts/patch';

// ---- 数据 ----
export { BUILT_IN_TEMPLATES } from './data/templates';
export {
  LAYOUT_VISUAL_INTENT,
  defaultVisualIntent,
  LAYOUT_SLOT_CONTRACTS,
  slotContractOf,
} from './data/layoutIntents';
export type {
  ContentSlotKey,
  LayoutSlotContract,
  SlotRequirement,
} from './data/layoutIntents';
export { createStarterProjects } from './data/starterProjects';
