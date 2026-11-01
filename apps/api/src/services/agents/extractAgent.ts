/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Template Extractor（docs/backend-design.md §10）
 * ---------------------------------------------------------------------------
 * 现状端点是纯占位（只收 fileName）。这里做**真实**的文件解析：
 *
 *   上传文件 → magic bytes 校验 → （.pptx）解 OOXML 取色板/字体/页面尺寸
 *            → 推导 theme → 对比度校验（WCAG AA）→ TemplateIR
 *
 * 安全（§10 校验与安全）：
 *   - magic bytes 判定真实类型，不信任扩展名与 Content-Type
 *   - zip bomb 防护：限制条目数、解压总大小、压缩比
 *   - 不做用户可控的 URL 抓取（SSRF）
 */

import JSZip from 'jszip';

import type { TemplateIR } from '@ppt/core';

/* -------------------------------------------------------------------------- */
/* 魔数                                                                         */
/* -------------------------------------------------------------------------- */

export type DetectedKind = 'pptx' | 'pdf' | 'png' | 'jpeg' | 'unknown';

export function detectKind(bytes: Uint8Array): DetectedKind {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) return 'pptx'; // PK zip
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50) return 'pdf'; // %PDF
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  return 'unknown';
}

/* -------------------------------------------------------------------------- */
/* 颜色                                                                         */
/* -------------------------------------------------------------------------- */

export function relativeLuminance(hex: string): number {
  const s = hex.replace('#', '');
  const to = (i: number) => {
    const v = parseInt(s.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * to(0) + 0.7152 * to(2) + 0.0722 * to(4);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

function adjustForContrast(bg: string, fg: string): string {
  // 目标 ≥ 4.5:1 —— 背景深就提亮文字，背景浅就压暗文字
  let candidate = fg;
  for (let i = 0; i < 24; i++) {
    if (contrastRatio(bg, candidate) >= 4.5) return candidate;
    const lum = relativeLuminance(candidate);
    candidate = lum > 0.5 ? mix(candidate, '#000000', 0.08) : mix(candidate, '#FFFFFF', 0.08);
  }
  return candidate;
}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.replace('#', ''), 16);
  const pb = parseInt(b.replace('#', ''), 16);
  const ch = (shift: number) => {
    const va = (pa >> shift) & 0xff;
    const vb = (pb >> shift) & 0xff;
    return Math.round(va + (vb - va) * t)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${ch(16)}${ch(8)}${ch(0)}`.toUpperCase();
}

/* -------------------------------------------------------------------------- */
/* PPTX 解析                                                                    */
/* -------------------------------------------------------------------------- */

/** JSZip 内部字段 —— 用于 zip bomb 防护（读取解压后大小） */
interface ZipEntryInternals {
  _data?: { uncompressedSize?: number };
}

const MAX_ENTRIES = 5000;
const MAX_UNCOMPRESSED = 64 * 1024 * 1024; // 64MB
const MAX_RATIO = 200;

export interface PptxTheme {
  palette: Record<string, string>;
  fonts: { major?: string; minor?: string };
  canvas: { width: number; height: number };
}

function readClrScheme(xml: string): Record<string, string> {
  const palette: Record<string, string> = {};
  const schemeMatch = xml.match(/<a:clrScheme[\s\S]*?<\/a:clrScheme>/);
  if (!schemeMatch) return palette;
  const scheme = schemeMatch[0];

  const entryRe = /<a:(dk1|lt1|dk2|lt2|accent[1-6]|hlink|folHlink)>([\s\S]*?)<\/a:\1>/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(scheme)) !== null) {
    const name = m[1]!;
    const body = m[2]!;
    const srgb = body.match(/<a:srgbClr val="([0-9a-fA-F]{6})"/);
    if (srgb) {
      palette[name] = `#${srgb[1]!.toUpperCase()}`;
      continue;
    }
    const sys = body.match(/<a:sysClr[^>]*lastClr="([0-9a-fA-F]{6})"/);
    if (sys) palette[name] = `#${sys[1]!.toUpperCase()}`;
  }
  return palette;
}

function readFontScheme(xml: string): { major?: string; minor?: string } {
  const out: { major?: string; minor?: string } = {};
  const major = xml.match(/<a:majorFont>[\s\S]*?<a:latin typeface="([^"]*)"/);
  if (major?.[1]) out.major = major[1];
  const minor = xml.match(/<a:minorFont>[\s\S]*?<a:latin typeface="([^"]*)"/);
  if (minor?.[1]) out.minor = minor[1];
  return out;
}

function readSlideSize(xml: string): { width: number; height: number } | undefined {
  const m = xml.match(/<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/);
  if (!m?.[1] || !m[2]) return undefined;
  const cx = Number(m[1]);
  const cy = Number(m[2]);
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || cx <= 0 || cy <= 0) return undefined;
  // EMU → px（96dpi，1px = 9525 EMU）
  return { width: Math.round(cx / 9525), height: Math.round(cy / 9525) };
}

export async function parsePptxTheme(bytes: Uint8Array): Promise<PptxTheme> {
  const zip = await JSZip.loadAsync(bytes);

  // zip bomb 防护
  const entries = Object.keys(zip.files);
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`PPTX 条目数超限（${entries.length} > ${MAX_ENTRIES}）`);
  }
  const compressedSize = bytes.length;
  let declared = 0;
  for (const name of entries) {
    const internals = zip.files[name] as unknown as ZipEntryInternals;
    const size = internals._data?.uncompressedSize;
    if (typeof size === 'number') declared += size;
  }
  if (declared > MAX_UNCOMPRESSED) {
    throw new Error(`PPTX 解压总大小超限（${declared} > ${MAX_UNCOMPRESSED}）`);
  }
  if (compressedSize > 0 && declared / compressedSize > MAX_RATIO) {
    throw new Error(`PPTX 压缩比异常（${(declared / compressedSize).toFixed(1)} > ${MAX_RATIO}）`);
  }

  const themeFile =
    zip.file('ppt/theme/theme1.xml') ?? zip.file('ppt/theme/theme2.xml');
  const themeXml = themeFile ? await themeFile.async('string') : '';

  const palette = readClrScheme(themeXml);
  const fonts = readFontScheme(themeXml);

  let canvas = { width: 1920, height: 1080 };
  const presFile = zip.file('ppt/presentation.xml');
  if (presFile) {
    const presXml = await presFile.async('string');
    const size = readSlideSize(presXml);
    if (size) canvas = size;
  }

  return { palette, fonts, canvas };
}

/* -------------------------------------------------------------------------- */
/* 组装                                                                         */
/* -------------------------------------------------------------------------- */

export interface ExtractInput {
  filename: string;
  bytes: Uint8Array;
}

export interface ExtractResult {
  template: TemplateIR;
  /** 来源类型 */
  detected: DetectedKind;
  /** 降级/警告 —— 例如"该格式暂不支持主题提取" */
  warnings: string[];
}

function defaultTemplate(): TemplateIR {
  return {
    templateId: 'tpl_extracted_generic',
    name: '通用提取模板',
    category: '通用',
    description: '由上传文件生成的默认设计系统',
    canvas: { width: 1920, height: 1080 },
    theme: {
      primaryColor: '#2563EB',
      secondaryColor: '#64748B',
      accentColor: '#F59E0B',
      backgroundColor: '#FFFFFF',
      surfaceColor: '#F8FAFC',
      surfaceBorder: '#E2E8F0',
      textPrimary: '#0F172A',
      textSecondary: '#64748B',
      fontFamily: 'Inter',
      fontHeading: 'Inter',
      isDark: false,
    },
    master: {
      showHeader: false,
      showFooter: true,
      footerText: '',
      showSlideNumber: true,
    },
  };
}

function buildTemplateFromPptx(theme: PptxTheme, filename: string): {
  template: TemplateIR;
  warnings: string[];
} {
  const warnings: string[] = [];
  const p = theme.palette;

  const dk1 = p['dk1'] ?? '#0F172A';
  const lt1 = p['lt1'] ?? '#FFFFFF';
  const dk2 = p['dk2'] ?? '#1E293B';
  const lt2 = p['lt2'] ?? '#F1F5F9';
  const accent1 = p['accent1'] ?? '#2563EB';
  const accent2 = p['accent2'] ?? '#7C3AED';
  const accent3 = p['accent3'] ?? '#F59E0B';

  const backgroundColor = lt1;
  const surfaceColor = lt2;
  const isDark = relativeLuminance(backgroundColor) < 0.35;

  let textPrimary = dk1;
  if (contrastRatio(backgroundColor, textPrimary) < 4.5) {
    textPrimary = adjustForContrast(backgroundColor, textPrimary);
    warnings.push('正文色与背景对比度不足，已自动调整以满足 WCAG AA');
  }

  let textSecondary = dk2;
  if (contrastRatio(backgroundColor, textSecondary) < 4.5) {
    textSecondary = adjustForContrast(backgroundColor, textSecondary);
    warnings.push('次要文字色与背景对比度不足，已自动调整以满足 WCAG AA');
  }

  const template: TemplateIR = {
    templateId: `tpl_extracted_${stableHash(filename)}`,
    name: filename.replace(/\.[^.]+$/, ''),
    category: '提取模板',
    description: `从 ${filename} 提取的设计系统`,
    canvas: theme.canvas,
    theme: {
      primaryColor: accent1,
      secondaryColor: accent2,
      accentColor: accent3,
      backgroundColor,
      surfaceColor,
      surfaceBorder: mix(surfaceColor, textPrimary, 0.12),
      textPrimary,
      textSecondary,
      fontFamily: theme.fonts.minor ?? 'Inter',
      fontHeading: theme.fonts.major ?? theme.fonts.minor ?? 'Inter',
      isDark,
    },
    master: {
      showHeader: false,
      showFooter: true,
      footerText: '',
      showSlideNumber: true,
    },
  };

  if (Object.keys(p).length === 0) {
    warnings.push('未能从 PPTX 主题中解析出色板，已回退到默认色板');
  }

  return { template, warnings };
}

/** 稳定哈希 —— 同名文件得到同一个 templateId */
function stableHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export async function extractTemplate(input: ExtractInput): Promise<ExtractResult> {
  const detected = detectKind(input.bytes);

  if (detected === 'pptx') {
    try {
      const theme = await parsePptxTheme(input.bytes);
      const { template, warnings } = buildTemplateFromPptx(theme, input.filename);
      return { template, detected, warnings };
    } catch (err) {
      return {
        template: defaultTemplate(),
        detected,
        warnings: [
          `PPTX 解析失败：${err instanceof Error ? err.message : String(err)} —— 已回退到默认模板`,
        ],
      };
    }
  }

  if (detected === 'pdf') {
    return {
      template: defaultTemplate(),
      detected,
      warnings: ['PDF 主题提取尚未实现（缺 pdfjs-dist 依赖），已回退到默认模板'],
    };
  }

  if (detected === 'png' || detected === 'jpeg') {
    return {
      template: defaultTemplate(),
      detected,
      warnings: ['图片主色提取尚未实现（缺 sharp 依赖），已回退到默认模板'],
    };
  }

  return {
    template: defaultTemplate(),
    detected,
    warnings: ['无法识别的文件格式，已回退到默认模板'],
  };
}
