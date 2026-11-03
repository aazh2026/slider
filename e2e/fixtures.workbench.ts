/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 工作台夹具 —— 新增的几条链共用
 * ---------------------------------------------------------------------------
 * 只 import `helpers.ts` 里**长期存在**的那批导出 ——
 * 这份夹具必须能脱离任何一条链单独跑（单独 checkout 也能跑）。
 *
 * 断言分层（写用例前先读这一段 —— 它决定断言该落在哪）
 * ---------------------------------------------------------------------------
 * `App.tsx` 的 `syncProject` 有两条硬规则：
 *
 *   1. **没有 `baseVersionId` 的页直接跳过** —— 新建的页还没在服务端登记过。
 *   2. **剩下页的 IR 没变就不写** —— 删页 / 移页 / 复制页改的是页集合，
 *      每一页自己的 IR 一个字节都没动，同步器因此认为"没东西可写"。
 *
 * 于是：
 *
 *   · **元素级**编辑（坐标 / 字号 / 颜色 / 文本 / 对齐 / 复制 / 删除）
 *     → 落库 → 断言落在**服务端 IR** 上。
 *   · **页级**操作（加页 / 复制页 / 删页 / 上移下移）
 *     → **不落库**（刷新就丢）→ 断言只能落在**界面侧**。
 *
 * 这条限制已登记进 `spec/spec.yaml` 的 `known_gaps`（SPEC-E2E-003）。
 */

import type { SlideElement, SlideIR } from '@ppt/core';

import {
  apiFetch,
  arrangeProjectWithSlides,
  createAccountViaApi,
  makeAccount,
  waitFor,
  type Account,
  type Session,
} from './helpers';

/** 一份"已编译、有页面"的工作台布置 */
export interface WorkbenchFixture {
  account: Account;
  projectId: string;
  /** 服务端顺序的 slideId —— 「第 N 页」= slideIds[N - 1] */
  slideIds: string[];
  /** 每页当前的服务端版本号（乐观锁的 baseVersionId） */
  versionIds: string[];
}

/* -------------------------------------------------------------------------- */
/* 账号                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 注册一个全新账号并让应用外壳认下这个会话。
 *
 * 注册接口顺带下发了会话 Cookie，但应用外壳是在**挂载时**读会话的 ——
 * 注册之前那一版外壳早就挂好了，Cookie 是后到的。所以必须重新加载一次。
 */
export async function loginAsFreshUser(session: Session): Promise<Account> {
  const account = makeAccount();
  await createAccountViaApi(session.page, account);
  await session.page.goto('/');
  await session.page.getByTestId('nav-projects').waitFor({ state: 'visible', timeout: 30_000 });
  return account;
}

/* -------------------------------------------------------------------------- */
/* 工作台布置                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 布置一个「已编译、有页面」的项目，并把界面停在这份项目的工作台上。
 *
 * 前置状态全走 API（快，且不依赖模型端点的真实状态），
 * 被测的那一步仍然走 UI。
 */
export async function setupCompiledWorkbench(
  session: Session,
  opts?: { topic?: string; pageCount?: number; name?: string }
): Promise<WorkbenchFixture> {
  const account = await loginAsFreshUser(session);
  const fixture = await arrangeProjectWithSlides(session.page, opts);

  // 重新加载 —— 让前端把这份项目拉进内存并进到工作台
  await session.page.goto('/');
  await session.page.getByTestId('slide-canvas').waitFor({ state: 'visible', timeout: 40_000 });

  return {
    account,
    projectId: fixture.projectId,
    slideIds: fixture.slides.map((s) => s.slideId),
    versionIds: fixture.slides.map((s) => s.versionId),
  };
}

/**
 * 从作品库点开一个项目并进到工作台（UI 路径）。
 *
 * 自己实现而不用 `helpers.ts` 的 `openProjectInWorkbench` ——
 * 那个函数的参数在两版之间改过（`(page, id)` → `(session, id)`），
 * 依赖它就等于把自己钉死在某一版上。
 */
export async function openProjectInWorkbenchUi(
  session: Session,
  projectId: string
): Promise<void> {
  await session.page.getByTestId('nav-projects').click();
  const open = session.page.getByTestId(`pm-open-${projectId}`).first();
  await open.waitFor({ state: 'visible', timeout: 20_000 });
  await open.click();
  await session.page.getByTestId('slide-canvas').waitFor({ state: 'visible', timeout: 30_000 });
}

/** 切到侧边栏的某个页签 */
export async function gotoNavTab(session: Session, tab: string): Promise<void> {
  await session.page.getByTestId(`nav-${tab}`).click();
}

/** 当前画布上的 slideId */
export async function currentSlideId(session: Session): Promise<string> {
  const id = await session.page.getByTestId('slide-canvas').getAttribute('data-slide-id');
  if (!id) throw new Error('画布上没有 data-slide-id');
  return id;
}

/* -------------------------------------------------------------------------- */
/* 服务端 IR 读取                                                               */
/* -------------------------------------------------------------------------- */

/** 读服务端那一页的 IR —— 断言的落点 */
export async function fetchSlideIr(
  session: Session,
  projectId: string,
  slideId: string
): Promise<SlideIR> {
  const res = await apiFetch<{ slide: { ir: SlideIR } }>(
    session.page,
    `/api/projects/${projectId}/slides/${slideId}`
  );
  const ir = res.body.data?.slide?.ir;
  if (!ir) {
    throw new Error(`读服务端 IR 失败：HTTP ${res.status} ${JSON.stringify(res.body)}`);
  }
  return ir;
}

/**
 * 等服务端那一页的 IR 满足条件。
 *
 * 前端改完是**防抖 700ms** 才发请求的，所以断言不能"改完立刻查" ——
 * 必须轮询到服务端真的存下来了为止。
 */
export async function waitForSlideIr(
  session: Session,
  projectId: string,
  slideId: string,
  predicate: (ir: SlideIR) => boolean,
  label: string,
  timeoutMs = 25_000
): Promise<SlideIR> {
  let last: SlideIR | null = null;
  await waitFor(
    async () => {
      last = await fetchSlideIr(session, projectId, slideId);
      return predicate(last);
    },
    timeoutMs,
    label
  );
  return last!;
}

/** 在服务端 IR 里按 id 找元素 */
export function findElement(ir: SlideIR, elementId: string): SlideElement {
  const found = ir.elements.find((el) => el.id === elementId);
  if (!found) {
    throw new Error(
      `服务端 IR 里没有元素 ${elementId}（现有：${ir.elements.map((e) => e.id).join(', ')}）`
    );
  }
  return found;
}

/* -------------------------------------------------------------------------- */
/* 画布元素选取                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * 按 role 选中画布上的元素，返回它的 id。
 *
 * 用 `dispatchEvent('mousedown')` 而不是 `click()`：
 * 画布上的可编辑元素是**互相重叠**的覆盖层，谁在上面取决于 DOM 顺序与 z-index，
 * 点"中心"很可能点到隔壁那个。派发事件则精确命中目标元素。
 *
 * 事件带的是 `clientX/clientY = 0` —— 覆盖层的 mousedown 会顺手开启拖拽，
 * 坐标一旦不是 0，拖拽逻辑就会把元素挪走。派完 mousedown 立刻补一个 mouseup，
 * 把拖拽状态收掉。
 */
export async function selectElementByRole(session: Session, role: string): Promise<string> {
  const overlay = session.page
    .locator(`[data-testid="slide-element"][data-role="${role}"]`)
    .first();
  await overlay.waitFor({ state: 'attached', timeout: 15_000 });
  const id = await overlay.getAttribute('data-element-id');
  if (!id) throw new Error(`画布上没有 role=${role} 的元素`);
  await overlay.dispatchEvent('mousedown', { button: 0, clientX: 0, clientY: 0 });
  await overlay.dispatchEvent('mouseup', { button: 0, clientX: 0, clientY: 0 });
  return id;
}

/** 按一组 role 依次尝试，选中第一个存在的（拿不到就抛 —— 不静默选错） */
export async function selectElementByRoles(
  session: Session,
  roles: string[]
): Promise<{ id: string; role: string }> {
  for (const role of roles) {
    const overlay = session.page
      .locator(`[data-testid="slide-element"][data-role="${role}"]`)
      .first();
    if ((await overlay.count()) === 0) continue;
    const id = await selectElementByRole(session, role);
    return { id, role };
  }
  throw new Error(`画布上没有 role ∈ {${roles.join(', ')}} 的元素`);
}

/* -------------------------------------------------------------------------- */
/* 输入框                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 写 `<input type="color">` 的值。
 *
 * Playwright 的 `fill()` 对颜色输入框无效（它只处理文本类输入），
 * 而且直接设 `.value` React 看不见 —— 必须走原型上的原生 setter，
 * 再补一个冒泡的 `input` 事件，React 的 onChange 才会被触发。
 */
export async function setColorInput(
  session: Session,
  testId: string,
  value: string
): Promise<void> {
  await session.page.getByTestId(testId).evaluate((el, v) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
