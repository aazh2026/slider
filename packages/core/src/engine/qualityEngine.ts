/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PresentationProject, QualityReport, QualityIssue, SlideIR, SlideElement, Geometry } from '../types/slide';
import { penaltyOf, fixableOf } from './qualityRules';
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

/** 内容安全区面积 */
const SAFE_AREA = (SAFE_RIGHT - SAFE_LEFT) * (SAFE_BOTTOM - SAFE_TOP);

/**
 * 卡片 / 层之间的最小安全距（`vis_collide` 规则）
 * ---------------------------------------------------------------------------
 * 10px 是**安全距**，不是容差（AMB-004 裁决，见 spec.yaml 的 DEC-014）：
 * 两块之间必须留出 10px 才算「分开的」。判成容差的话，间距 5px 的两张卡
 * 会被放过 —— 而 5px 间距的卡片在视觉上是**糊成一块**的，那正是这条规则
 * 要抓的缺陷。
 */
const COLLISION_MARGIN = 10;

/**
 * 两个 AABB 之间的分离距离
 * ---------------------------------------------------------------------------
 * 正数 = 隔开多远，负数 = 叠了多深。取两轴的较大者：在 x 轴上叠着但在
 * y 轴上隔开 300px 的两块，并不冲突。
 */
function separation(a: Geometry, b: Geometry): number {
  const dx = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));
  const dy = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height));
  return Math.max(dx, dy);
}

/**
 * 承载信息的元素 —— 「这一页有东西可看」的判据
 * ---------------------------------------------------------------------------
 * 不含 background（铺满画布的底）、footer（页码页脚）、divider（分隔线）——
 * 这三类是母版件，不承载信息。
 */
const INFO_ROLES = new Set([
  'title',
  'subtitle',
  'card',
  'layer',
  'metric',
  'badge',
  'connector',
  'chart',
  'icon',
  'annotation',
]);

/**
 * 实质内容件 —— 「这一页讲了什么」的判据
 * ---------------------------------------------------------------------------
 * 比 INFO_ROLES 更严：标题、副标题、连接线、图标都不算 —— 一页只有
 * 「标题 + 一句话结论 + 一个图标」时，它没有承载任何可汇报的信息。
 */
const CONTENT_ROLES = new Set(['card', 'layer', 'metric', 'badge', 'chart']);

/**
 * 承载信息的元素盖住内容安全区的下限（`vis_sparse` 规则）
 * ---------------------------------------------------------------------------
 * 低于这个比例说明内容缩在版心一角 —— 大片留白本身不违法，但一页 PPT
 * 看起来像「没排完」。
 *
 * 取值 20% 是**实测标定**出来的：
 *   · 真实版式的覆盖率是 30.8%（title_cover，最低）～ 82.2%（architecture_diagram）；
 *   · 「只有标题」的页面是 9.5%；
 *   · 20% 落在两者中间，两边都不误判。
 */
const MIN_CONTENT_AREA_RATIO = 0.2;

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

/**
 * 归一化一句结论 —— 用来判断两页是不是在讲同一件事
 * ---------------------------------------------------------------------------
 * 去空白、去标点、转小写：「我们把质量分提高了 10%。」与「我们把质量分提高了10%」
 * 说的是同一句话，必须被认出来是重复。
 */
function normalizeClaim(text: string): string {
  return (text ?? '')
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[，。！？、；：,.!?;:"'（）()【】\[\]《》〈〉<>—\-_~·…]/g, '');
}

/** 一页里承载信息的元素 */
function infoElements(slide: SlideIR): SlideElement[] {
  return slide.elements.filter((el) => INFO_ROLES.has(el.role));
}

/** 一页里实质内容件的个数 */
function contentElementCount(slide: SlideIR): number {
  return slide.elements.filter((el) => CONTENT_ROLES.has(el.role)).length;
}

/**
 * 承载信息的元素盖住了内容安全区的多少
 * ---------------------------------------------------------------------------
 * 用**矩形并集**，不用包围盒，也不用面积之和：
 *   · 面积之和会把同一块版面数好几遍（卡片里套着标题与正文 —— 实测
 *     architecture_diagram 的面积之和是安全区的 137.9%）；
 *   · 包围盒会把「标题在上、卡片在下」这种上下分离的版面算成一大块 ——
 *     实测 title_cover 的包围盒是 53.6%，而它实际只铺了 30.8%。
 * 矩形并集才是「这一页真正被内容盖住了多少」。
 *
 * 算法：先与内容安全区求交，再做坐标压缩 + 逐格判定（矩形并集的标准做法）。
 * 一页的元素个数是几十量级，格子数是 O(2n)²，代价可以忽略。
 */
function contentAreaRatio(slide: SlideIR): number {
  const els = infoElements(slide);
  if (els.length === 0) return 0;

  const rects = els
    .map((el) => {
      const g = el.geometry;
      return {
        x0: Math.max(g.x, SAFE_LEFT),
        y0: Math.max(g.y, SAFE_TOP),
        x1: Math.min(g.x + g.width, SAFE_RIGHT),
        y1: Math.min(g.y + g.height, SAFE_BOTTOM),
      };
    })
    .filter((r) => r.x1 > r.x0 && r.y1 > r.y0);
  if (rects.length === 0) return 0;

  const xs = [...new Set(rects.flatMap((r) => [r.x0, r.x1]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((r) => [r.y0, r.y1]))].sort((a, b) => a - b);

  let area = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      const cx = (xs[i]! + xs[i + 1]!) / 2;
      const cy = (ys[j]! + ys[j + 1]!) / 2;
      const covered = rects.some(
        (r) => r.x0 < cx && cx < r.x1 && r.y0 < cy && cy < r.y1
      );
      if (covered) area += (xs[i + 1]! - xs[i]!) * (ys[j + 1]! - ys[j]!);
    }
  }
  return area / SAFE_AREA;
}

export class QualityEngine {
  /**
   * Computes the 4-layer quality evaluation:
   * Q = w_s * Q_s + w_v * Q_v + w_c * Q_c + w_g * Q_g
   *
   * 扣分幅度全部取自 `qualityRules.ts` 的规则表 —— 引擎是表解释器，
   * 不是幅度的定义处（见 `docs/quality-rules.md`）。
   */
  static evaluatePresentation(project: PresentationProject): QualityReport {
    const issues: QualityIssue[] = [];

    let totalStructurePenalties = 0;
    let totalVisualPenalties = 0;
    let totalContentPenalties = 0;
    let totalConsistencyPenalties = 0;

    const seenIds = new Set<string>();

    project.slides.forEach((slide, sIdx) => {
      const isCover = slide.layout.type === 'title_cover';
      // 实质内容件个数 —— 「这一页讲了什么」的判据
      const contentCount = contentElementCount(slide);
      // 「只有标题的页面」—— 封面豁免（封面本就不该有卡片）
      const isThin = !isCover && contentCount === 0;

      // --- LAYER 1: Structural Validity (Qs) ---
      // Check 1: Canvas dimensions
      if (slide.canvas.width !== CANVAS_WIDTH || slide.canvas.height !== CANVAS_HEIGHT) {
        totalStructurePenalties += penaltyOf('struct_dim');
        issues.push({
          id: `struct_dim_${slide.slideId}`,
          level: 'error',
          dimension: 'structure',
          slideId: slide.slideId,
          message: `第 ${sIdx + 1} 页画布比例异常 (${slide.canvas.width}x${slide.canvas.height})，非标准 16:9 (1920x1080)。`,
          fixAction: '重置为 1920x1080 标准画布',
          fixable: fixableOf('struct_dim'),
        });
      }

      // Check 2: Element ID uniqueness & boundary
      slide.elements.forEach((el) => {
        if (seenIds.has(el.id)) {
          totalStructurePenalties += penaltyOf('struct_id');
          issues.push({
            id: `struct_id_${el.id}`,
            level: 'warning',
            dimension: 'structure',
            slideId: slide.slideId,
            elementId: el.id,
            message: `检测到重复元素 ID: ${el.id}，可能影响精准编辑。`,
            fixAction: '重命名为唯一 ID',
            fixable: fixableOf('struct_id'),
          });
        }
        seenIds.add(el.id);

        // Check 3: Geometry bounds
        if (el.role !== 'background' && isOutOfCanvas(el)) {
          totalVisualPenalties += penaltyOf('vis_bounds');
          issues.push({
            id: `vis_bounds_${el.id}`,
            level: 'warning',
            dimension: 'visual',
            slideId: slide.slideId,
            elementId: el.id,
            message: `元素 [${el.id}] 超出画布边界 (${el.geometry.x + el.geometry.width}px > ${CANVAS_WIDTH}px 或溢出底部)。`,
            fixAction: '自动平移回内容安全区',
            fixable: fixableOf('vis_bounds'),
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
          // AABB Collision check —— 10px 是**安全距**不是容差（AMB-004 裁决）：
          // 两块之间必须留出 10px 才算「分开的」，否则判碰撞。
          const isColliding = separation(a, b) < COLLISION_MARGIN;

          if (isColliding) {
            totalVisualPenalties += penaltyOf('vis_collide');
            issues.push({
              id: `vis_collide_${nonBgElements[i].id}_${nonBgElements[j].id}`,
              level: 'warning',
              dimension: 'visual',
              slideId: slide.slideId,
              message: `第 ${sIdx + 1} 页检测到卡片空间重叠碰撞。`,
              fixAction: `手动把 [${nonBgElements[i].id}] 与 [${nonBgElements[j].id}] 拉开 10px 以上（自动重排尚未实现）`,
              fixable: fixableOf('vis_collide'),
            });
          }
        }
      }

      // Check: 留白过多 —— 内容缩在版心一角
      // 「空页」由 content_thin 负责判（没有实质内容件），两者互斥，
      // 同一页不重复扣两次分。
      if (!isThin) {
        const ratio = contentAreaRatio(slide);
        if (ratio < MIN_CONTENT_AREA_RATIO) {
          totalVisualPenalties += penaltyOf('vis_sparse');
          issues.push({
            id: `vis_sparse_${slide.slideId}`,
            level: 'info',
            dimension: 'visual',
            slideId: slide.slideId,
            message: `第 ${sIdx + 1} 页内容只占版心 ${(ratio * 100).toFixed(0)}%，留白过多，看起来像没排完。`,
            fixAction: `把这一页的内容块撑到版心（内容并集应占内容安全区 ${(MIN_CONTENT_AREA_RATIO * 100).toFixed(0)}% 以上），或补一块内容`,
            fixable: fixableOf('vis_sparse'),
          });
        }
      }

      // --- LAYER 3: Content Quality (Qc) ---
      if (!slide.title || slide.title.length < 3) {
        totalContentPenalties += penaltyOf('content_title');
        issues.push({
          id: `content_title_${slide.slideId}`,
          level: 'error',
          dimension: 'content',
          slideId: slide.slideId,
          message: `第 ${sIdx + 1} 页缺少明确的标题概括。`,
          fixAction: '给这一页写一个能概括全页的标题（至少 3 个字）',
          fixable: fixableOf('content_title'),
        });
      }
      if (!slide.keyMessage && !isCover) {
        totalContentPenalties += penaltyOf('content_keymsg');
        issues.push({
          id: `content_keymsg_${slide.slideId}`,
          level: 'info',
          dimension: 'content',
          slideId: slide.slideId,
          message: `第 ${sIdx + 1} 页建议增加一句话核心结论 (Key Takeaway)，增强汇报说服力。`,
          fixAction: '给这一页补一句核心结论（一句话，说明观众看完这页要记住什么）',
          fixable: fixableOf('content_keymsg'),
        });
      }

      // Check: 实质内容缺失 —— 只有标题的页面在汇报里没有信息量
      if (isThin) {
        totalContentPenalties += penaltyOf('content_thin');
        issues.push({
          id: `content_thin_${slide.slideId}`,
          level: 'warning',
          dimension: 'content',
          slideId: slide.slideId,
          message: `第 ${sIdx + 1} 页只有标题，没有实质内容（卡片 / 层 / 指标一个都没有）。`,
          fixAction: '给这一页补上实质内容件（卡片 / 层 / 指标），只放标题的页面讲不出东西',
          fixable: fixableOf('content_thin'),
        });
      }
    });

    // --- 跨页核心结论重复（Qc） ---
    // 同一个结论在三页里各说一遍 —— 内容分此前完全看不见这类缺陷。
    // 按归一化后的结论分组，每组第 2..n 页各扣一次分。
    const claimGroups = new Map<string, SlideIR[]>();
    project.slides.forEach((slide) => {
      if (slide.layout.type === 'title_cover') return; // 封面不参与
      const claim = normalizeClaim(slide.keyMessage ?? '');
      if (!claim) return; // 空结论由 content_keymsg 负责
      const group = claimGroups.get(claim);
      if (group) group.push(slide);
      else claimGroups.set(claim, [slide]);
    });
    claimGroups.forEach((group) => {
      if (group.length < 2) return;
      // 第一页是「原版」，其余都是重复
      group.slice(1).forEach((slide) => {
        const idx = project.slides.findIndex((s) => s.slideId === slide.slideId);
        const first = group[0]!;
        totalContentPenalties += penaltyOf('content_dup');
        issues.push({
          id: `content_dup_${slide.slideId}`,
          level: 'warning',
          dimension: 'content',
          slideId: slide.slideId,
          message: `第 ${idx + 1} 页的核心结论与第 ${project.slides.findIndex((s) => s.slideId === first.slideId) + 1} 页重复。`,
          fixAction: `把第 ${idx + 1} 页的核心结论改成这一页独有的说法 —— 与第 ${project.slides.findIndex((s) => s.slideId === first.slideId) + 1} 页重复的结论应当合并`,
          fixable: fixableOf('content_dup'),
        });
      });
    });

    // --- LAYER 4: Global Consistency (Qg) ---
    // Check slide count adequacy
    if (project.slides.length < 3) {
      totalConsistencyPenalties += penaltyOf('consist_count');
      issues.push({
        id: 'consist_count',
        level: 'warning',
        dimension: 'consistency',
        message: '演示文稿页数过少 (少于 3 页)，建议扩充章节叙事。',
        fixAction: '把文稿扩到 3 页以上 —— 少于 3 页撑不起一次完整汇报',
        fixable: fixableOf('consist_count'),
      });
    }

    // Check cover presence
    const hasCover = project.slides.some((s) => s.layout.type === 'title_cover');
    if (!hasCover) {
      totalConsistencyPenalties += penaltyOf('consist_cover');
      issues.push({
        id: 'consist_cover',
        level: 'info',
        dimension: 'consistency',
        message: '缺少第一页项目封面，建议增加封面引导页。',
        fixAction: '在首页前面插入一页 title_cover 版式的封面',
        fixable: fixableOf('consist_cover'),
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
