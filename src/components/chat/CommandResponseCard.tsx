/**
 * SmartLinter AI Command Response Card Component
 *
 * Renders an Action-First conversational card presenting live In-Card Diff
 * between the target original paragraph and LLM revised text.
 * Exposes the prominent [즉시 반영 (Apply Immediately)] action button.
 */

import React, { useState } from 'react';
import {
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Clock,
  Cpu,
  RotateCcw,
  Copy,
  Check,
  X,
  Loader2,
  ArrowRight,
  FileText,
} from 'lucide-react';
import { type CommandCardData } from '../../types/chat.ts';
import { InlineDiffViewer } from '../qa/InlineDiffViewer.tsx';

export interface CommandResponseCardProps {
  card: CommandCardData;
  onApply?: (cardId: string) => void;
  onDismiss?: (cardId: string) => void;
  onRetry?: (cardId: string) => void;
  className?: string;
}

export const CommandResponseCard: React.FC<CommandResponseCardProps> = ({
  card,
  onApply,
  onDismiss,
  onRetry,
  className = '',
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!card.suggestedText) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(card.suggestedText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Ignore clipboard write failure in test/unsupported environments
    }
  };

  const isGenerating = card.status === 'generating';
  const isApplying = card.status === 'applying';
  const isApplied = card.status === 'applied';
  const isStaleRejected = card.status === 'stale_rejected';
  const isFailed = card.status === 'failed';
  const isReady = card.status === 'ready';

  return (
    <article
      data-testid={`command-response-card-${card.id}`}
      className={`relative rounded-xl bg-slate-900/95 border transition-all duration-300 shadow-lg p-4 overflow-hidden ${
        isApplied
          ? 'border-emerald-800/80 bg-slate-900/90 ring-1 ring-emerald-500/30'
          : isApplying
          ? 'border-indigo-600/80 ring-1 ring-indigo-500/40'
          : isStaleRejected
          ? 'border-amber-700/80 bg-amber-950/20'
          : isFailed
          ? 'border-rose-800/80 bg-rose-950/20'
          : 'border-slate-800 hover:border-slate-700/90 hover:shadow-indigo-950/20'
      } ${className}`}
    >
      {/* Top Header Bar */}
      <div className="flex items-start justify-between gap-3 mb-3">
        {/* Left: User Instruction & Model metadata */}
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              data-testid="card-prompt-badge"
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-950/90 text-indigo-300 border border-indigo-700/80 max-w-full truncate"
              title={card.prompt}
            >
              <Sparkles className="w-3 h-3 text-indigo-400 flex-shrink-0" />
              <span className="truncate">{card.prompt}</span>
            </span>

            {/* Model & Latency */}
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-400">
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800/80 border border-slate-700/70">
                <Cpu className="w-3 h-3 text-slate-400" />
                {card.model || 'qwen2.5:7b'}
              </span>
              {card.durationMs !== undefined && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800/80 border border-slate-700/70">
                  <Clock className="w-3 h-3 text-slate-400" />
                  {card.durationMs}ms
                </span>
              )}
            </div>
          </div>

          {/* Paragraph Context Meta */}
          <div className="flex items-center gap-2 text-[10px] font-mono text-slate-500 mt-0.5">
            <span className="flex items-center gap-1">
              <FileText className="w-3 h-3 text-slate-500" />
              ID: #{card.paragraphId ? card.paragraphId.slice(-6) : 'para'}
            </span>
            {card.originalText && card.suggestedText && (
              <span>
                길이: {card.originalText.length}자 → {card.suggestedText.length}자
              </span>
            )}
          </div>
        </div>

        {/* Right: Status Badge & Close */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Status Badge */}
          {isGenerating && (
            <span
              data-testid="card-status-generating"
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-950 text-indigo-300 border border-indigo-800 animate-pulse"
            >
              <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />
              생성 중...
            </span>
          )}

          {isReady && (
            <span
              data-testid="card-status-ready"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-cyan-950 text-cyan-300 border border-cyan-800"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
              반영 대기 (Diff Ready)
            </span>
          )}

          {isApplying && (
            <span
              data-testid="card-status-applying"
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-950 text-amber-300 border border-amber-800"
            >
              <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
              에디터 치환 중...
            </span>
          )}

          {isApplied && (
            <span
              data-testid="card-status-applied"
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-950 text-emerald-300 border border-emerald-800"
            >
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              즉시 반영 완료
            </span>
          )}

          {isStaleRejected && (
            <span
              data-testid="card-status-stale-rejected"
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-950 text-amber-300 border border-amber-800"
            >
              <AlertTriangle className="w-3 h-3 text-amber-400" />
              Stale 거부됨
            </span>
          )}

          {isFailed && (
            <span
              data-testid="card-status-failed"
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-950 text-rose-300 border border-rose-800"
            >
              <AlertCircle className="w-3 h-3 text-rose-400" />
              실패
            </span>
          )}

          {/* Dismiss button */}
          {onDismiss && (
            <button
              type="button"
              data-testid="dismiss-card-btn"
              onClick={() => onDismiss(card.id)}
              className="p-1 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800/80 transition-colors cursor-pointer"
              title="카드 닫기"
              aria-label="카드 닫기"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Card Body */}
      <div className="space-y-3">
        {/* Generating skeleton */}
        {isGenerating ? (
          <div className="p-4 rounded-lg bg-slate-950/80 border border-slate-800/80 space-y-2">
            <div className="flex items-center gap-2 text-xs text-indigo-400 font-mono">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Micro-Scoping Queue를 통해 문맥 기반 교정안을 생성 중입니다...</span>
            </div>
            <div className="h-2.5 bg-slate-800 rounded animate-pulse w-5/6" />
            <div className="h-2.5 bg-slate-800 rounded animate-pulse w-3/4" />
          </div>
        ) : (
          /* Action-First In-Card Diff Viewer */
          <div className="space-y-2">
            <InlineDiffViewer
              originalText={card.originalText}
              suggestedText={card.suggestedText}
              hunks={card.diffHunks}
              showLabels={true}
            />
          </div>
        )}

        {/* Error Alert Box */}
        {card.errorMessage && (
          <div
            data-testid="card-error-message"
            className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-800/60 text-rose-300 text-xs flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
            <span className="leading-relaxed">{card.errorMessage}</span>
          </div>
        )}
      </div>

      {/* Card Actions Footer */}
      <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2 flex-wrap">
        {/* Left: Secondary actions (Copy, Retry) */}
        <div className="flex items-center gap-2">
          {card.suggestedText && (
            <button
              type="button"
              data-testid="copy-suggested-btn"
              onClick={handleCopy}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-700 text-slate-300 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
              title="수정된 텍스트 클립보드 복사"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">복사 완료</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>텍스트 복사</span>
                </>
              )}
            </button>
          )}

          {(isFailed || isStaleRejected) && onRetry && (
            <button
              type="button"
              data-testid="retry-card-btn"
              onClick={() => onRetry(card.id)}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-700 text-slate-300 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>재시도</span>
            </button>
          )}
        </div>

        {/* Right: Primary Action Button [즉시 반영 (Action-First)] */}
        <div className="flex items-center gap-2 ml-auto">
          {isReady && onApply && (
            <button
              type="button"
              data-testid="apply-diff-btn"
              onClick={() => onApply(card.id)}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 active:from-indigo-700 active:to-indigo-600 text-white text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-indigo-950/40 hover:shadow-indigo-900/50 transition-all cursor-pointer transform hover:-translate-y-0.5"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-200" />
              <span>즉시 반영</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}

          {isApplying && (
            <button
              type="button"
              disabled
              className="px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 text-xs font-medium flex items-center gap-2 cursor-not-allowed opacity-80"
            >
              <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
              <span>에디터 치환 중...</span>
            </button>
          )}

          {isApplied && (
            <span className="text-xs text-emerald-400 flex items-center gap-1 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />
              에디터 문서에 무손실 치환됨
            </span>
          )}
        </div>
      </div>
    </article>
  );
};
