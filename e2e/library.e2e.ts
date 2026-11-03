/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 作品库链 —— 搜索 / 筛选 / 排序 / 复制 / 导出 / 导入 / 新建 / 打开
 * ---------------------------------------------------------------------------
 * 这一链守的是「我的演示文稿作品库」这一屏。
 *
 * 以前这一屏几乎不可测，也几乎全是坏的：
 *
 *   · 列表接口只回**摘要**（没有每一页的 IR），而前端把每份文稿的模板一律
 *     当成默认的浅色模板 → 「深色底」筛选永远筛不出东西；
 *   · 摘要里没有页数，`slides` 恒为空数组 → 每张卡片都写「0 页」，
 *     「按页数从多到少」对没打开过的文稿是空操作；
 *   · 「导出 Slide IR JSON 备份」导的是内存里那份（也就是摘要）→ 导出来
 *     是一份没有页面的空壳，再导入回去什么也恢复不了。
 *
 * 三条都已修（服务端摘要补 `templateId` / `slideCount`；导出改导服务端 bundle），
 * 这一链就是它们的**回归锁**。
 *
 * 断言分层：作品库这一层的动作（新建 / 复制 / 导入）**都落服务端**，
 * 所以断言查服务端的项目列表；界面上的卡片只作辅助观察。
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import {
  TEST_TIMEOUT,
  apiFetch,
  arrangeProjectWithSlides,
  assertServersUp,
  launchHarness,
  uncaughtErrors,
  waitFor,
  type Harness,
  type Session,
} from './helpers';
import { loginAsFreshUser } from './fixtures.workbench';

let harness: Harness;

beforeAll(async () => {
  await assertServersUp();
  harness = await launchHarness();
});

afterAll(async () => {
  await harness?.close();
});

/* -------------------------------------------------------------------------- */
/* 布置                                                                        */
/* -------------------------------------------------------------------------- */

/** 服务端项目列表摘要 */
interface ProjectSummary {
  id: string;
  name: string;
  templateId: string;
  slideCount: number;
}

interface LibraryFixture {
  lightId: string;
  lightSlideIds: string[];
  darkId: string;
  darkSlideIds: string[];
}

/** 读服务端的项目列表摘要 */
async function listSummaries(session: Session): Promise<ProjectSummary[]> {
  const res = await apiFetch<{ projects: ProjectSummary[] }>(session.page, '/api/projects');
  const list = res.body.data?.projects;
  if (!list) throw new Error(`读项目列表失败：HTTP ${res.status}`);
  return list;
}

/** 读服务端某一页的列表（页数） */
async function listSlideCount(session: Session, projectId: string): Promise<number> {
  const res = await apiFetch<{ slides: unknown[] }>(
    session.page,
    `/api/projects/${projectId}/slides`
  );
  return res.body.data?.slides?.length ?? -1;
}

/**
 * 布置一个作品库：一份浅色模板（3 页）、一份深色模板（5 页）。
 *
 * 深色那份靠 `POST /api/templates/:id/apply` 换模板 —— 服务端权威，
 * 前端只发意图。换了模板之后要**重新加载**页面，列表才会重新拉摘要。
 */
async function setupLibrary(session: Session): Promise<LibraryFixture> {
  await loginAsFreshUser(session);

  const light = await arrangeProjectWithSlides(session.page, {
    topic: '浅色方案',
    name: '浅色方案',
    pageCount: 3,
  });

  const dark = await arrangeProjectWithSlides(session.page, {
    topic: '深色方案',
    name: '深色方案',
    pageCount: 5,
  });

  const applied = await apiFetch(
    session.page,
    '/api/templates/tpl_slate_dark/apply',
    { method: 'POST', body: { projectId: dark.projectId } }
  );
  if (applied.status !== 200) {
    throw new Error(`换深色模板失败：HTTP ${applied.status} ${JSON.stringify(applied.body)}`);
  }

  await session.page.goto('/');
  await session.page.getByTestId('nav-projects').click();
  await session.page
    .locator('[data-testid="project-card"]')
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 });

  return {
    lightId: light.projectId,
    lightSlideIds: light.slides.map((s) => s.slideId),
    darkId: dark.projectId,
    darkSlideIds: dark.slides.map((s) => s.slideId),
  };
}

/** 界面上的卡片（按渲染顺序） */
async function cardIds(session: Session): Promise<string[]> {
  const cards = session.page.locator('[data-testid="project-card"][data-project-id]');
  const count = await cards.count();
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = await cards.nth(i).getAttribute('data-project-id');
    if (id) ids.push(id);
  }
  return ids;
}

/* -------------------------------------------------------------------------- */
/* 用例                                                                        */
/* -------------------------------------------------------------------------- */

describe('作品库链（真实浏览器 + 真实服务端）', () => {
  test('搜索 → 只剩下命中名字的那一张卡', async () => {
    const session = await harness.newSession();
    try {
      const fx = await setupLibrary(session);

      await session.page.getByTestId('pm-search').fill('深色');

      expect(await cardIds(session)).toEqual([fx.darkId]);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('搜索无命中 → 一张卡都不剩（空态）', async () => {
    const session = await harness.newSession();
    try {
      await setupLibrary(session);

      await session.page.getByTestId('pm-search').fill('绝对不存在的作品名-zzz');

      expect(await cardIds(session)).toEqual([]);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('深色底筛选 → 只剩深色模板的那一份', async () => {
    const session = await harness.newSession();
    try {
      const fx = await setupLibrary(session);

      await session.page.getByTestId('pm-filter-dark').click();

      expect(await cardIds(session)).toEqual([fx.darkId]);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('浅色底筛选 → 只剩浅色模板的那一份', async () => {
    const session = await harness.newSession();
    try {
      const fx = await setupLibrary(session);

      await session.page.getByTestId('pm-filter-light').click();

      expect(await cardIds(session)).toEqual([fx.lightId]);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('全部筛选 → 两份都回来', async () => {
    const session = await harness.newSession();
    try {
      const fx = await setupLibrary(session);

      await session.page.getByTestId('pm-filter-dark').click();
      expect((await cardIds(session)).length).toBe(1);

      await session.page.getByTestId('pm-filter-all').click();

      const ids = await cardIds(session);
      expect(ids.length).toBe(2);
      expect(ids).toContain(fx.lightId);
      expect(ids).toContain(fx.darkId);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('卡片页数写的是真实页数（不是「0 页」）', async () => {
    const session = await harness.newSession();
    try {
      const fx = await setupLibrary(session);

      const lightPages = await session.page.getByTestId(`pm-pages-${fx.lightId}`).textContent();
      const darkPages = await session.page.getByTestId(`pm-pages-${fx.darkId}`).textContent();

      expect((lightPages ?? '').trim()).toBe('3 页');
      expect((darkPages ?? '').trim()).toBe('5 页');

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('按页数从多到少排序 → 页多的排前面', async () => {
    const session = await harness.newSession();
    try {
      const fx = await setupLibrary(session);

      await session.page.getByTestId('pm-sort').selectOption('pages');

      const ids = await cardIds(session);
      expect(ids[0]).toBe(fx.darkId);
      expect(ids[1]).toBe(fx.lightId);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('复制作品 → 服务端多一份，页数与原件相同', async () => {
    const session = await harness.newSession();
    try {
      const fx = await setupLibrary(session);

      await session.page.getByTestId(`pm-duplicate-${fx.lightId}`).click();

      let copyId = '';
      await waitFor(
        async () => {
          const list = await listSummaries(session);
          const copy = list.find((p) => p.name.includes('副本'));
          if (!copy) return false;
          copyId = copy.id;
          return true;
        },
        25_000,
        '服务端出现副本项目'
      );

      expect(copyId).not.toBe(fx.lightId);
      expect(await listSlideCount(session, copyId)).toBe(3);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('导出 JSON → 拿到的是带页面的完整 bundle', async () => {
    const session = await harness.newSession();
    try {
      const fx = await setupLibrary(session);

      const [download] = await Promise.all([
        session.page.waitForEvent('download'),
        session.page.getByTestId(`pm-export-json-${fx.lightId}`).click(),
      ]);

      expect(download.suggestedFilename()).toContain('浅色方案');

      const path = await download.path();
      expect(path).toBeTruthy();
      const text = await Bun.file(path!).text();
      const bundle = JSON.parse(text) as {
        name: string;
        slides: Array<{ slideId: string; orderIndex: number; ir: { slideId: string } }>;
      };

      expect(bundle.name).toBe('浅色方案');
      // 关键：导出来的必须**带着页面**，而且每页都带 orderIndex（导入端要这个字段）
      expect(bundle.slides.length).toBe(3);
      // 服务端的 orderIndex 是 1 起的（idx + 1）—— 页序必须原样带出来
      expect(bundle.slides.map((s) => s.orderIndex)).toEqual([1, 2, 3]);
      expect(bundle.slides.map((s) => s.ir.slideId)).toEqual(fx.lightSlideIds);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('导入 JSON → 服务端多一份「(导入)」，页面也回来了', async () => {
    const session = await harness.newSession();
    try {
      const fx = await setupLibrary(session);

      // 拿服务端那份完整的 bundle 当导入文件
      const res = await apiFetch<{ bundle: unknown }>(
        session.page,
        `/api/projects/${fx.lightId}/export`
      );
      const bundle = res.body.data?.bundle;
      if (!bundle) throw new Error(`取 bundle 失败：HTTP ${res.status}`);

      const tmpFile = `/tmp/${fx.lightId}-import.json`;
      await Bun.write(tmpFile, JSON.stringify(bundle));

      await session.page.getByTestId('pm-import-input').setInputFiles(tmpFile);

      let importedId = '';
      await waitFor(
        async () => {
          const list = await listSummaries(session);
          const found = list.find((p) => p.name.includes('(导入)'));
          if (!found) return false;
          importedId = found.id;
          return true;
        },
        25_000,
        '服务端出现导入的项目'
      );

      expect(importedId).not.toBe(fx.lightId);
      expect(await listSlideCount(session, importedId)).toBe(3);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('新建弹窗选模板 → 服务端这份作品用的就是选中的模板', async () => {
    const session = await harness.newSession();
    try {
      await setupLibrary(session);

      const name = `新建的深色作品-${fxSuffix()}`;
      await session.page.getByTestId('new-project').click();
      await session.page.getByTestId('pm-template-option-tpl_tech_blue').click();
      await session.page.getByTestId('new-project-name').fill(name);
      await session.page.getByTestId('new-project-submit').click();

      let createdId = '';
      await waitFor(
        async () => {
          const list = await listSummaries(session);
          const found = list.find((p) => p.name === name);
          if (!found) return false;
          createdId = found.id;
          return true;
        },
        25_000,
        '服务端出现新建的项目'
      );

      const list = await listSummaries(session);
      expect(list.find((p) => p.id === createdId)?.templateId).toBe('tpl_tech_blue');

      // 新建完应用会跳到「创作中心」—— 那是创建成功的信号
      await session.page
        .getByTestId('topic-prompt')
        .waitFor({ state: 'visible', timeout: 20_000 });

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);

  test('打开工作台 → 进到工作台且画布上就是那一页', async () => {
    const session = await harness.newSession();
    try {
      const fx = await setupLibrary(session);

      await session.page.getByTestId(`pm-open-${fx.lightId}`).click();
      await session.page.getByTestId('slide-canvas').waitFor({ state: 'visible', timeout: 30_000 });

      const slideId = await session.page.getByTestId('slide-canvas').getAttribute('data-slide-id');
      expect(slideId).toBe(fx.lightSlideIds[0]);

      expect(uncaughtErrors(session.logs)).toEqual([]);
    } finally {
      await session.close();
    }
  }, TEST_TIMEOUT);
});

/** 每次调用给出一个不同的后缀 —— 同一个账号下的项目名不能撞 */
let suffixSeq = 0;
function fxSuffix(): string {
  suffixSeq += 1;
  return `${suffixSeq}-${Date.now().toString(36)}`;
}
