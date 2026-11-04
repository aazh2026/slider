/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 质量链 —— 体检报告与一键修复
 * ---------------------------------------------------------------------------
 * 判据分两层：
 *
 *   1. **一致性**：界面上显示的综合分，必须等于**服务端权威评分**
 *      （POST /api/quality/evaluate）。前后端跑的是同一份 @ppt/core，
 *      所以两个数字必须一致 —— 不一致就说明有一边的输入不是服务端那份 IR。
 *
 *   2. **落库**：一键修复不是"界面上看着顺眼了"就算数 ——
 *      服务端 slides 表里的 IR 必须真的被改写，versionId 必须前进。
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import {
  TEST_TIMEOUT,
  apiFetch,
  assertServersUp,
  confirmOutlineViaUi,
  createProjectViaUi,
  fetchSlide,
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

interface QualityScores {
  overallScore: number;
  structureScore: number;
  visualScore: number;
  contentScore: number;
  issues: Array<{ id: string; level: string; message: string }>;
}

/** 建一个编译好的项目并进入质量中心 */
async function openQualityCenter(
  session: Session,
  label: string
): Promise<{ projectId: string; slideId: string }> {
  await registerAndEnterApp(session);
  const projectId = await createProjectViaUi(session, unique(label));
  await generateOutlineViaUi(session, { topic: unique(`${label} 主题`), pageCount: 4 });
  await confirmOutlineViaUi(session);

  const slides = await apiFetch<{ slides: Array<{ slideId: string }> }>(
    session.page,
    `/api/projects/${projectId}/slides`
  );
  const slideId = slides.body.data!.slides[0]!.slideId;

  await session.page.getByTestId('nav-quality').click();
  await session.page.getByTestId('quality-report').waitFor({ state: 'visible', timeout: 20_000 });

  return { projectId, slideId };
}

/** 读界面上的四个分数 */
async function readUiScores(session: Session): Promise<QualityScores> {
  const num = async (id: string): Promise<number> => {
    const raw = (await session.page.getByTestId(id).textContent()) ?? '';
    return Number(raw.trim());
  };
  return {
    overallScore: await num('quality-overall-score'),
    structureScore: await num('quality-structure-score'),
    visualScore: await num('quality-visual-score'),
    contentScore: await num('quality-content-score'),
    issues: [],
  };
}

describe('质量链（真实浏览器 + 真实服务端）', () => {
  test('质量报告 → 界面分数与服务端权威评分逐项对得上', async () => {
    const session = await harness.newSession();
    try {
      const { projectId } = await openQualityCenter(session, 'E2E 质量');

      const ui = await readUiScores(session);
      expect(Number.isFinite(ui.overallScore)).toBe(true);
      expect(ui.overallScore).toBeGreaterThanOrEqual(0);
      expect(ui.overallScore).toBeLessThanOrEqual(100);

      // --- 服务端权威评分 ---
      const server = await apiFetch<{ report: QualityScores }>(session.page, '/api/quality/evaluate', {
        method: 'POST',
        body: { projectId },
      });
      expect(server.status).toBe(200);
      const report = server.body.data!.report;

      // 前后端跑同一份引擎 —— 数字必须一模一样
      expect(ui.overallScore).toBe(report.overallScore);
      expect(ui.structureScore).toBe(report.structureScore);
      expect(ui.visualScore).toBe(report.visualScore);
      expect(ui.contentScore).toBe(report.contentScore);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('一键修复 → 服务端的 IR 真的被改写，版本号前进', async () => {
    const session = await harness.newSession();
    try {
      const { projectId, slideId } = await openQualityCenter(session, 'E2E 质量修复');

      const before = await fetchSlide(session.page, projectId, slideId);
      expect(before).not.toBeNull();
      const beforeIds = (before!.ir as { elements: Array<{ id: string }> }).elements.map((e) => e.id);

      const beforeScores = await apiFetch<{ report: QualityScores }>(
        session.page,
        '/api/quality/evaluate',
        { method: 'POST', body: { projectId } }
      );

      await session.page.getByTestId('quality-autofix').click();

      // --- 服务端的这一页必须被改写 ---
      await waitFor(
        async () => {
          const now = await fetchSlide(session.page, projectId, slideId);
          if (!now) return false;
          const ids = (now.ir as { elements: Array<{ id: string }> }).elements.map((e) => e.id);
          return JSON.stringify(ids) !== JSON.stringify(beforeIds);
        },
        20_000,
        '一键修复写回服务端'
      );

      const after = await fetchSlide(session.page, projectId, slideId);
      // 版本号必须前进 —— 修复是一次真实的写入，不是本地幻觉
      expect(after!.versionId).not.toBe(before!.versionId);

      // 修复后的元素 id 是规范化的（引擎按 type_slideId_序号 重排）
      const afterIds = (after!.ir as { elements: Array<{ id: string }> }).elements.map((e) => e.id);
      expect(afterIds.every((id) => id.includes(slideId))).toBe(true);

      // --- 修复不该把分数改差 ---
      const afterScores = await apiFetch<{ report: QualityScores }>(
        session.page,
        '/api/quality/evaluate',
        { method: 'POST', body: { projectId } }
      );
      expect(afterScores.body.data!.report.overallScore).toBeGreaterThanOrEqual(
        beforeScores.body.data!.report.overallScore
      );
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);
});
