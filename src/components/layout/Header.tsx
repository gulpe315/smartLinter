/**
 * SmartLinter Dashboard Header Component
 *
 * Displays native editor connection indicator (Word/InDesign),
 * LLM status (Ollama model & latency), TM/guidelines load badge,
 * layout switcher buttons, and triggers for settings & guideline panels.
 */

import React from 'react';
import {
  Sparkles,
  Database,
  BookOpen,
  Columns,
  Rows,
  Radio,
  AlertCircle,
  RefreshCw,
  Settings,
} from 'lucide-react';
import { useBridgeStore } from '../../stores/bridgeStore.ts';
import { useConfigStore } from '../../stores/configStore.ts';
import { useQaStore } from '../../stores/qaStore.ts';
import { PinToggleButton } from './PinToggleButton.tsx';
import { BatchProgressBar } from '../config/BatchProgressBar.tsx';
import { EditorConnectionControl } from './EditorConnectionControl.tsx';

export const Header: React.FC = () => {
  const {
    llmAlive,
    llmModel,
    llmLatency,
    tmLoaded,
    tmEntriesCount,
    guidelinesLoaded,
    guidelinesCount,
    splitMode,
    toggleSplitMode,
    layoutPreset,
    setLayoutPreset,
  } = useBridgeStore();

  const { openSettingsModal, openGuidelineViewer } = useConfigStore();
  const resetQaCards = useQaStore((state) => state.resetQaCards);

  return (
    <header className="flex-none bg-slate-900 border-b border-slate-800 text-slate-100 select-none shadow-md z-30">
      <div className="px-4 py-2.5 flex items-center justify-between gap-4">
        {/* Left: Brand Logo & Title */}
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/40 text-indigo-400 font-bold">
            <Radio className="w-4 h-4 text-indigo-400 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold tracking-tight text-slate-100 text-base">SmartLinter</span>
              <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-800/60">
                Dashboard
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-mono">
              AI Linter &amp; TQA Native Bridge
            </p>
          </div>
        </div>

        {/* Center: Realtime Status Badges (Interactive triggers) */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <EditorConnectionControl />

          {/* LLM Status Indicator (Click to open Settings) */}
          <button
            type="button"
            data-testid="llm-status-badge"
            onClick={openSettingsModal}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer hover:border-indigo-500 ${
              llmAlive
                ? 'bg-indigo-950/50 border-indigo-700/60 text-indigo-300'
                : 'bg-amber-950/40 border-amber-800/60 text-amber-300'
            }`}
            title={`LLM 설정 열기: ${llmModel || 'qwen2.5:7b'}`}
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span className="font-mono text-[11px]">
              {llmModel || 'qwen2.5:7b'}
            </span>
            {llmAlive ? (
              <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-indigo-900/60 text-indigo-200">
                {llmLatency ? `${llmLatency}ms` : 'Ready'}
              </span>
            ) : (
              <span className="text-[10px] font-mono text-amber-400 flex items-center gap-0.5">
                <AlertCircle className="w-2.5 h-2.5" /> Standby
              </span>
            )}
          </button>

          {/* TM Load Badge (Click to open TM Manager) */}
          <button
            type="button"
            data-testid="tm-status-badge"
            onClick={openGuidelineViewer}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer hover:border-cyan-500 ${
              tmLoaded
                ? 'bg-cyan-950/50 border-cyan-700/60 text-cyan-300'
                : 'bg-slate-800/70 border-slate-700 text-slate-400'
            }`}
            title={tmLoaded ? `TM 로드 완료 (${tmEntriesCount.toLocaleString()}개 엔트리) - 클릭하여 관리` : 'TM 미로드 - 클릭하여 로드'}
          >
            <Database className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-mono text-[11px]">
              {tmLoaded ? `TM: ${tmEntriesCount.toLocaleString()}건` : 'TM: 미로드'}
            </span>
          </button>

          {/* Guidelines Badge (Click to open Guidelines) */}
          <button
            type="button"
            data-testid="guidelines-status-badge"
            onClick={openGuidelineViewer}
            className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer hover:border-violet-500 ${
              guidelinesLoaded
                ? 'bg-violet-950/50 border-violet-700/60 text-violet-300'
                : 'bg-slate-800/70 border-slate-700 text-slate-400'
            }`}
            title={guidelinesLoaded ? `가이드라인 규칙 ${guidelinesCount}개 적용 중 - 클릭하여 검토` : '기본 규칙 적용 중 - 클릭하여 검토'}
          >
            <BookOpen className="w-3.5 h-3.5 text-violet-400" />
            <span className="font-mono text-[11px]">
              {guidelinesLoaded ? `.agents (${guidelinesCount})` : '.agents'}
            </span>
          </button>
        </div>

        {/* Right: Layout Switcher, Pin Toggle & Settings Action Controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="qa-reset-btn"
            onClick={resetQaCards}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800 hover:bg-rose-950/50 active:bg-rose-950 border border-slate-700 hover:border-rose-800 text-slate-300 hover:text-rose-200 text-xs font-medium transition-colors cursor-pointer"
            title="저장된 QA 카드와 처리 기록을 초기화하고 다시 스캔합니다"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span className="hidden lg:inline text-[11px]">상태 초기화</span>
          </button>

          {/* Always-on-top Pin Mode Toggle Button */}
          <PinToggleButton />

          <div
            aria-label="레이아웃 비율 프리셋"
            className="flex items-center rounded-md bg-slate-800/80 p-0.5 border border-slate-700/80 text-[11px] text-slate-400"
          >
            <button
              type="button"
              data-testid="layout-preset-qa-focus"
              onClick={() => setLayoutPreset('qa-focus')}
              className={layoutPreset === 'qa-focus' ? 'px-2 py-0.5 rounded transition-colors bg-indigo-600 text-white font-semibold shadow-sm' : 'px-2 py-0.5 rounded transition-colors hover:text-slate-200'}
            >
              QA 중심
            </button>
            <button
              type="button"
              data-testid="layout-preset-balanced"
              onClick={() => setLayoutPreset('balanced')}
              className={layoutPreset === 'balanced' ? 'px-2 py-0.5 rounded transition-colors bg-indigo-600 text-white font-semibold shadow-sm' : 'px-2 py-0.5 rounded transition-colors hover:text-slate-200'}
            >
              균등
            </button>
            <button
              type="button"
              data-testid="layout-preset-tm-focus"
              onClick={() => setLayoutPreset('tm-focus')}
              className={layoutPreset === 'tm-focus' ? 'px-2 py-0.5 rounded transition-colors bg-indigo-600 text-white font-semibold shadow-sm' : 'px-2 py-0.5 rounded transition-colors hover:text-slate-200'}
            >
              TM 중심
            </button>
          </div>

          {/* Layout Split Mode Switcher (Horizontal vs Vertical) */}
          <button
            type="button"
            data-testid="layout-switcher-btn"
            onClick={toggleSplitMode}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-700 text-slate-300 hover:text-slate-100 text-xs font-medium transition-colors cursor-pointer"
            title={`레이아웃 전환 (현재: ${splitMode === 'horizontal' ? '좌우 분할' : '상하 분할'})`}
          >
            {splitMode === 'horizontal' ? (
              <>
                <Columns className="w-3.5 h-3.5 text-indigo-400" />
                <span className="hidden md:inline text-[11px]">좌우 분할</span>
              </>
            ) : (
              <>
                <Rows className="w-3.5 h-3.5 text-indigo-400" />
                <span className="hidden md:inline text-[11px]">상하 분할</span>
              </>
            )}
          </button>

          {/* Settings Modal Button */}
          <button
            type="button"
            data-testid="header-settings-btn"
            onClick={openSettingsModal}
            className="flex items-center justify-center p-1.5 rounded-md bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-700 text-slate-300 hover:text-slate-100 transition-colors cursor-pointer"
            title="환경 설정 (Ollama 모델, 가이드라인, TM)"
          >
            <Settings className="w-3.5 h-3.5 text-slate-300" />
          </button>
        </div>
      </div>

      {/* Top Real-time Batch Progress Bar */}
      <BatchProgressBar />
    </header>
  );
};
