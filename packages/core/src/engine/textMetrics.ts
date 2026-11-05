/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 文本宽度估算与折行
 * ---------------------------------------------------------------------------
 * 去掉 foreignObject 之后（SPEC-RND-002：SVG 里不得出现 foreignObject），
 * 浏览器不再替我们排版 —— 换行必须自己做。
 *
 * **中英混排不是一个宽度模型能搞定的**（波 2 ④）。
 *
 * 过去的模型是「全角 1em / 半角 0.56em」。它两头都错：
 *
 *   · `WWWW` 被估成 2.24em，实际要 3.78em —— 文字**横向溢出容器**；
 *   · `iiii` 被估成 2.24em，实际只要 0.89em —— 白白多折一行、留白变难看。
 *
 * 根因是「半角」根本不是一个宽度：西文的 advance width 逐字符不同
 * （`i` 0.22em、`m` 0.83em、`W` 0.94em、` ` 0.28em）。
 *
 * 现在的模型分两路：
 *
 *   · **全角字符**（CJK / 全角标点 / 韩文）—— 1em。各家 CJK 字体都是等宽
 *     1em，这一路不需要查表。
 *   · **半角字符** —— 查一张**标准西文 advance width 表**（单位 1/1000 em）。
 *     表取 Helvetica/Arial 的字形宽度：这些主题字体（Manrope / Inter / 思源）
 *     都与它同源，且是最保守的一档（见下）。
 *
 * **保守性**：主题字体比 Helvetica 更宽，所以半角部分统一乘一个安全系数
 * `LATIN_SAFETY = 1.08`。宁可少折一行，也不要让文字溢出容器 —— 这是
 * 渲染层唯一不能妥协的约束（ADR-011：不截断就会溢出版心）。
 */

/** 是否是全角字符（CJK / 全角标点 / 韩文） */
export function isWideChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (
    (code >= 0x1100 && code <= 0x115f) || // 谚文字母
    (code >= 0x2e80 && code <= 0x303e) || // CJK 部首与标点
    (code >= 0x3041 && code <= 0x33ff) || // 假名、CJK 兼容
    (code >= 0x3400 && code <= 0x4dbf) || // CJK 扩展 A
    (code >= 0x4e00 && code <= 0x9fff) || // CJK 统一表意文字
    (code >= 0xa000 && code <= 0xa4cf) || // 彝文
    (code >= 0xac00 && code <= 0xd7a3) || // 韩文音节
    (code >= 0xf900 && code <= 0xfaff) || // CJK 兼容表意文字
    (code >= 0xfe30 && code <= 0xfe4f) || // CJK 兼容形式
    (code >= 0xff00 && code <= 0xff60) || // 全角 ASCII
    (code >= 0xffe0 && code <= 0xffe6) || // 全角符号
    (code >= 0x20000 && code <= 0x3fffd) // CJK 扩展 B 及以后
  );
}

/**
 * 标准西文 advance width 表（单位 1/1000 em）
 * ---------------------------------------------------------------------------
 * 取 Helvetica / Arial 的字形宽度 —— 这两套字体的西文宽度在实务上被当作
 * 「西文标准档」：绝大多数无衬线 UI 字体的 `i`/`m`/`W` 与之相差在 ±10% 以内。
 *
 * 表是**只读数据**，不含任何逻辑 —— 逻辑全在下面的取值函数里。
 */
const LATIN_ADVANCE: Readonly<Record<string, number>> = {
  ' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556,
  '8': 556, '9': 556, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556,
  '@': 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278,
  J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222,
  j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333,
  s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  '{': 334, '|': 260, '}': 334, '~': 584,
};

/** 半角字符的安全系数 —— 主题字体比 Helvetica 更宽 */
const LATIN_SAFETY = 1.08;

/** 未知字符的兜底宽度（1/1000 em）—— 与数字同宽，比字母略宽 */
const UNKNOWN_ADVANCE = 556;

/**
 * 单个半角字符的 advance width（px）
 * ---------------------------------------------------------------------------
 * 表里没有的字符按 `UNKNOWN_ADVANCE` 兜底 —— 宁可估宽一点（可能多折一行），
 * 也不要估窄了（文字溢出容器）。
 */
export function latinCharWidth(ch: string, fontSize: number): number {
  const advance = LATIN_ADVANCE[ch] ?? UNKNOWN_ADVANCE;
  return (advance / 1000) * fontSize * LATIN_SAFETY;
}

/**
 * 单个字符的估算宽度（px）
 * ---------------------------------------------------------------------------
 * 全角 1em，半角查表。
 */
export function charWidth(ch: string, fontSize: number): number {
  return isWideChar(ch) ? fontSize : latinCharWidth(ch, fontSize);
}

/**
 * 整段文本的估算宽度（px）
 * ---------------------------------------------------------------------------
 * 这是**折行与截断用的口径**：半角已含安全系数，所以它偏保守 ——
 * 宁可少折一行，也不要让文字溢出容器。
 */
export function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const ch of text ?? '') width += charWidth(ch, fontSize);
  return width;
}

/**
 * 一段文本的宽度构成
 * ---------------------------------------------------------------------------
 * 「为什么这句比看上去长」只有一个答案：它混排了。中文一个顶俩，
 * 英文要看具体字母 —— 没有宽度构成表就说不清。
 */
export interface TextWidthProfile {
  /** 全角部分的总宽（px） */
  wide: number;
  /** 半角部分的总宽（px） */
  latin: number;
  /** 合计（px） */
  total: number;
  /** 全角字符个数 */
  wideCount: number;
  /** 半角字符个数 */
  latinCount: number;
}

/** 分解一段文本的宽度构成 */
export function profileTextWidth(text: string, fontSize: number): TextWidthProfile {
  let wide = 0;
  let latin = 0;
  let wideCount = 0;
  let latinCount = 0;
  for (const ch of text ?? '') {
    if (isWideChar(ch)) {
      wide += fontSize;
      wideCount += 1;
    } else {
      latin += latinCharWidth(ch, fontSize);
      latinCount += 1;
    }
  }
  return { wide, latin, total: wide + latin, wideCount, latinCount };
}

/**
 * 把文本按可用宽度折成多行。
 *
 * 优先在空格后断行；没有空格就硬断 —— 目的是**保证不溢出**，不是追求排版美感。
 * 中英混排时两段都要断得对：西文在空格处断，CJK 任意位置都能断，
 * 而「中英之间」没有空格可断，只能硬断 —— 这是排版规则决定的，不是模型的错。
 */
export function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  const raw = (text ?? '').trim();
  if (!raw) return [];

  const limit = Math.max(fontSize, maxWidth);
  const lines: string[] = [];
  let current = '';
  let currentWidth = 0;

  for (const ch of raw) {
    const w = charWidth(ch, fontSize);
    if (current.length > 0 && currentWidth + w > limit) {
      const spaceAt = current.lastIndexOf(' ');
      if (spaceAt > 0) {
        // 空格断行：空格之前的内容收成一行，当前字接到空格之后的尾段上
        const candidate = current.slice(spaceAt + 1) + ch;
        if (estimateTextWidth(candidate, fontSize) <= limit) {
          lines.push(current.slice(0, spaceAt));
          current = candidate;
          currentWidth = estimateTextWidth(candidate, fontSize);
        } else {
          // 尾段本来就贴着上限，再接一个字就超宽 —— 空格断行救不了，退化成硬断。
          // 不这么判就会漏出一个「估算宽度超过可用宽度」的行（ADR-011 的硬约束）。
          lines.push(current);
          current = ch;
          currentWidth = w;
        }
      } else {
        lines.push(current);
        current = ch;
        currentWidth = w;
      }
    } else {
      current += ch;
      currentWidth += w;
    }
  }

  if (current.length > 0) lines.push(current);
  return lines;
}
