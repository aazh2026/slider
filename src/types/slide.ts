/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type SlideLayoutType =
  | 'title_cover'          // 封面型
  | 'architecture_diagram' // 分层架构
  | 'cards_grid'           // 多卡片/能力矩阵
  | 'problem_solution'     // 问题与方案/对比
  | 'timeline_roadmap'     // 实施路线/时间轴
  | 'stats_kpi'            // 核心指标/数据看板
  | 'radial_center'        // 中心辐射/工程能力
  | 'summary_conclusion';  // 总结展望

export type ElementRole =
  | 'title'
  | 'subtitle'
  | 'layer'
  | 'card'
  | 'badge'
  | 'metric'
  | 'connector'
  | 'chart'
  | 'icon'
  | 'annotation'
  | 'background'
  | 'divider'
  | 'footer';

export type ElementType =
  | 'text'
  | 'card'
  | 'architecture_layer'
  | 'metric'
  | 'badge'
  | 'connector'
  | 'shape'
  | 'group';

export interface Geometry {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}

export interface ElementStyle {
  fontSize?: number;
  fontWeight?: number | string;
  fontFamily?: string;
  color?: string;
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  textAlign?: 'left' | 'center' | 'right';
  padding?: number;
  opacity?: number;
  boxShadow?: string;
  letterSpacing?: string;
  lineHeight?: number;
  gradient?: {
    from: string;
    to: string;
    direction?: 'horizontal' | 'vertical' | 'diagonal';
  };
}

export interface SlideElement {
  id: string;
  type: ElementType;
  role: ElementRole;
  content: string | any; // Text string or structured data
  geometry: Geometry;
  style: ElementStyle;
  editable: boolean;
  parentId?: string;
  groupId?: string;
  zIndex: number;
  metadata?: Record<string, any>;
}

export interface SlideIR {
  slideId: string;
  order: number;
  title: string;
  purpose: string;
  keyMessage: string;
  speakerNotes: string;
  visualIntent: string;
  layout: {
    type: SlideLayoutType;
    templateLayout?: string;
  };
  canvas: {
    width: number;
    height: number;
  };
  elements: SlideElement[];
  versionId?: string;
  lastModified?: number;
}

export interface TemplateTheme {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  surfaceColor: string;
  surfaceBorder: string;
  textPrimary: string;
  textSecondary: string;
  fontFamily: string;
  fontHeading: string;
  isDark: boolean;
}

export interface TemplateIR {
  templateId: string;
  name: string;
  category: string;
  description: string;
  theme: TemplateTheme;
  canvas: {
    width: number;
    height: number;
  };
  master: {
    showHeader: boolean;
    headerText?: string;
    showFooter: boolean;
    footerText?: string;
    showSlideNumber: boolean;
    logoText?: string;
  };
}

export interface SlideOutlineItem {
  slideId: string;
  order: number;
  title: string;
  purpose: string;
  keyMessage: string;
  visualIntent: string;
  layoutPreference: SlideLayoutType;
  requiredElements: string[];
  speakerNotes: string;
  bulletPoints: string[];
}

export interface PresentationRequirement {
  topic: string;
  purpose: string;
  audience: string;
  pageCount: number;
  style: string;
  depth: string;
  aspectRatio: '16:9' | '4:3';
  rawNotes?: string;
}

export interface SlideVersion {
  versionId: string;
  slideId: string;
  timestamp: number;
  author: 'ai' | 'user';
  description: string;
  snapshot: SlideIR;
}

export interface IRPatch {
  operation: 'update_element' | 'replace_group' | 'add_element' | 'remove_element' | 'restyle_slide' | 'reorder_elements';
  targetId?: string;
  changes: Partial<SlideElement> | any;
  preserveIds?: string[];
  reason?: string;
}

export interface QualityIssue {
  id: string;
  level: 'error' | 'warning' | 'info';
  dimension: 'structure' | 'visual' | 'content' | 'consistency';
  slideId?: string;
  elementId?: string;
  message: string;
  fixAction?: string;
}

export interface QualityReport {
  overallScore: number;
  structureScore: number;   // Qs
  visualScore: number;      // Qv
  contentScore: number;     // Qc
  consistencyScore: number; // Qg
  issues: QualityIssue[];
  checkedAt: number;
}

export interface PresentationProject {
  id: string;
  name: string;
  requirement: PresentationRequirement;
  template: TemplateIR;
  outline: SlideOutlineItem[];
  slides: SlideIR[];
  versions: Record<string, SlideVersion[]>; // slideId -> history
  qualityReport?: QualityReport;
  createdAt: number;
  updatedAt: number;
}
