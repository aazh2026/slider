/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { PresentationProject, SlideOutlineItem, SlideIR, TemplateIR, PresentationRequirement } from './types/slide';
import { BUILT_IN_TEMPLATES } from './data/templates';
import { LayoutEngine } from './engine/layoutEngine';
import { QualityEngine } from './engine/qualityEngine';
import { AIService } from './services/aiService';
import { ProjectStorage } from './services/projectStorage';
import { SidebarNav, NavTab } from './components/SidebarNav';
import { ProjectsManager } from './components/ProjectsManager';
import { CreationCenter } from './components/CreationCenter';
import { OutlineEditor } from './components/OutlineEditor';
import { Workbench } from './components/Workbench';
import { TemplateCenter } from './components/TemplateCenter';
import { QualityCenter } from './components/QualityCenter';
import { ExportModal } from './components/ExportModal';
import { PresentationMode } from './components/PresentationMode';

export default function App() {
  const [currentTab, setCurrentTab] = useState<NavTab>('workbench');
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isPresenting, setIsPresenting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);

  // UI Studio Dark / Light mode - Default to Light Theme
  const [isUiDark, setIsUiDark] = useState<boolean>(false);

  useEffect(() => {
    if (isUiDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isUiDark]);

  // Load projects from persistent localStorage storage
  const [projects, setProjects] = useState<PresentationProject[]>(() => ProjectStorage.getAllProjects());
  const [activeProjectId, setActiveProjectId] = useState<string>(() => {
    const all = ProjectStorage.getAllProjects();
    return all[0]?.id || 'proj_agent_arch_2026';
  });

  const currentProject = projects.find((p) => p.id === activeProjectId) || projects[0];

  // Save changes to current project and synchronize storage
  const handleUpdateCurrentProject = (updated: PresentationProject) => {
    const updatedList = ProjectStorage.saveProject(updated);
    setProjects(updatedList);
  };

  // Switch active project
  const handleSelectProject = (projectId: string) => {
    setActiveProjectId(projectId);
    setCurrentTab('workbench');
  };

  // Create new blank or template project
  const handleCreateNewProject = (name: string, templateId: string) => {
    const { newProject, projects: newList } = ProjectStorage.createBlankProject(name, templateId);
    setProjects(newList);
    setActiveProjectId(newProject.id);
    setCurrentTab('workbench');
  };

  // Duplicate an existing project
  const handleDuplicateProject = (projectId: string) => {
    const { newProject, projects: newList } = ProjectStorage.duplicateProject(projectId);
    setProjects(newList);
    setActiveProjectId(newProject.id);
  };

  // Delete project
  const handleDeleteProject = (projectId: string) => {
    const newList = ProjectStorage.deleteProject(projectId);
    setProjects(newList);
    if (activeProjectId === projectId && newList.length > 0) {
      setActiveProjectId(newList[0].id);
    }
  };

  // Import project from JSON
  const handleImportProject = (jsonString: string) => {
    const { newProject, projects: newList } = ProjectStorage.importProjectFromJson(jsonString);
    setProjects(newList);
    setActiveProjectId(newProject.id);
    setCurrentTab('workbench');
  };

  // Fullscreen presentation of any project
  const handleStartPresentProject = (projectToPresent: PresentationProject) => {
    setActiveProjectId(projectToPresent.id);
    setIsPresenting(true);
  };

  // Quick Slide Background Theme Toggle (Light <-> Dark)
  const handleToggleSlideTheme = () => {
    if (!currentProject) return;

    const isCurrentlyDark = currentProject.template.theme.isDark;
    const targetTemplate = isCurrentlyDark
      ? BUILT_IN_TEMPLATES.find((t) => !t.theme.isDark) || BUILT_IN_TEMPLATES[0] // Switch to Light
      : BUILT_IN_TEMPLATES.find((t) => t.theme.isDark) || BUILT_IN_TEMPLATES[4];  // Switch to Dark

    // Deep remap all slide elements
    const updatedSlides = currentProject.slides.map((s) => {
      const newElements = s.elements.map((el) => {
        if (el.role === 'background') {
          return { ...el, style: { ...el.style, backgroundColor: targetTemplate.theme.backgroundColor } };
        }
        if (el.id.startsWith('header_')) {
          return { ...el, style: { ...el.style, color: targetTemplate.theme.accentColor } };
        }
        if (el.role === 'title') {
          return { ...el, style: { ...el.style, color: targetTemplate.theme.textPrimary } };
        }
        if (el.role === 'subtitle' || el.role === 'footer') {
          return { ...el, style: { ...el.style, color: targetTemplate.theme.textSecondary } };
        }
        if (el.role === 'card' || el.role === 'layer' || el.role === 'metric') {
          return {
            ...el,
            style: {
              ...el.style,
              backgroundColor: targetTemplate.theme.surfaceColor,
              borderColor: targetTemplate.theme.surfaceBorder,
              color: targetTemplate.theme.textPrimary,
            },
          };
        }
        if (el.role === 'badge') {
          return {
            ...el,
            style: {
              ...el.style,
              color: targetTemplate.theme.accentColor,
              backgroundColor: targetTemplate.theme.isDark
                ? `${targetTemplate.theme.accentColor}20`
                : `${targetTemplate.theme.accentColor}15`,
              borderColor: targetTemplate.theme.accentColor,
            },
          };
        }
        if (el.role === 'divider') {
          return {
            ...el,
            style: {
              ...el.style,
              backgroundColor: el.id.includes('accent')
                ? targetTemplate.theme.accentColor
                : targetTemplate.theme.surfaceBorder,
            },
          };
        }
        return el;
      });
      return { ...s, elements: newElements };
    });

    const updatedProject: PresentationProject = {
      ...currentProject,
      template: targetTemplate,
      slides: updatedSlides,
      updatedAt: Date.now(),
    };
    updatedProject.qualityReport = QualityEngine.evaluatePresentation(updatedProject);
    handleUpdateCurrentProject(updatedProject);
  };

  // Generate outline flow in Creation Center
  const handleGenerateOutline = async (req: PresentationRequirement) => {
    setIsGenerating(true);
    try {
      const generatedOutline = await AIService.generateOutline(req);
      const updatedProject: PresentationProject = {
        ...currentProject,
        name: req.topic,
        requirement: req,
        outline: generatedOutline,
        updatedAt: Date.now(),
      };
      handleUpdateCurrentProject(updatedProject);
      setCurrentTab('outline');
    } catch (err) {
      console.error('Failed to generate outline:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  // Compile outline into SlideIRs
  const handleConfirmAndGenerateSlides = async () => {
    setIsCompiling(true);
    try {
      const compiledSlides: SlideIR[] = currentProject.outline.map((item, idx) =>
        LayoutEngine.generateSlideIR(
          item,
          currentProject.template.theme,
          idx + 1,
          currentProject.outline.length
        )
      );

      const updatedProj: PresentationProject = {
        ...currentProject,
        slides: compiledSlides,
        updatedAt: Date.now(),
      };
      updatedProj.qualityReport = QualityEngine.evaluatePresentation(updatedProj);
      handleUpdateCurrentProject(updatedProj);
      setCurrentTab('workbench');
    } finally {
      setIsCompiling(false);
    }
  };

  return (
    <div className="flex flex-row h-screen w-screen overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans transition-colors duration-150">
      {/* Left-hand Navigation Sidebar */}
      <SidebarNav
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        projectName={currentProject.name}
        onRenameProject={(name) => handleUpdateCurrentProject({ ...currentProject, name })}
        onOpenExport={() => setIsExportModalOpen(true)}
        onStartPresent={() => setIsPresenting(true)}
        qualityReport={currentProject.qualityReport}
        hasOutline={currentProject.outline.length > 0}
        hasSlides={currentProject.slides.length > 0}
        isUiDark={isUiDark}
        onToggleUiTheme={() => setIsUiDark((d) => !d)}
        isSlideDark={currentProject.template.theme.isDark}
        onToggleSlideTheme={handleToggleSlideTheme}
        allProjects={projects}
        onSwitchProject={(id) => setActiveProjectId(id)}
        onCreateNewProject={() => {
          setCurrentTab('projects');
        }}
      />

      {/* Main Content Workspace Panes on the Right */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {currentTab === 'projects' && (
        <ProjectsManager
          projects={projects}
          currentProjectId={activeProjectId}
          onSelectProject={handleSelectProject}
          onCreateNewProject={handleCreateNewProject}
          onDuplicateProject={handleDuplicateProject}
          onDeleteProject={handleDeleteProject}
          onImportProject={handleImportProject}
          onStartPresentProject={handleStartPresentProject}
        />
      )}

      {currentTab === 'create' && (
        <CreationCenter
          requirement={currentProject.requirement}
          selectedTemplate={currentProject.template}
          onSelectTemplate={(t) => handleUpdateCurrentProject({ ...currentProject, template: t })}
          onGenerateOutline={handleGenerateOutline}
          isGenerating={isGenerating}
        />
      )}

      {currentTab === 'outline' && (
        <OutlineEditor
          outline={currentProject.outline}
          onUpdateOutline={(outline) => handleUpdateCurrentProject({ ...currentProject, outline })}
          onConfirmAndGenerateSlides={handleConfirmAndGenerateSlides}
          isCompiling={isCompiling}
        />
      )}

      {currentTab === 'workbench' && (
        <Workbench
          project={currentProject}
          onUpdateProject={handleUpdateCurrentProject}
          onStartPresent={() => setIsPresenting(true)}
        />
      )}

      {currentTab === 'templates' && (
        <TemplateCenter
          currentTemplate={currentProject.template}
          onSelectTemplate={(t) => handleUpdateCurrentProject({ ...currentProject, template: t })}
          project={currentProject}
          onUpdateProject={handleUpdateCurrentProject}
        />
      )}

      {currentTab === 'quality' && (
        <QualityCenter
          project={currentProject}
          onUpdateProject={handleUpdateCurrentProject}
          onOpenWorkbench={() => setCurrentTab('workbench')}
        />
      )}
      </main>

      {/* Presentation Fullscreen Mode */}
      {isPresenting && (
        <PresentationMode
          project={currentProject}
          onClose={() => setIsPresenting(false)}
        />
      )}

      {/* Multi-Format Export Modal */}
      <ExportModal
        project={currentProject}
        currentSlideIndex={0}
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
      />
    </div>
  );
}
