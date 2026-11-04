/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 主题重映射：把元素按新主题重新配色
 * ---------------------------------------------------------------------------
 * 这一段逻辑曾经在三处各抄了一份（App 的主题快切、Workbench 的换模板、
 * TemplateCenter 的应用模板），抄到第三份时已经抄错了一个字段：App 那份给
 * divider 写的是 `style.color`，而分隔线画的是 `style.backgroundColor` ——
 * 于是换主题后强调线**不换色**。三份实现、三种行为，正是「逻辑散落」的
 * 典型代价。现在只有这一份。
 *
 * 配色判断一律读 `variant` 字段（ADR-018），不猜 ID 字符串。
 */

import type { SlideElement, SlideIR, TemplateTheme } from '../types/slide';
import { followsAccentColor, layerOf, variantOf } from './elementVariant';

/**
 * 把一页的所有元素重映射到新主题
 * ---------------------------------------------------------------------------
 * 规则按「谁最具体谁先判」的顺序：背景 → 页眉 → 标题 → 副标题/页脚 →
 * 卡片/层/指标 → 徽标 → 分隔线。页眉虽然 role 是 subtitle，但它要跟随
 * accent 色，必须排在 role 分支前面。
 */
export function remapElementsToTheme(
  elements: SlideElement[],
  theme: TemplateTheme
): SlideElement[] {
  return elements.map((el) => {
    // 背景 —— 整页底色
    if (layerOf(el) === 'background') {
      return { ...el, style: { ...el.style, backgroundColor: theme.backgroundColor } };
    }
    // 页眉 —— 唯一「副标题但用 accent 色」的槽位
    if (variantOf(el) === 'header') {
      return { ...el, style: { ...el.style, color: theme.accentColor } };
    }
    // 标题
    if (el.role === 'title') {
      return { ...el, style: { ...el.style, color: theme.textPrimary } };
    }
    // 副标题 / 页码 / 页脚
    if (el.role === 'subtitle' || el.role === 'footer') {
      return { ...el, style: { ...el.style, color: theme.textSecondary } };
    }
    // 卡片 / 架构层 / 指标块
    if (el.role === 'card' || el.role === 'layer' || el.role === 'metric') {
      return {
        ...el,
        style: {
          ...el.style,
          backgroundColor: theme.surfaceColor,
          borderColor: theme.surfaceBorder,
          color: theme.textPrimary,
        },
      };
    }
    // 徽标（含封面 kicker、时间轴节点）
    if (el.role === 'badge') {
      return {
        ...el,
        style: {
          ...el.style,
          color: theme.accentColor,
          backgroundColor: theme.isDark ? `${theme.accentColor}20` : `${theme.accentColor}15`,
          borderColor: theme.accentColor,
        },
      };
    }
    // 分隔线 —— accent 线跟随强调色，其余用描边色
    // 注意：分隔线画的是 backgroundColor，不是 color（波 2 ① 修掉的真 bug）
    if (el.role === 'divider') {
      return {
        ...el,
        style: {
          ...el.style,
          backgroundColor: followsAccentColor(el) ? theme.accentColor : theme.surfaceBorder,
        },
      };
    }
    return el;
  });
}

/** 把整份文稿的每一页重映射到新主题 */
export function remapSlidesToTheme(slides: SlideIR[], theme: TemplateTheme): SlideIR[] {
  return slides.map((s) => ({ ...s, elements: remapElementsToTheme(s.elements, theme) }));
}
