/**
 * SmartLinter Guideline & TM Control Viewer Component
 *
 * Provides drag-and-drop & file browser upload for .agents guideline files and TMX/JSON TM files,
 * rule summaries categorized by topic, severity badges, and TM entry count overviews.
 */

import React, { useState, useRef, useId } from 'react';
import {
  BookOpen,
  Database,
  Upload,
  FileText,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Search,
  Filter,
  Trash2,
  FileCode,
  Tag,
  Shield,
  X,
  Sparkles,
} from 'lucide-react';
import { useConfigStore } from '../../stores/configStore.ts';
import { useBridgeStore } from '../../stores/bridgeStore.ts';

export interface GuidelineViewerProps {
  isOpen?: boolean;
  onClose?: () => void;
  asModal?: boolean;
}

export const GuidelineViewer: React.FC<GuidelineViewerProps> = ({
  isOpen = true,
  onClose,
  asModal = false,
}) => {
  const {
    guidelines,
    guidelineFileName,
    isCustomGuideline,
    loadGuidelineFile,
    resetToDefaultGuidelines,
    tmEntries,
    tmFileName,
    loadTmFile,
    clearTm,
  } = useConfigStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [isDraggingGuideline, setIsDraggingGuideline] = useState(false);
  const [isDraggingTm, setIsDraggingTm] = useState(false);
  const [activeTab, setActiveTab] = useState<'guidelines' | 'tm'>('guidelines');

  const guidelineInputId = useId();
  const tmInputId = useId();

  const guidelineInputRef = useRef<HTMLInputElement>(null);
  const tmInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  // Categories extraction
  const categories = Array.from(
    new Set(guidelines.rules.map((r) => r.category))
  );

  // Filtered rules
  const filteredRules = guidelines.rules.filter((rule) => {
    const matchesCategory =
      selectedCategory === 'ALL' || rule.category === selectedCategory;
    const matchesSearch =
      !searchQuery ||
      rule.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rule.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (rule.example && rule.example.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  // Guideline Drag & Drop Handlers
  const handleGuidelineDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingGuideline(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      await loadGuidelineFile(file);
    }
  };

  const handleGuidelineFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      await loadGuidelineFile(file);
    }
  };

  // TM Drag & Drop Handlers
  const handleTmDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingTm(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      await loadTmFile(file);
    }
  };

  const handleTmFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      await loadTmFile(file);
    }
  };

  const content = (
    <div
      data-testid="guideline-viewer-root"
      className="flex flex-col h-full w-full bg-slate-900 text-slate-100 rounded-xl overflow-hidden shadow-2xl border border-slate-800"
    >
      {/* Header Bar */}
      <div className="flex-none px-5 py-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-400">
            <BookOpen className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              가이드라인 &amp; TM 제어 패널
              {isCustomGuideline ? (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-violet-950 text-violet-300 border border-violet-800">
                  사용자 정의 ({guidelineFileName})
                </span>
              ) : (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                  기본 내장 가이드라인
                </span>
              )}
            </h2>
            <p className="text-[11px] text-slate-400 font-sans">
              프로젝트 교정 가이드라인(.agents)과 번역 메모리(TMX/JSON)를 로드하고 규칙을 검토합니다.
            </p>
          </div>
        </div>

        {/* Tab Switcher & Close */}
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg bg-slate-900 p-1 border border-slate-800 text-xs">
            <button
              type="button"
              data-testid="tab-guidelines"
              onClick={() => setActiveTab('guidelines')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors cursor-pointer ${
                activeTab === 'guidelines'
                  ? 'bg-indigo-600 text-white font-medium shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>가이드라인 ({guidelines.rules.length}개)</span>
            </button>
            <button
              type="button"
              data-testid="tab-tm"
              onClick={() => setActiveTab('tm')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-colors cursor-pointer ${
                activeTab === 'tm'
                  ? 'bg-cyan-600 text-white font-medium shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              <span>번역 메모리 ({tmEntries.length}건)</span>
            </button>
          </div>

          {asModal && onClose && (
            <button
              type="button"
              data-testid="guideline-viewer-close-btn"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Main Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {activeTab === 'guidelines' ? (
          /* ================= GUIDELINES TAB ================= */
          <div className="space-y-4">
            {/* Upload Zone for .agents */}
            <div
              data-testid="guideline-dropzone"
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingGuideline(true);
              }}
              onDragLeave={() => setIsDraggingGuideline(false)}
              onDrop={handleGuidelineDrop}
              onClick={() => guidelineInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all duration-200 ${
                isDraggingGuideline
                  ? 'border-indigo-500 bg-indigo-950/40 shadow-inner'
                  : 'border-slate-700/80 bg-slate-950/40 hover:border-indigo-500/60 hover:bg-slate-950/60'
              }`}
            >
              <input
                ref={guidelineInputRef}
                id={guidelineInputId}
                type="file"
                accept=".agents,.md,.json,.txt"
                className="hidden"
                onChange={handleGuidelineFileSelect}
              />
              <div className="flex items-center justify-center gap-3">
                <div className="w-10 h-10 rounded-full bg-indigo-950/80 border border-indigo-800 flex items-center justify-center text-indigo-400">
                  <Upload className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <p className="text-xs font-semibold text-slate-200">
                    .agents / qa_rules.json 가이드라인 파일 드래그앤드롭 또는 파일 선택
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Markdown (.agents, .md) 또는 구조화된 JSON 규칙 파일을 자동 파싱하여 LLM 프롬프트에 주입합니다.
                  </p>
                </div>
              </div>
            </div>

            {/* Guideline Summary & Reset Actions */}
            <div className="flex items-center justify-between bg-slate-950/60 p-3 rounded-lg border border-slate-800">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-slate-200">
                  {guidelines.name}
                </span>
                <span className="text-[11px] font-mono text-slate-400">
                  총 {guidelines.rules.length}개 규칙 정의됨
                </span>
              </div>

              <div className="flex items-center gap-2">
                {isCustomGuideline && (
                  <button
                    type="button"
                    data-testid="reset-guidelines-btn"
                    onClick={resetToDefaultGuidelines}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3 text-indigo-400" />
                    <span>기본 가이드라인으로 복원</span>
                  </button>
                )}
              </div>
            </div>

            {/* Filter & Search Bar */}
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
                <input
                  type="text"
                  data-testid="guideline-search-input"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="규칙 설명, 카테고리, 예시 검색..."
                  className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Category Filter Chips */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
                <button
                  type="button"
                  data-testid="category-filter-all"
                  onClick={() => setSelectedCategory('ALL')}
                  className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                    selectedCategory === 'ALL'
                      ? 'bg-indigo-600 text-white font-medium'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  전체 ({guidelines.rules.length})
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    data-testid={`category-filter-${cat}`}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                      selectedCategory === cat
                        ? 'bg-indigo-600 text-white font-medium'
                        : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Rules List Cards */}
            <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
              {filteredRules.length > 0 ? (
                filteredRules.map((rule, idx) => (
                  <div
                    key={rule.id || `rule-${idx}`}
                    data-testid="guideline-rule-item"
                    className="p-3 bg-slate-950/70 border border-slate-800 rounded-lg space-y-1.5 hover:border-slate-700 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800">
                          {rule.category}
                        </span>
                        {rule.id && (
                          <span className="text-[10px] font-mono text-slate-500">
                            {rule.id}
                          </span>
                        )}
                      </div>

                      {rule.severity && (
                        <span
                          className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded uppercase ${
                            rule.severity === 'HIGH'
                              ? 'bg-rose-950 text-rose-300 border border-rose-800'
                              : rule.severity === 'MEDIUM'
                              ? 'bg-amber-950 text-amber-300 border border-amber-800'
                              : 'bg-slate-800 text-slate-300 border border-slate-700'
                          }`}
                        >
                          {rule.severity}
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-200 leading-relaxed font-sans">
                      {rule.description}
                    </p>

                    {rule.example && (
                      <p className="text-[11px] font-mono text-slate-400 bg-slate-900/90 p-1.5 rounded border border-slate-800/80">
                        {rule.example}
                      </p>
                    )}
                  </div>
                ))
              ) : (
                <div className="p-8 text-center border border-dashed border-slate-800 rounded-lg text-slate-400 text-xs">
                  조건에 일치하는 가이드라인 규칙이 없습니다.
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ================= TM (TRANSLATION MEMORY) TAB ================= */
          <div className="space-y-4">
            {/* Upload Zone for TMX / JSON TM */}
            <div
              data-testid="tm-dropzone"
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingTm(true);
              }}
              onDragLeave={() => setIsDraggingTm(false)}
              onDrop={handleTmDrop}
              onClick={() => tmInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all duration-200 ${
                isDraggingTm
                  ? 'border-cyan-500 bg-cyan-950/40 shadow-inner'
                  : 'border-slate-700/80 bg-slate-950/40 hover:border-cyan-500/60 hover:bg-slate-950/60'
              }`}
            >
              <input
                ref={tmInputRef}
                id={tmInputId}
                type="file"
                accept=".tmx,.xml,.json"
                className="hidden"
                onChange={handleTmFileSelect}
              />
              <div className="flex items-center justify-center gap-3">
                <div className="w-10 h-10 rounded-full bg-cyan-950/80 border border-cyan-800 flex items-center justify-center text-cyan-400">
                  <Upload className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <p className="text-xs font-semibold text-slate-200">
                    TMX XML / JSON 번역 메모리(TM) 파일 드래그앤드롭 또는 파일 선택
                  </p>
                  <p className="text-[11px] text-slate-400">
                    표준 TMX 1.4 또는 JSON TM을 초고속 인메모리 엔진에 로드하여 0.1초 퍼지 매칭을 제공합니다.
                  </p>
                </div>
              </div>
            </div>

            {/* TM Summary Bar */}
            <div className="flex items-center justify-between bg-slate-950/60 p-3 rounded-lg border border-slate-800">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-slate-200">
                  {tmFileName ? `로드된 TM: ${tmFileName}` : '로드된 TM 파일 없음'}
                </span>
                <span className="text-[11px] font-mono text-cyan-300">
                  {tmEntries.length.toLocaleString()}개 번역 단위(TU)
                </span>
              </div>

              {tmEntries.length > 0 && (
                <button
                  type="button"
                  data-testid="clear-tm-btn"
                  onClick={clearTm}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-950/70 hover:bg-rose-900 text-rose-300 text-xs transition-colors cursor-pointer border border-rose-800/60"
                >
                  <Trash2 className="w-3 h-3 text-rose-400" />
                  <span>TM 메모리 언로드</span>
                </button>
              )}
            </div>

            {/* TM Entries Preview */}
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {tmEntries.length > 0 ? (
                tmEntries.slice(0, 100).map((entry, idx) => (
                  <div
                    key={entry.id || `tm-entry-${idx}`}
                    data-testid="tm-entry-item"
                    className="p-3 bg-slate-950/70 border border-slate-800 rounded-lg space-y-1 text-xs font-mono"
                  >
                    <div className="text-slate-400 flex items-start gap-2">
                      <span className="text-[10px] text-slate-500 font-bold uppercase min-w-[28px]">
                        SRC:
                      </span>
                      <span className="text-slate-300 break-words flex-1">{entry.source}</span>
                    </div>
                    <div className="text-cyan-300 flex items-start gap-2 pt-1 border-t border-slate-800/60">
                      <span className="text-[10px] text-cyan-500 font-bold uppercase min-w-[28px]">
                        TGT:
                      </span>
                      <span className="text-slate-100 break-words flex-1">{entry.target}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-8 text-center border border-dashed border-slate-800 rounded-lg text-slate-400 text-xs">
                  번역 메모리 파일이 로드되지 않았습니다. TMX 또는 JSON 파일을 로드하세요.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (asModal) {
    return (
      <div
        data-testid="guideline-modal-backdrop"
        className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div
          className="w-full max-w-4xl max-h-[85vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {content}
        </div>
      </div>
    );
  }

  return content;
};
