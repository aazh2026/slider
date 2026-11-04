/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  FolderOpen,
  Sparkles,
  ListOrdered,
  Layout,
  Palette,
  ShieldCheck,
  Play,
  Download,
  Sun,
  Moon,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plus,
  Check,
  Edit2,
  Sliders,
  ExternalLink,
  LogOut,
} from 'lucide-react';
import { PresentationProject, QualityReport } from '@ppt/core';

export type NavTab = 'projects' | 'create' | 'outline' | 'workbench' | 'templates' | 'quality';

interface SidebarNavProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  projectName: string;
  onRenameProject: (name: string) => void;
  onOpenExport: () => void;
  onStartPresent: () => void;
  qualityReport?: QualityReport;
  hasOutline: boolean;
  hasSlides: boolean;
  isUiDark: boolean;
  onToggleUiTheme: () => void;
  isSlideDark: boolean;
  onToggleSlideTheme: () => void;
  allProjects?: PresentationProject[];
  onSwitchProject?: (projectId: string) => void;
  onCreateNewProject?: () => void;
  /**
   * 登出。
   *
   * 以前这个按钮**根本不存在** —— `authService.logout()` 定义了却没有任何调用方，
   * 于是用户在浏览器里无法结束会话（Cookie 一直有效到 30 天后过期）。
   * 既然「登出」是会话生命周期的一部分，就得有一个入口，
   * 而且它必须可测 —— 见 e2e/auth.e2e.ts。
   */
  onLogout?: () => void;
  userEmail?: string;
}

export const SidebarNav: React.FC<SidebarNavProps> = ({
  currentTab,
  onSelectTab,
  projectName,
  onRenameProject,
  onOpenExport,
  onStartPresent,
  qualityReport,
  hasOutline,
  hasSlides,
  isUiDark,
  onToggleUiTheme,
  isSlideDark,
  onToggleSlideTheme,
  allProjects = [],
  onSwitchProject,
  onCreateNewProject,
  onLogout,
  userEmail,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState(projectName);

  React.useEffect(() => {
    setTempTitle(projectName);
  }, [projectName]);

  const handleTitleSubmit = () => {
    setIsEditingTitle(false);
    if (tempTitle.trim()) {
      onRenameProject(tempTitle.trim());
    }
  };

  /**
   * 侧边栏徽章上的分数 —— **没有报告就没有分数**
   * ---------------------------------------------------------------------------
   * 之前这里是 `?? 92`：没有报告时显示一个写死的 92 分。那不是体检结果，
   * 是安慰剂 —— 用户会以为这份文稿已经体检过了。而服务端的 `quality_report`
   * 列在正常流程里恒为 NULL，所以「没有报告」本就是常态。
   * 现在没有报告就不显示徽章（App.tsx 的 currentQualityReport 保证有当前
   * 项目时那份报告总是真算出来的）。
   */
  const score = qualityReport?.overallScore;

  const navItems = [
    {
      id: 'projects' as NavTab,
      label: '我的作品',
      enLabel: 'Projects',
      icon: FolderOpen,
      disabled: false,
      badge: allProjects.length > 0 ? String(allProjects.length) : undefined,
    },
    {
      id: 'create' as NavTab,
      label: '创作中心',
      enLabel: 'AI Studio',
      icon: Sparkles,
      disabled: false,
      badge: 'AI',
    },
    {
      id: 'outline' as NavTab,
      label: '大纲规划',
      enLabel: 'Outline',
      icon: ListOrdered,
      disabled: !hasOutline,
      badge: undefined,
    },
    {
      id: 'workbench' as NavTab,
      label: '制作工作台',
      enLabel: 'Workbench',
      icon: Layout,
      disabled: !hasSlides,
      badge: undefined,
    },
    {
      id: 'templates' as NavTab,
      label: '模板资产',
      enLabel: 'Templates',
      icon: Palette,
      disabled: false,
      badge: undefined,
    },
    {
      id: 'quality' as NavTab,
      label: '质量体检',
      enLabel: 'Quality',
      icon: ShieldCheck,
      disabled: !hasSlides,
      badge: hasSlides && score !== undefined ? `${score}分` : undefined,
      badgeColor: (score ?? 0) >= 85 ? 'emerald' : 'amber',
    },
  ];

  return (
    <aside
      className={`h-screen flex flex-col justify-between shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-all duration-200 z-40 select-none ${
        isCollapsed ? 'w-18' : 'w-64'
      }`}
    >
      {/* Top Section: Brand + Current Project Card */}
      <div className="flex flex-col">
        {/* Brand & Collapse Header */}
        <div className="h-14 px-4 flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <button
              onClick={() => onSelectTab('projects')}
              data-testid="nav-brand"
              className="flex items-center gap-2.5 focus:outline-none group text-left cursor-pointer"
              title="回到作品管理"
            >
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 via-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-sm shadow-blue-500/20 group-hover:scale-105 transition-transform shrink-0">
                <span className="font-black text-sm tracking-tighter">P</span>
              </div>
              {!isCollapsed && (
                <div className="flex flex-col">
                  <div className="flex items-center gap-1.5">
                    <span className="font-extrabold text-sm text-slate-900 dark:text-white tracking-tight">
                      AI PPT Studio
                    </span>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                      v2.0
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-600 dark:text-slate-400">
                    结构化 Slide IR 演示套件
                  </span>
                </div>
              )}
            </button>
          </div>

          {/* Toggle Sidebar Collapse */}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1.5 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title={isCollapsed ? '展开侧边栏菜单' : '收起侧边栏'}
            aria-label="Toggle Sidebar"
          >
            {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        {/* Current Active Project Card / Switcher */}
        {!isCollapsed ? (
          <div className="p-3 border-b border-slate-100 dark:border-slate-800/80">
            <div className="relative">
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60 hover:border-slate-300 dark:hover:border-slate-600 transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-400 tracking-wider">
                    当前演示工程
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setIsProjectDropdownOpen(!isProjectDropdownOpen)}
                      data-testid="nav-project-dropdown"
                      className="p-1 rounded text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700/80 transition-colors"
                      title="切换工程"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {isEditingTitle ? (
                  <input
                    type="text"
                    value={tempTitle}
                    onChange={(e) => setTempTitle(e.target.value)}
                    onBlur={handleTitleSubmit}
                    onKeyDown={(e) => e.key === 'Enter' && handleTitleSubmit()}
                    data-testid="project-name-input"
                    autoFocus
                    className="w-full text-xs font-bold text-slate-900 dark:text-white bg-white dark:bg-slate-900 px-2 py-1 rounded border border-blue-500 focus:outline-none"
                  />
                ) : (
                  <div
                    onClick={() => setIsEditingTitle(true)}
                    data-testid="project-name-button"
                    className="group cursor-pointer flex items-center justify-between text-xs font-bold text-slate-800 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 py-0.5 truncate"
                    title="点击重命名当前演示文稿"
                  >
                    <span className="truncate">{projectName || '未命名演示文稿'}</span>
                    <Edit2 className="w-3 h-3 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-1" />
                  </div>
                )}

                <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-slate-200/60 dark:border-slate-700/40 text-[10px] text-slate-600 dark:text-slate-400">
                  <span className="font-mono">
                    {hasSlides ? '已就绪' : '草稿'}
                  </span>
                  <span className="inline-flex items-center gap-1 font-medium">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        isSlideDark ? 'bg-indigo-400' : 'bg-amber-400'
                      }`}
                    />
                    {isSlideDark ? '深色主题' : '浅色主题'}
                  </span>
                </div>
              </div>

              {/* Project Switcher Dropdown */}
              {isProjectDropdownOpen && (
                <div className="absolute left-0 top-full mt-1.5 w-60 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-2 z-50 space-y-1">
                  <div className="flex items-center justify-between px-2 py-1 text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                    <span>我的所有作品 ({allProjects.length})</span>
                    {onCreateNewProject && (
                      <button
                        onClick={() => {
                          setIsProjectDropdownOpen(false);
                          onCreateNewProject();
                        }}
                        data-testid="nav-dropdown-create"
                        className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5"
                      >
                        <Plus className="w-3 h-3" />
                        新建
                      </button>
                    )}
                  </div>
                  <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
                    {allProjects.map((proj) => {
                      const isActive = proj.name === projectName;
                      return (
                        <button
                          key={proj.id}
                          onClick={() => {
                            onSwitchProject?.(proj.id);
                            setIsProjectDropdownOpen(false);
                          }}
                          data-testid={`nav-project-item-${proj.id}`}
                          className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between transition-colors ${
                            isActive
                              ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 font-bold border border-blue-500/20'
                              : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                proj.template.theme.isDark ? 'bg-indigo-400' : 'bg-amber-400'
                              }`}
                            />
                            <span className="truncate max-w-[130px]">{proj.name}</span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[10px] text-slate-600 dark:text-slate-400 font-mono">
                              {proj.slides.length}P
                            </span>
                            {isActive && <Check className="w-3.5 h-3.5 text-blue-500" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="pt-1.5 border-t border-slate-100 dark:border-slate-800">
                    <button
                      onClick={() => {
                        setIsProjectDropdownOpen(false);
                        onSelectTab('projects');
                      }}
                      data-testid="nav-open-library"
                      className="w-full text-center py-1 text-xs text-blue-600 dark:text-blue-400 font-semibold hover:underline flex items-center justify-center gap-1"
                    >
                      <span>进入完整作品库管理</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="py-2 flex justify-center border-b border-slate-100 dark:border-slate-800/80">
            <button
              onClick={() => onSelectTab('projects')}
              data-testid="nav-current-project-dot"
              className="p-2 text-slate-500 hover:text-slate-800 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title={`当前作品: ${projectName}`}
            >
              <div
                className={`w-3 h-3 rounded-full ${
                  isSlideDark ? 'bg-indigo-500' : 'bg-amber-500'
                }`}
              />
            </button>
          </div>
        )}

        {/* Navigation Menu List */}
        <nav className="p-3 space-y-1.5">
          <div className={`px-2 mb-1 ${isCollapsed ? 'hidden' : 'block'}`}>
            <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
              流程导航
            </span>
          </div>

          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => !item.disabled && onSelectTab(item.id)}
                disabled={item.disabled}
                data-testid={`nav-${item.id}`}
                className={`w-full flex items-center rounded-xl transition-all font-medium text-xs group relative ${
                  isCollapsed ? 'justify-center p-3' : 'justify-between px-3 py-2.5'
                } ${
                  item.disabled
                    ? 'opacity-40 cursor-not-allowed text-slate-400 dark:text-slate-600'
                    : isActive
                    ? 'bg-blue-600 text-white font-semibold shadow-md shadow-blue-600/20'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                }`}
                title={isCollapsed ? `${item.label} (${item.enLabel})` : undefined}
              >
                <div className="flex items-center gap-3 truncate">
                  <Icon
                    className={`w-4 h-4 shrink-0 transition-colors ${
                      isActive
                        ? 'text-white'
                        : 'text-slate-500 dark:text-slate-400 group-hover:text-blue-500 dark:group-hover:text-blue-400'
                    }`}
                  />
                  {!isCollapsed && (
                    <div className="flex flex-col text-left">
                      <span className="leading-tight">{item.label}</span>
                      <span
                        className={`text-[9px] ${
                          isActive
                            ? 'text-blue-100'
                            : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {item.enLabel}
                      </span>
                    </div>
                  )}
                </div>

                {!isCollapsed && item.badge && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold shrink-0 ${
                      isActive
                        ? 'bg-white/20 text-white'
                        : item.badgeColor === 'emerald'
                        ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                        : item.badgeColor === 'amber'
                        ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}

                {/* Collapsed Active Indicator Dot */}
                {isCollapsed && isActive && (
                  <span className="absolute right-1 w-1.5 h-1.5 rounded-full bg-white" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Section: Quick Toggles (PPT Light/Dark, Studio Theme) & Export/Present Actions */}
      <div className="p-3 border-t border-slate-100 dark:border-slate-800/80 space-y-2 bg-slate-50/50 dark:bg-slate-900/50">
        {!isCollapsed && (
          <div className="px-2">
            <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
              快捷控制
            </span>
          </div>
        )}

        {/* Slide Theme Quick Switcher (Light <-> Dark) */}
        {hasSlides && (
          <button
            onClick={onToggleSlideTheme}
            data-testid="nav-toggle-slide-theme"
            className={`w-full flex items-center rounded-lg border text-xs font-semibold transition-colors ${
              isCollapsed ? 'justify-center p-2.5' : 'justify-between px-3 py-2'
            } ${
              isSlideDark
                ? 'bg-slate-800/70 text-slate-200 border-slate-700 hover:bg-slate-800'
                : 'bg-amber-50/70 text-amber-900 border-amber-200/80 hover:bg-amber-50 dark:bg-slate-800 dark:text-amber-300 dark:border-slate-700'
            }`}
            title={isSlideDark ? '当前为深色PPT底色，点击一键切换为浅色背景' : '当前为浅色PPT底色，点击一键切换为深色背景'}
          >
            <div className="flex items-center gap-2">
              <Palette
                className={`w-3.5 h-3.5 ${
                  isSlideDark ? 'text-indigo-400' : 'text-amber-500'
                }`}
              />
              {!isCollapsed && (
                <span>PPT底色: {isSlideDark ? '深色暗夜' : '明亮浅色'}</span>
              )}
            </div>
            {!isCollapsed && (
              <span className="text-[10px] text-blue-600 dark:text-blue-400 font-normal">
                切换
              </span>
            )}
          </button>
        )}

        {/* Studio UI Theme Toggle (Dark / Light) */}
        <button
          onClick={onToggleUiTheme}
          className={`w-full flex items-center rounded-lg border border-slate-200 dark:border-slate-700/80 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${
            isCollapsed ? 'justify-center p-2.5' : 'justify-between px-3 py-2'
          }`}
          title={isUiDark ? '切换编辑器界面为浅色明亮模式' : '切换编辑器界面为深色暗夜模式'}
          aria-label="Toggle UI Theme"
        >
          <div className="flex items-center gap-2">
            {isUiDark ? (
              <Sun className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <Moon className="w-3.5 h-3.5 text-slate-700" />
            )}
            {!isCollapsed && (
              <span>界面风格: {isUiDark ? '暗黑模式' : '明亮模式'}</span>
            )}
          </div>
        </button>

        <div className="pt-1 space-y-1.5">
          {/* Present Mode Action */}
          {hasSlides && (
            <button
              onClick={onStartPresent}
              data-testid="start-present"
              className={`w-full flex items-center rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-blue-600 dark:hover:text-white bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 transition-all ${
                isCollapsed ? 'justify-center p-2.5' : 'justify-center gap-2 py-2'
              }`}
              title="进入全屏演示模式 (F5)"
            >
              <Play className="w-3.5 h-3.5 text-blue-500 fill-blue-500" />
              {!isCollapsed && <span>全屏放映</span>}
            </button>
          )}

          {/* Export Action Button */}
          <button
            onClick={onOpenExport}
            disabled={!hasSlides}
            data-testid="open-export"
            className={`w-full flex items-center rounded-lg text-xs font-bold text-white transition-all shadow-sm ${
              isCollapsed ? 'justify-center p-2.5' : 'justify-center gap-2 py-2.5'
            } ${
              !hasSlides
                ? 'bg-slate-300 dark:bg-slate-800 text-slate-500 dark:text-slate-400 cursor-not-allowed'
                : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 active:scale-98 shadow-blue-900/20'
            }`}
            title="导出演示文稿 (PPTX / PDF / PNG)"
          >
            <Download className="w-4 h-4" />
            {!isCollapsed && <span>导出演示文稿</span>}
          </button>
        </div>

        {/* 登出 —— 会话在服务端也要作废，不能只清前端状态 */}
        {onLogout && (
          <button
            onClick={onLogout}
            data-testid="logout"
            className={`w-full flex items-center rounded-lg text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all ${
              isCollapsed ? 'justify-center p-2' : 'justify-center gap-2 py-2'
            }`}
            title={userEmail ? `退出登录（${userEmail}）` : '退出登录'}
          >
            <LogOut className="w-3.5 h-3.5" />
            {!isCollapsed && <span>退出登录</span>}
          </button>
        )}
      </div>
    </aside>
  );
};
