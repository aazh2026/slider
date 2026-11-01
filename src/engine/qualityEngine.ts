/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PresentationProject, QualityReport, QualityIssue, SlideIR, SlideElement } from '../types/slide';

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
      if (slide.canvas.width !== 1920 || slide.canvas.height !== 1080) {
        totalStructurePenalties += 15;
        issues.push({
          id: `struct_dim_${slide.slideId}`,
          level: 'error',
          dimension: 'structure',
          slideId: slide.slideId,
          message: `第 ${sIdx + 1} 页画布比例异常 (${slide.canvas.width}x${slide.canvas.height})，非标准 16:9 (1920x1080)。`,
          fixAction: '重置为 1920x1080 标准画布',
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
          });
        }
        seenIds.add(el.id);

        // Check 3: Geometry bounds
        if (el.role !== 'background') {
          if (
            el.geometry.x < 0 ||
            el.geometry.y < 0 ||
            el.geometry.x + el.geometry.width > 1920 ||
            el.geometry.y + el.geometry.height > 1080
          ) {
            totalVisualPenalties += 10;
            issues.push({
              id: `vis_bounds_${el.id}`,
              level: 'warning',
              dimension: 'visual',
              slideId: slide.slideId,
              elementId: el.id,
              message: `元素 [${el.id}] 超出安全边距边界 (${el.geometry.x + el.geometry.width}px > 1920px 或溢出底部)。`,
              fixAction: '自动平移至安全边距内',
            });
          }
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
              fixAction: '网格自动对齐重排',
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
          fixAction: '根据页面意图自动补全标题',
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
          fixAction: '生成管理层核心结论',
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
        fixAction: '插入标准封面页',
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
   * Automatically repairs geometry bounds, duplicate IDs, and missing key elements
   */
  static autoFixProject(project: PresentationProject): PresentationProject {
    const updated = JSON.parse(JSON.stringify(project)) as PresentationProject;

    updated.slides.forEach((slide, sIdx) => {
      slide.canvas = { width: 1920, height: 1080 };
      slide.order = sIdx + 1;

      slide.elements.forEach((el, eIdx) => {
        el.id = `${el.type}_${slide.slideId}_${eIdx}`;

        if (el.role !== 'background') {
          // Clamp inside 100px padding
          if (el.geometry.x < 100) el.geometry.x = 100;
          if (el.geometry.y < 60) el.geometry.y = 60;
          if (el.geometry.x + el.geometry.width > 1820) {
            el.geometry.width = Math.max(200, 1820 - el.geometry.x);
          }
          if (el.geometry.y + el.geometry.height > 1020) {
            el.geometry.height = Math.max(100, 1020 - el.geometry.y);
          }
        }
      });
    });

    updated.qualityReport = this.evaluatePresentation(updated);
    updated.updatedAt = Date.now();
    return updated;
  }
}
