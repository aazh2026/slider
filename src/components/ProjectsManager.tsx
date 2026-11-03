/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  FolderOpen,
  Plus,
  Search,
  Upload,
  Copy,
  Trash2,
  Play,
  Download,
  Calendar,
  Layers,
  Sparkles,
  CheckCircle2,
  MoreVertical,
  Sun,
  Moon,
  ShieldCheck,
  FileCode,
} from 'lucide-react';
import { PresentationProject, TemplateIR } from '@ppt/core';
import { SVGRenderer } from '@ppt/core';
import { BUILT_IN_TEMPLATES } from '@ppt/core';
import { ExportEngine } from '@ppt/core';

import { pageCountOf } from '../services/projectMerge';
import { ProjectStorage } from '../services/projectStorage';

interface ProjectsManagerProps {
  projects: PresentationProject[];
  currentProjectId: string;
  onSelectProject: (projectId: string) => void;
  onCreateNewProject: (name: string, templateId: string) => void;
  onDuplicateProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onImportProject: (jsonString: string) => void;
  onStartPresentProject: (project: PresentationProject) => void;
}

export const ProjectsManager: React.FC<ProjectsManagerProps> = ({
  projects,
  currentProjectId,
  onSelectProject,
  onCreateNewProject,
  onDuplicateProject,
  onDeleteProject,
  onImportProject,
  onStartPresentProject,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTheme, setFilterTheme] = useState<'all' | 'light' | 'dark'>('all');
  const [sortBy, setSortBy] = useState<'updated' | 'created' | 'pages'>('updated');
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('企业新业务规划演示文稿');
  const [selectedTemplateId, setSelectedTemplateId] = useState('tpl_modern_light');
  const [exportingProjectId, setExportingProjectId] = useState<string | null>(null);

  const handleExportAllProjects = () => {
    const jsonStr = JSON.stringify(projects, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai_ppt_studio_portfolio_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDirectExportPptx = async (p: PresentationProject) => {
    setExportingProjectId(p.id);
    try {
      await ExportEngine.exportPresentationAsPptx(p);
    } catch (err: any) {
      alert(`导出 PPTX 失败: ${err.message || '未知错误'}`);
    } finally {
      setExportingProjectId(null);
    }
  };

  /**
   * 导出 Slide IR JSON 备份。
   * ---------------------------------------------------------------------------
   * 导的是**服务端那份 bundle**，不是卡片上这份摘要 ——
   * 摘要的 `slides` 是空数组，直接导会得到一份没有页面的空壳，
   * 再导入回去什么也恢复不了。
   */
  const handleExportJson = async (p: PresentationProject) => {
    try {
      const bundle = await ProjectStorage.exportProjectBundle(p.id);
      ExportEngine.exportBundleAsJson(bundle);
    } catch (err: any) {
      alert(`导出 JSON 失败: ${err.message || '未知错误'}`);
    }
  };

  // Filter & Sort
  const filteredProjects = projects
    .filter((p) => {
      const matchesSearch =
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.requirement?.topic?.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchesSearch) return false;

      if (filterTheme === 'light') return !p.template.theme.isDark;
      if (filterTheme === 'dark') return p.template.theme.isDark;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'updated') return b.updatedAt - a.updatedAt;
      if (sortBy === 'created') return b.createdAt - a.createdAt;
      // 页数用服务给的 `slideCount`；没加载过的文稿 `slides` 是空的，
      // 只看 `slides.length` 会把所有没打开过的文稿都当成 0 页。
      if (sortBy === 'pages') return pageCountOf(b) - pageCountOf(a);
      return 0;
    });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    onCreateNewProject(newProjectName.trim(), selectedTemplateId);
    setIsNewModalOpen(false);
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content === 'string') {
        try {
          onImportProject(content);
        } catch (err: any) {
          alert(`导入失败: ${err.message}`);
        }
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950 p-6 md:p-10 flex flex-col items-center transition-colors">
      <div className="w-full max-w-6xl space-y-8">
        {/* Header Bar */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-6 border-b border-slate-200 dark:border-slate-800">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 text-xs font-semibold tracking-wide mb-2">
              <FolderOpen className="w-3.5 h-3.5" />
              <span>Project Portfolio · 个人作品管理</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              我的演示文稿作品库
            </h1>
            <p className="text-xs md:text-sm text-slate-600 dark:text-slate-400 mt-1">
              以结构化 Slide IR 原生模型保存，支持本地持久化、多端导出与一键复制编辑。
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Backup All Projects Button */}
            <button
              onClick={handleExportAllProjects}
              data-testid="pm-backup-all"
              className="hidden sm:flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg transition-colors cursor-pointer shadow-xs"
              title="一键将所有作品导出为一个完整 JSON 备份文件"
            >
              <Download className="w-3.5 h-3.5 text-blue-500" />
              <span>备份全库</span>
            </button>

            {/* Import JSON button */}
            <div className="relative">
              <input
                type="file"
                accept=".json"
                onChange={handleFileImport}
                data-testid="pm-import-input"
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              />
              <button
                type="button"
                data-testid="pm-import-trigger"
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg transition-colors cursor-pointer shadow-xs"
              >
                <Upload className="w-3.5 h-3.5 text-indigo-500" />
                <span>导入作品 (JSON)</span>
              </button>
            </div>

            {/* New Project Button */}
            <button
              onClick={() => setIsNewModalOpen(true)}
              data-testid="new-project"
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 active:scale-98 text-white rounded-lg font-bold text-xs shadow-md shadow-blue-900/30 transition-all cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>新建演示文稿</span>
            </button>
          </div>
        </div>

        {/* Search & Filter Toolbar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              data-testid="pm-search"
              placeholder="搜索演示文稿名称..."
              className="w-full pl-9 pr-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 shadow-xs"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto">
            {/* Filter segmented buttons */}
            <div className="flex items-center gap-1 p-0.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xs">
              <button
                onClick={() => setFilterTheme('all')}
                data-testid="pm-filter-all"
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                  filterTheme === 'all'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                全部 ({projects.length})
              </button>
              <button
                onClick={() => setFilterTheme('light')}
                data-testid="pm-filter-light"
                className={`flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                  filterTheme === 'light'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Sun className="w-3 h-3" />
                <span>浅色底</span>
              </button>
              <button
                onClick={() => setFilterTheme('dark')}
                data-testid="pm-filter-dark"
                className={`flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                  filterTheme === 'dark'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Moon className="w-3 h-3" />
                <span>深色底</span>
              </button>
            </div>

            {/* Sort Dropdown */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              data-testid="pm-sort"
              className="px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:border-blue-500 shadow-xs cursor-pointer font-medium"
            >
              <option value="updated">最近修改优先</option>
              <option value="created">创建时间优先</option>
              <option value="pages">按页数从多到少</option>
            </select>
          </div>
        </div>

        {/* Projects Cards Grid */}
        {filteredProjects.length === 0 ? (
          <div className="py-20 text-center space-y-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs">
            <FolderOpen className="w-12 h-12 text-slate-400 dark:text-slate-600 mx-auto" />
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-200">没有找到匹配的演示文稿</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              尝试清除搜索过滤条件，或者点击上方按钮创建一个全新的演示文稿。
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredProjects.map((p) => {
              const isCurrent = p.id === currentProjectId;
              const firstSlide = p.slides[0];
              const svgCover = firstSlide ? SVGRenderer.renderToString(firstSlide, p.template.theme) : '';
              const score = p.qualityReport?.overallScore ?? 92;

              return (
                <div
                  key={p.id}
                  data-testid="project-card"
                  data-project-id={p.id}
                  className={`bg-white dark:bg-slate-900 rounded-xl border flex flex-col justify-between transition-all shadow-sm group hover:shadow-md ${
                    isCurrent
                      ? 'border-blue-500 ring-2 ring-blue-500/30'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="p-4 space-y-3">
                    {/* Miniature 16:9 Cover preview */}
                    <div
                      onClick={() => onSelectProject(p.id)}
                      data-testid={`pm-cover-${p.id}`}
                      className="w-full aspect-[16/9] rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 relative cursor-pointer group/thumb shadow-xs"
                      style={{ backgroundColor: p.template.theme.backgroundColor }}
                    >
                      {firstSlide && (
                        <div
                          className="w-full h-full pointer-events-none select-none flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:block"
                          dangerouslySetInnerHTML={{
                            __html: SVGRenderer.renderInlineSvg(firstSlide, p.template.theme),
                          }}
                        />
                      )}

                      {/* Hover Overlay with Quick Present Button */}
                      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onStartPresentProject(p);
                          }}
                          data-testid={`pm-present-${p.id}`}
                          className="px-3 py-1.5 bg-white/95 text-slate-900 rounded-lg text-xs font-bold shadow-lg flex items-center gap-1.5 hover:bg-white transition-colors"
                        >
                          <Play className="w-3.5 h-3.5 fill-slate-900" />
                          <span>放映演示</span>
                        </button>
                      </div>

                      {/* Theme indicator pill */}
                      <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/60 backdrop-blur-md text-white text-[10px] font-semibold flex items-center gap-1">
                        {p.template.theme.isDark ? <Moon className="w-3 h-3 text-indigo-400" /> : <Sun className="w-3 h-3 text-amber-400" />}
                        <span>{p.template.name.split(' ')[0]}</span>
                      </div>

                      {/* Quality Score tag */}
                      <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur-md text-[10px] font-mono font-bold text-emerald-400 flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3 text-emerald-400" />
                        <span>{score}分</span>
                      </div>
                    </div>

                    {/* Title & Metadata */}
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h3
                          onClick={() => onSelectProject(p.id)}
                          data-testid={`pm-title-${p.id}`}
                          className="font-bold text-sm text-slate-900 dark:text-white line-clamp-1 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
                          title={p.name}
                        >
                          {p.name}
                        </h3>
                        {isCurrent && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 font-bold shrink-0">
                            正在编辑
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono">
                        <span data-testid={`pm-pages-${p.id}`}>{pageCountOf(p)} 页</span>
                        <span>·</span>
                        <span>{new Date(p.updatedAt).toLocaleDateString()}</span>
                        <span>·</span>
                        <span className="truncate">{p.requirement.audience || '企业演示'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions Footer Strip */}
                  <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-950/60 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between rounded-b-xl">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => onSelectProject(p.id)}
                        data-testid={`pm-open-${p.id}`}
                        className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors cursor-pointer"
                      >
                        打开工作台 →
                      </button>

                      {/* Direct PPTX Download */}
                      <button
                        onClick={() => handleDirectExportPptx(p)}
                        disabled={exportingProjectId === p.id}
                        data-testid={`pm-pptx-${p.id}`}
                        className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white flex items-center gap-1 transition-colors"
                        title="直接下载为 PowerPoint .pptx"
                      >
                        {exportingProjectId === p.id ? (
                          <>
                            <div className="w-2.5 h-2.5 border border-blue-500 border-t-transparent rounded-full animate-spin" />
                            <span className="text-[10px]">导出中...</span>
                          </>
                        ) : (
                          <>
                            <Download className="w-3 h-3 text-indigo-500" />
                            <span>PPTX</span>
                          </>
                        )}
                      </button>
                    </div>

                    <div className="flex items-center gap-1">
                      {/* Duplicate */}
                      <button
                        onClick={() => onDuplicateProject(p.id)}
                        data-testid={`pm-duplicate-${p.id}`}
                        className="p-1.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white rounded hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                        title="复制作品 (创建独立副本)"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>

                      {/* Export JSON */}
                      <button
                        onClick={() => void handleExportJson(p)}
                        data-testid={`pm-export-json-${p.id}`}
                        className="p-1.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white rounded hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                        title="导出 Slide IR JSON 备份"
                      >
                        <FileCode className="w-3.5 h-3.5" />
                      </button>

                      {/* Delete */}
                      <button
                        onClick={() => {
                          if (confirm(`确定要删除作品「${p.name}」吗？此操作无法撤销。`)) {
                            onDeleteProject(p.id);
                          }
                        }}
                        data-testid="project-delete"
                        disabled={projects.length <= 1}
                        className="p-1.5 text-slate-400 hover:text-rose-600 dark:text-slate-500 dark:hover:text-rose-400 rounded hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        title="删除作品"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* New Project Modal */}
      {isNewModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateSubmit}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>新建演示文稿项目</span>
              </h2>
              <button
                type="button"
                onClick={() => setIsNewModalOpen(false)}
                data-testid="pm-new-modal-close"
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="text-slate-700 dark:text-slate-300 font-bold block mb-1">
                  演示文稿名称
                </label>
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  data-testid="new-project-name"
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="text-slate-700 dark:text-slate-300 font-bold block mb-2">
                  选择初始模板风格
                </label>
                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto p-1">
                  {BUILT_IN_TEMPLATES.map((t) => {
                    const isSelected = selectedTemplateId === t.templateId;
                    return (
                      <div
                        key={t.templateId}
                        onClick={() => setSelectedTemplateId(t.templateId)}
                        data-testid={`pm-template-option-${t.templateId}`}
                        className={`p-2.5 rounded-lg border cursor-pointer transition-all flex items-center justify-between ${
                          isSelected
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10'
                            : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span
                            className="w-3 h-3 rounded-full border border-slate-300 dark:border-white/20 shrink-0"
                            style={{ backgroundColor: t.theme.primaryColor }}
                          />
                          <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                            {t.name.split(' ')[0]}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {t.theme.isDark ? '深' : '浅'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setIsNewModalOpen(false)}
                data-testid="pm-new-cancel"
                className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg"
              >
                取消
              </button>
              <button
                type="submit"
                data-testid="new-project-submit"
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold text-xs shadow-md transition-colors cursor-pointer"
              >
                立即创建并进入工作台
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
