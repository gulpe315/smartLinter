/**
 * SmartLinter Translation Memory (TM) Match Panel Component
 *
 * Dedicated viewport for real-time TM Fuzzy Match suggestions calculated in <100ms.
 * Provides score badges, source/target diff views, one-click replacement dispatch,
 * and seamless fallback handling when no TM is loaded.
 */

import React, { useState } from 'react';
import {
  Database,
  Search,
  Zap,
  SlidersHorizontal,
  FolderOpen,
  Sparkles,
  CheckCircle2,
  Clock,
  Layers,
  AlertTriangle,
  RotateCw,
  X,
} from 'lucide-react';
import { useBridgeStore } from '../../stores/bridgeStore.ts';
import { useConfigStore } from '../../stores/configStore.ts';
import { useTmStore } from '../../stores/tmStore.ts';
import { TMMatchCard } from './TMMatchCard.tsx';
import { type TmMatchCandidate } from '../../types/tm.ts';

export interface TMMatchPanelProps {
  className?: string;
}

export const TMMatchPanel: React.FC<TMMatchPanelProps> = ({ className = '' }) => {
  const { tmLoaded, tmEntriesCount, tmFileName, activeParagraph } = useBridgeStore();
  const { tmEntries, openSettingsModal } = useConfigStore();
  const {
    candidates,
    isSearching,
    matchDurationMs,
    minScore,
    searchQuery,
    setMinScore,
    search,
    applyMatch,
  } = useTmStore();

  const [customSearchInput, setCustomSearchInput] = useState('');
  const [showSearchInput, setShowSearchInput] = useState(false);

  const currentParagraphText = activeParagraph?.text || '';
  const effectiveTmCount = tmEntriesCount || tmEntries.length;
  const isTmActuallyLoaded = tmLoaded || effectiveTmCount > 0;

  const handleScoreFilterChange = (score: number) => {
    setMinScore(score);
  };

  const handleCustomSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customSearchInput.trim()) {
      search(customSearchInput.trim());
    } else if (currentParagraphText) {
      search(currentParagraphText);
    }
  };

  const handleClearCustomSearch = () => {
    setCustomSearchInput('');
    setShowSearchInput(false);
    if (currentParagraphText) {
      search(currentParagraphText);
    }
  };

  const handleApply = async (candidate: TmMatchCandidate) => {
    await applyMatch(candidate);
  };

  return (
    <section
      data-testid="tm-match-panel"
      aria-label="번역 메모리 퍼지 매치 제안 패널"
      className={`flex-1 h-full flex flex-col overflow-hidden bg-slate-900/50 ${className}`}
    >
      {/* Header Bar */}
      <div className="flex-none px-4 py-2.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between gap-3">
        {/* Left: Title & Count */}
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-cyan-400" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
            번역 메모리 (TM 제안)
          </h2>
          <span
            data-testid="tm-entries-count-badge"
            className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800"
          >
            {effectiveTmCount.toLocaleString()}건
          </span>
        </div>

        {/* Center/Right: Speed Metric & Filter Controls */}
        <div className="flex items-center gap-2">
          {/* Latency Speed Indicator (<100ms) */}
          {matchDurationMs !== null && matchDurationMs > 0 && isTmActuallyLoaded && (
            <span
              data-testid="tm-speed-badge"
              className="hidden sm:inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-950/80 text-emerald-300 border border-emerald-800"
              title="TM Fuzzy Match 인메모리 연산 소요 시간"
            >
              <Zap className="w-2.5 h-2.5 text-emerald-400 fill-emerald-400" />
              <span>{matchDurationMs}ms</span>
            </span>
          )}

          {/* Similarity Filter Buttons (All, 85%+, 100%) */}
          <div
            data-testid="tm-score-filters"
            className="flex items-center rounded-md bg-slate-800/80 p-0.5 border border-slate-700/80 text-[11px] text-slate-400"
          >
            <button
              type="button"
              data-testid="filter-min-75"
              onClick={() => handleScoreFilterChange(0.75)}
              className={`px-2 py-0.5 rounded transition-colors ${
                minScore === 0.75
                  ? 'bg-cyan-600 text-white font-semibold shadow-sm'
                  : 'hover:text-slate-200'
              }`}
            >
              75%+
            </button>
            <button
              type="button"
              data-testid="filter-min-85"
              onClick={() => handleScoreFilterChange(0.85)}
              className={`px-2 py-0.5 rounded transition-colors ${
                minScore === 0.85
                  ? 'bg-cyan-600 text-white font-semibold shadow-sm'
                  : 'hover:text-slate-200'
              }`}
            >
              85%+
            </button>
            <button
              type="button"
              data-testid="filter-min-100"
              onClick={() => handleScoreFilterChange(1.0)}
              className={`px-2 py-0.5 rounded transition-colors ${
                minScore === 1.0
                  ? 'bg-cyan-600 text-white font-semibold shadow-sm'
                  : 'hover:text-slate-200'
              }`}
            >
              Exact
            </button>
          </div>

          {/* Search Toggle */}
          <button
            type="button"
            data-testid="tm-search-toggle-btn"
            onClick={() => setShowSearchInput(!showSearchInput)}
            aria-label="수동 검색 열기"
            className={`p-1.5 rounded-md border transition-colors ${
              showSearchInput
                ? 'bg-cyan-950 text-cyan-300 border-cyan-800'
                : 'text-slate-400 hover:text-slate-200 bg-slate-800/80 border-slate-700/80'
            }`}
          >
            <Search className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Optional Manual Search Bar */}
      {showSearchInput && (
        <form
          onSubmit={handleCustomSearchSubmit}
          data-testid="tm-custom-search-form"
          className="flex-none px-4 py-2 bg-slate-950/80 border-b border-slate-800 flex items-center gap-2"
        >
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              data-testid="tm-custom-search-input"
              value={customSearchInput}
              onChange={(e) => setCustomSearchInput(e.target.value)}
              placeholder="TM 직접 검색할 문장 또는 키워드 입력..."
              className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-sans"
            />
            {customSearchInput && (
              <button
                type="button"
                onClick={handleClearCustomSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            type="submit"
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-cyan-600 hover:bg-cyan-500 border border-cyan-500 transition-colors"
          >
            검색
          </button>
        </form>
      )}

      {/* Main Content Area */}
      <div
        data-testid="tm-panel-content"
        className="flex-1 overflow-y-auto p-4 space-y-3"
      >
        {!isTmActuallyLoaded ? (
          /* Empty / Unloaded TM State */
          <div
            data-testid="tm-unloaded-state"
            className="h-full flex flex-col items-center justify-center text-center p-6 border border-dashed border-slate-800/80 rounded-xl bg-slate-900/20"
          >
            <div className="w-12 h-12 rounded-2xl bg-cyan-950/50 border border-cyan-800/50 flex items-center justify-center text-cyan-400 mb-3 shadow-inner">
              <Database className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-slate-200 mb-1">
              번역 메모리(TM) 미로드
            </h3>
            <p className="text-xs text-slate-400 max-w-xs leading-relaxed mb-4">
              TMX 또는 JSON 번역 메모리 파일을 로드하면, 문단 작성 시 0.1초 내에 가장 유사한 번역 제안이 카드 형태로 표시됩니다.
            </p>
            <button
              type="button"
              data-testid="tm-load-open-settings-btn"
              onClick={openSettingsModal}
              className="px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-cyan-600 hover:bg-cyan-500 border border-cyan-500 transition-all flex items-center gap-1.5 shadow-sm shadow-cyan-950/50 cursor-pointer"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>TM 파일 로드하기</span>
            </button>
          </div>
        ) : !activeParagraph && !searchQuery ? (
          /* Waiting for paragraph input */
          <div
            data-testid="tm-waiting-paragraph-state"
            className="h-full flex flex-col items-center justify-center text-center p-6 border border-dashed border-slate-800/80 rounded-xl bg-slate-900/20"
          >
            <div className="w-10 h-10 rounded-xl bg-indigo-950/50 border border-indigo-800/50 flex items-center justify-center text-indigo-400 mb-2.5 shadow-inner">
              <Clock className="w-5 h-5" />
            </div>
            <h3 className="text-xs font-semibold text-slate-200 mb-1">
              에디터 문단 입력 대기 중
            </h3>
            <p className="text-[11px] text-slate-400 max-w-xs leading-relaxed">
              Word 또는 InDesign에서 문단을 편집하면 0.1초(100ms) 이내에 계산된 유사 매치 후보군이 자동으로 표시됩니다.
            </p>
          </div>
        ) : candidates.length === 0 ? (
          /* No match found */
          <div
            data-testid="tm-no-matches-state"
            className="h-full flex flex-col items-center justify-center text-center p-6 border border-dashed border-slate-800/60 rounded-xl bg-slate-900/20"
          >
            <div className="w-10 h-10 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center text-slate-500 mb-2.5">
              <Search className="w-5 h-5" />
            </div>
            <h3 className="text-xs font-semibold text-slate-300 mb-1">
              일치하는 TM 제안 없음
            </h3>
            <p className="text-[11px] text-slate-400 max-w-xs leading-relaxed mb-3">
              현재 기준({Math.round(minScore * 100)}% 이상)에 부합하는 번역 제안이 TM에 없습니다.
            </p>
            {minScore > 0.75 && (
              <button
                type="button"
                onClick={() => setMinScore(0.75)}
                className="text-[11px] text-cyan-400 hover:text-cyan-300 underline cursor-pointer"
              >
                기준을 75%로 완화하여 다시 검색
              </button>
            )}
          </div>
        ) : (
          /* Render Match Candidate Cards */
          <div
            data-testid="tm-match-candidates-list"
            className="space-y-3"
          >
            {candidates.map((cand, idx) => (
              <TMMatchCard
                key={`${cand.tuId || idx}-${cand.source}-${cand.scorePercent}`}
                candidate={cand}
                currentText={currentParagraphText || searchQuery}
                onApply={handleApply}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer Status Strip */}
      {isTmActuallyLoaded && (
        <div className="flex-none px-4 py-2 bg-slate-900/80 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
          <div className="flex items-center gap-1.5 truncate max-w-[220px]">
            <Database className="w-3 h-3 text-cyan-400 flex-none" />
            <span className="truncate text-slate-300">{tmFileName || '인메모리 TM 로드됨'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-slate-500">
              후보: <strong className="text-cyan-400">{candidates.length}</strong>건
            </span>
          </div>
        </div>
      )}
    </section>
  );
};
