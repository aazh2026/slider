/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 参考文档服务（docs/backend-features.md §L 素材与文档 DOC-01 ~ DOC-07）
 * ---------------------------------------------------------------------------
 *   DOC-01 文档上传     md / txt / pdf / docx；大小上限可配
 *   DOC-03 文本抽取     md/txt 直读；pdf 用 pdfjs-dist；docx 解 OOXML
 *   DOC-04 Zip Bomb 防护 限制条目数、总大小、压缩比
 *   DOC-05 素材与项目绑定 documents 表关联项目
 *   DOC-07 素材删除     删除素材同时清理存储文件
 *
 * 安全（docs/backend-features.md §N SEC-05 / backend-design.md §10）：
 *   - **magic bytes 校验真实类型**，不信任扩展名与 Content-Type
 *   - 大小上限 + zip bomb 防护
 *   - **服务端不执行任何用户文件** —— 只做字节解析，绝不 exec / 动态 import
 */

import JSZip from 'jszip';

import { ApiError } from '../errors';

/* -------------------------------------------------------------------------- */
/* 类型识别                                                                     */
/* -------------------------------------------------------------------------- */

export type DocumentKind = 'markdown' | 'text' | 'pdf' | 'docx';

const MARKDOWN_EXT = /\.(md|markdown)$/i;

/** zip 内部条目 —— 用于 zip bomb 防护（读取声明的解压大小） */
interface ZipEntryInternals {
  _data?: { uncompressedSize?: number };
}

const MAX_ZIP_ENTRIES = 5000;
const MAX_ZIP_UNCOMPRESSED = 64 * 1024 * 1024; // 64MB
const MAX_ZIP_RATIO = 200;

/** 判定是不是 zip 容器 */
function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/** 判定是不是 PDF */
function isPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

/**
 * 纯文本判定
 * ---------------------------------------------------------------------------
 * 没有可靠的「纯文本」魔数 —— 业界通行做法是「能按 UTF-8 解码且不含 NUL / 控制字符」。
 * 扩展名只用来区分 md 与 txt，**不参与是否接受**的判定。
 */
function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  for (const b of sample) {
    if (b === 0) return false;
    // 允许 \t \n \r，其余控制字符视为二进制
    if (b < 0x20 && b !== 9 && b !== 10 && b !== 13) return false;
  }
  return true;
}

/** docx 与 pptx 都是 zip —— 用内部目录区分 */
async function zipLooksLikeDocx(bytes: Uint8Array): Promise<boolean> {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files);
  if (names.includes('word/document.xml')) return true;
  if (names.some((n) => n.startsWith('ppt/'))) return false;
  return false;
}

/**
 * 识别文档真实类型
 * ---------------------------------------------------------------------------
 * 只信任魔数；扩展名仅用于在 md / txt 之间做区分。
 */
export async function detectDocumentKind(
  bytes: Uint8Array,
  filename: string
): Promise<DocumentKind> {
  if (isPdf(bytes)) return 'pdf';
  if (isZip(bytes)) {
    if (await zipLooksLikeDocx(bytes)) return 'docx';
    throw ApiError.validation('不支持的文件类型：仅支持 md / txt / pdf / docx', {
      detected: 'zip-but-not-docx',
    });
  }
  if (looksLikeText(bytes)) {
    return MARKDOWN_EXT.test(filename) ? 'markdown' : 'text';
  }
  throw ApiError.validation('不支持的文件类型：仅支持 md / txt / pdf / docx', {
    detected: 'unknown',
  });
}

/* -------------------------------------------------------------------------- */
/* 文本抽取                                                                     */
/* -------------------------------------------------------------------------- */

const XML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

function decodeXmlEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos);/g, (m) => XML_ENTITIES[m] ?? m);
}

/** docx → 纯文本（解 OOXML） */
export async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);

  // zip bomb 防护（DOC-04）
  const entries = Object.keys(zip.files);
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw ApiError.validation(`docx 条目数超限（${entries.length} > ${MAX_ZIP_ENTRIES}）`);
  }
  let declared = 0;
  for (const name of entries) {
    const internals = zip.files[name] as unknown as ZipEntryInternals;
    const size = internals._data?.uncompressedSize;
    if (typeof size === 'number') declared += size;
  }
  if (declared > MAX_ZIP_UNCOMPRESSED) {
    throw ApiError.validation(`docx 解压总大小超限（${declared} > ${MAX_ZIP_UNCOMPRESSED}）`);
  }
  if (bytes.length > 0 && declared / bytes.length > MAX_ZIP_RATIO) {
    throw ApiError.validation(
      `docx 压缩比异常（${(declared / bytes.length).toFixed(1)} > ${MAX_ZIP_RATIO}）`
    );
  }

  const docFile = zip.file('word/document.xml');
  if (!docFile) throw ApiError.validation('docx 缺少 word/document.xml');

  const xml = await docFile.async('string');
  // 段落换行 → 文本；再剥掉所有标签
  const withBreaks = xml
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:tc>/g, '\t');
  const text = decodeXmlEntities(withBreaks.replace(/<[^>]+>/g, ''));
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

/** pdf → 纯文本（pdfjs-dist） */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  // 动态 import —— pdfjs 体积大，且只在真的传 pdf 时才需要加载
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const task = getDocument({
    data: bytes,
    useSystemFonts: false,
    isEvalSupported: false,
    disableFontFace: true,
  });
  const doc = await task.promise;

  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const line = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (line) pages.push(line);
  }

  await doc.destroy();
  return pages.join('\n').trim();
}

/** 统一入口 —— 按类型抽取纯文本 */
export async function extractDocumentText(
  kind: DocumentKind,
  bytes: Uint8Array
): Promise<string> {
  switch (kind) {
    case 'markdown':
    case 'text':
      return new TextDecoder('utf-8').decode(bytes).trim();
    case 'pdf':
      return extractPdfText(bytes);
    case 'docx':
      return extractDocxText(bytes);
  }
}

/* -------------------------------------------------------------------------- */
/* 上传校验                                                                     */
/* -------------------------------------------------------------------------- */

/** 大小上限 —— 可配（DOC-01「大小上限可配」） */
export function maxDocumentBytes(): number {
  const raw = Number(process.env['DOCUMENT_MAX_BYTES'] ?? 32 * 1024 * 1024);
  return Number.isFinite(raw) && raw > 0 ? raw : 32 * 1024 * 1024;
}

/** 文件名清洗 —— 防路径穿越 */
export function sanitizeFilename(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? 'document';
  return base.replace(/[^\w.\-一-龥 ]/g, '_').slice(0, 120) || 'document';
}

export interface ValidatedUpload {
  kind: DocumentKind;
  filename: string;
  mime: string;
  sizeBytes: number;
}

const MIME_BY_KIND: Record<DocumentKind, string> = {
  markdown: 'text/markdown',
  text: 'text/plain',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** 校验上传文件 —— 魔数 + 大小（SEC-05） */
export async function validateUpload(
  filename: string,
  bytes: Uint8Array
): Promise<ValidatedUpload> {
  if (bytes.length === 0) throw ApiError.validation('上传文件为空');
  const limit = maxDocumentBytes();
  if (bytes.length > limit) {
    throw ApiError.validation(`文件过大（${bytes.length} 字节，上限 ${limit} 字节）`);
  }
  const kind = await detectDocumentKind(bytes, filename);
  return {
    kind,
    filename: sanitizeFilename(filename),
    mime: MIME_BY_KIND[kind],
    sizeBytes: bytes.length,
  };
}
