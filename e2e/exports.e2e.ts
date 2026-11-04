/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 导出链 —— 五种格式各走一遍，产物**回读**校验
 * ---------------------------------------------------------------------------
 * 这一链的判据只有一条：**服务端真的产出了那个格式的字节流**。
 *
 * 以前只有 PPTX 与 PDF 两条，且只看了魔数（PK / %PDF）——
 * 魔数对只能说明"头几个字节像"，不能说明"里面是这份文稿"。
 * 所以这里加了两层：
 *
 *   1. **格式层**：PPTX 是 ZIP、PDF 是 %PDF、PNG 是 PNG 签名、SVG 是 XML、JSON 能解析
 *   2. **内容层**：PPTX 里的 slide XML 必须含有本次生成的主题文字；
 *      JSON 里的 slides 必须与服务端 IR 对得上；
 *      SVG 里必须画出了这一页的标题
 *
 * 内容层是关键 —— 换成一份别的文稿的产物，格式层的断言照样过。
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import JSZip from 'jszip';

import {
  TEST_TIMEOUT,
  apiFetch,
  assertServersUp,
  confirmOutlineViaUi,
  createProjectViaUi,
  generateOutlineViaUi,
  launchHarness,
  registerAndEnterApp,
  unique,
  waitFor,
  type Harness,
  type Session,
} from './helpers';

let harness: Harness;

beforeAll(async () => {
  await assertServersUp();
  harness = await launchHarness();
});

afterAll(async () => {
  await harness?.close();
});

/** 下载产物 —— 走浏览器的会话 Cookie，字节用 base64 带回来 */
async function downloadArtifact(
  session: Session,
  jobId: string
): Promise<{ status: number; contentType: string; length: number; bytes: Uint8Array }> {
  const raw = await session.page.evaluate(async (jid: string) => {
    const res = await fetch(`/api/exports/${jid}/download`, { credentials: 'include' });
    const buf = new Uint8Array(await res.arrayBuffer());
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < buf.length; i += chunk) {
      binary += String.fromCharCode(...buf.subarray(i, i + chunk));
    }
    return {
      status: res.status,
      contentType: res.headers.get('content-type') ?? '',
      length: buf.length,
      base64: btoa(binary),
    };
  }, jobId);

  return {
    status: raw.status,
    contentType: raw.contentType,
    length: raw.length,
    bytes: new Uint8Array(Buffer.from(raw.base64, 'base64')),
  };
}

/** 在 UI 上选格式并发起导出，等任务跑完，返回 jobId */
async function exportViaUi(
  session: Session,
  format: 'pptx' | 'pdf' | 'png' | 'svg' | 'json'
): Promise<string> {
  await session.page.getByTestId('open-export').click();
  await session.page.getByTestId(`export-format-${format}`).click();
  await session.page.getByTestId('export-submit').click();

  const progress = session.page.getByTestId('export-progress');
  await progress.waitFor({ state: 'visible', timeout: 20_000 });

  await waitFor(
    async () => {
      const text = (await progress.textContent()) ?? '';
      if (text.includes('导出失败') || text.includes('导出超时')) {
        throw new Error(`导出失败：${text}`);
      }
      return text.includes('导出成功');
    },
    120_000,
    `${format} 导出任务成功`
  );

  const jobId = await session.page.getByTestId('export-job-id').getAttribute('data-job-id');
  expect(jobId).toBeTruthy();
  return jobId!;
}

/** 关掉导出弹窗 —— 它是全屏遮罩，不关会挡住后续所有点击 */
async function closeExport(session: Session): Promise<void> {
  await session.page.getByTestId('export-close').click();
  await session.page.getByTestId('export-close').waitFor({ state: 'detached', timeout: 10_000 });
}

/** 建一个编译好的项目，返回 { projectId, topic } */
async function setupCompiledProject(
  session: Session,
  label: string
): Promise<{ projectId: string; topic: string }> {
  await registerAndEnterApp(session);
  const projectId = await createProjectViaUi(session, unique(label));
  const topic = unique(`${label} 主题`);
  await generateOutlineViaUi(session, { topic, pageCount: 4 });
  await confirmOutlineViaUi(session);
  return { projectId, topic };
}

describe('导出链（真实浏览器 + 真实服务端）', () => {
  test('AC-E2E-009 PPTX 导出 → 产物是真正的 OOXML，而且里面是这份文稿', async () => {
    const session = await harness.newSession();
    try {
      const { topic } = await setupCompiledProject(session, 'E2E 导出 PPTX');

      const jobId = await exportViaUi(session, 'pptx');
      const artifact = await downloadArtifact(session, jobId);

      expect(artifact.status).toBe(200);
      expect(artifact.length).toBeGreaterThan(1024);
      // ZIP 魔数 PK\x03\x04
      expect(Array.from(artifact.bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);

      // --- 内容层：解包，看第一页的 XML 里有没有本次的主题文字 ---
      const zip = await JSZip.loadAsync(artifact.bytes);
      const slideNames = Object.keys(zip.files).filter(
        (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)
      );
      expect(slideNames.length).toBeGreaterThan(0);

      const firstSlideXml = await zip.file(slideNames[0]!)!.async('string');
      // 主题文字可能被 XML 拆进多个 <a:t> —— 先把标签剥掉再比对
      const text = firstSlideXml.replace(/<[^>]*>/g, '');
      expect(text).toContain(topic);

      await closeExport(session);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('AC-E2E-010 PDF 导出 → 产物是真正的 PDF（%PDF 魔数）', async () => {
    const session = await harness.newSession();
    try {
      await setupCompiledProject(session, 'E2E 导出 PDF');

      const jobId = await exportViaUi(session, 'pdf');
      const artifact = await downloadArtifact(session, jobId);

      expect(artifact.status).toBe(200);
      expect(artifact.contentType).toContain('pdf');
      expect(artifact.length).toBeGreaterThan(1024);
      expect(Buffer.from(artifact.bytes.slice(0, 5)).toString('latin1')).toStartWith('%PDF');

      await closeExport(session);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('PNG 导出 → 产物是真正的 PNG 位图', async () => {
    const session = await harness.newSession();
    try {
      await setupCompiledProject(session, 'E2E 导出 PNG');

      const jobId = await exportViaUi(session, 'png');
      const artifact = await downloadArtifact(session, jobId);

      expect(artifact.status).toBe(200);
      expect(artifact.contentType).toContain('png');
      expect(artifact.length).toBeGreaterThan(1024);
      // PNG 签名 89 50 4E 47 0D 0A 1A 0A
      expect(Array.from(artifact.bytes.slice(0, 8))).toEqual([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      // IEND 结尾 —— 说明文件是完整的，不是被截断的
      expect(Buffer.from(artifact.bytes.slice(-8, -4)).toString('latin1')).toBe('IEND');

      // 像素尺寸 —— PNG 的 IHDR 在第 16~23 字节（宽高各 4 字节大端）。
      // EXP-02 要求 3840×2160（1920×1080 的 2 倍），界面上的按钮也这么写着。
      // 这一条以前没人验：判据 AC-EXP-003 验的是核心库里那条**没人走**的
      // 浏览器 canvas 路径，服务端这条真路一直是 1 倍（1920×1080）而没人发现。
      const pngView = new DataView(
        artifact.bytes.buffer,
        artifact.bytes.byteOffset,
        artifact.bytes.byteLength
      );
      expect({ width: pngView.getUint32(16), height: pngView.getUint32(20) }).toEqual({
        width: 3840,
        height: 2160,
      });

      await closeExport(session);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('SVG 导出 → 产物是真正的 SVG，而且画的是这一页', async () => {
    const session = await harness.newSession();
    try {
      const { topic } = await setupCompiledProject(session, 'E2E 导出 SVG');

      const jobId = await exportViaUi(session, 'svg');
      const artifact = await downloadArtifact(session, jobId);

      expect(artifact.status).toBe(200);
      expect(artifact.contentType).toContain('svg');
      expect(artifact.length).toBeGreaterThan(512);

      const svg = Buffer.from(artifact.bytes).toString('utf-8');
      expect(svg).toContain('<svg');
      expect(svg).toContain('data-slide-id=');
      // 画的是这一页 —— 标题必须出现在 SVG 里
      expect(svg.replace(/<[^>]*>/g, '')).toContain(topic);

      await closeExport(session);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('JSON 导出 → 产物是能解析的 Slide IR，且与服务端一致', async () => {
    const session = await harness.newSession();
    try {
      const { projectId, topic } = await setupCompiledProject(session, 'E2E 导出 JSON');

      const jobId = await exportViaUi(session, 'json');
      const artifact = await downloadArtifact(session, jobId);

      expect(artifact.status).toBe(200);
      expect(artifact.contentType).toContain('json');
      expect(artifact.length).toBeGreaterThan(512);

      const parsed = JSON.parse(Buffer.from(artifact.bytes).toString('utf-8')) as {
        id: string;
        slides: Array<{ slideId: string; elements: Array<{ id: string }> }>;
      };
      expect(parsed.id).toBe(projectId);
      expect(parsed.slides.length).toBe(4);
      expect(parsed.slides[0]!.elements.length).toBeGreaterThan(0);

      // --- 与服务端这一页的 slideId 对得上 ---
      const server = await apiFetch<{ slides: Array<{ slideId: string }> }>(
        session.page,
        `/api/projects/${projectId}/slides`
      );
      expect(server.status).toBe(200);
      expect(parsed.slides.map((s) => s.slideId)).toEqual(
        server.body.data!.slides.map((s) => s.slideId)
      );

      // --- 主题文字确实在产物里 ---
      expect(JSON.stringify(parsed)).toContain(topic);

      await closeExport(session);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);
});
