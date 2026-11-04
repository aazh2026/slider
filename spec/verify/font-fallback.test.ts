/**
 * SPEC-EXP-006 —— 字体 fallback 链必须显式覆盖中英混排
 * ---------------------------------------------------------------------------
 * 手法：SVG 侧读 `<style>` 块里真正写出来的 `font-family` 声明；PPTX 侧
 * **回读产物**（解包 pptx 的 XML），而不是相信导出函数自己的返回值。
 *
 * 这条判据守的是 EXP-06「字体名 fallback 链保证中英混排」——
 * 以前 SVG 里根本没有 CJK 字体（只有 `system-ui`），中文靠操作系统兜底，
 * 换台机器字形就变；PPTX 侧则写死一个字体名却没说明为什么是它。
 *
 * 链的内容由 AMB-003 裁决（见 spec.yaml 的 DEC-013）：
 *   · SVG = 主题拉丁字体在前 → **显式命名的 CJK 族**居中 → generic 兜底在后
 *   · PPTX = 单名字体（DrawingML 没有 fallback 链）
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { ExportEngine } from '../../packages/core/src/engine/exportEngine';
import { SVGRenderer } from '../../packages/core/src/engine/svgRenderer';
import {
  CJK_FALLBACK_FAMILIES,
  PPTX_FONT_NAME,
} from '../../packages/core/src/engine/typography';
import type { PresentationProject } from '../../packages/core/src/types/slide';
import { ALL_COMBOS, makeProject, makeSlide } from './helpers';

/** CSS 通用族 —— CJK 族必须排在它们之前 */
const GENERIC_FAMILIES = new Set([
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'sans-serif',
  'serif',
  'monospace',
  'cursive',
  'fantasy',
]);

/** 去掉引号并转小写，用于比较字体族名 */
function normalizeFamily(family: string): string {
  return family.replace(/['"]/g, '').trim().toLowerCase();
}

/** 从 SVG 里取出所有 `font-family: <stack>;` 声明 */
function extractFontStacks(svg: string): string[] {
  const stacks: string[] = [];
  const re = /font-family:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) {
    stacks.push(m[1]!.trim());
  }
  return stacks;
}

/** 把字体栈拆成族名数组 */
function splitStack(stack: string): string[] {
  return stack
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 主题字体栈的第一个族名（拉丁字体） */
function headFamily(stack: string): string {
  return normalizeFamily(splitStack(stack)[0] ?? '');
}

/**
 * 断言一个字体栈满足「CJK 族在 generic 之前」
 * ---------------------------------------------------------------------------
 * 顺序是这条判据的核心：`sans-serif` 在多数系统上确实能显示中文，但那是
 * 「操作系统挑的」，不同机器挑的还不一样；显式命名的 CJK 族排在 generic
 * 之前，才让同一份 SVG 在哪台机器上都长一样。
 */
function expectCjkBeforeGeneric(stack: string, context: string) {
  const parts = splitStack(stack);
  const normalized = parts.map(normalizeFamily);

  // 四个 CJK 族一个都不能少
  for (const cjk of CJK_FALLBACK_FAMILIES) {
    const target = normalizeFamily(cjk);
    expect(
      normalized.includes(target),
      `${context}: 字体栈缺少 CJK 族 ${cjk}\n实际：${stack}`
    ).toBe(true);
  }

  // 第一个 generic 族的位置
  const genericIndex = normalized.findIndex((p) => GENERIC_FAMILIES.has(p));
  if (genericIndex !== -1) {
    for (const cjk of CJK_FALLBACK_FAMILIES) {
      const target = normalizeFamily(cjk);
      const cjkIndex = normalized.indexOf(target);
      expect(
        cjkIndex < genericIndex,
        `${context}: CJK 族 ${cjk} 排在 generic 族之后 —— generic 一旦命中就轮不到 CJK 了\n实际：${stack}`
      ).toBe(true);
    }
  }
}

describe('SPEC-EXP-006 SVG 的字体 fallback 链必须显式覆盖中英混排', () => {
  test('svg-font-stack-has-cjk-fallback', () => {
    // 8 种版式 × 8 套主题 = 64 组，每一组的正文字体栈都要过这一关
    for (const { layout, theme } of ALL_COMBOS) {
      const slide = makeSlide(layout, { theme });
      const svg = SVGRenderer.renderToString(slide, theme);
      const stacks = extractFontStacks(svg);

      expect(stacks.length).toBeGreaterThan(0);

      const bodyHead = headFamily(theme.fontFamily);
      const headingHead = headFamily(theme.fontHeading);

      // 主题的正文字体与标题字体（两者都要有 CJK 兜底）
      const bodyStack = stacks.find((s) => headFamily(s) === bodyHead);
      const headingStack = stacks.find((s) => headFamily(s) === headingHead);

      expect(bodyStack).toBeDefined();
      expect(headingStack).toBeDefined();

      const context = `${layout} / 正文=${bodyHead} 标题=${headingHead}`;
      expectCjkBeforeGeneric(bodyStack!, `${context} / 正文`);
      expectCjkBeforeGeneric(headingStack!, `${context} / 标题`);

      // 主题的拉丁字体必须排在最前 —— 否则中文会先被 CJK 族吃掉
      expect(
        headFamily(bodyStack!),
        `${context}: 主题拉丁字体不再是字体栈的第一个\n实际：${bodyStack}`
      ).toBe(bodyHead);
    }
  });
});

describe('SPEC-EXP-006 PPTX 必须用一个同时覆盖中英的字体名', () => {
  test('pptx-uses-cjk-capable-font', async () => {
    const slide = makeSlide('cards_grid', {});
    const project: PresentationProject = makeProject([slide], { name: '字体夹具' });

    const dir = mkdtempSync(join(tmpdir(), 'fontspec-'));
    const cwd = process.cwd();
    try {
      process.chdir(dir);
      await ExportEngine.exportPresentationAsPptx(project);
    } finally {
      process.chdir(cwd);
    }

    try {
      const files = readdirSync(dir);
      const pptxName = files.find((f) => f.endsWith('.pptx'));
      expect(pptxName).toBeDefined();

      const zip = await JSZip.loadAsync(await Bun.file(join(dir, pptxName!)).arrayBuffer());
      const entry = zip.file('ppt/slides/slide1.xml');
      expect(entry).not.toBeNull();
      const xml = await entry!.async('string');

      // 拉丁字形（a:latin）与东亚字形（a:ea）都必须指向同一个 CJK 字体
      expect(xml.includes(`<a:latin typeface="${PPTX_FONT_NAME}"`)).toBe(true);
      expect(xml.includes(`<a:ea typeface="${PPTX_FONT_NAME}"`)).toBe(true);

      // 不得出现裸的 Arial —— 那是「主题字体栈直接透传」的旧写法
      expect(xml.includes('typeface="Arial"')).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
