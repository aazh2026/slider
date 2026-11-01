/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * patchApplier —— IRPatch → SlideIR（docs/backend-design.md §4.3）
 * ---------------------------------------------------------------------------
 * 六种 operation 的语义：
 *
 *   update_element    局部合并，保留未提及字段
 *   remove_element    存在性校验，删不存在则报错而非静默
 *   add_element       校验 id 唯一 + geometry 在画布内
 *   replace_group     组内元素整体替换，外部 id 保持稳定
 *   restyle_slide     只改 style，不动 geometry/content
 *   reorder_elements  只改 zIndex
 *
 * 三条硬约束：
 *
 * 1. **原子性** —— 函数先 `structuredClone` 再改，抛错时调用方的 SlideIR 一个字节都不变。
 *
 * 2. **幂等** —— 同一条 patch 施加两次，结果与施加一次相同（§4.3「便于重试」）。
 *
 * 3. **幂等与「删不存在则报错」同时成立** —— 这两条要求在朴素实现里是冲突的：
 *    第一次删掉了元素，第二次再删同一个 id 就成了「删不存在」，按第 1 条该报错，
 *    按第 2 条该是 no-op。区分二者需要记住「这个 id 曾经存在且已被删除」，
 *    因此 SlideIR 增加了 `removedElementIds` 墓碑字段：
 *      - id 在墓碑里 → 已经删过了 → no-op（幂等）
 *      - id 既不在元素里也不在墓碑里 → 从来没存在过 → 报错（AC-IRP-003）
 *    墓碑只增不改，不影响任何既有渲染与导出行为。
 */

import { IRPatch, SlideElement, SlideIR, Geometry, ElementStyle } from '../types/slide';

export type PatchErrorCode =
  | 'INVALID_PATCH'
  | 'UNKNOWN_ELEMENT'
  | 'DUPLICATE_ID'
  | 'OUT_OF_BOUNDS'
  | 'ID_STABILITY';

export class PatchApplyError extends Error {
  readonly code: PatchErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: PatchErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'PatchApplyError';
    this.code = code;
    this.details = details;
  }
}

/* -------------------------------------------------------------------------- */
/* 工具                                                                        */
/* -------------------------------------------------------------------------- */

/** 深度相等 —— 自己写，不用 JSON.stringify（会丢 undefined 键） */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== 'object') return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  const ka = Object.keys(a as Record<string, unknown>);
  const kb = Object.keys(b as Record<string, unknown>);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    Object.prototype.hasOwnProperty.call(b, k) &&
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
  );
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 两个元素是否可视为「同一个」
 * ---------------------------------------------------------------------------
 * 补丁没显式给 zIndex 时，zIndex 是施加器按**数组长度**补的默认值。
 * 同一条补丁施加第二次时数组长度已经变了，默认 zIndex 也会跟着变，
 * 于是深度相等判定失败 —— 幂等性直接被打破（AC-IRP-002）。
 *
 * 因此：**补丁未指定 zIndex 时，zIndex 不参与相等性判断**。
 * 补丁显式给了 zIndex，则它必须被严格比对（那时它是补丁语义的一部分）。
 */
function sameElement(a: SlideElement, b: SlideElement, ignoreZIndex: boolean): boolean {
  if (!ignoreZIndex) return deepEqual(a, b);
  return deepEqual({ ...a, zIndex: 0 }, { ...b, zIndex: 0 });
}

/** 补丁是否显式指定了 zIndex */
function specifiesZIndex(raw: unknown): boolean {
  return isPlainObject(raw) && raw['zIndex'] !== undefined;
}

/** 几何是否完整落在画布内 */
export function isWithinCanvas(geometry: Geometry, canvas: { width: number; height: number }): boolean {
  const { x, y, width, height } = geometry;
  if (![x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
  if (width < 0 || height < 0) return false;
  return x >= 0 && y >= 0 && x + width <= canvas.width && y + height <= canvas.height;
}

/** 合并两个 style（后者覆盖前者，未提及的键保留） */
function mergeStyle(base: ElementStyle, patch: ElementStyle): ElementStyle {
  return { ...base, ...patch };
}

/** 合并两个 geometry */
function mergeGeometry(base: Geometry, patch: Partial<Geometry>): Geometry {
  return { ...base, ...patch };
}

/* -------------------------------------------------------------------------- */
/* 单条 patch                                                                  */
/* -------------------------------------------------------------------------- */

function findIndex(elements: SlideElement[], id: string): number {
  return elements.findIndex((e) => e.id === id);
}

function applyUpdateElement(slide: SlideIR, patch: IRPatch): void {
  const targetId = patch.targetId;
  if (!targetId) {
    throw new PatchApplyError('INVALID_PATCH', 'update_element 必须携带 targetId');
  }
  const idx = findIndex(slide.elements, targetId);
  if (idx < 0) {
    throw new PatchApplyError('UNKNOWN_ELEMENT', `update_element 指向不存在的元素：${targetId}`, {
      targetId,
    });
  }
  if (!isPlainObject(patch.changes)) {
    throw new PatchApplyError('INVALID_PATCH', 'update_element 的 changes 必须是对象');
  }
  const changes = patch.changes;
  if (typeof changes.id === 'string' && changes.id !== targetId) {
    throw new PatchApplyError(
      'ID_STABILITY',
      `update_element 不允许改 id（${targetId} → ${changes.id}）`,
      { targetId }
    );
  }

  const el = slide.elements[idx]!;
  const next: SlideElement = { ...el };

  if (isPlainObject(changes.geometry)) {
    next.geometry = mergeGeometry(el.geometry, changes.geometry as Partial<Geometry>);
  }
  if (isPlainObject(changes.style)) {
    next.style = mergeStyle(el.style, changes.style as ElementStyle);
  }
  for (const key of ['type', 'role', 'content', 'editable', 'zIndex', 'parentId', 'groupId', 'metadata'] as const) {
    if (key in changes) {
      (next as unknown as Record<string, unknown>)[key] = changes[key];
    }
  }

  if (!isWithinCanvas(next.geometry, slide.canvas)) {
    throw new PatchApplyError(
      'OUT_OF_BOUNDS',
      `update_element 使元素 ${targetId} 越出画布`,
      { targetId, geometry: next.geometry, canvas: slide.canvas }
    );
  }

  slide.elements[idx] = next;
}

function applyRemoveElement(slide: SlideIR, patch: IRPatch): void {
  const targetId = patch.targetId;
  if (!targetId) {
    throw new PatchApplyError('INVALID_PATCH', 'remove_element 必须携带 targetId');
  }
  const idx = findIndex(slide.elements, targetId);
  if (idx >= 0) {
    slide.elements.splice(idx, 1);
    const tombstones = slide.removedElementIds ?? [];
    if (!tombstones.includes(targetId)) {
      slide.removedElementIds = [...tombstones, targetId];
    }
    return;
  }
  // 已经删过 → 幂等 no-op；从来没存在过 → 报错
  if ((slide.removedElementIds ?? []).includes(targetId)) return;
  throw new PatchApplyError('UNKNOWN_ELEMENT', `remove_element 指向不存在的元素：${targetId}`, {
    targetId,
  });
}

function normalizeAddedElement(
  raw: unknown,
  slide: SlideIR,
  index: number
): SlideElement {
  if (!isPlainObject(raw)) {
    throw new PatchApplyError('INVALID_PATCH', 'add_element 的 changes 必须是元素对象');
  }
  const id = raw.id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new PatchApplyError('INVALID_PATCH', 'add_element 的元素必须有 id');
  }
  const geometry = raw.geometry as Geometry | undefined;
  if (!isPlainObject(geometry)) {
    throw new PatchApplyError('INVALID_PATCH', `add_element 的元素 ${id} 必须有 geometry`);
  }
  const geo: Geometry = {
    x: Number(geometry.x),
    y: Number(geometry.y),
    width: Number(geometry.width),
    height: Number(geometry.height),
    ...(geometry.rotation !== undefined ? { rotation: Number(geometry.rotation) } : {}),
  };
  if (!isWithinCanvas(geo, slide.canvas)) {
    throw new PatchApplyError('OUT_OF_BOUNDS', `add_element 的元素 ${id} 越出画布`, {
      id,
      geometry: geo,
      canvas: slide.canvas,
    });
  }

  const element: SlideElement = {
    id,
    type: (raw.type as SlideElement['type']) ?? 'text',
    role: (raw.role as SlideElement['role']) ?? 'annotation',
    content: raw.content ?? '',
    geometry: geo,
    style: (raw.style as ElementStyle) ?? {},
    editable: raw.editable === undefined ? true : Boolean(raw.editable),
    zIndex: raw.zIndex === undefined ? index : Number(raw.zIndex),
    ...(raw.parentId !== undefined ? { parentId: String(raw.parentId) } : {}),
    ...(raw.groupId !== undefined ? { groupId: String(raw.groupId) } : {}),
    ...(isPlainObject(raw.metadata) ? { metadata: raw.metadata } : {}),
  };
  return element;
}

function applyAddElement(slide: SlideIR, patch: IRPatch): void {
  const raw = patch.changes;
  const list = Array.isArray(raw) ? raw : isPlainObject(raw) && Array.isArray(raw.element) ? raw.element : [raw];
  if (!Array.isArray(list) || list.length === 0) {
    throw new PatchApplyError('INVALID_PATCH', 'add_element 的 changes 必须包含要新增的元素');
  }

  for (const item of list) {
    const element = normalizeAddedElement(item, slide, slide.elements.length);
    const existingIdx = findIndex(slide.elements, element.id);
    if (existingIdx >= 0) {
      // id 冲突：内容完全一致 → 幂等 no-op；否则报 id 唯一性错误
      const existing = slide.elements[existingIdx]!;
      if (sameElement(existing, element, !specifiesZIndex(item))) continue;
      throw new PatchApplyError('DUPLICATE_ID', `add_element 的 id 与既有元素冲突：${element.id}`, {
        id: element.id,
      });
    }
    slide.elements.push(element);
  }
}

function applyReplaceGroup(slide: SlideIR, patch: IRPatch): void {
  const groupId = patch.targetId;
  if (!groupId) {
    throw new PatchApplyError('INVALID_PATCH', 'replace_group 必须携带 targetId（组 id）');
  }
  const raw = patch.changes;
  const incoming = Array.isArray(raw)
    ? raw
    : isPlainObject(raw) && Array.isArray(raw.elements)
      ? raw.elements
      : [];
  if (incoming.length === 0) {
    throw new PatchApplyError('INVALID_PATCH', 'replace_group 的 changes.elements 不能为空');
  }

  const preserveIds = patch.preserveIds ?? [];
  const members = slide.elements.filter(
    (e) => e.groupId === groupId || e.parentId === groupId
  );
  const memberIds = new Set(members.map((e) => e.id));

  // 幂等：若补丁里的元素已经原样落在该组里，说明这条补丁施加过了 —— 不再动第二次
  const alreadyApplied = incoming.every((item) => {
    try {
      const id = isPlainObject(item) ? item['id'] : undefined;
      if (typeof id !== 'string') return false;
      const existing = slide.elements.find((e) => e.id === id);
      // 必须是该组成员 —— 否则「别处恰好有同 id 元素」会被误判成已施加
      if (!existing || !memberIds.has(id)) return false;
      // 探针必须与真正写入时一样挂上 groupId —— 否则两边的键集合不同，永远比不相等
      const probe = { ...normalizeAddedElement(item, slide, 0), groupId: groupId };
      return sameElement(existing, probe, !specifiesZIndex(item));
    } catch {
      // 元素本身不合法 —— 交给后面的正常流程报错
      return false;
    }
  });
  if (alreadyApplied) return;

  // 新元素：强制挂在该组下，否则第二次施加找不到成员、幂等性失效
  const newElements: SlideElement[] = incoming.map((item, i) => {
    const el = normalizeAddedElement(item, slide, slide.elements.length + i);
    return { ...el, groupId: el.groupId ?? groupId };
  });

  for (const el of newElements) {
    if (!isWithinCanvas(el.geometry, slide.canvas)) {
      throw new PatchApplyError('OUT_OF_BOUNDS', `replace_group 的元素 ${el.id} 越出画布`, {
        id: el.id,
      });
    }
  }

  // 与非成员元素 id 冲突 → 报错
  for (const el of newElements) {
    const conflict = slide.elements.find((e) => e.id === el.id && !memberIds.has(e.id));
    if (conflict) {
      throw new PatchApplyError('DUPLICATE_ID', `replace_group 的 id 与组外元素冲突：${el.id}`, {
        id: el.id,
      });
    }
  }

  const insertAt = members.length > 0 ? slide.elements.indexOf(members[0]!) : slide.elements.length;
  const kept = slide.elements.filter((e) => !memberIds.has(e.id) || preserveIds.includes(e.id));
  const replacement = newElements.map((el) => {
    // 保留下来的同 id 元素：若新集合提供了同 id 元素，以新元素为准
    const preservedIdx = kept.findIndex((e) => e.id === el.id);
    if (preservedIdx >= 0) kept.splice(preservedIdx, 1);
    return el;
  });

  slide.elements = [...kept];
  const at = Math.min(insertAt, slide.elements.length);
  slide.elements.splice(at, 0, ...replacement);
}

function applyRestyleSlide(slide: SlideIR, patch: IRPatch): void {
  if (!isPlainObject(patch.changes) || !isPlainObject(patch.changes.style)) {
    throw new PatchApplyError('INVALID_PATCH', 'restyle_slide 的 changes 必须是 { style }');
  }
  const style = patch.changes.style as ElementStyle;

  let targets: SlideElement[];
  if (patch.targetId) {
    const idx = findIndex(slide.elements, patch.targetId);
    if (idx < 0) {
      throw new PatchApplyError('UNKNOWN_ELEMENT', `restyle_slide 指向不存在的元素：${patch.targetId}`, {
        targetId: patch.targetId,
      });
    }
    targets = [slide.elements[idx]!];
  } else {
    targets = slide.elements;
  }

  for (const el of targets) {
    el.style = mergeStyle(el.style, style);
    // restyle_slide 只改 style —— geometry / content 一个字节都不动
  }
}

function applyReorderElements(slide: SlideIR, patch: IRPatch): void {
  if (!isPlainObject(patch.changes) || !Array.isArray(patch.changes.order)) {
    throw new PatchApplyError('INVALID_PATCH', 'reorder_elements 的 changes 必须是 { order: string[] }');
  }
  const order = patch.changes.order as string[];
  for (const id of order) {
    if (findIndex(slide.elements, id) < 0) {
      throw new PatchApplyError('UNKNOWN_ELEMENT', `reorder_elements 指向不存在的元素：${id}`, { id });
    }
  }
  order.forEach((id, index) => {
    const idx = findIndex(slide.elements, id);
    slide.elements[idx]!.zIndex = index;
  });
  // 稳定排序：zIndex 相同则保持原相对次序
  slide.elements = slide.elements
    .map((el, i) => ({ el, i }))
    .sort((a, b) => a.el.zIndex - b.el.zIndex || a.i - b.i)
    .map(({ el }) => el);
}

/* -------------------------------------------------------------------------- */
/* 入口                                                                        */
/* -------------------------------------------------------------------------- */

/** 施加单条 patch（就地修改传入的 slide —— 调用方负责克隆） */
export function applyPatch(slide: SlideIR, patch: IRPatch): void {
  if (!patch || typeof patch.operation !== 'string') {
    throw new PatchApplyError('INVALID_PATCH', 'patch 必须有 operation');
  }
  switch (patch.operation) {
    case 'update_element':
      return applyUpdateElement(slide, patch);
    case 'remove_element':
      return applyRemoveElement(slide, patch);
    case 'add_element':
      return applyAddElement(slide, patch);
    case 'replace_group':
      return applyReplaceGroup(slide, patch);
    case 'restyle_slide':
      return applyRestyleSlide(slide, patch);
    case 'reorder_elements':
      return applyReorderElements(slide, patch);
    default:
      throw new PatchApplyError(
        'INVALID_PATCH',
        `未知的 patch operation：${String((patch as { operation: unknown }).operation)}`
      );
  }
}

/**
 * 施加一组 patch。
 *
 * - **原子**：先克隆，抛错不影响入参
 * - **幂等**：同一组 patch 施加两次，结果与施加一次相同
 */
export function applyPatches(slide: SlideIR, patches: IRPatch[]): SlideIR {
  if (!Array.isArray(patches)) {
    throw new PatchApplyError('INVALID_PATCH', 'patches 必须是数组');
  }
  const next: SlideIR = structuredClone(slide);
  for (const patch of patches) {
    applyPatch(next, patch);
  }
  return next;
}
