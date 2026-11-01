/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  X,
  FileText,
  Clock,
  Crosshair,
  Grid,
  RotateCcw,
  Maximize2,
  Volume2,
} from 'lucide-react';
import { PresentationProject } from '@ppt/core';
import { SVGRenderer } from '@ppt/core';

interface PresentationModeProps {
  project: PresentationProject;
  initialSlideIndex?: number;
  onClose: () => void;
}

export const PresentationMode: React.FC<PresentationModeProps> = ({
  project,
  initialSlideIndex = 0,
  onClose,
}) => {
  const [currentIndex, setCurrentIndex] = useState(initialSlideIndex);
  const [showNotes, setShowNotes] = useState(false);
  const [showSlideDrawer, setShowSlideDrawer] = useState(false);
  const [isLaserPointerActive, setIsLaserPointerActive] = useState(false);
  const [mousePos, setMousePos] = useState({ x: -100, y: -100 });

  // Presentation Timer (seconds)
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(true);

  const total = project.slides.length;
  const currentSlide = project.slides[currentIndex];

  useEffect(() => {
    let interval: any;
    if (isTimerRunning) {
      interval = setInterval(() => {
        setElapsedSeconds((s) => s + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isTimerRunning]);

  const formatTimer = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remaining = secs % 60;
    return `${String(mins).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
  };

  const handlePrev = () => {
    setCurrentIndex((i) => Math.max(0, i - 1));
  };

  const handleNext = () => {
    setCurrentIndex((i) => Math.min(total - 1, i + 1));
  };

  // Keyboard Navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
        handleNext();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        handlePrev();
      } else if (e.key === 'Escape') {
        if (showSlideDrawer) {
          setShowSlideDrawer(false);
        } else if (showNotes) {
          setShowNotes(false);
        } else {
          onClose();
        }
      } else if (e.key === 'n' || e.key === 'N') {
        setShowNotes((prev) => !prev);
      } else if (e.key === 'l' || e.key === 'L') {
        setIsLaserPointerActive((prev) => !prev);
      } else if (e.key === 'g' || e.key === 'G') {
        setShowSlideDrawer((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [total, showSlideDrawer, showNotes]);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isLaserPointerActive) {
      setMousePos({ x: e.clientX, y: e.clientY });
    }
  };

  if (!currentSlide) return null;

  const svgContent = SVGRenderer.renderToString(currentSlide, project.template.theme);

  return (
    <div
      onMouseMove={handleMouseMove}
      className={`fixed inset-0 z-50 bg-black flex flex-col items-center justify-center select-none overflow-hidden ${
        isLaserPointerActive ? 'cursor-none' : 'cursor-default'
      }`}
    >
      {/* Laser Pointer Simulated Dot */}
      {isLaserPointerActive && (
        <div
          className="fixed pointer-events-none z-50 transform -translate-x-1/2 -translate-y-1/2"
          style={{ left: mousePos.x, top: mousePos.y }}
        >
          <div className="w-5 h-5 rounded-full bg-rose-500/80 shadow-[0_0_16px_4px_rgba(244,63,94,0.9)] animate-pulse" />
          <div className="w-2 h-2 rounded-full bg-white absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2" />
        </div>
      )}

      {/* Top Floating Info Bar (Timer, Title, Shortcuts hint) */}
      <div className="absolute top-4 left-6 right-6 flex items-center justify-between text-white/70 text-xs font-mono pointer-events-none z-40">
        <div className="flex items-center gap-3 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 pointer-events-auto">
          <Clock className="w-3.5 h-3.5 text-blue-400" />
          <span className="font-bold text-white tracking-widest">{formatTimer(elapsedSeconds)}</span>
          <button
            onClick={() => setElapsedSeconds(0)}
            className="text-white/40 hover:text-white transition-colors"
            title="重置计时"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        </div>

        <div className="bg-black/60 backdrop-blur-md px-4 py-1.5 rounded-full border border-white/10 font-sans text-xs font-semibold text-white truncate max-w-md">
          {currentSlide.title}
        </div>

        <div className="hidden sm:flex items-center gap-2 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 text-[11px] text-white/50">
          <span>[空格/箭头]翻页</span>
          <span>·</span>
          <span>[N]备注</span>
          <span>·</span>
          <span>[L]激光笔</span>
          <span>·</span>
          <span>[G]大纲</span>
          <span>·</span>
          <span>[Esc]退出</span>
        </div>
      </div>

      {/* Main 16:9 Slide Display */}
      <div className="w-full h-full max-w-[1920px] max-h-[1080px] aspect-[16/9] relative flex items-center justify-center p-4">
        <div
          className="w-full h-full pointer-events-none select-none flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:block"
          dangerouslySetInnerHTML={{
            __html: SVGRenderer.renderInlineSvg(currentSlide, project.template.theme),
          }}
        />
      </div>

      {/* Speaker Notes Overlay Drawer */}
      {showNotes && (
        <div className="absolute bottom-20 left-1/2 transform -translate-x-1/2 w-full max-w-2xl bg-slate-900/95 backdrop-blur-lg border border-slate-700/80 rounded-2xl p-5 shadow-2xl text-white z-40 animate-in fade-in slide-in-from-bottom-4 duration-200">
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-800">
            <div className="flex items-center gap-2 text-xs font-bold text-blue-400">
              <FileText className="w-4 h-4" />
              <span>本页演讲备忘录 (Speaker Notes)</span>
            </div>
            <button
              onClick={() => setShowNotes(false)}
              className="text-slate-400 hover:text-white text-xs"
            >
              关闭 [N]
            </button>
          </div>
          <div className="text-sm leading-relaxed text-slate-200 font-sans max-h-48 overflow-y-auto pr-2">
            {currentSlide.speakerNotes || (
              <span className="text-slate-500 italic">
                本页暂无专属备忘录。可点击工作台下方「演讲备忘录」补充演讲要点。
              </span>
            )}
          </div>
          {currentSlide.keyMessage && (
            <div className="mt-3 pt-2 border-t border-slate-800/80 text-xs text-amber-300/90 flex items-center gap-1.5">
              <span className="font-bold">核心观点传达：</span>
              <span>{currentSlide.keyMessage}</span>
            </div>
          )}
        </div>
      )}

      {/* Slide Thumbnails Jump Drawer */}
      {showSlideDrawer && (
        <div className="absolute inset-x-0 bottom-0 max-h-72 bg-slate-950/95 backdrop-blur-xl border-t border-slate-800 p-4 z-40 animate-in slide-in-from-bottom duration-200 flex flex-col">
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-800 text-xs text-slate-400">
            <span className="font-bold text-white flex items-center gap-2">
              <Grid className="w-4 h-4 text-blue-400" />
              <span>幻灯片快速跳转 (共 {total} 页)</span>
            </span>
            <button
              onClick={() => setShowSlideDrawer(false)}
              className="hover:text-white"
            >
              关闭 [G]
            </button>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin">
            {project.slides.map((s, idx) => {
              const thumbSvg = SVGRenderer.renderToString(s, project.template.theme);
              const isActive = idx === currentIndex;
              return (
                <div
                  key={s.slideId}
                  onClick={() => {
                    setCurrentIndex(idx);
                    setShowSlideDrawer(false);
                  }}
                  className={`shrink-0 w-44 flex flex-col rounded-lg border transition-all cursor-pointer p-1 ${
                    isActive
                      ? 'border-blue-500 ring-2 ring-blue-500/50 bg-blue-500/10'
                      : 'border-slate-800 hover:border-slate-700 bg-slate-900/60'
                  }`}
                >
                  <div
                    className="w-full aspect-[16/9] rounded overflow-hidden pointer-events-none mb-1 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:block"
                    dangerouslySetInnerHTML={{
                      __html: SVGRenderer.renderInlineSvg(s, project.template.theme),
                    }}
                  />
                  <div className="flex items-center justify-between text-[10px] px-1 text-slate-300">
                    <span className="font-mono font-bold">{idx + 1}</span>
                    <span className="truncate max-w-[120px]">{s.title}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Floating Bottom Nav Control Bar */}
      <div className="absolute bottom-6 flex items-center gap-3 px-4 py-2 bg-slate-900/85 hover:bg-slate-900 backdrop-blur-md rounded-full border border-slate-700/80 shadow-2xl text-white transition-opacity duration-200 opacity-70 hover:opacity-100 z-30">
        <button
          onClick={handlePrev}
          disabled={currentIndex === 0}
          className="p-1.5 rounded-full hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="上一页 (Left Arrow / PageUp)"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <span className="font-mono text-xs font-bold px-1 tracking-wider">
          {String(currentIndex + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
        </span>

        <button
          onClick={handleNext}
          disabled={currentIndex === total - 1}
          className="p-1.5 rounded-full hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="下一页 (Right Arrow / Space / PageDown)"
        >
          <ChevronRight className="w-5 h-5" />
        </button>

        <div className="w-px h-4 bg-slate-700" />

        {/* Toggle Speaker Notes */}
        <button
          onClick={() => setShowNotes(!showNotes)}
          className={`p-1.5 rounded-full transition-colors ${
            showNotes ? 'bg-blue-600 text-white' : 'hover:bg-slate-800 text-slate-300'
          }`}
          title="显示/隐藏演讲备忘录 [N]"
        >
          <FileText className="w-4 h-4" />
        </button>

        {/* Toggle Laser Pointer */}
        <button
          onClick={() => setIsLaserPointerActive(!isLaserPointerActive)}
          className={`p-1.5 rounded-full transition-colors ${
            isLaserPointerActive ? 'bg-rose-600 text-white shadow-[0_0_10px_rgba(244,63,94,0.6)]' : 'hover:bg-slate-800 text-slate-300'
          }`}
          title="激光笔模式 [L]"
        >
          <Crosshair className="w-4 h-4" />
        </button>

        {/* Toggle Slide Drawer */}
        <button
          onClick={() => setShowSlideDrawer(!showSlideDrawer)}
          className={`p-1.5 rounded-full transition-colors ${
            showSlideDrawer ? 'bg-blue-600 text-white' : 'hover:bg-slate-800 text-slate-300'
          }`}
          title="幻灯片抽屉 [G]"
        >
          <Grid className="w-4 h-4" />
        </button>

        <div className="w-px h-4 bg-slate-700" />

        {/* Exit Presentation */}
        <button
          onClick={onClose}
          className="p-1.5 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          title="退出全屏演示 (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
