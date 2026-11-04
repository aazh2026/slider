/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PresentationProject, QualityReport, QualityIssue, SlideIR, SlideElement, Geometry } from '../types/slide';
import { idPrefixOf, variantOf } from './elementVariant';

/** 设计画布尺寸 —— 判定「越界」用的是画布边界 */
const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

/**
 * 内容安全区（画布内四周留白）—— 内容元素应当落在这一圈里
 * ---------------------------------------------------------------------------
 * 注意它与画布边界不是一回事：母版页码（右下角）与页脚（左下角）**故意**贴着
 * 画布下沿，它们在画布内、只是不在内容安全区内，版式就是这么设计的。
 * 把它们也钳进安全区，等于把版式里设计好的元素挪走。
 */
const SAFE_LEFT = 100;
const SAFE_TOP = 60;
const SAFE_RIGHT = 1820;
const SAFE_BOTTOM = 1020;

/**
 * 元素 ID 的语义前缀
 * ---------------------------------------------------------------------------
 * **不再从 ID 字符串里抠语义**（ADR-018）—— 语义住在 `variant` 字段里，
 * ID 只是它的**派生结果**：`{variant 的 idPrefix}_{slideId}_{序号}`。
 *
 * 过去这里是 `semanticPrefix(id, slideId, elementType)`：从 ID 里剥掉页号段
 * 与序号段，剩下的当语义前缀。它把「字符串即语义」固化成了引擎契约，于是
 * 一次重命名就是一次事故 —— 波 0 的 ADR-014 修的正是这个。
 *
 * 现在语义只有一处真源：`ELEMENT_VARIANTS` 表（engine/elementVariant.ts）。
 * 旧数据没有 `variant` 字段时，`variantOf()` 会走**唯一**的 legacy 回退
 * （按 ID 前缀猜，猜不到按 role 兜底）—— 那是兼容层，不是语义依赖。
 */

/** 这个元素真的越出画布了吗 —— 越界的才算「坏了」 */
function isOutOfCanvas(el: SlideElement): boolean {
  const g = el.geometry;
  return (
    g.x < 0 ||
    g.y < 0 ||
    g.x + g.width > CANVAS_WIDTH ||
    g.y + g.height > CANVAS_HEIGHT
  );
}

/**
 * 把一个越界元素挪回内容安全区
 * ---------------------------------------------------------------------------
 * **保持原尺寸优先** —— 能平移就不缩窄。缩窄会让元素留在原位，与邻居的重叠
 * 关系一点没变（重叠没修好），只是把「越界」换成了「叠在一起」；平移至少
 * 把它放回能看见的地方。只有元素本身比安全区还大时才收尺寸（那时它无论如何
 * 都装不下）。
 */
function clampIntoSafeArea(el: SlideElement): void {
  const g = el.geometry;
  const maxWidth = SAFE_RIGHT - SAFE_LEFT;
  const maxHeight = SAFE_BOTTOM - SAFE_TOP;

  const width = Math.min(g.width, maxWidth);
  const height = Math.min(g.height, maxHeight);

  g.x = Math.min(Math.max(g.x, SAFE_LEFT), SAFE_RIGHT - width);
  g.y = Math.min(Math.max(g.y, SAFE_TOP), SAFE_BOTTOM - height);
  g.width = width;
  g.height = height;
}

export class QualityEngine {
  /**
   * Computes the 4-layer quality evaluation:
   * Q = w_s * Q_s + w_v * Q_v + w_c * Q_c + w_g * Q_g
   */
  static evaluatePresentation(project: PresentationProject): QualityReport {
    const issues: QualityIssue[] = [];

    let totalStructurePenalties = 0;
    let totalVisualPenalties = 0;
    let totalContentPenalties = 0;
    let totalConsistencyPenalties = 0;

    const seenIds = new Set<string>();

    project.slides.forEach((slide, sIdx) => {
      // --- LAYER 1: Structural Validity (Qs) ---
      // Check 1: Canvas dimensions
      if (slide.canvas.width !== CANVAS_WIDTH || slide.canvas.height !== CANVAS_HEIGHT) {
        totalStructurePenalties += 15;
        issues.push({
          id: `struct_dim_${slide.slideId}`,
          level: 'error',
          dimension: 'structure',
          slideId: slide.slideId,
          message: `第 ${sIdx + 1} 页画布比例异常 (${slide.canvas.width}x${slide.canvas.height})，非标准 16:9 (1920x1080)。`,
          fixAction: '重置为 1920x1080 标准画布',
          fixable: true,
        });
      }

      // Check 2: Element ID uniqueness & boundary
      slide.elements.forEach((el) => {
        if (seenIds.has(el.id)) {
          totalStructurePenalties += 5;
          issues.push({
            id: `struct_id_${el.id}`,
            level: 'warning',
            dimension: 'structure',
            slideId: slide.slideId,
            elementId: el.id,
            message: `检测到重复元素 ID: ${el.id}，可能影响精准编辑。`,
            fixAction: '重命名为唯一 ID',
            fixable: true,
          });
        }
        seenIds.add(el.id);

        // Check 3: Geometry bounds
        if (el.role !== 'background' && isOutOfCanvas(el)) {
          totalVisualPenalties += 10;
          issues.push({
            id: `vis_bounds_${el.id}`,
            level: 'warning',
            dimension: 'visual',
            slideId: slide.slideId,
            elementId: el.id,
            message: `元素 [${el.id}] 超出画布边界 (${el.geometry.x + el.geometry.width}px > ${CANVAS_WIDTH}px 或溢出底部)。`,
            fixAction: '自动平移回内容安全区',
            fixable: true,
          });
        }
      });

      // --- LAYER 2: Visual Quality (Qv) ---
      // Check collisions between cards/layers on same slide
      const nonBgElements = slide.elements.filter((e) => e.role === 'card' || e.role === 'layer');
      for (let i = 0; i < nonBgElements.length; i++) {
        for (let j = i + 1; j < nonBgElements.length; j++) {
          const a = nonBgElements[i].geometry;
          const b = nonBgElements[j].geometry;
          // AABB Collision check with 10px buffer
          const isColliding =
            a.x + 10 < b.x + b.width &&
            a.x + a.width - 10 > b.x &&
            a.y + 10 < b.y + b.height &&
            a.y + a.height - 10 > b.y;

          if (isColliding) {
            totalVisualPenalties += 8;
            issues.push({
              id: `vis_collide_${nonBgElements[i].id}_${nonBgElements[j].id}`,
              level: 'warning',
              dimension: 'visual',
              slideId: slide.slideId,
              message: `第 ${sIdx + 1} 页检测到卡片空间重叠碰撞。`,
              fixAction: '建议人工调整版式间距（自动重排尚未实现）',
              fixable: false,
            });
          }
        }
      }

      // --- LAYER 3: Content Quality (Qc) ---
      if (!slide.title || slide.title.length < 3) {
        totalContentPenalties += 15;
        issues.push({
          id: `content_title_${slide.slideId}`,
          level: 'error',
          dimension: 'content',
          slideId: slide.slideId,
          message: `第 ${sIdx + 1} 页缺少明确的标题概括。`,
          fixAction: '建议补充明确的标题概括',
          fixable: false,
        });
      }
      if (!slide.keyMessage && slide.layout.type !== 'title_cover') {
        totalContentPenalties += 8;
        issues.push({
          id: `content_keymsg_${slide.slideId}`,
          level: 'info',
          dimension: 'content',
          slideId: slide.slideId,
          message: `第 ${sIdx + 1} 页建议增加一句话核心结论 (Key Takeaway)，增强汇报说服力。`,
          fixAction: '建议补充一句话核心结论',
          fixable: false,
        });
      }
    });

    // --- LAYER 4: Global Consistency (Qg) ---
    // Check slide count adequacy
    if (project.slides.length < 3) {
      totalConsistencyPenalties += 15;
      issues.push({
        id: `consist_count`,
        level: 'warning',
        dimension: 'consistency',
        message: '演示文稿页数过少 (少于 3 页)，建议扩充章节叙事。',
        fixable: false,
      });
    }

    // Check cover presence
    const hasCover = project.slides.some((s) => s.layout.type === 'title_cover');
    if (!hasCover) {
      totalConsistencyPenalties += 10;
      issues.push({
        id: `consist_cover`,
        level: 'info',
        dimension: 'consistency',
        message: '缺少第一页项目封面，建议增加封面引导页。',
        fixAction: '建议在首页插入标准封面页',
        fixable: false,
      });
    }

    const structureScore = Math.max(0, 100 - totalStructurePenalties);
    const visualScore = Math.max(0, 100 - totalVisualPenalties);
    const contentScore = Math.max(0, 100 - totalContentPenalties);
    const consistencyScore = Math.max(0, 100 - totalConsistencyPenalties);

    // Weighted Formula: Q = 0.3 * Qs + 0.3 * Qv + 0.2 * Qc + 0.2 * Qg
    const overallScore = Math.round(
      0.3 * structureScore + 0.3 * visualScore + 0.2 * contentScore + 0.2 * consistencyScore
    );

    return {
      overallScore,
      structureScore,
      visualScore,
      contentScore,
      consistencyScore,
      issues,
      checkedAt: Date.now(),
    };
  }

  /**
   * 只修「真的坏了」的地方 —— 修完不得让文稿变得更糟
   * ---------------------------------------------------------------------------
   * 旧实现是无差别归一化：给每个元素重写 ID、把每个非背景元素钳进安全区。
   * 两处都造成了可见的破坏：
   *
   *   1. **几何**：母版页码 (1760,1015,80,30) 与页脚 (100,1015,600,30) 本来就
   *      贴着画布下沿 —— 它们在画布内、只是不在内容安全区内，版式就是这么设计
   *      的。旧实现把它们钳进安全区，等于每点一次「一键修复」，每一页的页码
   *      和页脚就上移 95px、左移 140px。
   *   2. **ID**：旧实现把 ID 洗成 `{元素类型}_{slideId}_{序号}`，抹掉了
   *      `header_` / `accent` 这类语义前缀。而渲染分层与前端主题重映射都靠
   *      前缀识别元素 —— 修完 kicker 会掉出 template-layer，换模板时也不再
   *      跟随 accent 色。
   *
   * 现在的规则：
   *   · **只动被判定为有问题的元素** —— 没坏的元素一个坐标都不改；
   *   · **ID 重排保留语义前缀** —— 前缀取自 `variant` 字段（ADR-018），
   *     不是从旧 ID 里抠出来的；顺手把 `variant` 补齐，语义从此住在字段里；
   *   · **修复后任一维度分数不得下降** —— 修坏了就整体退回，宁可不修也不能修坏。
   */
  static autoFixProject(project: PresentationProject): PresentationProject {
    const before = this.evaluatePresentation(project);
    const updated = JSON.parse(JSON.stringify(project)) as PresentationProject;

    // ---- 1. 画布与页序归一（画布尺寸不符是真的会扣结构分的问题） ----
    updated.slides.forEach((slide, sIdx) => {
      slide.canvas = { width: CANVAS_WIDTH, height: CANVAS_HEIGHT };
      slide.order = sIdx + 1;
    });

    // ---- 2. ID 规范化：语义来自 variant，ID 只是派生结果 ----
    updated.slides.forEach((slide) => {
      slide.elements.forEach((el, idx) => {
        // 先把语义**落进字段**：旧数据没有 variant 的，在这里补齐。
        // 补齐之后整条链路都不再需要从 ID 里猜语义（ADR-018）。
        el.variant = variantOf(el);
        el.id = `${idPrefixOf(el)}_${slide.slideId}_${idx}`;
      });
    });
    // 规范化后仍可能撞 ID（同一页里两个元素语义前缀相同且 slideId 相同）——
    // 补一个后缀兜底，保证全局唯一
    const usedIds = new Set<string>();
    updated.slides.forEach((slide) => {
      slide.elements.forEach((el) => {
        if (!usedIds.has(el.id)) {
          usedIds.add(el.id);
          return;
        }
        let n = 2;
        while (usedIds.has(`${el.id}_${n}`)) n += 1;
        el.id = `${el.id}_${n}`;
        usedIds.add(el.id);
      });
    });

    // ---- 3. 几何：只把真越出画布的元素挪回内容安全区 ----
    updated.slides.forEach((slide) => {
      slide.elements.forEach((el) => {
        if (el.role === 'background') return;
        // 没越界的元素（含母版页码/页脚）—— 一个坐标都不动
        if (!isOutOfCanvas(el)) return;
        clampIntoSafeArea(el);
      });
    });

    // ---- 4. 复评：修复不得让文稿变得更糟 ----
    const after = this.evaluatePresentation(updated);
    if (after.overallScore < before.overallScore) {
      const untouched = JSON.parse(JSON.stringify(project)) as PresentationProject;
      untouched.qualityReport = before;
      untouched.updatedAt = Date.now();
      return untouched;
    }

    updated.qualityReport = after;
    updated.updatedAt = Date.now();
    return updated;
  }
}
