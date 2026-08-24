/**
 * SmartLinter Bottom AI Command Bar Component
 *
 * Provides a fixed bottom natural language prompt input bar,
 * quick action suggestion chips, interactive response cards tray,
 * and Action-First instant editor modification triggers.
 */

import React, { useState } from 'react';
import {
  Send,
  Sparkles,
  Terminal,
  Cpu,
  Server,
  ChevronUp,
  ChevronDown,
  Trash2,
  Layers,
  MessageSquare,
  CornerDownLeft,
  CheckCircle2,
} from 'lucide-react';
import { useBridgeStore } from '../../stores/bridgeStore.ts';
import { useChatStore } from '../../stores/chatStore.ts';
import { CommandResponseCard } from './CommandResponseCard.tsx';

export interface AICommandBarProps {
  className?: string;
  showTelemetry?: boolean;
}

export const AICommandBar: React.FC<AICommandBarProps> = ({
  className = '',
  showTelemetry = true,
}) => {
  const {
    activeParagraph,
    editorConnected,
    llmModel,
    setCommandInput,
  } = useBridgeStore();

  const {
    cards,
    inputPrompt,
    setInputPrompt,
    isGenerating,
    isHistoryOpen,
    toggleHistory,
    setIsHistoryOpen,
    quickPrompts,
    submitCommand,
    applyCard,
    dismissCard,
    retryCard,
    clearCards,
  } = useChatStore();

  const [inputLocal, setInputLocal] = useState(inputPrompt || '');

  // Synchronize local input state when store changes
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputLocal(e.target.value);
    setInputPrompt(e.target.value);
    setCommandInput(e.target.value);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const promptToSubmit = inputLocal.trim() || inputPrompt.trim();
    if (!promptToSubmit || isGenerating) return;

    setInputLocal('');
    setInputPrompt('');
    setCommandInput(promptToSubmit);

    await submitCommand(promptToSubmit, activeParagraph);
  };

  const handleQuickChipClick = async (promptText: string) => {
    setInputLocal(promptText);
    setInputPrompt(promptText);
    setCommandInput(promptText);

    // If a paragraph is actively selected, immediately submit for seamless Action-First workflow
    if (activeParagraph && !isGenerating) {
      await submitCommand(promptText, activeParagraph);
    }
  };

  const activeCards = cards.filter((c) => c.status !== 'dismissed');

  return (
    <footer
      data-testid="status-bar-container"
      data-chat-testid="ai-command-bar"
      className={`flex-none bg-slate-900 border-t border-slate-800 text-slate-100 p-3 select-none z-20 shadow-2xl relative ${className}`}
    >
      {/* Expandable Conversational AI Response Cards Tray */}
      {activeCards.length > 0 && isHistoryOpen && (
        <div
          data-testid="ai-response-cards-tray"
          className="mb-3 max-h-[380px] overflow-y-auto space-y-3 rounded-xl bg-slate-950/90 border border-slate-800/90 p-3 shadow-inner scrollbar-thin scrollbar-thumb-slate-700"
        >
          {/* Tray Header */}
          <div className="flex items-center justify-between px-1 pb-2 border-b border-slate-800/80 text-xs font-semibold text-slate-300">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
              <span>AI 커맨드 교정 결과</span>
              <span className="px-1.5 py-0.2 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-800 text-[10px] font-mono">
                {activeCards.length}건
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                data-testid="clear-all-cards-btn"
                onClick={clearCards}
                className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-rose-300 transition-colors cursor-pointer px-2 py-0.5 rounded hover:bg-slate-800"
                title="모든 카드 지우기"
              >
                <Trash2 className="w-3 h-3" />
                <span>전체 삭제</span>
              </button>

              <button
                type="button"
                onClick={toggleHistory}
                className="text-[11px] text-slate-400 hover:text-slate-200 transition-colors cursor-pointer px-1.5 py-0.5 rounded hover:bg-slate-800"
                title="트레이 접기"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Cards List */}
          <div className="space-y-3 pt-1">
            {activeCards.map((card) => (
              <CommandResponseCard
                key={card.id}
                card={card}
                onApply={applyCard}
                onDismiss={dismissCard}
                onRetry={retryCard}
              />
            ))}
          </div>
        </div>
      )}

      {/* Quick Action Suggestion Chips Bar */}
      <div className="flex items-center gap-1.5 mb-2 overflow-x-auto pb-1 text-[11px] font-mono scrollbar-none">
        <span className="text-slate-500 flex items-center gap-1 text-[10px] uppercase font-bold mr-1 flex-shrink-0">
          <Terminal className="w-3 h-3 text-indigo-400" /> 커맨드:
        </span>

        {/* Standard Quick Prompt Chips from Plan */}
        <button
          type="button"
          onClick={() => handleQuickChipClick('공식 번역 가이드라인에 맞게 용어를 통일해줘')}
          className="px-2.5 py-1 rounded-full bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1 shadow-sm"
        >
          <span>✨ 가이드라인 용어 통일</span>
        </button>

        <button
          type="button"
          onClick={() => handleQuickChipClick('피동형/번역투 문장을 자연스러운 능동형으로 다듬어줘')}
          className="px-2.5 py-1 rounded-full bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1 shadow-sm"
        >
          <span>✍️ 번역투 피동문 개선</span>
        </button>

        <button
          type="button"
          onClick={() => handleQuickChipClick('선택 문단을 더 간결하고 명확한 기술문서 문체로 요약해줘')}
          className="px-2.5 py-1 rounded-full bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1 shadow-sm"
        >
          <span>⚡ 문단 간결화</span>
        </button>

        <button
          type="button"
          onClick={() => handleQuickChipClick('한글 맞춤법과 띄어쓰기 규칙에 맞게 교정해줘')}
          className="px-2.5 py-1 rounded-full bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1 shadow-sm"
        >
          <span>📝 맞춤법 교정</span>
        </button>

        <button
          type="button"
          onClick={() => handleQuickChipClick('외래어 및 기술 전문 용어를 표준 표기법에 맞춰 수정해줘')}
          className="px-2.5 py-1 rounded-full bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1 shadow-sm"
        >
          <span>🌐 외래어 표기</span>
        </button>
      </div>

      {/* Main AI Command Natural Language Input Row */}
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <div className="relative flex-1">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-indigo-400">
            <Sparkles className="w-4 h-4" />
          </div>
          <input
            type="text"
            data-testid="ai-command-input"
            value={inputLocal}
            onChange={handleInputChange}
            disabled={isGenerating}
            placeholder={
              activeParagraph
                ? `현재 문단에 대한 AI 수정 지시를 입력하세요 (Enter로 전송)`
                : `AI 커맨드 입력 또는 수정 지시 (Word/InDesign 문단 선택 시 즉시 적용)`
            }
            className="w-full pl-9 pr-24 py-2 bg-slate-950/90 border border-slate-700/80 rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-all font-sans disabled:opacity-60"
          />
          <div className="absolute inset-y-0 right-0 pr-2 flex items-center gap-1.5 text-[10px] font-mono text-slate-500">
            <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 flex items-center gap-0.5">
              <span>Enter</span>
              <CornerDownLeft className="w-2.5 h-2.5" />
            </kbd>
          </div>
        </div>

        <button
          type="submit"
          data-testid="ai-command-submit-btn"
          disabled={!inputLocal.trim() || isGenerating}
          className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer flex-shrink-0"
        >
          {isGenerating ? (
            <span className="w-3.5 h-3.5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          ) : (
            <Send className="w-3.5 h-3.5" />
          )}
          <span className="hidden sm:inline">실행</span>
        </button>

        {/* History Toggle Button if cards exist */}
        {activeCards.length > 0 && (
          <button
            type="button"
            data-testid="toggle-chat-history-btn"
            onClick={toggleHistory}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer flex-shrink-0"
            title={isHistoryOpen ? '응답 트레이 닫기' : '응답 트레이 열기'}
          >
            {isHistoryOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        )}
      </form>

      {/* Bottom Telemetry & Metadata Strip */}
      {showTelemetry && (
        <div className="mt-2 pt-1.5 border-t border-slate-800/60 flex items-center justify-between text-[10px] font-mono text-slate-500 flex-wrap gap-2">
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

          <div className="flex items-center gap-3">
            {activeCards.length > 0 && (
              <button
                type="button"
                onClick={toggleHistory}
                className="text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <MessageSquare className="w-3 h-3" />
                <span>
                  응답 {activeCards.length}건 {isHistoryOpen ? '(접기)' : '(펼치기)'}
                </span>
              </button>
            )}

            {activeParagraph ? (
              <span className="text-indigo-400">
                활성 문단: {activeParagraph.text.length}자 ({activeParagraph.editorType})
              </span>
            ) : (
              <span>모니터링 대기</span>
            )}
          </div>
        </div>
      )}
    </footer>
  );
};
