/**
 * SmartLinter TM Match Card Component
 *
 * Displays a single TM Fuzzy Match candidate with visual score badge
 * (100% Green, 85~99% Blue, 75~84% Yellow), source/target comparison,
 * and instant [TM 적용] one-click replacement action button.
 */

import React, { useState } from 'react';
import {
  Check,
  ArrowRight,
  Copy,
  CheckCheck,
  Loader2,
  AlertCircle,
  FileText,
  Languages,
  Sparkles,
  Zap,
  Search,
} from 'lucide-react';
import {
  type TmMatchCandidate,
  getGradeBadgeClasses,
} from '../../types/tm.ts';
import { InlineDiffViewer } from '../qa/InlineDiffViewer.tsx';

export interface TMMatchCardProps {
  candidate: TmMatchCandidate;
  currentText?: string;
  onApply?: (candidate: TmMatchCandidate) => void;
  isApplying?: boolean;
  className?: string;
}

const renderHighlightedText = (text: string, keyword?: string) => {
  if (!keyword) return text;
  const start = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (start < 0) return text;
  const end = start + keyword.length;
  return <>{text.slice(0, start)}<mark className="rounded bg-amber-300/25 px-0.5 text-inherit">{text.slice(start, end)}</mark>{text.slice(end)}</>;
};

export const TMMatchCard: React.FC<TMMatchCardProps> = ({
  candidate,
  currentText = '',
  onApply,
  isApplying: propIsApplying,
  className = '',
}) => {
  const [copied, setCopied] = useState(false);
  const [showDiff, setShowDiff] = useState(true);

  const isApplying = propIsApplying || candidate.status === 'applying';
  const isApplied = candidate.status === 'applied';
  const isFailed = candidate.status === 'failed';

  const badgeStyle = getGradeBadgeClasses(candidate.grade, candidate.scorePercent);

  const handleCopyTarget = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(candidate.target);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (err) {
      console.warn('Failed to copy to clipboard:', err);
    }
  };

  return (
    <article
      data-testid={`tm-match-card-${candidate.tuId || candidate.scorePercent}`}
      className={`group relative rounded-xl bg-slate-900/90 border border-slate-800 hover:border-slate-700/80 shadow-md p-4 transition-all duration-300 ease-out hover:shadow-cyan-950/20 hover:shadow-lg ${
        isApplying ? 'ring-1 ring-cyan-500/50 bg-slate-900' : ''
      } ${isApplied ? 'border-emerald-800/60 bg-emerald-950/10' : ''} ${
        isFailed ? 'border-rose-900/80 bg-rose-950/20' : ''
      } ${className}`}
    >
      {/* Top Header: Score Badge & Meta Details */}
      <div className="flex items-center justify-between gap-2 mb-3">
        {/* Left: Score Badge with Color Coding */}
        <div className="flex items-center gap-2">
          {candidate.matchMode === 'keyword' ? (
            <span data-testid="tm-keyword-badge" className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border bg-slate-800 text-slate-300 border-slate-600">
              <Search className="w-3 h-3" /> 키워드 일치
            </span>
          ) : <span
            data-testid="tm-score-badge"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border ${badgeStyle.bg} ${badgeStyle.text} ${badgeStyle.border}`}
          >
            <span className={`w-2 h-2 rounded-full ${badgeStyle.dotColor}`} />
            <span>{badgeStyle.label}</span>
          </span>}

          {/* Translation Unit ID */}
          {candidate.tuId && (
            <span className="text-[10px] font-mono text-slate-500 px-1.5 py-0.5 rounded bg-slate-950/60 border border-slate-800/60">
              TU #{candidate.tuId}
            </span>
          )}

          {/* Language Pair Tag */}
          {(candidate.sourceLang || candidate.targetLang) && (
            <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-mono text-slate-400 px-1.5 py-0.5 rounded bg-slate-950/40 border border-slate-800/40">
              <Languages className="w-2.5 h-2.5" />
              <span>
                {candidate.sourceLang || 'SRC'} → {candidate.targetLang || 'TGT'}
              </span>
            </span>
          )}
        </div>

        {/* Right: Copy & Quick Actions */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            data-testid="tm-copy-target-btn"
            onClick={handleCopyTarget}
            aria-label="타깃 번역 복사"
            className="p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            title="제안 번역 클립보드 복사"
          >
            {copied ? (
              <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Source (SRC) & Target (TGT) Comparison Box */}
      <div className="space-y-2 mb-3.5">
        {/* Source Text (SRC) */}
        <div className="rounded-lg bg-slate-950/70 p-2.5 border border-slate-800/80">
          <div className="flex items-center justify-between text-[10px] text-slate-500 font-semibold mb-1">
            <span className="flex items-center gap-1 uppercase tracking-wider">
              <FileText className="w-3 h-3 text-slate-500" /> TM 소스 원문 (SRC)
            </span>
          </div>
          <p
            data-testid="tm-card-source"
            className="text-xs text-slate-300 font-mono leading-relaxed break-words select-text"
          >
            {candidate.matchMode === 'keyword'
              ? renderHighlightedText(candidate.source, candidate.matchedKeyword)
              : candidate.source}
          </p>
        </div>

        {/* Source Diff vs Current Paragraph (if not 100% exact and current text exists) */}
        {candidate.matchMode !== 'keyword' && currentText &&
          currentText.trim() !== '' &&
          candidate.scorePercent < 99.9 &&
          currentText !== candidate.source && (
            <div className="rounded-lg bg-slate-950/50 p-2 border border-slate-800/60 text-xs">
              <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium mb-1">
                <span className="flex items-center gap-1 text-indigo-300">
                  <Sparkles className="w-3 h-3 text-indigo-400" /> 현재 텍스트 대비 차이점
                </span>
                <button
                  type="button"
                  onClick={() => setShowDiff(!showDiff)}
                  className="text-[10px] text-slate-500 hover:text-slate-300 underline cursor-pointer"
                >
                  {showDiff ? '접기' : '비교 보기'}
                </button>
              </div>
              {showDiff && (
                <InlineDiffViewer
                  originalText={currentText}
                  suggestedText={candidate.source}
                  showLabels={false}
                  className="p-1.5 bg-slate-950/90 text-[11px]"
                />
              )}
            </div>
          )}

        {/* Target Translation (TGT) */}
        <div className="rounded-lg bg-slate-950/90 p-3 border border-cyan-900/40 shadow-inner">
          <div className="flex items-center justify-between text-[10px] text-cyan-400 font-semibold mb-1">
            <span className="flex items-center gap-1 uppercase tracking-wider">
              <Zap className="w-3 h-3 text-cyan-400" /> TM 번역 제안 (TGT)
            </span>
          </div>
          <p
            data-testid="tm-card-target"
            className="text-xs font-medium text-slate-100 leading-relaxed break-words select-text"
          >
            {candidate.matchMode === 'keyword'
              ? renderHighlightedText(candidate.target, candidate.matchedKeyword)
              : candidate.target}
          </p>
        </div>
      </div>

      {/* Error Alert if Replacement Failed */}
      {isFailed && candidate.errorMessage && (
        <div
          data-testid="tm-card-error"
          className="mb-3 p-2.5 rounded-lg bg-rose-950/60 border border-rose-800/80 flex items-center gap-2 text-xs text-rose-300"
        >
          <AlertCircle className="w-4 h-4 text-rose-400 flex-none" />
          <span>{candidate.errorMessage}</span>
        </div>
      )}

      {/* Bottom Footer: [TM 적용] Action Button */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-800/60">
        <div className="text-[11px] font-mono text-slate-500 truncate max-w-[200px]">
          {candidate.matchMode === 'keyword' ? (
            <span className="text-slate-400">키워드 검색 결과 — 현재 문단에 적용</span>
          ) : candidate.scorePercent >= 99.9 ? (
            <span className="text-emerald-400 flex items-center gap-1 font-medium">
              <Check className="w-3 h-3" /> 완벽 일치 (100% Exact)
            </span>
          ) : (
            <span className="text-slate-400">
              일치율: <strong className="text-slate-200">{candidate.scorePercent}%</strong>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-none">
          {/* [TM 적용] Button */}
          <button
            type="button"
            data-testid="tm-apply-btn"
            disabled={isApplying || isApplied}
            onClick={() => onApply?.(candidate)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm ${
              isApplied
                ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-700/60 cursor-default'
                : 'text-white bg-cyan-600 hover:bg-cyan-500 active:bg-cyan-700 border border-cyan-500 shadow-cyan-950/50 disabled:opacity-60 disabled:cursor-not-allowed'
            }`}
          >
            {isApplying ? (
              <>
                <Loader2
                  data-testid="tm-apply-spinner"
                  className="w-3.5 h-3.5 animate-spin text-white"
                />
                <span>적용 중...</span>
              </>
            ) : isApplied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-300" />
                <span>적용됨</span>
              </>
            ) : (
              <>
                <Zap className="w-3.5 h-3.5" />
                <span>TM 적용</span>
              </>
            )}
          </button>
        </div>
      </div>
    </article>
  );
};
