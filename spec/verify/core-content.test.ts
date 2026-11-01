/**
 * SPEC-CORE-008 / 009 / 010 —— 版式内容不得回落到硬编码演示文案
 * ---------------------------------------------------------------------------
 * 判定手法：给要点塞入专属标记串（ZQ7MARKER 前缀）。
 *   · 标记串出现在渲染内容里  → 版式确实消费了 outline.bulletPoints
 *   · 标记串不出现            → 版式回落到了与输入无关的固定演示文案
 * 标记串由本文件自己生成，不来自任何演示数据集，因此不存在「碰巧命中硬编码文案」的可能。
 */

import { describe, expect, test } from 'bun:test';
import {
  BULLET_CONSUMING_LAYOUTS,
  MARKER,
  makeOutline,
  makeSlide,
  slideTexts,
} from './helpers';

describe('SPEC-CORE-008 消费 bullets 的 7 种版式必须使用 outline.bulletPoints', () => {
  test('bullet-consuming-layouts-use-outline-bullets', () => {
    const missing: string[] = [];
    for (const layout of BULLET_CONSUMING_LAYOUTS) {
      const bullets = Array.from({ length: 4 }, (_, i) => `${MARKER}_${layout}_P${i + 1}`);
      const slide = makeSlide(layout, { slideId: `c_${layout}`, outline: { bulletPoints: bullets } });
      const texts = slideTexts(slide);
      for (const bullet of bullets) {
        if (!texts.some((t) => t.includes(bullet))) {
          missing.push(`${layout} 缺少要点 ${bullet}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('SPEC-CORE-009 封面内容必须可追溯到 outline 字段', () => {
  test('cover-content-traceable-to-outline', () => {
    const outline = makeOutline({
      slideId: 'cover_trace',
      layoutPreference: 'title_cover',
      title: '可追溯的封面标题',
      purpose: '可追溯的封面副标题',
      keyMessage: '可追溯的核心结论',
      visualIntent: '可追溯的视觉意图',
    });
    const slide = makeSlide('title_cover', { slideId: 'cover_trace', outline });

    // outline 中所有可作为内容来源的字段值
    const sources = [
      outline.title,
      outline.purpose,
      outline.keyMessage,
      outline.visualIntent,
      outline.speakerNotes,
      ...outline.bulletPoints,
    ].filter((s) => s.length > 0);

    const untraceable: string[] = [];
    for (const text of slideTexts(slide)) {
      const t = text.trim();
      if (t.length === 0) continue;
      const traced = sources.some((src) => src.includes(t) || t.includes(src));
      if (!traced) untraceable.push(t);
    }
    expect(untraceable).toEqual([]);
  });
});

describe('SPEC-CORE-010 渲染结果必须随 outline.bulletPoints 改变而改变', () => {
  test('render-output-follows-outline-bullets', () => {
    const problems: string[] = [];
    for (const layout of BULLET_CONSUMING_LAYOUTS) {
      const bulletsA = Array.from({ length: 4 }, (_, i) => `${MARKER}_A_${layout}_${i + 1}`);
      const bulletsB = Array.from({ length: 4 }, (_, i) => `${MARKER}_B_${layout}_${i + 1}`);

      const contentA = slideTexts(
        makeSlide(layout, { slideId: `m_${layout}`, outline: { bulletPoints: bulletsA } })
      );
      const contentB = slideTexts(
        makeSlide(layout, { slideId: `m_${layout}`, outline: { bulletPoints: bulletsB } })
      );

      if (JSON.stringify([...contentA].sort()) === JSON.stringify([...contentB].sort())) {
        problems.push(`${layout} 换掉 bulletPoints 后渲染结果完全不变 —— 内容与输入无关`);
      }
      for (const a of bulletsA) {
        if (contentB.some((t) => t.includes(a))) {
          problems.push(`${layout} 的第二次渲染残留了第一次的要点 ${a}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('夹具自检 —— 标记串不得与任何固定演示文案重合', () => {
  test('marker-prefix-is-unique-to-fixture', () => {
    expect(MARKER).toBe('ZQ7MARKER');
    // 标记串必须出现在 bulletPoints 里，且不能出现在 outline 的其他字段中
    const outline = makeOutline({
      bulletPoints: [`${MARKER}_X_1`],
      title: '普通标题',
      purpose: '普通目的',
    });
    expect(outline.bulletPoints[0].startsWith(MARKER)).toBe(true);
    expect(outline.title.includes(MARKER)).toBe(false);
  });
});
