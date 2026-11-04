/**
 * SPEC-EXP-003 PNG 导出为 2 倍分辨率 —— 验的是**产品真正走的那条路**
 * ---------------------------------------------------------------------------
 * 这个文件为什么存在（一次把规格验错了地方）：
 *
 *   判据 AC-EXP-003 写的是「断言光栅化目标画布尺寸为 3840×2160，
 *   且等于 slide.canvas 的两倍」，权威来源是 docs/backend-features.md §J EXP-02：
 *
 *       「`@resvg/resvg-js` 3840×2160，无需浏览器」
 *
 *   注意原文说的是 **resvg**、**无需浏览器** —— 判据指向的是**服务端**那条路。
 *   但它此前验的是 `ExportEngine.exportSlideAsPng` —— 核心库里一条**浏览器 canvas**
 *   的实现：整个仓库里除了 `export-pptx.test.ts` 没有任何调用者，
 *   前端导出走的是 `POST /api/exports` → `exportService.renderExport` → resvg。
 *
 *   后果是判据「通过」而产品是错的：服务端那条路写的是 `svgToPng(svg, 1920)`，
 *   也就是**与画布同宽的 1 倍**。界面上的按钮却写着「2x 超清光栅化图片」「3840×2160」。
 *   一个假 DOM shim 让判据看起来是绿的 —— 它证明的是
 *   「一条没人走的路被问出了 3840×2160」，不是「导出的 PNG 是 3840×2160」。
 *
 * 这个文件把判据挪回产品路径：**回读服务端产出的 PNG 文件头**，
 * 读 IHDR 里的宽高 —— 不信导出函数的返回值，也不装假 DOM。
 * （判据的修订记录见 spec.yaml DEC-015。）
 *
 * 手艺上照 spec/README.md「验证器怎么写」：
 *   2. 验产物，不信返回值 —— 断言的是 PNG 字节流里的真实像素尺寸；
 *   1. 断言写在 test 里，不藏在 helper 里。
 */

import { describe, expect, test } from 'bun:test';
import JSZip from 'jszip';

import { renderExport } from '../../apps/api/src/services/exportService';
import { makeProject, makeSlide } from './helpers';

/**
 * 回读 PNG 的真实像素尺寸。
 * ---------------------------------------------------------------------------
 * PNG 文件头：8 字节签名 + 4 字节长度 + 4 字节 "IHDR" + **4 字节宽 + 4 字节高**。
 * 宽高从第 16 字节起，各 4 字节大端 —— 这是 PNG 格式的规定，不是实现细节。
 */
function pngPixelSize(bytes: Uint8Array): { width: number; height: number } {
  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    expect(bytes[i]).toBe(PNG_SIGNATURE[i]!);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** EXP-02 规定的光栅化尺寸 */
const EXPECTED = { width: 3840, height: 2160 };

describe('SPEC-EXP-003 PNG 光栅化必须是 2 倍分辨率（产品路径：服务端 resvg）', () => {
  test('server-png-export-is-2x', async () => {
    const slide = makeSlide('cards_grid', { slideId: 'png2x' });
    const project = makeProject([slide], { name: 'fixture' });

    const rendered = await renderExport(project, 'png');

    // 单页导出直接给 PNG 字节（多页才打 zip）
    expect(rendered.mime).toBe('image/png');
    expect(pngPixelSize(rendered.bytes)).toEqual(EXPECTED);

    // 判据的第二句：必须等于 slide.canvas 的两倍
    expect(rendered.bytes.length).toBeGreaterThan(0);
    expect(EXPECTED.width).toBe(slide.canvas.width * 2);
    expect(EXPECTED.height).toBe(slide.canvas.height * 2);
  });

  test('server-png-export-zip-is-2x', async () => {
    // 多页导出走 zip 分支 —— 两条分支都得是 2 倍，不能只修一条
    const slides = [
      makeSlide('cards_grid', { slideId: 'png2x-1', order: 1, total: 2 }),
      makeSlide('title_cover', { slideId: 'png2x-2', order: 2, total: 2 }),
    ];
    const project = makeProject(slides, { name: 'fixture' });

    const rendered = await renderExport(project, 'png');
    expect(rendered.mime).toBe('application/zip');

    const zip = await JSZip.loadAsync(rendered.bytes);
    const pngNames = Object.keys(zip.files).filter((n) => n.endsWith('.png'));
    expect(pngNames.length).toBe(2);

    for (const name of pngNames) {
      const entry = zip.file(name)!;
      const bytes = new Uint8Array(await entry.async('uint8array'));
      expect({ name, size: pngPixelSize(bytes) }).toEqual({ name, size: EXPECTED });
    }
  });

  test('server-pdf-export-is-unaffected-by-the-png-doubling', async () => {
    // PNG 改成 2 倍不能顺手把 PDF 也改了 ——
    // PDF 页面就是 1920×1080，位图 1:1 嵌入才是像素对齐（EXP-02 只约束 PNG）。
    const slide = makeSlide('cards_grid', { slideId: 'pdf1x' });
    const project = makeProject([slide], { name: 'fixture' });

    const rendered = await renderExport(project, 'pdf');
    expect(rendered.mime).toBe('application/pdf');
    expect(Buffer.from(rendered.bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
  });
});
