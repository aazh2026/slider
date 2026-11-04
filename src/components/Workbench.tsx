/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import {
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Plus,
  Copy,
  Trash2,
  Sparkles,
  Sliders,
  Palette,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Wand2,
  Layers,
  Type,
  Move,
  History,
  RotateCcw,
  Sun,
  Moon,
  ArrowUp,
  ArrowDown,
  AlignHorizontalJustifyCenter,
  AlignVerticalJustifyCenter,
  ArrowUpToLine,
  ArrowDownToLine,
  FileText,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  TrendingUp,
  GitBranch,
  Split,
  Tag,
  Minus,
  Maximize,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Grid,
} from 'lucide-react';
import {
  PresentationProject,
  SlideIR,
  SlideElement,
  TemplateIR,
  SlideVersion,
  QualityReport,
  SlideLayoutType,
  SlideOutlineItem,
} from '@ppt/core';
import { SVGRenderer } from '@ppt/core';
import { BUILT_IN_TEMPLATES } from '@ppt/core';
import { defaultVisualIntent } from '@ppt/core';
import { QualityEngine } from '@ppt/core';
import { LayoutEngine } from '@ppt/core';
import { remapSlidesToTheme } from '@ppt/core';

interface WorkbenchProps {
  project: PresentationProject;
  onUpdateProject: (p: PresentationProject) => void;
  onStartPresent: () => void;
  /**
   * 当前页码变化时上报 —— 让 App 侧知道"用户停在第几页"。
   * ---------------------------------------------------------------------------
   * 导出（PNG/SVG 只导当前页）与放映（从当前页开始）都需要这个信息，
   * 而页码的真源只有 Workbench 里的 activeSlideIndex 一份。
   * 父组件只**读**这个值，不反过来下发 —— 免得父子形成同步环。
   */
  onActiveSlideChange?: (index: number) => void;
  /**
   * AI 编辑 —— 由 **服务端** 施加 IRPatch 协议
   * ---------------------------------------------------------------------------
   * Workbench 不再自己调用模型、自己改元素数组。补丁在服务端施加并落库，
   * 返回的是**施加之后的 IR**与新版本号 —— 前端只负责把结果画出来。
   * 这样乐观锁、版本历史、AI 输出校验都只有一处实现。
   */
  onAiEdit: (
    slideId: string,
    instruction: string,
    mode: 'content' | 'style' | 'layout'
  ) => Promise<{ message: string; degraded: boolean }>;
}

type InspectorTab = 'ai' | 'props' | 'theme' | 'quality';

export const Workbench: React.FC<WorkbenchProps> = ({
  project,
  onUpdateProject,
  onStartPresent,
  onActiveSlideChange,
  onAiEdit,
}) => {
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<InspectorTab>('ai');
  const [zoomLevel, setZoomLevel] = useState<number>(0.55);
  const [showGrid, setShowGrid] = useState(false);
  const [showSpeakerNotesDrawer, setShowSpeakerNotesDrawer] = useState(false);
  const [isLayoutModalOpen, setIsLayoutModalOpen] = useState(false);
  const [isInsertMenuOpen, setIsInsertMenuOpen] = useState(false);

  // Collapsible Sidebars for maximizing canvas workspace
  const [isLeftRailCollapsed, setIsLeftRailCollapsed] = useState(false);
  const [isRightInspectorCollapsed, setIsRightInspectorCollapsed] = useState(false);

  // Undo / Redo Stacks
  const [undoStack, setUndoStack] = useState<SlideIR[][]>([]);
  const [redoStack, setRedoStack] = useState<SlideIR[][]>([]);

  // AI Prompt in Inspector
  const [aiInstruction, setAiInstruction] = useState('');
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  /** 本轮 AI 编辑是否走了服务端降级路径 —— 显式暴露，不靠文案猜 */
  const [aiDegraded, setAiDegraded] = useState(false);
  /** 编辑意图 —— 与后端 IRPatch 协议的 mode 一一对应 */
  const [aiMode, setAiMode] = useState<'content' | 'style' | 'layout'>('content');

  // Inline text editing state
  const [editingTextElementId, setEditingTextElementId] = useState<string | null>(null);
  const [inlineTextValue, setInlineTextValue] = useState('');

  // Dragging state on canvas
  const [isDragging, setIsDragging] = useState(false);
  const dragStartPos = useRef<{ x: number; y: number; elX: number; elY: number } | null>(null);

  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const insertMenuRef = useRef<HTMLDivElement>(null);

  const currentSlide = project.slides[activeSlideIndex] || project.slides[0];
  const selectedElement = currentSlide?.elements.find((el) => el.id === selectedElementId);

  /**
   * 把当前页码上报给 App —— 导出与放映需要知道"用户停在第几页"。
   * ---------------------------------------------------------------------------
   * 这里用 effect 而不是把 setState 逐个包一层，是为了**只有一个上报点**：
   * 上面所有 setActiveSlideIndex 的调用点无论怎么改都会流经这里，不会漏报。
   */
  useEffect(() => {
    onActiveSlideChange?.(activeSlideIndex);
  }, [activeSlideIndex, onActiveSlideChange]);

  // Auto-fit zoom on mount, resize, or rail collapse/expand
  const fitZoomToContainer = useCallback(() => {
    if (canvasContainerRef.current) {
      const { clientWidth, clientHeight } = canvasContainerRef.current;
      const availableW = clientWidth - 48;
      const availableH = clientHeight - 48;
      if (availableW > 100 && availableH > 100) {
        const scaleW = availableW / 1920;
        const scaleH = availableH / 1080;
        const calculated = Math.min(scaleW, scaleH);
        // **向下取整**，不向上取整：适配缩放的语义是「装得下」。
        // 向上取整最多会多出 0.005×1920 ≈ 9.6px，
        // 而画布一旦比可视内容区宽，多出来的部分就会被裁掉（见下面的 safe 对齐说明）。
        setZoomLevel(Math.max(0.2, Math.min(1.4, Math.floor(calculated * 100) / 100)));
      }
    }
  }, []);

  /**
   * 适配缩放：容器尺寸一变就重算。
   * ---------------------------------------------------------------------------
   * 为什么不用 `window.resize`（2026-11-05 实测出来的坑）：
   * 容器变宽**不一定**是窗口变宽 —— 左右面板收起/展开、面板换宽度都会改容器宽度；
   * 窗口变宽也**不一定**改容器宽度（外面还有别的栏）。
   * 只监听 window.resize，缩放档位就会停在旧值上：
   * 画布比可视区宽 → 超出的一侧被裁掉且滚不到（见下面的 safe 对齐说明）。
   *
   * 为什么用 `useLayoutEffect` 而不是 `useEffect`：
   * 初次挂载时 zoomLevel 的初值是 0.55（画布 1056px 宽），
   * useEffect 在**首帧画出来之后**才跑 —— 那一帧用户看到的就是一张被裁掉的画布。
   * useLayoutEffect 在浏览器绘制之前跑，首帧就是适配好的。
   */
  useLayoutEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) return;
    let lastW = 0;
    let lastH = 0;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      // 用**边框盒**判断容器是不是真的变了：
      // clientWidth/clientHeight 不含滚动条，滚动条一出现高度就少 15px，
      // 拿它当触发条件会「适配 → 冒出滚动条 → 高度又变了 → 再适配」地来回抖。
      if (Math.abs(rect.width - lastW) < 0.5 && Math.abs(rect.height - lastH) < 0.5) return;
      lastW = rect.width;
      lastH = rect.height;
      fitZoomToContainer();
    });
    ro.observe(el);
    fitZoomToContainer();
    return () => ro.disconnect();
  }, [fitZoomToContainer]);

  // Click outside to close Insert Menu
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (insertMenuRef.current && !insertMenuRef.current.contains(e.target as Node)) {
        setIsInsertMenuOpen(false);
      }
    };
    if (isInsertMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isInsertMenuOpen]);

  // Push state to undo stack before committing mutation
  const pushUndoSnapshot = () => {
    setUndoStack((prev) => [...prev.slice(-15), JSON.parse(JSON.stringify(project.slides))]);
    setRedoStack([]);
  };

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const previousSlides = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev, JSON.parse(JSON.stringify(project.slides))]);

    const updatedProj: PresentationProject = {
      ...project,
      slides: previousSlides,
      updatedAt: Date.now(),
    };
    updatedProj.qualityReport = QualityEngine.evaluatePresentation(updatedProj);
    onUpdateProject(updatedProj);
  }, [undoStack, project, onUpdateProject]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const nextSlides = redoStack[redoStack.length - 1];
    setRedoStack((prev) => prev.slice(0, -1));
    setUndoStack((prev) => [...prev, JSON.parse(JSON.stringify(project.slides))]);

    const updatedProj: PresentationProject = {
      ...project,
      slides: nextSlides,
      updatedAt: Date.now(),
    };
    updatedProj.qualityReport = QualityEngine.evaluatePresentation(updatedProj);
    onUpdateProject(updatedProj);
  }, [redoStack, project, onUpdateProject]);

  // Update slide IR helper
  const updateCurrentSlide = (newSlide: SlideIR, snapshotDesc?: string, skipUndoPush = false) => {
    if (!skipUndoPush) {
      pushUndoSnapshot();
    }

    const updatedSlides = [...project.slides];
    const prevSlide = updatedSlides[activeSlideIndex];
    updatedSlides[activeSlideIndex] = newSlide;

    const versionHistory = { ...project.versions };
    if (snapshotDesc) {
      const slideHistory = versionHistory[newSlide.slideId] || [];
      const newVersion: SlideVersion = {
        versionId: `v_${Date.now()}`,
        slideId: newSlide.slideId,
        timestamp: Date.now(),
        author: snapshotDesc.includes('AI') ? 'ai' : 'user',
        description: snapshotDesc,
        snapshot: JSON.parse(JSON.stringify(prevSlide)),
      };
      versionHistory[newSlide.slideId] = [newVersion, ...slideHistory.slice(0, 10)];
    }

    const updatedProject: PresentationProject = {
      ...project,
      slides: updatedSlides,
      versions: versionHistory,
      updatedAt: Date.now(),
    };
    updatedProject.qualityReport = QualityEngine.evaluatePresentation(updatedProject);
    onUpdateProject(updatedProject);
  };

  // Add Slide with specific layout
  const handleAddSlideWithLayout = (layoutType: SlideLayoutType) => {
    pushUndoSnapshot();
    const newSlideId = `slide_${Date.now()}`;
    const mockOutlineItem: SlideOutlineItem = {
      slideId: newSlideId,
      order: project.slides.length + 1,
      title: '新模块内容规划与架构推演',
      purpose: '阐述业务目标、关键举措与技术支撑',
      keyMessage: '以统一平台规范与高保真架构保障业务持续创新',
      speakerNotes: '本页重点介绍核心逻辑与落地实施路径。',
      visualIntent: defaultVisualIntent(layoutType),
      layoutPreference: layoutType,
      bulletPoints: ['建立核心数据链路与标准化集成模型', '引入智能调度体系提升端到端执行效率', '打造全流程监控与敏捷响应机制'],
      requiredElements: ['title', 'content'],
    };

    const newSlide = LayoutEngine.generateSlideIR(
      mockOutlineItem,
      project.template.theme,
      project.slides.length + 1,
      project.slides.length + 1
    );

    const updatedSlides = [...project.slides, newSlide];
    onUpdateProject({ ...project, slides: updatedSlides, updatedAt: Date.now() });
    setActiveSlideIndex(updatedSlides.length - 1);
    setSelectedElementId(null);
    setIsLayoutModalOpen(false);
  };

  const handleDuplicateSlide = (index: number) => {
    pushUndoSnapshot();
    const target = project.slides[index];
    const duplicated: SlideIR = JSON.parse(JSON.stringify(target));
    duplicated.slideId = `slide_${Date.now()}`;
    duplicated.order = index + 2;
    duplicated.title = `${duplicated.title} (副本)`;

    const updated = [...project.slides];
    updated.splice(index + 1, 0, duplicated);
    updated.forEach((s, i) => (s.order = i + 1));
    onUpdateProject({ ...project, slides: updated, updatedAt: Date.now() });
    setActiveSlideIndex(index + 1);
  };

  const handleDeleteSlide = (index: number) => {
    if (project.slides.length <= 1) return;
    pushUndoSnapshot();
    const updated = project.slides.filter((_, i) => i !== index);
    updated.forEach((s, i) => (s.order = i + 1));
    onUpdateProject({ ...project, slides: updated, updatedAt: Date.now() });
    setActiveSlideIndex(Math.max(0, index - 1));
    setSelectedElementId(null);
  };

  const handleMoveSlideUp = (index: number) => {
    if (index === 0) return;
    pushUndoSnapshot();
    const updated = [...project.slides];
    const temp = updated[index];
    updated[index] = updated[index - 1];
    updated[index - 1] = temp;
    updated.forEach((s, i) => (s.order = i + 1));
    onUpdateProject({ ...project, slides: updated, updatedAt: Date.now() });
    setActiveSlideIndex(index - 1);
  };

  const handleMoveSlideDown = (index: number) => {
    if (index >= project.slides.length - 1) return;
    pushUndoSnapshot();
    const updated = [...project.slides];
    const temp = updated[index];
    updated[index] = updated[index + 1];
    updated[index + 1] = temp;
    updated.forEach((s, i) => (s.order = i + 1));
    onUpdateProject({ ...project, slides: updated, updatedAt: Date.now() });
    setActiveSlideIndex(index + 1);
  };

  // Add New Elements manually
  const handleAddTextElement = () => {
    pushUndoSnapshot();
    const newEl: SlideElement = {
      id: `text_${Date.now()}`,
      variant: 'annotation',
      type: 'text',
      role: 'annotation',
      content: '点击双击输入自定义说明文本...',
      geometry: { x: 300, y: 350, width: 450, height: 60 },
      style: {
        fontSize: 20,
        fontWeight: 500,
        color: project.template.theme.textPrimary,
      },
      editable: true,
      zIndex: 20,
    };
    updateCurrentSlide({ ...currentSlide, elements: [...currentSlide.elements, newEl] });
    setSelectedElementId(newEl.id);
    setIsInsertMenuOpen(false);
  };

  const handleAddCardElement = () => {
    pushUndoSnapshot();
    const newEl: SlideElement = {
      id: `card_${Date.now()}`,
      variant: 'card',
      type: 'card',
      role: 'card',
      content: {
        tag: 'NEW CAPABILITY',
        title: '新增业务功能卡片',
        desc: '在此处添加详尽的业务方案论述、数据佐证与阶段性落地行动项。',
      },
      geometry: { x: 350, y: 320, width: 480, height: 380 },
      style: {
        backgroundColor: project.template.theme.surfaceColor,
        borderColor: project.template.theme.surfaceBorder,
        borderWidth: 1,
        borderRadius: 14,
        padding: 28,
      },
      editable: true,
      zIndex: 10,
    };
    updateCurrentSlide({ ...currentSlide, elements: [...currentSlide.elements, newEl] });
    setSelectedElementId(newEl.id);
    setIsInsertMenuOpen(false);
  };

  const handleAddMetricElement = () => {
    pushUndoSnapshot();
    const newEl: SlideElement = {
      id: `metric_${Date.now()}`,
      variant: 'metric',
      type: 'card',
      role: 'metric',
      content: {
        metricValue: '98.5%',
        metricUnit: '提升率',
        label: '业务效能综合指标',
      },
      geometry: { x: 400, y: 350, width: 340, height: 180 },
      style: {
        backgroundColor: project.template.theme.surfaceColor,
        borderColor: project.template.theme.surfaceBorder,
        borderWidth: 1,
        borderRadius: 12,
        padding: 24,
      },
      editable: true,
      zIndex: 15,
    };
    updateCurrentSlide({ ...currentSlide, elements: [...currentSlide.elements, newEl] });
    setSelectedElementId(newEl.id);
    setIsInsertMenuOpen(false);
  };

  const handleAddBadgeElement = () => {
    pushUndoSnapshot();
    const newEl: SlideElement = {
      id: `badge_${Date.now()}`,
      variant: 'badge',
      type: 'text',
      role: 'badge',
      content: 'CORE HIGHLIGHT',
      geometry: { x: 400, y: 300, width: 200, height: 36 },
      style: {
        fontSize: 13,
        fontWeight: 700,
        color: project.template.theme.accentColor,
        backgroundColor: project.template.theme.isDark ? `${project.template.theme.accentColor}20` : `${project.template.theme.accentColor}15`,
        borderColor: project.template.theme.accentColor,
        borderWidth: 1,
        borderRadius: 20,
        padding: 8,
      },
      editable: true,
      zIndex: 15,
    };
    updateCurrentSlide({ ...currentSlide, elements: [...currentSlide.elements, newEl] });
    setSelectedElementId(newEl.id);
    setIsInsertMenuOpen(false);
  };

  const handleAddDividerElement = () => {
    pushUndoSnapshot();
    const newEl: SlideElement = {
      id: `divider_${Date.now()}`,
      variant: 'divider',
      type: 'shape',
      role: 'divider',
      content: '',
      geometry: { x: 200, y: 400, width: 600, height: 3 },
      style: {
        backgroundColor: project.template.theme.accentColor,
      },
      editable: true,
      zIndex: 10,
    };
    updateCurrentSlide({ ...currentSlide, elements: [...currentSlide.elements, newEl] });
    setSelectedElementId(newEl.id);
    setIsInsertMenuOpen(false);
  };

  // Delete currently selected element
  const handleDeleteSelectedElement = useCallback(() => {
    if (!selectedElementId || !selectedElement) return;
    if (selectedElement.role === 'background') return;
    pushUndoSnapshot();
    const updated = currentSlide.elements.filter((el) => el.id !== selectedElementId);
    updateCurrentSlide({ ...currentSlide, elements: updated }, '删除元素');
    setSelectedElementId(null);
  }, [selectedElementId, selectedElement, currentSlide]);

  // Duplicate currently selected element
  const handleDuplicateSelectedElement = () => {
    if (!selectedElementId || !selectedElement) return;
    pushUndoSnapshot();
    const duplicated: SlideElement = JSON.parse(JSON.stringify(selectedElement));
    duplicated.id = `${selectedElement.type}_${Date.now()}`;
    duplicated.geometry.x = Math.min(1920 - duplicated.geometry.width, duplicated.geometry.x + 30);
    duplicated.geometry.y = Math.min(1080 - duplicated.geometry.height, duplicated.geometry.y + 30);
    duplicated.zIndex = (selectedElement.zIndex || 5) + 1;

    updateCurrentSlide({ ...currentSlide, elements: [...currentSlide.elements, duplicated] }, '复制元素');
    setSelectedElementId(duplicated.id);
  };

  // Layer ordering
  const handleBringToFront = () => {
    if (!selectedElementId) return;
    pushUndoSnapshot();
    const maxZ = Math.max(...currentSlide.elements.map((e) => e.zIndex || 0), 10);
    const updated = currentSlide.elements.map((el) =>
      el.id === selectedElementId ? { ...el, zIndex: maxZ + 2 } : el
    );
    updateCurrentSlide({ ...currentSlide, elements: updated });
  };

  const handleSendToBack = () => {
    if (!selectedElementId) return;
    pushUndoSnapshot();
    const updated = currentSlide.elements.map((el) =>
      el.id === selectedElementId ? { ...el, zIndex: 1 } : el
    );
    updateCurrentSlide({ ...currentSlide, elements: updated });
  };

  // Alignments
  const handleAlignCenterHorizontally = () => {
    if (!selectedElementId || !selectedElement) return;
    pushUndoSnapshot();
    const newX = Math.round((1920 - selectedElement.geometry.width) / 2);
    const updated = currentSlide.elements.map((el) =>
      el.id === selectedElementId ? { ...el, geometry: { ...el.geometry, x: newX } } : el
    );
    updateCurrentSlide({ ...currentSlide, elements: updated });
  };

  const handleAlignCenterVertically = () => {
    if (!selectedElementId || !selectedElement) return;
    pushUndoSnapshot();
    const newY = Math.round((1080 - selectedElement.geometry.height) / 2);
    const updated = currentSlide.elements.map((el) =>
      el.id === selectedElementId ? { ...el, geometry: { ...el.geometry, y: newY } } : el
    );
    updateCurrentSlide({ ...currentSlide, elements: updated });
  };

  // Keyboard Shortcuts (Undo/Redo, Delete, Escape, Arrow keys)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      // Undo: Ctrl+Z or Cmd+Z
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }

      // Redo: Ctrl+Y or Cmd+Shift+Z
      if (
        ((e.ctrlKey || e.metaKey) && e.key === 'y') ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z'))
      ) {
        e.preventDefault();
        handleRedo();
        return;
      }

      // Delete / Backspace
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedElementId && !editingTextElementId) {
          e.preventDefault();
          handleDeleteSelectedElement();
        }
        return;
      }

      // Escape: deselect
      if (e.key === 'Escape') {
        setSelectedElementId(null);
        setEditingTextElementId(null);
        return;
      }

      // Nudge with arrow keys
      if (selectedElementId && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;

        const updated = currentSlide.elements.map((el) => {
          if (el.id === selectedElementId && el.editable) {
            return {
              ...el,
              geometry: {
                ...el.geometry,
                x: Math.max(0, Math.min(1920 - el.geometry.width, el.geometry.x + dx)),
                y: Math.max(0, Math.min(1080 - el.geometry.height, el.geometry.y + dy)),
              },
            };
          }
          return el;
        });
        updateCurrentSlide({ ...currentSlide, elements: updated }, undefined, true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedElementId, editingTextElementId, currentSlide, handleUndo, handleRedo, handleDeleteSelectedElement]);

  // AI Modification handler
  // ---------------------------------------------------------------------------
  // 补丁在**服务端**施加：App 把 IRPatch 请求发给后端，后端用 patchApplier
  // 改 IR、校验、写库、生成新版本，然后把施加后的 IR 送回来。
  // 这里不再自己"改元素数组" —— 否则前端和后端会有两套补丁语义。
  const handleRunAiEdit = async (customPrompt?: string) => {
    const instruction = customPrompt || aiInstruction;
    if (!instruction.trim() || isAiProcessing) return;
    if (!currentSlide) return;

    setIsAiProcessing(true);
    setAiMessage(null);
    setAiDegraded(false);

    try {
      const result = await onAiEdit(currentSlide.slideId, instruction, aiMode);

      // 服务端返回的 IR 会通过 project prop 回来 —— 这里只负责反馈
      const suffix = result.degraded ? '（模型不可用，已本地降级）' : '';
      setAiMessage(`${result.message || '修改已成功应用！'}${suffix}`);
      setAiDegraded(result.degraded);
      setAiInstruction('');
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : '网络繁忙或服务不可用';
      setAiMessage(`AI 编辑失败: ${message}`);
      setAiDegraded(false);
    } finally {
      setIsAiProcessing(false);
    }
  };

  // Rollback to historical snapshot
  const handleRollbackVersion = (version: SlideVersion) => {
    updateCurrentSlide(version.snapshot, `回退到历史版本: ${version.description}`);
  };

  // Switch Theme Template (Deep remapping of all elements for light/dark)
  const handleApplyTheme = (t: TemplateIR) => {
    pushUndoSnapshot();
    // 主题重映射只有一份实现（packages/core/src/engine/themeRemap.ts）——
    // 语义判断读 `variant` 字段，不猜 ID 字符串（ADR-018）。
    const updatedSlides = remapSlidesToTheme(project.slides, t.theme);

    onUpdateProject({
      ...project,
      template: t,
      slides: updatedSlides,
      updatedAt: Date.now(),
    });
  };

  const handleQuickToggleSlideTheme = () => {
    const isCurrentlyDark = project.template.theme.isDark;
    const targetTheme = isCurrentlyDark
      ? BUILT_IN_TEMPLATES.find((t) => !t.theme.isDark) || BUILT_IN_TEMPLATES[0]
      : BUILT_IN_TEMPLATES.find((t) => t.theme.isDark) || BUILT_IN_TEMPLATES[4];
    handleApplyTheme(targetTheme);
  };

  // Element Selection & Drag Logic
  const handleElementMouseDown = (e: React.MouseEvent, el: SlideElement) => {
    e.stopPropagation();
    setSelectedElementId(el.id);
    if (isRightInspectorCollapsed) {
      setIsRightInspectorCollapsed(false);
    }
    setActiveTab('props');

    if (!el.editable) return;

    setIsDragging(true);
    dragStartPos.current = {
      x: e.clientX,
      y: e.clientY,
      elX: el.geometry.x,
      elY: el.geometry.y,
    };
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !dragStartPos.current || !selectedElementId) return;

    const dx = (e.clientX - dragStartPos.current.x) / zoomLevel;
    const dy = (e.clientY - dragStartPos.current.y) / zoomLevel;

    const newX = Math.round(dragStartPos.current.elX + dx);
    const newY = Math.round(dragStartPos.current.elY + dy);

    const updatedElements = currentSlide.elements.map((el) => {
      if (el.id === selectedElementId) {
        return {
          ...el,
          geometry: {
            ...el.geometry,
            x: Math.max(0, Math.min(1920 - el.geometry.width, newX)),
            y: Math.max(0, Math.min(1080 - el.geometry.height, newY)),
          },
        };
      }
      return el;
    });

    updateCurrentSlide({ ...currentSlide, elements: updatedElements }, undefined, true);
  };

  const handleCanvasMouseUp = () => {
    if (isDragging) {
      setIsDragging(false);
      dragStartPos.current = null;
    }
  };

  // Inline text editing & card inspection
  const handleElementDoubleClick = (el: SlideElement) => {
    if (!el.editable) return;
    if (typeof el.content === 'string') {
      setEditingTextElementId(el.id);
      setInlineTextValue(el.content);
    } else {
      if (isRightInspectorCollapsed) {
        setIsRightInspectorCollapsed(false);
      }
      setActiveTab('props');
    }
  };

  const handleSaveInlineText = () => {
    if (!editingTextElementId) return;
    const updatedElements = currentSlide.elements.map((el) => {
      if (el.id === editingTextElementId) {
        return { ...el, content: inlineTextValue };
      }
      return el;
    });
    updateCurrentSlide({ ...currentSlide, elements: updatedElements }, '手动文本修改');
    setEditingTextElementId(null);
  };

  // 1-Click Auto Fix in Quality tab
  const handleAutoFix = () => {
    const fixed = QualityEngine.autoFixProject(project);
    onUpdateProject(fixed);
  };

  const currentVersions = currentSlide ? project.versions[currentSlide.slideId] || [] : [];
  const lightTemplates = BUILT_IN_TEMPLATES.filter((t) => !t.theme.isDark);
  const darkTemplates = BUILT_IN_TEMPLATES.filter((t) => t.theme.isDark);

  // 一页都没有 —— 不能往下渲染。
  //
  // `currentSlide` 来自 `project.slides[activeSlideIndex] || project.slides[0]`，
  // 列表为空时它是 undefined；而下面（画布、元素覆盖层、版本历史）
  // 到处都在解引用它 —— 一个 undefined 就能把整个应用打崩（React 没有错误边界）。
  //
  // 「列表为空」不是理论状态：项目**摘要**接口返回的 slides 就是空的，
  // 摘要覆盖掉已加载的全量时会短暂出现这个状态。
  if (!currentSlide) {
    return (
      <div
        data-testid="workbench-empty"
        className="flex-1 flex h-full items-center justify-center bg-slate-100 dark:bg-slate-950 text-slate-500 dark:text-slate-400 text-sm"
      >
        还没有可编辑的页面 —— 请先在「大纲」里生成并编译。
      </div>
    );
  }

  return (
    <div className="flex-1 flex h-full overflow-hidden bg-slate-100 dark:bg-slate-950 select-none transition-colors duration-150">
      {/* ========================================================
          LEFT COLUMN: Collapsible Slide Thumbnails List & Page Rail
          ======================================================== */}
      <aside
        className={`bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col shrink-0 transition-all duration-200 z-30 ${
          isLeftRailCollapsed ? 'w-12' : 'w-52'
        }`}
      >
        {/* Rail Header with Toggle Button */}
        <div className="h-10 px-2 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
          {!isLeftRailCollapsed && (
            <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5 truncate">
              <Layers className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
              <span className="truncate">页面 ({project.slides.length})</span>
            </span>
          )}

          <div className="flex items-center gap-1 ml-auto">
            {!isLeftRailCollapsed && (
              <button
                onClick={() => setIsLayoutModalOpen(true)}
                data-testid="wb-rail-add-slide"
                className="p-1 px-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold flex items-center gap-0.5 transition-colors shadow-xs"
                title="选择版式添加新页面"
              >
                <Plus className="w-3 h-3" />
                <span>加页</span>
              </button>
            )}

            <button
              onClick={() => setIsLeftRailCollapsed(!isLeftRailCollapsed)}
              data-testid="wb-rail-collapse"
              className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title={isLeftRailCollapsed ? '展开页面缩略图' : '收起页面缩略图'}
            >
              {isLeftRailCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Slide Rail List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {project.slides.map((s, index) => {
            const isActive = activeSlideIndex === index;
            const svgPreview = SVGRenderer.renderToString(s, project.template.theme);

            if (isLeftRailCollapsed) {
              return (
                <button
                  key={s.slideId}
                  onClick={() => {
                    setActiveSlideIndex(index);
                    setSelectedElementId(null);
                  }}
                  data-testid={`wb-rail-page-${index}`}
                  className={`w-full py-2 flex flex-col items-center justify-center rounded-lg text-xs font-mono font-bold transition-all ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                  title={`第 ${index + 1} 页: ${s.title}`}
                >
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <div
                    className={`w-1.5 h-1.5 rounded-full mt-1 ${
                      isActive ? 'bg-white' : 'bg-slate-300 dark:bg-slate-700'
                    }`}
                  />
                </button>
              );
            }

            return (
              <div
                key={s.slideId}
                onClick={() => {
                  setActiveSlideIndex(index);
                  setSelectedElementId(null);
                }}
                data-testid="slide-thumb"
                data-slide-id={s.slideId}
                className={`relative group rounded-lg border transition-all cursor-pointer p-1.5 ${
                  isActive
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10 shadow-md ring-1 ring-blue-500/30'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-950/60 shadow-xs'
                }`}
              >
                {/* Header label */}
                <div className="flex items-center justify-between mb-1 px-1">
                  <span className="text-[10px] font-mono font-bold text-slate-600 dark:text-slate-400">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="text-[10px] text-slate-500 truncate max-w-[100px]">
                    {s.title}
                  </span>
                </div>

                {/* Miniature 16:9 Canvas preview (Scrollbar-Free Vector) */}
                <div
                  className="w-full aspect-[16/9] rounded overflow-hidden relative border border-slate-200 dark:border-slate-800/80 pointer-events-none select-none flex items-center justify-center bg-white dark:bg-slate-900 shadow-2xs"
                  style={{ backgroundColor: project.template.theme.backgroundColor }}
                  dangerouslySetInnerHTML={{
                    __html: SVGRenderer.renderInlineSvg(s, project.template.theme),
                  }}
                />

                {/* Hover action bar with Reorder Up/Down, Duplicate, Delete */}
                <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 bg-white/95 dark:bg-slate-900/95 backdrop-blur rounded p-0.5 border border-slate-200 dark:border-slate-700 shadow-md z-30">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMoveSlideUp(index);
                    }}
                    data-testid={`wb-slide-move-up-${index}`}
                    disabled={index === 0}
                    className="p-1 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white disabled:opacity-20"
                    title="上移页面"
                  >
                    <ArrowUp className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMoveSlideDown(index);
                    }}
                    data-testid={`wb-slide-move-down-${index}`}
                    disabled={index === project.slides.length - 1}
                    className="p-1 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white disabled:opacity-20"
                    title="下移页面"
                  >
                    <ArrowDown className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDuplicateSlide(index);
                    }}
                    data-testid={`wb-slide-duplicate-${index}`}
                    className="p-1 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                    title="复制页面"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteSlide(index);
                    }}
                    data-testid={`wb-slide-delete-${index}`}
                    disabled={project.slides.length <= 1}
                    className="p-1 text-slate-500 hover:text-rose-500 dark:text-slate-400 dark:hover:text-rose-400 disabled:opacity-20"
                    title="删除页面"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Collapsed Add Button at Bottom */}
        {isLeftRailCollapsed && (
          <div className="p-2 border-t border-slate-200 dark:border-slate-800 flex justify-center">
            <button
              onClick={() => setIsLayoutModalOpen(true)}
              data-testid="wb-rail-add-slide-collapsed"
              className="p-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white"
              title="添加新页面"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </aside>

      {/* ========================================================
          CENTER VIEWPORT: Interactive Canvas & Responsive Toolbar
          ======================================================== */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-slate-200/90 dark:bg-slate-950 relative">
        {/* Top Workbench Toolbar (Strictly single-line, zero clipping, fully responsive) */}
        <div className="h-10 bg-white dark:bg-slate-900/95 border-b border-slate-200 dark:border-slate-800 px-3 flex items-center justify-between gap-2 z-20 transition-colors shrink-0 overflow-hidden">
          {/* Left Zone: Slide Indicator & Undo / Redo */}
          <div className="flex items-center gap-1.5 min-w-0 shrink">
            <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate max-w-[130px] sm:max-w-[200px] md:max-w-xs">
              P{activeSlideIndex + 1} · {currentSlide.title}
            </span>

            <div className="flex items-center border-l border-slate-200 dark:border-slate-800 pl-1.5 ml-1 shrink-0">
              <button
                onClick={handleUndo}
                data-testid="wb-undo"
                disabled={undoStack.length === 0}
                className="p-1 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-25 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title="撤销 (Ctrl+Z)"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleRedo}
                data-testid="wb-redo"
                disabled={redoStack.length === 0}
                className="p-1 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-25 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title="重做 (Ctrl+Y)"
              >
                <Redo2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Center Zone: Quick Element Insertion Menu */}
          <div className="relative shrink-0" ref={insertMenuRef}>
            <button
              onClick={() => setIsInsertMenuOpen(!isInsertMenuOpen)}
              data-testid="wb-insert-menu"
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors"
              title="在幻灯片中插入新元素"
            >
              <Plus className="w-3.5 h-3.5 text-blue-500" />
              <span>插入元素</span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {/* Dropdown Menu for Elements */}
            {isInsertMenuOpen && (
              <div className="absolute left-1/2 transform -translate-x-1/2 top-full mt-1.5 w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl p-1.5 z-50 space-y-0.5">
                <button
                  onClick={handleAddTextElement}
                  data-testid="wb-insert-text"
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-left"
                >
                  <Type className="w-3.5 h-3.5 text-blue-500" />
                  <div>
                    <div className="font-semibold">文本块</div>
                    <div className="text-[10px] text-slate-400">标题或说明注释</div>
                  </div>
                </button>
                <button
                  onClick={handleAddCardElement}
                  data-testid="wb-insert-card"
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-left"
                >
                  <LayoutGrid className="w-3.5 h-3.5 text-indigo-500" />
                  <div>
                    <div className="font-semibold">内容卡片</div>
                    <div className="text-[10px] text-slate-400">带标签的方案卡片</div>
                  </div>
                </button>
                <button
                  onClick={handleAddMetricElement}
                  data-testid="wb-insert-metric"
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-left"
                >
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                  <div>
                    <div className="font-semibold">KPI 核心指标</div>
                    <div className="text-[10px] text-slate-400">关键数据指标看板</div>
                  </div>
                </button>
                <button
                  onClick={handleAddBadgeElement}
                  data-testid="wb-insert-badge"
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-left"
                >
                  <Tag className="w-3.5 h-3.5 text-amber-500" />
                  <div>
                    <div className="font-semibold">胶囊徽标</div>
                    <div className="text-[10px] text-slate-400">突出亮点与状态</div>
                  </div>
                </button>
                <button
                  onClick={handleAddDividerElement}
                  data-testid="wb-insert-divider"
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-left"
                >
                  <Minus className="w-3.5 h-3.5 text-purple-500" />
                  <div>
                    <div className="font-semibold">装饰分割线</div>
                    <div className="text-[10px] text-slate-400">视觉区分与分界</div>
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* Right Zone: Canvas Tools (Theme, Grid, Zoom, Inspector Toggle) */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Quick PPT Theme Switcher */}
            <button
              onClick={handleQuickToggleSlideTheme}
              data-testid="wb-toggle-slide-theme"
              className="p-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              title={project.template.theme.isDark ? '切换为浅色PPT底色' : '切换为深色PPT底色'}
            >
              {project.template.theme.isDark ? (
                <Sun className="w-3.5 h-3.5 text-amber-500" />
              ) : (
                <Moon className="w-3.5 h-3.5 text-indigo-400" />
              )}
            </button>

            {/* Grid Toggle */}
            <button
              onClick={() => setShowGrid(!showGrid)}
              data-testid="wb-toggle-grid"
              className={`p-1.5 text-xs rounded border transition-colors ${
                showGrid
                  ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/40'
                  : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:text-slate-900 dark:hover:text-white'
              }`}
              title="切换对齐辅助网格"
            >
              <Grid className="w-3.5 h-3.5" />
            </button>

            {/* Fit Zoom Button */}
            <button
              onClick={fitZoomToContainer}
              data-testid="wb-zoom-fit"
              className="hidden sm:flex items-center gap-1 px-1.5 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded transition-colors"
              title="自适应铺满设计区域"
            >
              <Maximize className="w-3 h-3" />
              <span>适应</span>
            </button>

            {/* Zoom Stepper */}
            <div className="flex items-center bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded p-0.5 text-xs text-slate-700 dark:text-slate-300">
              <button
                onClick={() => setZoomLevel((z) => Math.max(0.2, z - 0.08))}
                data-testid="wb-zoom-out"
                className="p-1 hover:text-slate-900 dark:hover:text-white"
                title="缩小"
              >
                <ZoomOut className="w-3 h-3" />
              </button>
              <span className="font-mono px-1 w-9 text-center text-[10px]">
                {Math.round(zoomLevel * 100)}%
              </span>
              <button
                onClick={() => setZoomLevel((z) => Math.min(1.5, z + 0.08))}
                data-testid="wb-zoom-in"
                className="p-1 hover:text-slate-900 dark:hover:text-white"
                title="放大"
              >
                <ZoomIn className="w-3 h-3" />
              </button>
            </div>

            {/* Right Inspector Collapse Toggle */}
            <button
              onClick={() => setIsRightInspectorCollapsed(!isRightInspectorCollapsed)}
              data-testid="wb-inspector-collapse"
              className={`p-1.5 rounded border transition-colors ${
                isRightInspectorCollapsed
                  ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30'
                  : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:text-slate-900 dark:hover:text-white'
              }`}
              title={isRightInspectorCollapsed ? '展开属性检查器' : '收起属性检查器以最大化画布'}
            >
              {isRightInspectorCollapsed ? (
                <PanelRightOpen className="w-3.5 h-3.5" />
              ) : (
                <PanelRightClose className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>

        {/* Center Canvas Viewport */}
        <div
          ref={canvasContainerRef}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onClick={() => {
            setSelectedElementId(null);
            setEditingTextElementId(null);
          }}
          className="flex-1 overflow-auto flex items-[safe_center] justify-[safe_center] p-6 relative"
          style={{
            backgroundImage: showGrid
              ? 'radial-gradient(circle, rgba(148, 163, 184, 0.25) 1px, transparent 1px)'
              : 'none',
            backgroundSize: '24px 24px',
          }}
        >
          {/*
            画布分两层：外层只负责**占位**，尺寸 = 缩放后的实际视觉尺寸；
            内层才是真正的 1920×1080 画布，靠 transform 缩放。

            为什么必须分两层 —— 这是实测出来的坑（2026-11-04）：
            原来只有一层，它是 flex 项，`width: 1920` 会被 flex-shrink 压扁
            （实测 528px 宽的视口里被压成 480px，而高度仍是 1080px）。
            于是 1920×1080 的 SVG 被塞进 480×1080 的竖条里，
            preserveAspectRatio="xMidYMid meet" 只能把幻灯片缩成中间一条，
            上下留大片空白 —— 画布看起来是竖着的，幻灯片只剩四分之一高。
            外层给 flex 一个 shrink-0 的占位盒，尺寸正好等于缩放后的视觉尺寸，
            滚动区也不会因为 transform 不改变布局尺寸而出现幽灵滚动条。

            为什么对齐要写 `safe center` 而不是 `center`（2026-11-05 实测）：
            放大到超过适配档位后，画布比可视内容区宽。
            `center` 会把**溢出量平均分到两侧**，而滚动容器只能往右滚 ——
            左边那一半落在负坐标上，滚多少都看不到。
            实测 73% 缩放下左侧 460px 被裁掉且不可达（scrollLeft 已经是 0 了）。
            `safe center` 的语义是「放不下就退回起点对齐」：
            放得下就居中，放不下就贴左/贴上，溢出全部甩到可滚动的那一侧。
            （Chromium 之外的浏览器若不认识 `safe`，整条声明会被丢弃 →
            退回 `flex-start`，同样安全，只是不再居中。）
          */}
          <div
            className="relative shrink-0 transition-all duration-100"
            style={{ width: 1920 * zoomLevel, height: 1080 * zoomLevel }}
          >
            <div
              className="absolute left-0 top-0 shadow-2xl transition-transform duration-100 origin-top-left border border-slate-300 dark:border-slate-800 rounded-sm overflow-hidden select-none"
              style={{
                width: 1920,
                height: 1080,
                transform: `scale(${zoomLevel})`,
                transformOrigin: 'top left',
                backgroundColor: project.template.theme.backgroundColor,
              }}
            >
              {/* Layer 1: Pixel-Perfect Slide Vector SVG (100% Identical to Left Thumbnail & Presentation Mode) */}
              <div
                data-testid="slide-canvas"
                data-slide-id={currentSlide.slideId}
                data-slide-title={currentSlide.title}
                className="absolute inset-0 w-full h-full pointer-events-none select-none [&>svg]:w-full [&>svg]:h-full [&>svg]:block"
                dangerouslySetInnerHTML={{
                  __html: SVGRenderer.renderInlineSvg(currentSlide, project.template.theme),
                }}
              />

              {/* Layer 2: Interactive Element Overlays for Selection, Dragging & Direct Inline Editing */}
              {currentSlide.elements
                .filter((el) => el.role !== 'background')
                .map((el) => {
                  const isSelected = selectedElementId === el.id;
                  const isInlineEditing = editingTextElementId === el.id;
                  const { x, y, width, height } = el.geometry;
                  const style = el.style || {};

                  return (
                    <div
                      key={el.id}
                      onMouseDown={(e) => handleElementMouseDown(e, el)}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        handleElementDoubleClick(el);
                      }}
                      data-testid="slide-element"
                      data-element-id={el.id}
                      data-role={el.role}
                      data-editable={el.editable ? 'true' : 'false'}
                      className={`absolute rounded-sm transition-all ${
                        el.editable ? 'cursor-move' : 'cursor-pointer'
                      } ${
                        isSelected
                          ? 'ring-2 ring-blue-500 bg-blue-500/10 shadow-lg z-40'
                          : 'hover:ring-1 hover:ring-blue-400/60 hover:bg-blue-400/5 z-20'
                      }`}
                      style={{
                        left: x,
                        top: y,
                        width,
                        height,
                      }}
                      title={el.editable ? `点击选中/拖拽移动 (${el.role})，双击直接编辑文本` : `${el.role}`}
                    >
                      {/* Transform handles if selected */}
                      {isSelected && (
                        <>
                          <div className="absolute -top-1.5 -left-1.5 w-3.5 h-3.5 bg-blue-500 border-2 border-white rounded-full z-50 pointer-events-none shadow-xs" />
                          <div className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-blue-500 border-2 border-white rounded-full z-50 pointer-events-none shadow-xs" />
                          <div className="absolute -bottom-1.5 -left-1.5 w-3.5 h-3.5 bg-blue-500 border-2 border-white rounded-full z-50 pointer-events-none shadow-xs" />
                          <div className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-blue-500 border-2 border-white rounded-full z-50 pointer-events-none shadow-xs" />
                          <div className="absolute -top-6 left-0 px-2 py-0.5 bg-blue-600 text-white text-[10px] font-mono font-bold rounded pointer-events-none whitespace-nowrap shadow-sm flex items-center gap-1.5">
                            <span>{el.role.toUpperCase()}</span>
                            <span className="opacity-60">|</span>
                            <span>{Math.round(x)},{Math.round(y)}</span>
                            <span className="opacity-60">|</span>
                            <span>{Math.round(width)}×{Math.round(height)}</span>
                          </div>
                        </>
                      )}

                      {/* Inline text edit overlay */}
                      {isInlineEditing && (
                        <textarea
                          value={inlineTextValue}
                          onChange={(e) => setInlineTextValue(e.target.value)}
                          onBlur={handleSaveInlineText}
                          data-testid="inline-text-editor"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleSaveInlineText();
                            }
                          }}
                          autoFocus
                          className="w-full h-full p-2.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-white border-2 border-blue-500 rounded-lg shadow-2xl focus:outline-none resize-none font-sans font-semibold leading-relaxed z-50"
                          style={{
                            fontSize: style.fontSize || 16,
                            lineHeight: 1.4,
                          }}
                        />
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        </div>

        {/* Collapsible Speaker Notes Drawer */}
        {showSpeakerNotesDrawer && (
          <div className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 p-3 z-20 shadow-lg animate-in slide-in-from-bottom-2 duration-150">
            <div className="flex items-center justify-between pb-1.5 mb-2 border-b border-slate-100 dark:border-slate-800">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-blue-500" />
                <span>演讲备忘录与核心观点 (Speaker Notes)</span>
              </span>
              <button
                onClick={() => setShowSpeakerNotesDrawer(false)}
                data-testid="wb-notes-close"
                className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white"
              >
                收起
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-semibold text-slate-500 block mb-1">
                  核心传递观点 (Key Message)
                </label>
                <input
                  type="text"
                  value={currentSlide.keyMessage || ''}
                  onChange={(e) => {
                    updateCurrentSlide({ ...currentSlide, keyMessage: e.target.value });
                  }}
                  data-testid="wb-notes-key-message"
                  placeholder="一句话核心结论..."
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-2.5 py-1 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-500 block mb-1">
                  演讲口述要点 (Speaker Cues)
                </label>
                <textarea
                  rows={2}
                  value={currentSlide.speakerNotes || ''}
                  onChange={(e) => {
                    updateCurrentSlide({ ...currentSlide, speakerNotes: e.target.value });
                  }}
                  data-testid="wb-notes-speaker-notes"
                  placeholder="台词提醒、转场引导语与数据补充..."
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-2.5 py-1 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>
            </div>
          </div>
        )}

        {/* Bottom Status Bar (Strict single line, streamlined, zero clipping) */}
        <div className="h-6 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-3 flex items-center justify-between text-[10px] text-slate-500 font-mono z-20 shrink-0 overflow-hidden select-none">
          {/* Left info & notes toggle */}
          <div className="flex items-center gap-2 truncate">
            <span>16:9 · 1920×1080</span>
            <span>·</span>
            <span className="truncate">{project.template.theme.isDark ? '深色底' : '浅色底'}</span>
            <span>·</span>
            <button
              onClick={() => setShowSpeakerNotesDrawer(!showSpeakerNotesDrawer)}
              data-testid="wb-notes-toggle"
              className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5 font-sans"
            >
              <FileText className="w-2.5 h-2.5" />
              <span>{showSpeakerNotesDrawer ? '收起备忘录' : '演讲备忘录'}</span>
            </button>
          </div>

          {/* Center hint (hidden on smaller widths) */}
          <div className="hidden lg:inline text-slate-400 truncate">
            双击修改文本 · 拖拽自由移动 · 选中按[Del]删除
          </div>

          {/* Right status */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-slate-500">已自动保存</span>
            <span>·</span>
            <button
              onClick={onStartPresent}
              data-testid="wb-start-present"
              className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors flex items-center gap-0.5 font-sans"
              title="放映演示 (F5)"
            >
              <Play className="w-2.5 h-2.5 fill-current" />
              <span>放映</span>
            </button>
          </div>
        </div>
      </main>

      {/* ========================================================
          RIGHT COLUMN: Collapsible Inspector & AI Copilot
          ======================================================== */}
      <aside
        className={`bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col shrink-0 transition-all duration-200 z-30 ${
          isRightInspectorCollapsed ? 'w-11' : 'w-72'
        }`}
      >
        {/* Collapsed Vertical Icons Rail */}
        {isRightInspectorCollapsed ? (
          <div className="py-2 flex flex-col items-center gap-2 text-slate-500">
            <button
              onClick={() => setIsRightInspectorCollapsed(false)}
              data-testid="wb-inspector-expand-collapsed"
              className="p-1.5 text-slate-400 hover:text-slate-800 dark:hover:text-white rounded hover:bg-slate-100 dark:hover:bg-slate-800"
              title="展开属性检查器"
            >
              <PanelRightOpen className="w-4 h-4" />
            </button>
            <div className="w-6 h-px bg-slate-200 dark:border-slate-800 my-1" />
            <button
              onClick={() => {
                setIsRightInspectorCollapsed(false);
                setActiveTab('ai');
              }}
              className={`p-2 rounded-lg transition-colors ${
                activeTab === 'ai' ? 'text-blue-600 bg-blue-50 dark:bg-blue-500/10' : 'hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
              data-testid="wb-tab-ai-collapsed"
              title="AI 智能编辑"
            >
              <Sparkles className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                setIsRightInspectorCollapsed(false);
                setActiveTab('props');
              }}
              className={`p-2 rounded-lg transition-colors ${
                activeTab === 'props' ? 'text-blue-600 bg-blue-50 dark:bg-blue-500/10' : 'hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
              data-testid="wb-tab-props-collapsed"
              title="元素坐标与属性"
            >
              <Sliders className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                setIsRightInspectorCollapsed(false);
                setActiveTab('theme');
              }}
              className={`p-2 rounded-lg transition-colors ${
                activeTab === 'theme' ? 'text-blue-600 bg-blue-50 dark:bg-blue-500/10' : 'hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
              data-testid="wb-tab-theme-collapsed"
              title="模板主题"
            >
              <Palette className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                setIsRightInspectorCollapsed(false);
                setActiveTab('quality');
              }}
              className={`p-2 rounded-lg transition-colors ${
                activeTab === 'quality' ? 'text-blue-600 bg-blue-50 dark:bg-blue-500/10' : 'hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
              data-testid="wb-tab-quality-collapsed"
              title="质量评测"
            >
              <ShieldCheck className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <>
            {/* Inspector Tab Bar */}
            <div className="h-10 border-b border-slate-200 dark:border-slate-800 grid grid-cols-4 text-xs font-semibold text-slate-500 dark:text-slate-400">
              <button
                onClick={() => setActiveTab('ai')}
                className={`flex items-center justify-center gap-1 border-b-2 transition-colors ${
                  activeTab === 'ai' ? 'text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-500 bg-slate-50 dark:bg-slate-800/40' : 'border-transparent hover:text-slate-900 dark:hover:text-white'
                }`}
                data-testid="wb-tab-ai"
                title="AI 智能编辑与版本"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>AI</span>
              </button>

              <button
                onClick={() => setActiveTab('props')}
                className={`flex items-center justify-center gap-1 border-b-2 transition-colors ${
                  activeTab === 'props' ? 'text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-500 bg-slate-50 dark:bg-slate-800/40' : 'border-transparent hover:text-slate-900 dark:hover:text-white'
                }`}
                data-testid="wb-tab-props"
                title="元素坐标与样式"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>属性</span>
              </button>

              <button
                onClick={() => setActiveTab('theme')}
                className={`flex items-center justify-center gap-1 border-b-2 transition-colors ${
                  activeTab === 'theme' ? 'text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-500 bg-slate-50 dark:bg-slate-800/40' : 'border-transparent hover:text-slate-900 dark:hover:text-white'
                }`}
                data-testid="wb-tab-theme"
                title="模板风格与母版"
              >
                <Palette className="w-3.5 h-3.5" />
                <span>主题</span>
              </button>

              <button
                onClick={() => setActiveTab('quality')}
                className={`flex items-center justify-center gap-1 border-b-2 transition-colors ${
                  activeTab === 'quality' ? 'text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-500 bg-slate-50 dark:bg-slate-800/40' : 'border-transparent hover:text-slate-900 dark:hover:text-white'
                }`}
                data-testid="wb-tab-quality"
                title="质量体检与合规评分"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>质检</span>
              </button>
            </div>

            {/* Tab Content Panes */}
            <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
              {/* TAB 1: AI Copilot */}
              {activeTab === 'ai' && (
                <div className="space-y-3.5">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                        <span>AI 意图定向编辑</span>
                      </span>
                      {selectedElement ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 font-mono">
                          #{selectedElement.id.slice(-5)}
                        </span>
                      ) : (
                        <button
                          onClick={() => setSelectedElementId(null)}
                          data-testid="wb-ai-whole-page"
                          className="text-[10px] text-slate-500 hover:text-blue-500"
                        >
                          修改整页
                        </button>
                      )}
                    </div>
                    <textarea
                      rows={3}
                      value={aiInstruction}
                      onChange={(e) => setAiInstruction(e.target.value)}
                      data-testid="ai-instruction"
                      placeholder={
                        selectedElement
                          ? '对选中元素的修改，如：加粗标题并改为橙色，精简成要点...'
                          : '对整页的修改，如：文字精简30%、强化管理层汇报表达...'
                      }
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none leading-relaxed"
                    />
                  </div>

                  {/* 编辑意图 —— 直接对应后端 IRPatch 的 mode */}
                  <div className="flex rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5" data-testid="ai-mode">
                    {(
                      [
                        { value: 'content', label: '内容' },
                        { value: 'style', label: '样式' },
                        { value: 'layout', label: '布局' },
                      ] as const
                    ).map((m) => (
                      <button
                        key={m.value}
                        type="button"
                        data-testid={`ai-mode-${m.value}`}
                        onClick={() => setAiMode(m.value)}
                        className={`flex-1 py-1 rounded-md text-[11px] font-bold transition-all ${
                          aiMode === m.value
                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={() => handleRunAiEdit()}
                    disabled={isAiProcessing || !aiInstruction.trim()}
                    data-testid="ai-run"
                    className="w-full py-1.5 px-3 bg-blue-600 hover:bg-blue-500 active:scale-98 text-white rounded-lg font-bold text-xs shadow-sm flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {isAiProcessing ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>AI 计算中...</span>
                      </>
                    ) : (
                      <>
                        <Wand2 className="w-3.5 h-3.5" />
                        <span>执行智能修改</span>
                      </>
                    )}
                  </button>

                  {aiMessage && (
                    <div
                      data-testid="ai-message"
                      data-degraded={String(aiDegraded)}
                      className="p-2 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 rounded-lg text-xs text-blue-700 dark:text-blue-300"
                    >
                      {aiMessage}
                    </div>
                  )}

                  {/* Quick Prompt Presets */}
                  <div className="space-y-1 pt-2 border-t border-slate-200 dark:border-slate-800">
                    <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                      快捷智能指令
                    </span>
                    <div className="grid grid-cols-1 gap-1 text-xs">
                      <button
                        onClick={() => handleRunAiEdit('将页面核心要点精简 30%，保留核心关键词与数据')}
                        data-testid="wb-ai-preset-shorten"
                        className="text-left px-2 py-1.5 rounded bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors text-[11px]"
                      >
                        ⚡ 精简文字 30% (增加留白)
                      </button>
                      <button
                        onClick={() => handleRunAiEdit('增加更适合管理层汇报的论据和商业成效表达')}
                        data-testid="wb-ai-preset-executive"
                        className="text-left px-2 py-1.5 rounded bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors text-[11px]"
                      >
                        👔 强化管理层汇报语气
                      </button>
                    </div>
                  </div>

                  {/* Version History & Rollback */}
                  <div className="space-y-1.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                    <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1">
                      <History className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                      <span>版本快照 ({currentVersions.length})</span>
                    </span>

                    {currentVersions.length === 0 ? (
                      <div className="text-[10px] text-slate-500 p-2 bg-slate-50 dark:bg-slate-950/50 rounded border border-slate-200 dark:border-slate-800/60">
                        每次重要编辑自动保留快照，支持随时回退。
                      </div>
                    ) : (
                      <div className="space-y-1 max-h-36 overflow-y-auto">
                        {currentVersions.map((v) => (
                          <div
                            key={v.versionId}
                            data-testid="version-item"
                            data-version-id={v.versionId}
                            className="flex items-center justify-between p-1.5 rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
                          >
                            <div>
                              <div className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[120px] text-[11px]">
                                {v.description}
                              </div>
                              <div className="text-[9px] text-slate-500 font-mono">
                                {new Date(v.timestamp).toLocaleTimeString()}
                              </div>
                            </div>
                            <button
                              onClick={() => handleRollbackVersion(v)}
                              data-testid="version-rollback"
                              className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-blue-600 dark:text-blue-400 text-[10px] flex items-center gap-0.5"
                            >
                              <RotateCcw className="w-2.5 h-2.5" />
                              <span>回退</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 2: Element Properties, Layer Ordering, and Alignment */}
              {activeTab === 'props' && (
                <div className="space-y-3.5">
                  {selectedElement ? (
                    <>
                      <div className="p-2 bg-slate-50 dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800 text-xs space-y-0.5">
                        <div className="font-mono text-slate-500 text-[9px]">ID: {selectedElement.id}</div>
                        <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center justify-between">
                          <span>{selectedElement.type}</span>
                          <span className="text-blue-600 dark:text-blue-400 font-mono text-[10px]">{selectedElement.role}</span>
                        </div>
                      </div>

                      {/* Layer and Alignment Quick Action Toolbar */}
                      <div className="space-y-1">
                        <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                          图层层级与对齐
                        </span>
                        <div className="grid grid-cols-4 gap-1 text-xs">
                          <button
                            onClick={handleBringToFront}
                            data-testid="wb-el-bring-front"
                            className="p-1 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded flex flex-col items-center gap-0.5 text-slate-700 dark:text-slate-300"
                            title="置顶图层"
                          >
                            <ArrowUpToLine className="w-3 h-3 text-blue-500" />
                            <span className="text-[9px]">置顶</span>
                          </button>
                          <button
                            onClick={handleSendToBack}
                            data-testid="wb-el-send-back"
                            className="p-1 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded flex flex-col items-center gap-0.5 text-slate-700 dark:text-slate-300"
                            title="置底图层"
                          >
                            <ArrowDownToLine className="w-3 h-3 text-blue-500" />
                            <span className="text-[9px]">置底</span>
                          </button>
                          <button
                            onClick={handleAlignCenterHorizontally}
                            data-testid="wb-el-align-h-center"
                            className="p-1 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded flex flex-col items-center gap-0.5 text-slate-700 dark:text-slate-300"
                            title="水平居中"
                          >
                            <AlignHorizontalJustifyCenter className="w-3 h-3 text-emerald-500" />
                            <span className="text-[9px]">水平居中</span>
                          </button>
                          <button
                            onClick={handleAlignCenterVertically}
                            data-testid="wb-el-align-v-center"
                            className="p-1 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded flex flex-col items-center gap-0.5 text-slate-700 dark:text-slate-300"
                            title="垂直居中"
                          >
                            <AlignVerticalJustifyCenter className="w-3 h-3 text-emerald-500" />
                            <span className="text-[9px]">垂直居中</span>
                          </button>
                        </div>

                        <div className="flex gap-1.5 pt-1">
                          <button
                            onClick={handleDuplicateSelectedElement}
                            data-testid="wb-el-duplicate"
                            className="flex-1 py-1 px-1.5 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-[11px] font-medium text-slate-700 dark:text-slate-300 flex items-center justify-center gap-1"
                          >
                            <Copy className="w-3 h-3" />
                            <span>复制元素</span>
                          </button>
                          <button
                            onClick={handleDeleteSelectedElement}
                            data-testid="wb-el-delete"
                            className="py-1 px-2.5 rounded bg-rose-50 hover:bg-rose-100 dark:bg-rose-500/10 dark:hover:bg-rose-500/20 text-[11px] font-medium text-rose-600 dark:text-rose-400 flex items-center justify-center gap-1"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>删除</span>
                          </button>
                        </div>
                      </div>

                      {/* Geometry X, Y, W, H */}
                      <div className="space-y-1.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                        <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                          坐标与尺寸 (Geometry)
                        </span>
                        <div className="grid grid-cols-2 gap-1.5 text-xs">
                          <div>
                            <label className="text-slate-500 text-[9px] block">X 坐标 (px)</label>
                            <input
                              type="number"
                              value={selectedElement.geometry.x}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                const updated = currentSlide.elements.map((el) =>
                                  el.id === selectedElement.id ? { ...el, geometry: { ...el.geometry, x: val } } : el
                                );
                                updateCurrentSlide({ ...currentSlide, elements: updated });
                              }}
                              data-testid="wb-el-x"
                              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-1.5 py-1 text-slate-800 dark:text-slate-200 font-mono text-[11px]"
                            />
                          </div>
                          <div>
                            <label className="text-slate-500 text-[9px] block">Y 坐标 (px)</label>
                            <input
                              type="number"
                              value={selectedElement.geometry.y}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                const updated = currentSlide.elements.map((el) =>
                                  el.id === selectedElement.id ? { ...el, geometry: { ...el.geometry, y: val } } : el
                                );
                                updateCurrentSlide({ ...currentSlide, elements: updated });
                              }}
                              data-testid="wb-el-y"
                              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-1.5 py-1 text-slate-800 dark:text-slate-200 font-mono text-[11px]"
                            />
                          </div>
                          <div>
                            <label className="text-slate-500 text-[9px] block">宽度 (px)</label>
                            <input
                              type="number"
                              value={selectedElement.geometry.width}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                const updated = currentSlide.elements.map((el) =>
                                  el.id === selectedElement.id ? { ...el, geometry: { ...el.geometry, width: val } } : el
                                );
                                updateCurrentSlide({ ...currentSlide, elements: updated });
                              }}
                              data-testid="wb-el-width"
                              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-1.5 py-1 text-slate-800 dark:text-slate-200 font-mono text-[11px]"
                            />
                          </div>
                          <div>
                            <label className="text-slate-500 text-[9px] block">高度 (px)</label>
                            <input
                              type="number"
                              value={selectedElement.geometry.height}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                const updated = currentSlide.elements.map((el) =>
                                  el.id === selectedElement.id ? { ...el, geometry: { ...el.geometry, height: val } } : el
                                );
                                updateCurrentSlide({ ...currentSlide, elements: updated });
                              }}
                              data-testid="wb-el-height"
                              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-1.5 py-1 text-slate-800 dark:text-slate-200 font-mono text-[11px]"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Typography & Color */}
                      <div className="space-y-1.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                        <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                          字体与字重 (Typography)
                        </span>
                        <div className="grid grid-cols-2 gap-1.5 text-xs">
                          <div>
                            <label className="text-slate-500 text-[9px] block">字号 (px)</label>
                            <input
                              type="number"
                              value={selectedElement.style.fontSize || 16}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                const updated = currentSlide.elements.map((el) =>
                                  el.id === selectedElement.id
                                    ? { ...el, style: { ...el.style, fontSize: val } }
                                    : el
                                );
                                updateCurrentSlide({ ...currentSlide, elements: updated });
                              }}
                              data-testid="wb-el-font-size"
                              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-1.5 py-1 text-slate-800 dark:text-slate-200 font-mono text-[11px]"
                            />
                          </div>
                          <div>
                            <label className="text-slate-500 text-[9px] block">字重 (Weight)</label>
                            <select
                              value={selectedElement.style.fontWeight || 500}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                const updated = currentSlide.elements.map((el) =>
                                  el.id === selectedElement.id
                                    ? { ...el, style: { ...el.style, fontWeight: val } }
                                    : el
                                );
                                updateCurrentSlide({ ...currentSlide, elements: updated });
                              }}
                              data-testid="wb-el-font-weight"
                              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-1.5 py-1 text-slate-800 dark:text-slate-200 text-[11px]"
                            >
                              <option value={400}>Regular</option>
                              <option value={600}>SemiBold</option>
                              <option value={700}>Bold</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      {/* Surface Fill */}
                      <div className="space-y-1.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                        <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                          外观与填充色
                        </span>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={selectedElement.style.backgroundColor || project.template.theme.surfaceColor}
                            onChange={(e) => {
                              const val = e.target.value;
                              const updated = currentSlide.elements.map((el) =>
                                el.id === selectedElement.id
                                  ? { ...el, style: { ...el.style, backgroundColor: val } }
                                  : el
                              );
                              updateCurrentSlide({ ...currentSlide, elements: updated });
                            }}
                            data-testid="wb-el-bg-color"
                            className="w-7 h-7 rounded border border-slate-300 dark:border-slate-700 bg-transparent cursor-pointer"
                          />
                          <span
                            data-testid="wb-el-bg-color-value"
                            className="text-xs font-mono text-slate-700 dark:text-slate-300 text-[11px]"
                          >
                            {selectedElement.style.backgroundColor || project.template.theme.surfaceColor}
                          </span>
                        </div>
                      </div>

                      {/* Content Editing (Text, Card, Metric) */}
                      <div className="space-y-1.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                        <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                          文本与内容 (Content)
                        </span>
                        {typeof selectedElement.content === 'string' ? (
                          <textarea
                            rows={3}
                            value={selectedElement.content}
                            onChange={(e) => {
                              const val = e.target.value;
                              const updated = currentSlide.elements.map((el) =>
                                el.id === selectedElement.id ? { ...el, content: val } : el
                              );
                              updateCurrentSlide({ ...currentSlide, elements: updated });
                            }}
                            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500 resize-none font-medium leading-relaxed"
                            data-testid="wb-el-content-text"
                            placeholder="输入文本内容..."
                          />
                        ) : typeof selectedElement.content === 'object' && selectedElement.content !== null ? (
                          <div className="space-y-2 text-xs">
                            {selectedElement.content.tag !== undefined && (
                              <div>
                                <label className="text-[9px] text-slate-500 block mb-0.5">标签 (Tag)</label>
                                <input
                                  type="text"
                                  value={selectedElement.content.tag || ''}
                                  onChange={(e) => {
                                    const updated = currentSlide.elements.map((el) =>
                                      el.id === selectedElement.id
                                        ? { ...el, content: { ...el.content, tag: e.target.value } }
                                        : el
                                    );
                                    updateCurrentSlide({ ...currentSlide, elements: updated });
                                  }}
                                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-2 py-1 text-slate-800 dark:text-slate-200 text-xs"
                                  data-testid="wb-el-content-tag"
                                />
                              </div>
                            )}
                            {selectedElement.content.title !== undefined && (
                              <div>
                                <label className="text-[9px] text-slate-500 block mb-0.5">标题 (Title)</label>
                                <input
                                  type="text"
                                  value={selectedElement.content.title || ''}
                                  onChange={(e) => {
                                    const updated = currentSlide.elements.map((el) =>
                                      el.id === selectedElement.id
                                        ? { ...el, content: { ...el.content, title: e.target.value } }
                                        : el
                                    );
                                    updateCurrentSlide({ ...currentSlide, elements: updated });
                                  }}
                                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-2 py-1 text-slate-800 dark:text-slate-200 text-xs font-semibold"
                                  data-testid="wb-el-content-title"
                                />
                              </div>
                            )}
                            {selectedElement.content.desc !== undefined && (
                              <div>
                                <label className="text-[9px] text-slate-500 block mb-0.5">描述说明 (Description)</label>
                                <textarea
                                  rows={2}
                                  value={selectedElement.content.desc || ''}
                                  onChange={(e) => {
                                    const updated = currentSlide.elements.map((el) =>
                                      el.id === selectedElement.id
                                        ? { ...el, content: { ...el.content, desc: e.target.value } }
                                        : el
                                    );
                                    updateCurrentSlide({ ...currentSlide, elements: updated });
                                  }}
                                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-2 py-1 text-slate-800 dark:text-slate-200 text-xs resize-none"
                                  data-testid="wb-el-content-desc"
                                />
                              </div>
                            )}
                            {selectedElement.content.value !== undefined && (
                              <div>
                                <label className="text-[9px] text-slate-500 block mb-0.5">核心数值 (KPI Value)</label>
                                <input
                                  type="text"
                                  value={selectedElement.content.value || ''}
                                  onChange={(e) => {
                                    const updated = currentSlide.elements.map((el) =>
                                      el.id === selectedElement.id
                                        ? { ...el, content: { ...el.content, value: e.target.value } }
                                        : el
                                    );
                                    updateCurrentSlide({ ...currentSlide, elements: updated });
                                  }}
                                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-2 py-1 text-slate-800 dark:text-slate-200 font-mono text-xs font-bold"
                                  data-testid="wb-el-content-value"
                                />
                              </div>
                            )}
                            {selectedElement.content.trend !== undefined && (
                              <div>
                                <label className="text-[9px] text-slate-500 block mb-0.5">趋势标签 (Trend)</label>
                                <input
                                  type="text"
                                  value={selectedElement.content.trend || ''}
                                  onChange={(e) => {
                                    const updated = currentSlide.elements.map((el) =>
                                      el.id === selectedElement.id
                                        ? { ...el, content: { ...el.content, trend: e.target.value } }
                                        : el
                                    );
                                    updateCurrentSlide({ ...currentSlide, elements: updated });
                                  }}
                                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-2 py-1 text-slate-800 dark:text-slate-200 text-xs"
                                  data-testid="wb-el-content-trend"
                                />
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-8 space-y-2 text-slate-400 dark:text-slate-500">
                      <Move className="w-7 h-7 mx-auto opacity-40 text-blue-500 dark:text-blue-400" />
                      <p className="text-[11px]">点击画布上的任意元素，即可编辑属性与图层。</p>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: Theme & Design System */}
              {activeTab === 'theme' && (
                <div className="space-y-4">
                  {/* Quick Background Mode Toggle */}
                  <div className="p-2.5 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        底色模式
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {project.template.theme.isDark ? '深色暗调' : '清爽浅色'}
                      </div>
                    </div>

                    <button
                      onClick={handleQuickToggleSlideTheme}
                      className="px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1 bg-blue-600 hover:bg-blue-500 text-white shadow-xs"
                    >
                      {project.template.theme.isDark ? <Sun className="w-3 h-3 text-amber-300" /> : <Moon className="w-3 h-3 text-slate-200" />}
                      <span>{project.template.theme.isDark ? '切浅色' : '切深色'}</span>
                    </button>
                  </div>

                  {/* Light Background Themes Group */}
                  <div>
                    <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider block mb-1.5 flex items-center gap-1">
                      <Sun className="w-3 h-3 text-amber-500" />
                      <span>浅色背景主题</span>
                    </span>
                    <div className="space-y-1">
                      {lightTemplates.map((t) => {
                        const isCurrent = project.template.templateId === t.templateId;
                        return (
                          <button
                            key={t.templateId}
                            onClick={() => handleApplyTheme(t)}
                            className={`w-full text-left p-2 rounded-lg border transition-all text-xs flex items-center justify-between ${
                              isCurrent
                                ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10 shadow-xs'
                                : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 hover:border-slate-300 dark:hover:border-slate-700'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className="w-3 h-3 rounded-full border border-slate-300 dark:border-white/20"
                                style={{ backgroundColor: t.theme.primaryColor }}
                              />
                              <span className="font-bold text-slate-800 dark:text-slate-200 text-[11px]">{t.name.split(' ')[0]}</span>
                            </div>
                            {isCurrent && <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Dark Background Themes Group */}
                  <div>
                    <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider block mb-1.5 flex items-center gap-1">
                      <Moon className="w-3 h-3 text-indigo-400" />
                      <span>深色背景主题</span>
                    </span>
                    <div className="space-y-1">
                      {darkTemplates.map((t) => {
                        const isCurrent = project.template.templateId === t.templateId;
                        return (
                          <button
                            key={t.templateId}
                            onClick={() => handleApplyTheme(t)}
                            className={`w-full text-left p-2 rounded-lg border transition-all text-xs flex items-center justify-between ${
                              isCurrent
                                ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10 shadow-xs'
                                : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 hover:border-slate-300 dark:hover:border-slate-700'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className="w-3 h-3 rounded-full border border-white/20"
                                style={{ backgroundColor: t.theme.primaryColor }}
                              />
                              <span className="font-bold text-slate-800 dark:text-slate-200 text-[11px]">{t.name.split(' ')[0]}</span>
                            </div>
                            {isCurrent && <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: Quality Inspection */}
              {activeTab === 'quality' && (
                <div className="space-y-3.5">
                  <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 text-center space-y-1">
                    <div className="text-2xl font-extrabold text-blue-600 dark:text-blue-400 font-mono">
                      {project.qualityReport?.overallScore ?? 92}
                      <span className="text-[10px] text-slate-500 font-normal"> / 100</span>
                    </div>
                    <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">加权质量综合评分</div>
                  </div>

                  <button
                    onClick={handleAutoFix}
                    className="w-full py-1.5 px-3 bg-indigo-600 hover:bg-indigo-500 active:scale-98 text-white rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-sm cursor-pointer"
                  >
                    <Wand2 className="w-3.5 h-3.5" />
                    <span>智能合规修复</span>
                  </button>

                  <div className="space-y-1 pt-1">
                    <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                      诊断结果 ({project.qualityReport?.issues.length || 0})
                    </span>

                    <div className="space-y-1">
                      {(project.qualityReport?.issues || []).map((issue) => (
                        <div
                          key={issue.id}
                          className="p-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs space-y-0.5"
                        >
                          <div className="flex items-center gap-1 font-semibold text-slate-800 dark:text-slate-200 text-[11px]">
                            {issue.level === 'error' && <AlertCircle className="w-3 h-3 text-rose-500 dark:text-rose-400" />}
                            {issue.level === 'warning' && <AlertCircle className="w-3 h-3 text-amber-500 dark:text-amber-400" />}
                            {issue.level === 'info' && <CheckCircle2 className="w-3 h-3 text-blue-500 dark:text-blue-400" />}
                            <span>[{issue.dimension.toUpperCase()}]</span>
                          </div>
                          <p className="text-[10px] text-slate-600 dark:text-slate-400 leading-snug">{issue.message}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </aside>

      {/* ========================================================
          LAYOUT SELECTOR MODAL (When adding a new slide)
          ======================================================== */}
      {isLayoutModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  选择新页面版式 (Slide Layout)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  依据当前模板主题（{project.template.theme.isDark ? '深色' : '浅色'}）精准计算矢量坐标与留白网格
                </p>
              </div>
              <button
                onClick={() => setIsLayoutModalOpen(false)}
                data-testid="wb-layout-modal-close"
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { type: 'cards_grid' as SlideLayoutType, label: '3栏卡片网格', desc: '模块化方案阐述' },
                { type: 'architecture_diagram' as SlideLayoutType, label: '4层分层架构', desc: '技术模型与中台' },
                { type: 'stats_kpi' as SlideLayoutType, label: '核心指标看板', desc: 'KPI数据与商业回报' },
                { type: 'problem_solution' as SlideLayoutType, label: '痛点对比分析', desc: '前后对照与破局' },
                { type: 'timeline_roadmap' as SlideLayoutType, label: '时间路线规划', desc: '阶段里程序程图' },
                { type: 'radial_center' as SlideLayoutType, label: '中心放射发散', desc: '核心引擎与赋能' },
                { type: 'summary_conclusion' as SlideLayoutType, label: '总结与下一步', desc: '行动落地与号召' },
                { type: 'title_cover' as SlideLayoutType, label: '主标题封面', desc: '开篇汇报主视觉' },
              ].map((item) => (
                <button
                  key={item.type}
                  onClick={() => handleAddSlideWithLayout(item.type)}
                  data-testid={`wb-layout-option-${item.type}`}
                  className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-blue-500 dark:hover:border-blue-500 bg-slate-50/50 dark:bg-slate-800/40 hover:bg-blue-50/50 dark:hover:bg-blue-500/10 text-left transition-all group flex flex-col justify-between"
                >
                  <div>
                    <div className="font-bold text-xs text-slate-800 dark:text-slate-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {item.label}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      {item.desc}
                    </div>
                  </div>
                  <div className="text-[10px] font-mono text-blue-600 dark:text-blue-400 mt-3 flex items-center justify-between">
                    <span>{item.type}</span>
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity">创建 →</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
