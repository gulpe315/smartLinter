/**
 * SmartLinter Dashboard StatusBar & Fixed Bottom AI Command Bar
 *
 * Provides prompt input for AI-driven corrections and contextual actions,
 * along with bridge status and hardware resource telemetry.
 */

import React, { useState } from 'react';
import {
  Send,
  Sparkles,
  CornerDownLeft,
  Cpu,
  Server,
  Zap,
  Terminal,
} from 'lucide-react';
import { useBridgeStore } from '../../stores/bridgeStore.ts';

export const StatusBar: React.FC = () => {
  const {
    commandInput,
    setCommandInput,
    isAiProcessing,
    setIsAiProcessing,
    activeParagraph,
    editorConnected,
    editorType,
    llmModel,
  } = useBridgeStore();

  const [inputLocal, setInputLocal] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputLocal.trim() || isAiProcessing) return;

    setCommandInput(inputLocal);
    setIsAiProcessing(true);

    // Mock processing delay for placeholder
    setTimeout(() => {
      setIsAiProcessing(false);
      setInputLocal('');
    }, 600);
  };

  const handleQuickCommand = (prompt: string) => {
    setInputLocal(prompt);
  };

  return (
    <footer
      data-testid="status-bar-container"
      className="flex-none bg-slate-900 border-t border-slate-800 text-slate-100 p-3 select-none z-20 shadow-lg"
    >
      {/* Quick Action Suggestion Chips */}
      <div className="flex items-center gap-1.5 mb-2 overflow-x-auto pb-1 text-[11px] font-mono">
        <span className="text-slate-500 flex items-center gap-1 text-[10px] uppercase font-bold mr-1">
          <Terminal className="w-3 h-3 text-indigo-400" /> 커맨드:
        </span>
        <button
          type="button"
          onClick={() => handleQuickCommand('공식 번역 가이드라인에 맞게 용어를 통일해줘')}
          className="px-2 py-0.5 rounded-full bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
        >
          ✨ 가이드라인 용어 통일
        </button>
        <button
          type="button"
          onClick={() => handleQuickCommand('피동형/번역투 문장을 자연스러운 능동형으로 다듬어줘')}
          className="px-2 py-0.5 rounded-full bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
        >
          ✍️ 번역투 피동문 개선
        </button>
        <button
          type="button"
          onClick={() => handleQuickCommand('선택 문단을 더 간결하고 명확한 기술문서 문체로 요약해줘')}
          className="px-2 py-0.5 rounded-full bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
        >
          ⚡ 문단 간결화
        </button>
      </div>

      {/* Main AI Command Input Row */}
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <div className="relative flex-1">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-indigo-400">
            <Sparkles className="w-4 h-4" />
          </div>
          <input
            type="text"
            data-testid="ai-command-input"
            value={inputLocal}
            onChange={(e) => setInputLocal(e.target.value)}
            disabled={isAiProcessing}
            placeholder={
              activeParagraph
                ? `현재 문단에 대한 AI 수정 지시를 입력하세요 (Enter로 전송)`
                : `AI 커맨드 입력 또는 수정 지시 (Word/InDesign 문단 선택 시 즉시 적용)`
            }
            className="w-full pl-9 pr-24 py-2 bg-slate-950/90 border border-slate-700/80 rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-all font-sans"
          />
          <div className="absolute inset-y-0 right-0 pr-2 flex items-center gap-1.5 text-[10px] font-mono text-slate-500">
            <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400">
              Enter
            </kbd>
          </div>
        </div>

        <button
          type="submit"
          data-testid="ai-command-submit-btn"
          disabled={!inputLocal.trim() || isAiProcessing}
          className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
        >
          {isAiProcessing ? (
            <span className="w-3.5 h-3.5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          ) : (
            <Send className="w-3.5 h-3.5" />
          )}
          <span className="hidden sm:inline">실행</span>
        </button>
      </form>

      {/* Bottom Telemetry & Metadata Strip */}
      <div className="mt-2 pt-1.5 border-t border-slate-800/60 flex items-center justify-between text-[10px] font-mono text-slate-500">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Server className="w-3 h-3 text-slate-400" />
            <span>Bridge: 127.0.0.1:49152</span>
          </span>
          <span className="hidden md:flex items-center gap-1">
            <Cpu className="w-3 h-3 text-slate-400" />
            <span>Engine: {llmModel || 'qwen2.5:7b'} (RTX 3050 VRAM 최적화)</span>
          </span>
        </div>

        <div className="flex items-center gap-2">
          {activeParagraph ? (
            <span className="text-indigo-400">
              활성 문단: {activeParagraph.text.length}자 ({activeParagraph.editorType})
            </span>
          ) : (
            <span>모니터링 대기</span>
          )}
        </div>
      </div>
    </footer>
  );
};
