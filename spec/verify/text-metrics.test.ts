/**
 * SPEC-RND-007 —— 文本宽度估算必须区分全角与半角
 * ---------------------------------------------------------------------------
 * 手法：直接量 `textMetrics` 的输出，并**回读产物的估算宽度**，而不是相信
 * 折行函数自己的说法。
 *
 * 这条判据守的是波 2 ④（`docs/quality-strategy.md`）：宽度估算是折行与截断的
 * 精度天花板 —— 它估窄了，文字横向溢出容器（ADR-011 的硬约束）；它估宽了，
 * 白白多折一行、留白变难看。旧模型两头都错：
 *
 *   · `WWWW` 被估成 2.24em，真实约 3.78em —— **横向溢出**；
 *   · `iiii` 被估成 2.24em，真实约 0.89em —— **白折一行**。
 *
 * 根因是「半角」根本不是一个宽度：西文的 advance width 逐字符不同
 * （`i` 0.222em、`m` 0.833em、`W` 0.944em、空格 0.278em）。
 */

import { describe, expect, test } from 'bun:test';
import {
  charWidth,
  estimateTextWidth,
  isWideChar,
  latinCharWidth,
  profileTextWidth,
  wrapText,
} from '../../packages/core/src/engine/textMetrics';

/** 旧模型：半角一律 0.56em —— 这就是本条判据要钉死的「过时口径」 */
const OLD_HALF_WIDTH_EM = 0.56;

/** 标准西文 advance width（Helvetica/Arial，单位 em）—— 参照物，不是被测代码 */
const HELVETICA: Record<string, number> = {
  ' ': 0.278,
  i: 0.222,
  j: 0.222,
  l: 0.222,
  m: 0.833,
  W: 0.944,
  M: 0.833,
  ',': 0.278,
  '.': 0.278,
  '0': 0.556,
};

/** 安全系数 —— 主题字体（Manrope / Inter / 思源）比 Helvetica 略宽 */
const SAFETY = 1.08;

describe('SPEC-RND-007 宽度模型必须区分全角与半角', () => {
  test('text-width-model-is-calibrated', () => {
    const fontSize = 16;

    // ① 全角字符按 1em 精确计宽 —— 各家 CJK 字体都是等宽 1em
    for (const ch of ['中', '文', '，', '。', '한']) {
      expect(isWideChar(ch)).toBe(true);
      expect(charWidth(ch, fontSize)).toBe(fontSize);
      expect(estimateTextWidth(ch, fontSize)).toBe(fontSize);
    }
    for (const ch of ['A', 'a', '1', ' ']) {
      expect(isWideChar(ch)).toBe(false);
    }

    // ② 半角字符落在「标准字宽」与「标准字宽 × 安全系数」之间 ——
    //    不得比标准窄（估窄 = 溢出），也不得比安全系数宽（估太宽 = 白折行）
    for (const [ch, em] of Object.entries(HELVETICA)) {
      const w = latinCharWidth(ch, fontSize);
      expect(w).toBeGreaterThanOrEqual(em * fontSize);
      expect(w).toBeLessThanOrEqual(em * SAFETY * fontSize + 1e-9);
    }
    // 逐字符的差异是这一条的核心 —— 「半角一个宽度」的老口径必须消失
    expect(latinCharWidth('W', fontSize)).toBeGreaterThan(latinCharWidth('m', fontSize));
    expect(latinCharWidth('m', fontSize)).toBeGreaterThan(latinCharWidth('i', fontSize));
    expect(latinCharWidth('i', fontSize)).toBeLessThan(OLD_HALF_WIDTH_EM * fontSize);

    // ③ 旧口径的两个错都必须被纠正
    //    旧口径把 'WWWW' 估成 2.24em，真实约 3.78em —— 少估 40%，文字顶出排版盒
    const wideReal = HELVETICA['W']! * 4 * fontSize;
    const wideOld = OLD_HALF_WIDTH_EM * 4 * fontSize;
    expect(wideOld).toBeLessThan(wideReal);
    const wideNow = estimateTextWidth('WWWW', fontSize);
    expect(wideNow).toBeGreaterThanOrEqual(wideReal);
    expect(wideNow).toBeLessThanOrEqual(wideReal * SAFETY + 1e-9);

    //    旧口径把 'iiii' 估成 2.24em，真实约 0.89em —— 多估 2.5 倍，白折一行
    const narrowReal = HELVETICA['i']! * 4 * fontSize;
    const narrowOld = OLD_HALF_WIDTH_EM * 4 * fontSize;
    expect(narrowOld).toBeGreaterThan(narrowReal * 2);
    const narrowNow = estimateTextWidth('iiii', fontSize);
    expect(narrowNow).toBeGreaterThanOrEqual(narrowReal);
    expect(narrowNow).toBeLessThanOrEqual(narrowReal * SAFETY + 1e-9);
    expect(narrowNow).toBeLessThan(narrowOld / 2);

    // ④ 未知字符按保守口径兜底 —— 不得窄于数字（常用且宽度已知的字符）
    expect(latinCharWidth('€', fontSize)).toBeGreaterThanOrEqual(
      latinCharWidth('0', fontSize)
    );

    // ⑤ 宽度构成必须能对账：「为什么这句比看上去长」只有一个答案 —— 它混排了
    const text = '中英 mixed 混排';
    const p = profileTextWidth(text, fontSize);
    expect(p.wide + p.latin).toBeCloseTo(p.total, 6);
    expect(p.total).toBeCloseTo(estimateTextWidth(text, fontSize), 6);
    expect(p.wideCount).toBe(4);
    expect(p.latinCount).toBe(text.length - 4);
    expect(p.wide).toBe(4 * fontSize);
  });
});

describe('SPEC-RND-007 折出来的每一行都不得超过可用宽度', () => {
  test('wrapped-lines-never-exceed-the-available-width', () => {
    const fontSize = 16;
    const samples = [
      'Hello 世界 this is a mixed 测试 string with more words',
      'i WWWW m, W W W W W W W W W W',
      '中文字符测试 W W W',
      'iiii iiii iiii iiii iiii',
      'WWWWWWWW WWWWWWWW WWWWWWWW',
      'a b W W W W W W W W W W W W W W W W W W',
      '短',
    ];

    for (const text of samples) {
      for (const maxWidth of [40, 60, 80, 100, 120, 200, 300, 600]) {
        const lines = wrapText(text, maxWidth, fontSize);
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
          const w = estimateTextWidth(line, fontSize);
          expect(
            w,
            `折行溢出：${JSON.stringify(text)} @ maxWidth=${maxWidth} → ${JSON.stringify(line)} 宽 ${w.toFixed(2)}`
          ).toBeLessThanOrEqual(maxWidth);
        }
        // 折出来的内容不能丢字（只允许在空格处断开）
        const joined = lines.join('').replace(/\s+/g, '');
        expect(joined).toBe(text.replace(/\s+/g, ''));
      }
    }
  });
});
