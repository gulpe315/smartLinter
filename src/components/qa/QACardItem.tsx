/**
 * SmartLinter QA Card Item Component
 *
 * Displays a single detected QA violation card with category badge,
 * severity indicator, reason tooltip, inline diff viewer, and [Accept] / [Dismiss] actions.
 */

import React, { useState } from 'react';
import {
  Check,
  X,
  AlertCircle,
  AlertTriangle,
  Info,
  HelpCircle,
  Loader2,
  Sparkles,
  ArrowRight,
  Clock,
  MapPin,
  Lock,
  Pencil,
} from 'lucide-react';
import { type QACardData } from '../../types/qa.ts';
import { getBridgeService } from '../../services/tauriBridge.ts';
import {
  getCategoryBadgeClasses,
  getSeverityBadgeClasses,
  normalizeSeverity,
} from '../../types/qa.ts';
import { InlineDiffViewer } from './InlineDiffViewer.tsx';
import { StaleNotificationBadge } from './StaleNotificationBadge.tsx';
import { RollbackAlertCard } from './RollbackAlertCard.tsx';
import { useQaStore } from '../../stores/qaStore.ts';

export interface QACardItemProps {
  card: QACardData;
  onAccept?: (cardId: string) => void;
  onDismiss?: (cardId: string) => void;
  onMarkObsolete?: (cardId: string) => void;
  isApplying?: boolean;
  readOnly?: boolean;
  className?: string;
}

export const QACardItem: React.FC<QACardItemProps> = ({
  card,
  onAccept,
  onDismiss,
  onMarkObsolete,
  isApplying: propIsApplying,
  readOnly = false,
  className = '',
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [isEditingSuggestion, setIsEditingSuggestion] = useState(false);
  const [editedSuggestion, setEditedSuggestion] = useState(card.suggestedSegment);
  const updateSuggestedSegment = useQaStore((state) => state.updateSuggestedSegment);
  const isStale = card.status === 'stale_refreshing' || card.status === 'stale_rejected' || !!card.isStale;
  const isObsolete = card.status === 'stale_obsolete';
  const isApplying = propIsApplying || card.status === 'applying' || isStale;
  const isAcceptDisabled = isApplying || isObsolete || card.isLocked === true;
  const isEditUnavailable = readOnly || isApplying || isObsolete;
  const readOnlyStatus = card.status === 'applied'
    ? '적용됨'
    : card.status === 'dismissed'
    ? '무시됨'
    : card.status === 'stale_obsolete'
    ? '만료됨'
    : '기록됨';

  const categoryStyle = getCategoryBadgeClasses(card.category);
  const severityStyle = getSeverityBadgeClasses(card.severity);
  const normSeverity = normalizeSeverity(card.severity);

  const handleLocate = async () => {
    setIsLocating(true);
    setLocateError(null);
    try {
      const result = await getBridgeService().locateParagraph(card.paragraphId, card.paragraphHash);
      if (!result.found) {
        setLocateError(result.message || '문단을 찾을 수 없습니다. 문서가 변경되었을 수 있습니다.');
        onMarkObsolete?.(card.id);
      }
    } catch (_error) {
      setLocateError('문단을 찾을 수 없습니다. 문서가 변경되었을 수 있습니다.');
    } finally {
      setIsLocating(false);
    }
  };

  const startEditingSuggestion = () => {
    setEditedSuggestion(card.suggestedSegment);
    setIsEditingSuggestion(true);
  };

  const cancelEditingSuggestion = () => {
    setEditedSuggestion(card.suggestedSegment);
    setIsEditingSuggestion(false);
  };

  const saveEditedSuggestion = () => {
    if (!editedSuggestion.trim()) return;

    updateSuggestedSegment(card.id, editedSuggestion);
    setIsEditingSuggestion(false);
  };

  const renderSeverityIcon = () => {
    switch (normSeverity) {
      case 'HIGH':
        return <AlertCircle className="w-3.5 h-3.5 text-rose-400" />;
      case 'MEDIUM':
        return <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />;
      case 'INFO':
      case 'LOW':
      default:
        return <Info className="w-3.5 h-3.5 text-blue-400" />;
    }
  };

  return (
    <article
      data-testid={`qa-card-item-${card.id}`}
      className={`group relative rounded-xl bg-slate-900/90 border border-slate-800 hover:border-slate-700/80 shadow-md p-4 transition-all duration-300 ease-out hover:shadow-indigo-950/20 hover:shadow-lg ${
        isObsolete ? 'ring-1 ring-slate-500/60 border-slate-500/60 bg-slate-950/90 opacity-85' : isStale ? 'ring-1 ring-amber-500/50 border-amber-500/40 bg-slate-900' : card.status === 'applying' ? 'ring-1 ring-indigo-500/50 bg-slate-900' : ''
      } ${
        card.status === 'failed' ? 'border-rose-900/80 bg-rose-950/20' : ''
      } ${className}`}
    >
      {/* Stale Document Modified Notification Badge (Task 16 UX) */}
      {isStale && (
        <div className="mb-3">
          <StaleNotificationBadge message={card.staleMessage} />
        </div>
      )}

      {isObsolete && (
        <div data-testid="qa-card-obsolete-notice" role="status" className="mb-3 px-3 py-2 rounded-lg border border-slate-600/70 bg-slate-800/70 text-xs text-slate-300">
          이 문단은 더 이상 찾을 수 없습니다. 문서가 변경되었을 수 있습니다.
        </div>
      )}

      {/* Top Header: Category, Severity, and Reason Tooltip */}
      <div className="flex items-center justify-between gap-2 mb-3">
        {/* Left: Badges */}
        <div className="flex items-center flex-wrap gap-1.5">
          {/* Category Tag */}
          <span
            data-testid="category-badge"
            className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border ${categoryStyle.bg} ${categoryStyle.text} ${categoryStyle.border}`}
          >
            {card.category}
          </span>

          {/* Severity Tag */}
          <span
            data-testid="severity-badge"
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${severityStyle.bg} ${severityStyle.text} ${severityStyle.border}`}
          >
            {renderSeverityIcon()}
            <span>{severityStyle.label}</span>
          </span>

          {/* Paragraph ID / Time context */}
          {card.paragraphId && (
            <span className="text-[10px] font-mono text-slate-500 hidden sm:inline-block px-1.5 py-0.5 rounded bg-slate-950/60 border border-slate-800/60">
              #{card.paragraphId.slice(-6)}
            </span>
          )}

          {card.isLocked && (
            <span
              data-testid="qa-card-locked-badge"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border border-amber-700/70 bg-amber-950/50 text-amber-200"
              title="잠긴 프레임 또는 레이어입니다"
            >
              <Lock className="w-3 h-3" />
              <span>잠김</span>
            </span>
          )}
        </div>

        {/* Right: Interactive Reason Tooltip Trigger & Dismiss Button */}
        <div className="flex items-center gap-1.5 relative">
          <div
            className="relative"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
          >
            <button
              type="button"
              data-testid="reason-tooltip-trigger"
              onClick={() => setShowTooltip(!showTooltip)}
              aria-label="위반 사유 상세 보기"
              className="p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              title={card.reason}
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </button>

            {/* Hover Tooltip Popover */}
            {showTooltip && (
              <div
                data-testid="reason-tooltip-content"
                className="absolute right-0 top-6 z-30 w-72 p-3 rounded-lg bg-slate-950 border border-slate-700 shadow-xl text-xs text-slate-200 animate-in fade-in zoom-in-95 duration-150"
              >
                <div className="flex items-center gap-1.5 font-semibold text-indigo-300 mb-1 text-[11px]">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                  <span>AI 위반 사유 분석</span>
                </div>
                <p className="text-[11px] leading-relaxed text-slate-300 font-sans">
                  {card.reason}
                </p>
              </div>
            )}
          </div>

          {/* Dismiss (무시) Header Action */}
          {!readOnly && <button
            type="button"
            data-testid="dismiss-qa-btn"
            disabled={isApplying}
            onClick={() => onDismiss?.(card.id)}
            aria-label="이 제안 무시"
            className="p-1 rounded-md text-slate-400 hover:text-rose-300 hover:bg-rose-950/40 border border-transparent hover:border-rose-900/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="제안 무시"
          >
            <X className="w-3.5 h-3.5" />
          </button>}
        </div>
      </div>

      {/* Violation Reason Bar */}
      <div className="mb-3 px-3 py-2 rounded-lg bg-slate-950/60 border border-slate-800/80 flex items-start gap-2">
        <Info className="w-3.5 h-3.5 text-indigo-400 mt-0.5 flex-none" />
        <p
          data-testid="qa-card-reason"
          className="text-xs text-slate-300 leading-relaxed font-sans"
        >
          {card.reason}
        </p>
      </div>

      {/* Inline Diff Viewer (Core Visualizer) */}
      <div className="mb-3.5">
        <InlineDiffViewer
          originalText={card.originalSegment}
          suggestedText={card.suggestedSegment}
          showLabels={true}
        />
        {!isEditUnavailable && (
          <div className="mt-2 flex items-center justify-end gap-2">
            {isEditingSuggestion ? (
              <>
                <label className="sr-only" htmlFor={`qa-suggestion-editor-${card.id}`}>제안문 수정</label>
                <textarea
                  id={`qa-suggestion-editor-${card.id}`}
                  data-testid="qa-suggestion-editor"
                  value={editedSuggestion}
                  onChange={(event) => setEditedSuggestion(event.target.value)}
                  rows={3}
                  className="w-full resize-y rounded-lg border border-emerald-800/70 bg-slate-950 px-2.5 py-2 text-xs text-slate-100 outline-none focus:border-emerald-500"
                />
                <button type="button" data-testid="qa-suggestion-cancel-btn" onClick={cancelEditingSuggestion} className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-slate-800 border border-slate-700">취소</button>
                <button
                  type="button"
                  data-testid="qa-suggestion-save-btn"
                  disabled={!editedSuggestion.trim()}
                  onClick={saveEditedSuggestion}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-emerald-100 bg-emerald-700 hover:bg-emerald-600 border border-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >저장</button>
              </>
            ) : (
              <button type="button" data-testid="qa-edit-suggestion-btn" onClick={startEditingSuggestion} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-emerald-300 hover:text-emerald-100 hover:bg-emerald-950/40 rounded-md">
                <Pencil className="w-3 h-3" />
                수정
              </button>
            )}
          </div>
        )}
      </div>

      {/* Rollback Alert & Fallback Card (Task 17 UX) */}
      {(card.rollbackStatus || card.status === 'failed' || card.status === 'rollback_aborted' || card.status === 'rolled_back') && (
        <div data-testid={card.status === 'failed' ? 'qa-card-error-alert' : undefined} className="mb-3">
          <RollbackAlertCard
            status={
              card.rollbackStatus ||
              (card.status === 'rollback_aborted'
                ? 'ROLLBACK_ABORTED'
                : card.status === 'rolled_back'
                ? 'ROLLED_BACK'
                : 'FAILED')
            }
            message={card.rollbackMessage}
            technicalMessage={card.errorMessage}
            suggestedText={card.suggestedSegment}
            originalText={card.originalSegment}
          />
        </div>
      )}

      {locateError && (
        <div data-testid="qa-locate-error" role="alert" className="mb-3 px-3 py-2 rounded-lg border border-amber-800/70 bg-amber-950/30 text-xs text-amber-200">
          {locateError}
        </div>
      )}

      {/* Bottom Action Footer */}
      <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-800/60">
        <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono truncate">
          <span className="text-slate-500 font-bold">원문:</span>
          <span className="truncate max-w-[160px] text-slate-300">{card.originalSegment}</span>
          <ArrowRight className="w-3 h-3 text-slate-500 flex-none" />
          <span className="truncate max-w-[160px] text-emerald-400 font-medium">{card.suggestedSegment}</span>
        </div>

        {readOnly ? (
          <span data-testid="qa-card-readonly-status" className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-emerald-300 bg-emerald-950/40 border border-emerald-800/60">
            <Check className="w-3 h-3" />
            {readOnlyStatus}
          </span>
        ) : (
        <div className="flex items-center gap-2 flex-none">
          <button
            type="button"
            data-testid="qa-locate-paragraph-btn"
            disabled={isLocating || !card.paragraphId}
            onClick={() => void handleLocate()}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-sky-300 hover:text-sky-100 bg-sky-950/40 hover:bg-sky-900/50 border border-sky-800/70 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            title="문단 위치 보기"
          >
            {isLocating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MapPin className="w-3.5 h-3.5" />}
            <span>위치 보기</span>
          </button>
          {/* Dismiss (무시) Action Button */}
          <button
            type="button"
            data-testid="qa-dismiss-action-btn"
            disabled={isApplying}
            onClick={() => onDismiss?.(card.id)}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
          >
            <X className="w-3.5 h-3.5" />
            <span>무시</span>
          </button>

          {/* Accept (적용) Action Button with Loading Spinner */}
          <button
            type="button"
            data-testid="qa-accept-action-btn"
            disabled={isAcceptDisabled}
            onClick={() => onAccept?.(card.id)}
            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 border border-indigo-500 shadow-sm shadow-indigo-950/50 transition-all flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            title={card.isLocked ? '잠긴 프레임 또는 레이어입니다' : undefined}
          >
            {card.isLocked ? (
              <>
                <Lock className="w-3.5 h-3.5 text-amber-200" />
                <span className="text-amber-100">잠겨 있음</span>
              </>
            ) : isObsolete ? (
              <>
                <AlertCircle className="w-3.5 h-3.5 text-slate-300" />
                <span>적용할 수 없음</span>
              </>
            ) : isStale ? (
              <>
                <Loader2
                  data-testid="accept-spinner"
                  className="w-3.5 h-3.5 animate-spin text-amber-200"
                />
                <span className="text-amber-200">새로고침 중...</span>
              </>
            ) : isApplying ? (
              <>
                <Loader2
                  data-testid="accept-spinner"
                  className="w-3.5 h-3.5 animate-spin text-white"
                />
                <span>적용 중...</span>
              </>
            ) : (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>적용</span>
              </>
            )}
          </button>
        </div>
        )}
      </div>
    </article>
  );
};
