/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 文本宽度估算与折行
 * ---------------------------------------------------------------------------
 * 去掉 foreignObject 之后（SPEC-RND-002：SVG 里不得出现 foreignObject），
 * 浏览器不再替我们排版 —— 换行必须自己做。
 *
 * 宽度是**估算**而不是实测：渲染期拿不到字体度量信息，
 * 唯一可行的做法是按「全角 1em / 半角 0.56em」估算。
 * 估算刻意偏保守（宁可少折一行，也不要让文字溢出容器）。
 */

/** 是否是全角字符（CJK / 全角标点 / 韩文） */
function isWideChar(ch: string): boolean {
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

/** 单个字符的估算宽度（px） */
export function charWidth(ch: string, fontSize: number): number {
  return isWideChar(ch) ? fontSize : fontSize * 0.56;
}

/** 整段文本的估算宽度（px） */
export function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const ch of text) width += charWidth(ch, fontSize);
  return width;
}

/**
 * 把文本按可用宽度折成多行。
 * 优先在空格后断行；没有空格就硬断 —— 目的是**保证不溢出**，不是追求排版美感。
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
        lines.push(current.slice(0, spaceAt));
        current = current.slice(spaceAt + 1) + ch;
        currentWidth = estimateTextWidth(current, fontSize);
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
