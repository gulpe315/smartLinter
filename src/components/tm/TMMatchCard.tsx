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
  Pencil,
  Save,
  X,
  Database,
} from 'lucide-react';
import {
  type TmMatchCandidate,
  getGradeBadgeClasses,
} from '../../types/tm.ts';
import { InlineDiffViewer } from '../qa/InlineDiffViewer.tsx';
import { useBridgeStore } from '../../stores/bridgeStore.ts';
import { useConfigStore } from '../../stores/configStore.ts';
import { useTmStore } from '../../stores/tmStore.ts';

export interface TMMatchCardProps {
  candidate: TmMatchCandidate;
  currentText?: string;
  onApply?: (candidate: TmMatchCandidate, overrideTarget?: string) => void;
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

// A period only ends a sentence when it is followed by whitespace or the end
// of the paragraph.  This deliberately leaves decimals, file names, and
// abbreviations such as U.S.A. intact.
const sentenceCount = (text: string) => text.trim()
  .split(/[.!?\u2026](?=\s|$)|\n+/)
  .filter((segment) => segment.trim().length > 0)
  .length;

export const TMMatchCard: React.FC<TMMatchCardProps> = ({
  candidate,
  currentText = '',
  onApply,
  isApplying: propIsApplying,
  className = '',
}) => {
  const [copied, setCopied] = useState(false);
  const [showDiff, setShowDiff] = useState(true);
  const [editedSuggestion, setEditedSuggestion] = useState<string | null>(null);
  const [isEditingSuggestion, setIsEditingSuggestion] = useState(false);
  const [isTmSaved, setIsTmSaved] = useState(false);
  const tmCurrentParagraph = useTmStore((state) => state.currentParagraph);
  const searchMode = useTmStore((state) => state.searchMode);
  const searchQuery = useTmStore((state) => state.searchQuery);
  const activeParagraph = useBridgeStore((state) => state.activeParagraph);

  const isApplying = propIsApplying || candidate.status === 'applying';
  const isApplied = candidate.status === 'applied';
  const isFailed = candidate.status === 'failed';
  const canEdit = !isApplying && !isApplied;
  const effectiveTarget = editedSuggestion ?? candidate.target;
  const hasUsableTarget = effectiveTarget.trim().length > 0;
  const currentParagraphText = tmCurrentParagraph?.text || activeParagraph?.text || '';
  const hasCurrentParagraph = Boolean(currentParagraphText.trim());
  const isCurrentParagraphSearch = searchQuery.trim() === currentParagraphText.trim();
  const isSingleSentence = sentenceCount(currentParagraphText) === 1;
  const canSaveToTm = searchMode === 'fuzzy'
    && hasCurrentParagraph
    && isCurrentParagraphSearch
    && hasUsableTarget;
  const saveDisabledReason = searchMode !== 'fuzzy'
    ? 'TM 검색 결과는 문장 단위로 저장할 수 없습니다.'
    : !hasCurrentParagraph
      ? '현재 문단이 없어 TM에 저장할 수 없습니다.'
      : !isCurrentParagraphSearch
        ? '직접 검색한 결과는 현재 문단과 연결되지 않아 TM에 저장할 수 없습니다.'
      : !hasUsableTarget
        ? '빈 번역은 TM에 저장할 수 없습니다.'
        : undefined;

  const badgeStyle = getGradeBadgeClasses(candidate.grade, candidate.scorePercent);

  const handleCopyTarget = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(effectiveTarget);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (err) {
      console.warn('Failed to copy to clipboard:', err);
    }
  };

  const startEditingSuggestion = () => {
    if (!canEdit) return;
    setEditedSuggestion((previous) => previous ?? candidate.target);
    setIsEditingSuggestion(true);
  };

  const cancelEditingSuggestion = () => {
    setEditedSuggestion(null);
    setIsEditingSuggestion(false);
    setIsTmSaved(false);
  };

  const saveToTm = () => {
    if (!canSaveToTm) return;
    const config = useConfigStore.getState();
    const conflict = config.findUserTmConflict(currentParagraphText);
    const sameTarget = conflict?.target === effectiveTarget;
    const conflictWarning = conflict && !sameTarget
      ? `\n\n같은 원문으로 저장된 다른 TM 번역이 있습니다.\n기존 번역:\n${conflict.target}`
      : '';
    const multiSentenceWarning = !isSingleSentence
      ? '\n\n경고: 이 문단에는 여러 문장이 포함되어 있습니다. 문단 전체가 하나의 TM 항목으로 저장됩니다.'
      : '';
    if (!window.confirm(`다음 문장쌍을 TM에 저장하시겠습니까?\n\n원문:\n${currentParagraphText}\n\n번역:\n${effectiveTarget}${multiSentenceWarning}${conflictWarning}`)) return;
    const result = config.addUserTmEntry({
      source: currentParagraphText,
      target: effectiveTarget,
      targetLang: config.targetLang,
    }, Boolean(conflict && !sameTarget));
    if (result === 'added' || result === 'duplicate') setIsTmSaved(true);
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
            {editedSuggestion !== null && (
              <span data-testid="tm-edited-suggestion-label" className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-amber-300">
                수정된 제안
              </span>
            )}
          </div>
          {isEditingSuggestion ? (
            <textarea data-testid="tm-edit-target-textarea" value={effectiveTarget} onChange={(event) => { setEditedSuggestion(event.target.value); setIsTmSaved(false); }} disabled={!canEdit} aria-label="TM 번역 제안 편집" className="w-full min-h-20 resize-y rounded-md border border-cyan-800 bg-slate-950 px-2 py-1.5 text-xs font-medium leading-relaxed text-slate-100 outline-none focus:border-cyan-500 disabled:opacity-60" />
          ) : (
            <p data-testid="tm-card-target" className="text-xs font-medium text-slate-100 leading-relaxed break-words select-text">
              {candidate.matchMode === 'keyword' && editedSuggestion === null
                ? renderHighlightedText(effectiveTarget, candidate.matchedKeyword)
                : effectiveTarget}
            </p>
          )}
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
          {isEditingSuggestion ? (
            <><button type="button" data-testid="tm-edit-confirm-btn" onClick={() => setIsEditingSuggestion(false)} disabled={!hasUsableTarget || !canEdit} className="p-1.5 rounded-md text-emerald-300 hover:bg-emerald-950 disabled:opacity-50" title="편집 완료"><Save className="w-3.5 h-3.5" /></button><button type="button" data-testid="tm-edit-cancel-btn" onClick={cancelEditingSuggestion} disabled={!canEdit} className="p-1.5 rounded-md text-slate-400 hover:bg-slate-800 disabled:opacity-50" title="편집 취소"><X className="w-3.5 h-3.5" /></button></>
          ) : <button type="button" data-testid="tm-edit-target-btn" onClick={startEditingSuggestion} disabled={!canEdit} className="p-1.5 rounded-md text-slate-400 hover:text-cyan-300 hover:bg-slate-800 disabled:opacity-50" title="번역 제안 편집"><Pencil className="w-3.5 h-3.5" /></button>}
          <button type="button" data-testid="tm-save-btn" onClick={saveToTm} disabled={!canSaveToTm} title={isTmSaved ? 'TM에 저장됨' : saveDisabledReason || '현재 문단과 번역을 TM에 저장'} className="px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 text-violet-200 bg-violet-950/70 border border-violet-800 hover:bg-violet-900 disabled:opacity-50 disabled:cursor-not-allowed">
            {isTmSaved ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Database className="w-3.5 h-3.5" />}<span>{isTmSaved ? 'TM 저장됨' : 'TM 저장'}</span>
          </button>
          {/* [TM 적용] Button */}
          <button
            type="button"
            data-testid="tm-apply-btn"
            disabled={isApplying || isApplied || !hasUsableTarget}
            onClick={() => editedSuggestion !== null ? onApply?.(candidate, editedSuggestion) : onApply?.(candidate)}
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
