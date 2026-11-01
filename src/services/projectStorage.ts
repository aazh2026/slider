/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PresentationProject, SlideOutlineItem, SlideIR } from '../types/slide';
import { createStarterProjects } from '../data/starterProjects';
import { BUILT_IN_TEMPLATES } from '../data/templates';
import { LayoutEngine } from '../engine/layoutEngine';
import { QualityEngine } from '../engine/qualityEngine';

const STORAGE_KEY = 'ai_ppt_studio_projects_v2';

export class ProjectStorage {
  /**
   * Retrieves all user projects from localStorage, initializing with starter projects if empty
   */
  static getAllProjects(): PresentationProject[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (err) {
      console.warn('Failed to parse projects from localStorage:', err);
    }

    // Default seed
    const starters = createStarterProjects();
    this.saveAllProjects(starters);
    return starters;
  }

  /**
   * Saves or updates a project in the collection
   */
  static saveProject(project: PresentationProject): PresentationProject[] {
    const all = this.getAllProjects();
    const idx = all.findIndex((p) => p.id === project.id);
    const updated = { ...project, updatedAt: Date.now() };

    let newList: PresentationProject[];
    if (idx >= 0) {
      newList = [...all];
      newList[idx] = updated;
    } else {
      newList = [updated, ...all];
    }

    this.saveAllProjects(newList);
    return newList;
  }

  /**
   * Deletes a project by ID
   */
  static deleteProject(projectId: string): PresentationProject[] {
    const all = this.getAllProjects();
    const newList = all.filter((p) => p.id !== projectId);
    this.saveAllProjects(newList);
    return newList;
  }

  /**
   * Duplicates an existing project
   */
  static duplicateProject(projectId: string): { newProject: PresentationProject; projects: PresentationProject[] } {
    const all = this.getAllProjects();
    const target = all.find((p) => p.id === projectId);
    if (!target) {
      throw new Error(`Project ${projectId} not found.`);
    }

    const cloned: PresentationProject = JSON.parse(JSON.stringify(target));
    const newId = `proj_${Date.now()}`;
    cloned.id = newId;
    cloned.name = `${cloned.name} (副本)`;
    cloned.createdAt = Date.now();
    cloned.updatedAt = Date.now();

    // Re-assign slide IDs to ensure integrity
    cloned.slides.forEach((s, idx) => {
      s.slideId = `slide_${newId}_${idx}`;
      s.elements.forEach((el, eIdx) => {
        el.id = `${el.type}_${newId}_${idx}_${eIdx}`;
      });
    });

    const newList = [cloned, ...all];
    this.saveAllProjects(newList);
    return { newProject: cloned, projects: newList };
  }

  /**
   * Creates a new blank presentation
   */
  static createBlankProject(
    name: string = '未命名演示文稿',
    templateId: string = 'tpl_modern_light'
  ): { newProject: PresentationProject; projects: PresentationProject[] } {
    const all = this.getAllProjects();
    const template = BUILT_IN_TEMPLATES.find((t) => t.templateId === templateId) || BUILT_IN_TEMPLATES[0];

    const outlineItem: SlideOutlineItem = {
      slideId: `slide_${Date.now()}_01`,
      order: 1,
      title: name,
      purpose: '演示文稿总体目标与定位',
      keyMessage: '以清晰的逻辑与专业的视觉规范阐述核心价值',
      visualIntent: 'title_cover',
      layoutPreference: 'title_cover',
      requiredElements: ['主标题', '副标题', '作者信息'],
      speakerNotes: '开场致辞与背景介绍。',
      bulletPoints: ['项目战略背景', '核心业务价值'],
    };

    const firstSlide = LayoutEngine.generateSlideIR(outlineItem, template.theme, 1, 1);

    const newProject: PresentationProject = {
      id: `proj_${Date.now()}`,
      name,
      requirement: {
        topic: name,
        purpose: '业务与技术规划汇报',
        audience: '管理层与相关利益方',
        pageCount: 1,
        style: template.theme.isDark ? '科技沉浸深色' : '清爽明亮纯白',
        depth: '商业与技术规划',
        aspectRatio: '16:9',
      },
      template,
      outline: [outlineItem],
      slides: [firstSlide],
      versions: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    newProject.qualityReport = QualityEngine.evaluatePresentation(newProject);
    const newList = [newProject, ...all];
    this.saveAllProjects(newList);
    return { newProject, projects: newList };
  }

  /**
   * Imports a presentation from a Slide IR JSON backup string
   */
  static importProjectFromJson(jsonString: string): { newProject: PresentationProject; projects: PresentationProject[] } {
    const parsed = JSON.parse(jsonString);
    if (!parsed.slides || !parsed.name) {
      throw new Error('无效的 Slide IR 项目格式文件。');
    }

    const importedProject: PresentationProject = {
      ...parsed,
      id: `proj_${Date.now()}`,
      name: `${parsed.name} (导入)`,
      updatedAt: Date.now(),
    };

    const all = this.getAllProjects();
    const newList = [importedProject, ...all];
    this.saveAllProjects(newList);
    return { newProject: importedProject, projects: newList };
  }

  private static saveAllProjects(projects: PresentationProject[]) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    } catch (err) {
      console.warn('Failed to save projects to localStorage (quota exceeded?):', err);
    }
  }
}
