/**
 * SPEC-EXP-001 .. SPEC-EXP-004 —— 导出契约
 * ---------------------------------------------------------------------------
 * 手法：导出后**回读产物**（解包 pptx 的 XML），而不是相信导出函数自己的返回值。
 * PPTX 产物用 JSZip 解包 —— 它就是 pptxgenjs 自己写包用的那套实现，读写同源。
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { ExportEngine } from '../../packages/core/src/engine/exportEngine';
import type { PresentationProject, SlideIR } from '../../packages/core/src/types/slide';
import {
  ALL_LAYOUTS,
  ALL_THEMES,
  collectScalarTexts,
  extractTextRuns,
  installDomShim,
  makeProject,
  makeSlide,
  unescapeXml,
  uninstallDomShim,
} from './helpers';

/** 导出 PPTX 到临时目录并解包，返回各部件的 XML 文本 */
async function exportAndUnpack(project: PresentationProject): Promise<{
  dir: string;
  files: string[];
  slideXml: string[];
  notesXml: string[];
}> {
  const dir = mkdtempSync(join(tmpdir(), 'pptspec-'));
  const cwd = process.cwd();
  try {
    process.chdir(dir);
    await ExportEngine.exportPresentationAsPptx(project);
  } finally {
    process.chdir(cwd);
  }

  const files = readdirSync(dir);
  const pptxName = files.find((f) => f.endsWith('.pptx'));
  expect(pptxName).toBeDefined();

  const zip = await JSZip.loadAsync(
    await Bun.file(join(dir, pptxName!)).arrayBuffer()
  );

  const slideXml: string[] = [];
  for (let i = 1; i <= project.slides.length; i++) {
    const entry = zip.file(`ppt/slides/slide${i}.xml`);
    slideXml.push(entry ? await entry.async('string') : '');
  }

  const notesXml: string[] = [];
  for (const path of Object.keys(zip.files)) {
    if (/^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(path)) {
      notesXml.push(await zip.file(path)!.async('string'));
    }
  }

  return { dir, files, slideXml, notesXml };
}

describe('SPEC-EXP-001 PPTX 导出必须保留 IR 中的文本内容', () => {
  test('pptx-preserves-ir-text-content', async () => {
    const slides: SlideIR[] = ALL_LAYOUTS.map((layout, i) =>
      makeSlide(layout, {
        slideId: `ex${i + 1}`,
        order: i + 1,
        total: ALL_LAYOUTS.length,
        // stats_kpi 的指标值取自「以数字开头」的要点。用通用标记串会让该分支永远
        // 产出空值 —— 指标卡的内容就永远进不了验证范围，等于这条判据只验了一半。
        outline:
          layout === 'stats_kpi'
            ? { bulletPoints: ['99% 目标达成率', '128 家企业客户', '3.5 倍 交付效率'] }
            : layout === 'cards_grid'
              ? // 含换行的 IR 字符串：PPTX 段落以换行为界，必然被拆进多个 <a:t>。
                // 判据单位是「行」而非「字符串」（见 spec.yaml DEC-003），
                // 所以这里必须真的放一条多行内容进去，否则这条分支永远验不到。
                { bulletPoints: ['多行要点：第一行正文\n第二行正文'] }
              : {},
      })
    );
    const project = makeProject(slides, { name: 'fixture' });

    const { dir, slideXml } = await exportAndUnpack(project);
    const problems: string[] = [];

    try {
      slides.forEach((slide, i) => {
        const runs = new Set(
          extractTextRuns(slideXml[i] ?? '').filter((r) => r.length > 0)
        );

        // IR 侧的「行」集合：每个非空字符串内容按 \n 拆行
        const irLines = new Set<string>();
        for (const el of slide.elements) {
          if (el.role === 'background') continue;
          for (const text of collectScalarTexts(el.content)) {
            for (const line of text.split('\n')) {
              const t = line.trim();
              if (t.length > 0) irLines.add(t);
            }
          }
        }

        // 集合相等：既不缺（正文丢失），也不多（凭空多出的固定文案）
        for (const line of irLines) {
          if (!runs.has(line)) {
            problems.push(`slide${i + 1} 缺失 IR 行 ${JSON.stringify(line.slice(0, 40))}`);
          }
        }
        for (const run of runs) {
          if (!irLines.has(run)) {
            problems.push(`slide${i + 1} 多出非 IR 文本 ${JSON.stringify(run.slice(0, 40))}`);
          }
        }
      });
      expect(problems).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('SPEC-EXP-002 PPTX 写入演讲者备注', () => {
  test('pptx-includes-speaker-notes', () => {
    const notes = '这是第一页的演讲者备注：请先讲结论再讲论据。';
    const slide = makeSlide('cards_grid', { slideId: 'note1', outline: { speakerNotes: notes } });
    const project = makeProject([slide], { name: 'fixture' });

    return exportAndUnpack(project).then(({ dir, notesXml }) => {
      try {
        expect(notesXml.length).toBe(1);
        expect(unescapeXml(notesXml[0] ?? '')).toContain(notes);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});

/**
 * SPEC-EXP-003 PNG 导出为 2 倍分辨率 —— **核心库的浏览器 canvas 实现**
 * ---------------------------------------------------------------------------
 * 这个用例验的是 `ExportEngine.exportSlideAsPng`（浏览器里用 canvas 光栅化）。
 *
 * ⚠️ 它**不是**产品走的路：产品导出走 `POST /api/exports` →
 * `exportService.renderExport` → resvg（服务端），那条路的 2× 由
 * `spec/verify/export-png-resolution.test.ts` 验。
 *
 * 以前判据 AC-EXP-003 挂的是**这个**用例 —— 于是判据是绿的、产品是错的
 * （服务端当时是 1 倍，而界面写着「3840×2160」）。判据已于 DEC-015 改挂产品路径；
 * 这个用例保留下来，因为它验的仍是一个对外 API 的契约。
 */
describe('SPEC-EXP-003 PNG 导出为 2 倍分辨率（核心库浏览器 canvas 路径）', () => {
  test('png-export-is-2x', async () => {
    const shim = installDomShim();
    try {
      const slide = makeSlide('cards_grid', { slideId: 'png1' });
      await ExportEngine.exportSlideAsPng(slide, ALL_THEMES[0]);

      expect(shim.canvases.length).toBe(1);
      const canvas = shim.canvases[0]!;
      expect({ width: canvas.width, height: canvas.height }).toEqual({
        width: 3840,
        height: 2160,
      });
      // 必须等于 slide.canvas 的两倍
      expect(canvas.width).toBe(slide.canvas.width * 2);
      expect(canvas.height).toBe(slide.canvas.height * 2);
    } finally {
      uninstallDomShim();
    }
  });
});

describe('SPEC-EXP-004 导出文件名清洗且扩展名正确', () => {
  test('export-filename-sanitized', async () => {
    const ILLEGAL = /[\s/\\:*?"<>|]/;
    const shim = installDomShim();
    const dir = mkdtempSync(join(tmpdir(), 'pptspec-name-'));

    try {
      const name = 'Q3 规划: 草案';
      const slide = makeSlide('cards_grid', {
        slideId: 'fn1',
        outline: { title: name },
      });
      const project = makeProject([slide], { name });

      // 1) SVG
      ExportEngine.exportSlideAsSvg(slide, ALL_THEMES[0]);
      // 2) JSON
      ExportEngine.exportProjectAsJson(project);
      // 3) PPTX（真实落盘，文件名从目录里读回来）
      const cwd = process.cwd();
      try {
        process.chdir(dir);
        await ExportEngine.exportPresentationAsPptx(project);
      } finally {
        process.chdir(cwd);
      }
      const pptxName = readdirSync(dir).find((f) => f.endsWith('.pptx'))!;

      const svgName = shim.downloads[0] ?? '';
      const jsonName = shim.downloads[1] ?? '';
      expect(svgName.endsWith('.svg')).toBe(true);
      expect(jsonName.endsWith('.json')).toBe(true);
      expect(pptxName.endsWith('.pptx')).toBe(true);

      const offenders: string[] = [];
      for (const [label, filename] of [
        ['svg', svgName],
        ['json', jsonName],
        ['pptx', pptxName],
      ] as const) {
        if (ILLEGAL.test(filename)) offenders.push(`${label} → ${JSON.stringify(filename)}`);
      }
      expect(offenders).toEqual([]);

      // 文件系统非法字符 '/' 也必须被剥离（用不会落盘的 SVG 路径观察）
      const slashSlide = makeSlide('cards_grid', {
        slideId: 'fn2',
        outline: { title: 'Q3 / 规划' },
      });
      ExportEngine.exportSlideAsSvg(slashSlide, ALL_THEMES[0]);
      const slashName = shim.downloads[2] ?? '';
      expect(slashName.includes('/')).toBe(false);
    } finally {
      uninstallDomShim();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
