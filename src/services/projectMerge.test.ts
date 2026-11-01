/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 摘要 / 全量合并的回归测试
 * ---------------------------------------------------------------------------
 * 这个 bug 是被 E2E 挖出来的（见 projectMerge.ts 顶部的说明）：
 * 拿项目**摘要**覆盖已加载的**全量**，会把每一页的 IR 抹掉，
 * 工作台于是渲染出一个「零页」的项目并崩溃。
 *
 * 所以这里断言的**不是**"函数返回了正确的对象"，
 * 而是"已加载的 IR 一个都没丢" —— 用可辨识的标记值，不靠"不等于空"。
 */

import { describe, expect, test } from 'bun:test';
import { BUILT_IN_TEMPLATES, type PresentationProject, type SlideIR } from '@ppt/core';
import { mergeProjectSummaries } from './projectMerge';

/** 唯一标记 —— 任何夹具都不会碰巧长这样 */
const MARKER = 'ZQ7MERGE-MARKER';

function makeSlide(id: string, title: string): SlideIR {
  return {
    slideId: id,
    title,
    layout: 'content',
    elements: [
      {
        id: `${id}-el`,
        role: 'text',
        content: title,
        geometry: { x: 100, y: 100, width: 800, height: 200 },
        style: {},
        zIndex: 1,
      },
    ],
  } as unknown as SlideIR;
}

function makeProject(overrides: Partial<PresentationProject> = {}): PresentationProject {
  return {
    id: 'p1',
    name: '原始名字',
    requirement: {
      topic: '主题',
      purpose: '',
      audience: '',
      pageCount: 2,
      style: '',
      depth: '',
      aspectRatio: '16:9',
    },
    template: BUILT_IN_TEMPLATES[0]!,
    outline: [{ slideId: 's1', order: 1, title: MARKER }],
    slides: [makeSlide('s1', MARKER)],
    versions: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as PresentationProject;
}

/** 列表接口返回的摘要 —— slides 恒为空数组 */
function makeSummary(overrides: Partial<PresentationProject> = {}): PresentationProject {
  return makeProject({
    name: '服务端改过的名字',
    slides: [],
    outline: [],
    versions: {},
    ...overrides,
  });
}

describe('摘要 / 全量合并', () => {
  test('摘要不得抹掉已加载的每一页 IR', () => {
    const loaded = makeProject();
    const merged = mergeProjectSummaries([makeSummary()], [loaded]);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.slides).toHaveLength(1);
    expect(merged[0]!.slides[0]!.slideId).toBe('s1');
    expect(JSON.stringify(merged[0]!.slides)).toContain(MARKER);
  });

  test('摘要不得抹掉已加载的大纲', () => {
    const merged = mergeProjectSummaries([makeSummary()], [makeProject()]);
    expect(merged[0]!.outline).toHaveLength(1);
    expect(JSON.stringify(merged[0]!.outline)).toContain(MARKER);
  });

  test('摘要的标量字段要更新（不然改名不会生效）', () => {
    const merged = mergeProjectSummaries([makeSummary()], [makeProject()]);
    expect(merged[0]!.name).toBe('服务端改过的名字');
  });

  test('没有已加载全量的项目原样返回摘要', () => {
    const summary = makeSummary();
    const merged = mergeProjectSummaries([summary], []);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.id).toBe(summary.id);
    expect(merged[0]!.name).toBe(summary.name);
  });

  test('摘要里没有的项目不进列表（服务端是唯一权威）', () => {
    const merged = mergeProjectSummaries([makeSummary({ id: 'p2' })], [makeProject({ id: 'p1' })]);
    expect(merged.map((p) => p.id)).toEqual(['p2']);
  });

  test('版本历史要跟着 IR 一起留下', () => {
    const loaded = makeProject({
      versions: {
        s1: [
          {
            versionId: 'v1',
            slideId: 's1',
            timestamp: 1,
            author: 'user' as const,
            description: 'x',
            snapshot: makeSlide('s1', MARKER),
          },
        ],
      },
    });
    const merged = mergeProjectSummaries([makeSummary()], [loaded]);
    expect(Object.keys(merged[0]!.versions)).toContain('s1');
  });
});
