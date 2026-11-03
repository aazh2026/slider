/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 项目「摘要」与「全量」的合并 —— 纯函数
 * ---------------------------------------------------------------------------
 * 为什么单独抽出来：
 *
 *   项目列表接口返回的是**摘要** —— 只有标量字段，`slides` 恒为空数组。
 *   项目详情接口返回的是**全量** —— 带每一页的 IR。
 *
 *   两者混用的后果很具体：拿摘要去覆盖已加载的全量，等于把**每一页的 IR 抹掉**。
 *   工作台于是渲染出一个「零页」的项目 —— 而 `Workbench.tsx` 在零页时
 *   仍一路解引用 `currentSlide`，`Cannot read properties of undefined
 *   (reading 'slideId')` 会把整个应用打崩（仓库里没有错误边界）。
 *
 *   这个 bug 是被 E2E 挖出来的：页面被 vite 热重载 → 走一遍
 *   「会话恢复 → 拉列表 → 拉全量」→ 列表先回来 → 抹掉 IR → 崩。
 *
 * 抽成纯函数是为了**能直接测**：断言逻辑写在测试里，不要藏在组件里。
 */

import type { PresentationProject } from '@ppt/core';

/**
 * 把摘要合并进已加载的全量。
 *
 * **摘要只更新标量字段**（名称、需求、更新时间）——
 * IR / 大纲 / 模板 / 版本历史沿用已加载的那一份。
 *
 * 没有已加载全量的项目，原样返回摘要（它本来就只有标量字段）。
 *
 * @param summaries 列表接口返回的摘要
 * @param loaded    当前内存里的项目（可能是全量，也可能是更早的摘要）
 */
export function mergeProjectSummaries(
  summaries: PresentationProject[],
  loaded: PresentationProject[]
): PresentationProject[] {
  const loadedById = new Map(loaded.map((p) => [p.id, p]));

  return summaries.map((summary) => {
    const previous = loadedById.get(summary.id);
    if (!previous) return summary;

    return {
      ...summary,
      // —— 摘要里根本没有的字段，沿用已加载的那份 ——
      template: previous.template,
      outline: previous.outline,
      slides: previous.slides,
      versions: previous.versions,
      qualityReport: previous.qualityReport,
    };
  });
}

/**
 * 一份文稿的**真实页数**。
 * ---------------------------------------------------------------------------
 * `slideCount` 是服务端 `slides` 表的行数（权威）；`slides.length` 只是
 * "当前内存里加载了几页" —— 作品库只拉摘要，没打开过的文稿恒为 0。
 *
 * 列表上要显示"N 页"、要按页数排序，都必须走这个函数：
 * 直接看 `slides.length` 会把没打开过的文稿全当成 0 页。
 */
export function pageCountOf(project: PresentationProject): number {
  return project.slideCount ?? project.slides.length;
}
