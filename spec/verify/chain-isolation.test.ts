/**
 * 编排器的「跑批之间不许互踩」—— 缺陷回放
 * ---------------------------------------------------------------------------
 * 这个文件存在的原因：
 *
 *   E2E 编排器原先是这样收浏览器残留的：
 *
 *     「记下这条链启动前系统里已有的浏览器 pid，跑完做差集，多出来的全杀掉」
 *
 *   这个写法**默认了「这个世界上只有我在跑」**。
 *   实测踩过：同时有另一个跑批在跑（`e2e-only.ts navigation`），
 *   两个跑批各有各的「之前/之后」，于是**两边互踩** ——
 *
 *     · 我的差集把**它**的浏览器当成我的残留杀了；
 *     · 它的差集把**我的**浏览器当成它的残留杀了。
 *
 *   症状落在**最无辜的地方**：`newContext: Target page, context or browser has been closed`，
 *   栈顶是 `helpers.ts` 里建上下文那一行 —— 看着像**页面逻辑**炸了，
 *   失败的那条用例（跨租户隔离）跟浏览器被杀八竿子打不着。
 *   不看进程树就会去查前端，查到天亮也查不出来。
 *
 *   所以判据只能钉在**归属**上：一条链只能收自己进程树里的浏览器。
 *
 * ---------------------------------------------------------------------------
 * **为什么断言写在 test 里，不写在 helper 里**：
 *   见 spec/README.md「验证器怎么写」第 1 条 —— 判定逻辑藏进 helper
 *   会导致失败时说不清是哪条判据挂了。
 */

import { describe, expect, test } from 'bun:test';

import { browserDescendants, parsePsTree } from './run-e2e.ts';

/**
 * 现场复刻：`ps -eo pid=,ppid=,command=` 在「两条跑批同时在跑」时的样子。
 *
 *   · 900 → 800 → 700 → 701 ：A 跑批（我的这一轮）
 *   · 300 → 200 → 100 → 101 ：B 跑批（同时在跑的另一个）
 *   · 500（ppid = 1）        ：已经被 init 收养的孤儿浏览器 —— 谁都不属于
 *
 * 两棵树的形状一样，只有 pid 不同 —— 这正是缺陷现场：
 * 靠「差集」认不出归属，靠**进程树**才认得出。
 */
const PS_SAMPLE = `
  900     1 bun run spec/verify/e2e-only.ts
  800   900 bun test ./e2e/projects.e2e.ts --reporter=junit
  700   800 /Users/x/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing --headless
  701   700 /Users/x/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing --type=renderer
  300     1 bun run spec/verify/e2e-only.ts navigation
  200   300 bun test ./e2e/navigation.e2e.ts --reporter=junit
  100   200 /Users/x/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell --headless
  101   100 /Users/x/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell --type=renderer
  500     1 /Users/x/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell --headless
`.trim();

describe('进程树解析', () => {
  test('父 pid 映射到子 pid 列表', () => {
    const tree = parsePsTree(PS_SAMPLE);
    expect(tree.get(800)).toEqual([700]);
    expect(tree.get(700)).toEqual([701]);
  });

  test('没有子进程的 pid 不在映射里', () => {
    const tree = parsePsTree(PS_SAMPLE);
    expect(tree.has(701)).toBe(false);
  });

  test('三列输出也能解析（命令里有空格也不影响 pid/ppid）', () => {
    const tree = parsePsTree('  42   41 /bin/sh -c "echo hello world"');
    expect(tree.get(41)).toEqual([42]);
  });
});

describe('浏览器归属 —— 缺陷回放', () => {
  test('认领得到本链的浏览器（含渲染子进程）', () => {
    const mine = browserDescendants(PS_SAMPLE, 800);
    expect(mine.sort()).toEqual([700, 701]);
  });

  test('**别人的**浏览器不在本链的名单里', () => {
    // **这就是出事的那一步**：原实现按「系统里多出来的」杀，
    // 于是把 B 跑批的浏览器当成了自己的残留。
    const mine = browserDescendants(PS_SAMPLE, 800);
    expect(mine).not.toContain(100);
    expect(mine).not.toContain(101);
  });

  test('反过来也一样：两条链各认各的', () => {
    const a = browserDescendants(PS_SAMPLE, 800).sort();
    const b = browserDescendants(PS_SAMPLE, 200).sort();
    expect(a).toEqual([700, 701]);
    expect(b).toEqual([100, 101]);
    expect(a.filter((p) => b.includes(p))).toEqual([]);
  });

  test('被 init 收养的孤儿不属于任何链 —— 谁都不该杀它', () => {
    // 它的命令行确实带 Playwright 目录（是浏览器），
    // 但它不在任何一条链的子树里 —— 认领不到，就不动。
    const a = browserDescendants(PS_SAMPLE, 800);
    const b = browserDescendants(PS_SAMPLE, 200);
    expect(a).not.toContain(500);
    expect(b).not.toContain(500);
  });

  test('树里没有的非浏览器进程不算浏览器', () => {
    // `bun test` 进程本身是链的根，不是浏览器 —— 不该被当成浏览器收掉。
    const mine = browserDescendants(PS_SAMPLE, 800);
    expect(mine).not.toContain(800);
    expect(mine).not.toContain(900);
  });

  test('根进程不存在时返回空 —— 不猜', () => {
    expect(browserDescendants(PS_SAMPLE, 999_999)).toEqual([]);
  });
});
