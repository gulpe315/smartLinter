/**
 * SmartLinter Dashboard Header Component
 *
 * Displays native editor connection indicator (Word/InDesign),
 * LLM status (Ollama model & latency), TM/guidelines load badge,
 * batch scan progress indicator, and layout switcher buttons.
 */

import React from 'react';
import {
  FileText,
  Layers,
  Sparkles,
  Database,
  BookOpen,
  Columns,
  Rows,
  Radio,
  CheckCircle2,
  AlertCircle,
  XCircle,
  RefreshCw,
} from 'lucide-react';
import { useBridgeStore } from '../../stores/bridgeStore.ts';

export const Header: React.FC = () => {
  const {
    editorConnected,
    editorType,
    activeDocument,
    llmAlive,
    llmModel,
    llmLatency,
    tmLoaded,
    tmEntriesCount,
    guidelinesLoaded,
    guidelinesCount,
    splitMode,
    toggleSplitMode,
    batchScanning,
    batchCurrent,
    batchTotal,
    batchPercent,
  } = useBridgeStore();

  return (
    <header className="flex-none bg-slate-900 border-b border-slate-800 text-slate-100 px-4 py-2.5 select-none shadow-md z-30">
      <div className="flex items-center justify-between gap-4">
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

        {/* Center: Realtime Status Badges */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Editor Connection Indicator */}
          <div
            data-testid="editor-status-badge"
            className={`flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
              editorConnected
                ? 'bg-emerald-950/50 border-emerald-700/60 text-emerald-300 shadow-sm shadow-emerald-950'
                : 'bg-slate-800/80 border-slate-700 text-slate-400'
            }`}
            title={activeDocument ? `활성 문서: ${activeDocument}` : '에디터 상태'}
          >
            {editorType === 'Word' ? (
              <span className="flex items-center justify-center w-4 h-4 rounded bg-blue-600 text-[10px] font-bold text-white leading-none">
                W
              </span>
            ) : editorType === 'InDesign' ? (
              <span className="flex items-center justify-center w-4 h-4 rounded bg-pink-700 text-[10px] font-bold text-white leading-none">
                Id
              </span>
            ) : (
              <FileText className="w-3.5 h-3.5 text-slate-400" />
            )}

            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  editorConnected
                    ? 'bg-emerald-400 animate-live-pulse'
                    : 'bg-slate-500'
                }`}
              />
              <span className="font-mono text-[11px]">
                {editorConnected
                  ? `${editorType || 'Editor'} 연결됨${activeDocument ? ` (${activeDocument})` : ''}`
                  : '에디터 대기 중'}
              </span>
            </div>
          </div>

          {/* LLM Status Indicator */}
          <div
            data-testid="llm-status-badge"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
              llmAlive
                ? 'bg-indigo-950/50 border-indigo-700/60 text-indigo-300'
                : 'bg-amber-950/40 border-amber-800/60 text-amber-300'
            }`}
            title={`LLM 상태: ${llmAlive ? '온라인' : '오프라인/대기'}`}
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
          </div>

          {/* TM Load Badge */}
          <div
            data-testid="tm-status-badge"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
              tmLoaded
                ? 'bg-cyan-950/50 border-cyan-700/60 text-cyan-300'
                : 'bg-slate-800/70 border-slate-700 text-slate-400'
            }`}
            title={tmLoaded ? `TM 로드 완료 (${tmEntriesCount.toLocaleString()}개 엔트리)` : 'TM 미로드 (단일 QA 모드)'}
          >
            <Database className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-mono text-[11px]">
              {tmLoaded ? `TM: ${tmEntriesCount.toLocaleString()}건` : 'TM: 미로드'}
            </span>
          </div>

          {/* Guidelines Badge */}
          <div
            data-testid="guidelines-status-badge"
            className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
              guidelinesLoaded
                ? 'bg-violet-950/50 border-violet-700/60 text-violet-300'
                : 'bg-slate-800/70 border-slate-700 text-slate-400'
            }`}
            title={guidelinesLoaded ? `가이드라인 규칙 ${guidelinesCount}개 적용 중` : '기본 규칙 적용 중'}
          >
            <BookOpen className="w-3.5 h-3.5 text-violet-400" />
            <span className="font-mono text-[11px]">
              {guidelinesLoaded ? `.agents (${guidelinesCount})` : '.agents'}
            </span>
          </div>
        </div>

        {/* Right: Layout Switcher & Action Controls */}
        <div className="flex items-center gap-2">
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
        </div>
      </div>

      {/* Optional Inline Batch Scan Progress (Visible when scanning) */}
      {batchScanning && (
        <div data-testid="batch-progress-container" className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs text-indigo-300 font-mono">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
            <span>대용량 문서 일괄 분석 중... ({batchCurrent} / {batchTotal} 문단)</span>
          </div>
          <div className="flex items-center gap-3 flex-1 max-w-xs">
            <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${batchPercent}%` }}
              />
            </div>
            <span className="text-[11px] font-mono text-slate-400">{batchPercent}%</span>
          </div>
        </div>
      )}
    </header>
  );
};
