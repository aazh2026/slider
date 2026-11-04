/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SlideContent } from './content';

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

/**
 * 元素的版式槽位（variant）
 * ---------------------------------------------------------------------------
 * **语义住在字段里，不住在 ID 字符串里**（ADR-018）。
 *
 * 过去语义只能从 ID 猜：`el.id.startsWith('header_')` 决定它走 SVG 的哪一层、
 * `el.id.includes('accent')` 决定它的颜色跟不跟主题 accent 色、ID 修复时从
 * ID 里抠出语义前缀。这三处都是「字符串即语义」—— 任何一次重命名都是事故
 * （波 0 的 ADR-014 就是被它坑的：修复把 `header_s1` 洗成 `text_s1_1`，元素
 * 当场掉出模板层）。
 *
 * `role` 回答「这是什么东西」（标题 / 卡片 / 徽标），`variant` 回答
 * 「**它是哪个版式槽位**」（页眉 / 页码 / 时间轴节点 / 架构层盒）。
 * 两者正交：一个 `role: 'card'` 的元素可能是 `grid_card` 也可能是 `kpi_card`，
 * 而这个区别决定了它怎么被重映射配色。
 *
 * 通用桶（`card` / `metric` / `badge` / `divider` …）是**兜底**：用户手插的
 * 元素、旧数据迁移不出来的元素落在这里。
 */
export type ElementVariant =
  // ---- 通用桶（版式无关）----
  | 'background'
  | 'title'
  | 'subtitle'
  | 'footer'
  | 'card'
  | 'metric'
  | 'badge'
  | 'divider'
  | 'layer'
  | 'connector'
  | 'chart'
  | 'icon'
  | 'annotation'
  // ---- 母版槽位（非封面页）----
  | 'header'
  | 'keymsg'
  | 'pagenum'
  | 'footernote'
  // ---- 封面槽位----
  | 'kicker'
  | 'maintitle'
  | 'accent_line'
  | 'metacard'
  // ---- 版式专属槽位----
  | 'layer_box'
  | 'layer_title'
  | 'layer_body'
  | 'grid_card'
  | 'problem_box'
  | 'solution_box'
  | 'timeline_bar'
  | 'timeline_node'
  | 'timeline_card'
  | 'kpi_card'
  | 'radial_center_node'
  | 'radial_sat'
  | 'summary_main_card';

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
  /**
   * 版式槽位（ADR-018）
   * ---------------------------------------------------------------------------
   * **可选**是为了兼容已存的旧 IR（它们没有这个字段）；版式引擎生成的元素
   * **一定**带它。缺字段时读 `variantOf()` —— 它会走唯一的 legacy 回退。
   */
  variant?: ElementVariant;
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
  /**
   * 已被删除的元素 id 墓碑（补丁协议幂等性所需，见 engine/patchApplier.ts）
   * ---------------------------------------------------------------------------
   * 「同一条 patch 施加两次结果相同」与「删不存在的元素必须报错」这两条要求
   * 在朴素实现里互斥：第一次删掉了元素，第二次再删同一 id 就是「删不存在」。
   * 墓碑用来区分「已经删过了」（幂等 no-op）与「从来没存在过」（报错）。
   */
  removedElementIds?: string[];
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
  /**
   * 内容槽位（docs/backend-design.md §4.2）
   * ---------------------------------------------------------------------------
   * AI 产出 / 人工编辑的排版槽位。缺省时由 `engine/contentBinding.ts`
   * 从 bulletPoints / keyMessage 确定性推导，**绝不回落硬编码演示文案**。
   */
  content?: SlideContent;
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
  /** 各 operation 的载荷不同 —— remove_element 不需要载荷，故可选 */
  changes?: Partial<SlideElement> | any;
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
  /**
   * 这一条能不能被「一键修复」自动处理
   * ---------------------------------------------------------------------------
   * `fixAction` 是**给人看的建议**，不是「点一下就能修」的承诺。
   * 只有真正实现了自动修复的规则才置 true —— 前端据此禁用按钮，
   * 免得用户点「修复」发现什么都没变。
   */
  fixable?: boolean;
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
  /**
   * 真实页数 —— 服务端 `slides` 表里的行数。
   *
   * 为什么单独留一个字段：作品库只拉**摘要**，摘要里没有每一页的 IR，
   * 于是 `slides` 恒为空数组。列表上要显示"N 页"时，光看 `slides.length`
   * 永远是 0 —— 除非这份文稿刚好被完整加载过。
   *
   * 这个字段是服务端给的权威页数；`slides.length` 是"当前内存里加载了几页"。
   * 两者不一致时以本字段为准。
   */
  slideCount?: number;
  versions: Record<string, SlideVersion[]>; // slideId -> history
  qualityReport?: QualityReport;
  createdAt: number;
  updatedAt: number;
}
