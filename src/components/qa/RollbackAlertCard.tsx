/**
 * SmartLinter Rollback Alert & Fallback UX Card Component (Task 17)
 *
 * Displays a friendly fallback alert when automatic text replacement fails
 * due to formatting complexity (FAILED) or when pre-rollback hash checks
 * detect concurrent user typing (ROLLBACK_ABORTED).
 *
 * Follows the visual design pattern of Task 16's StaleNotificationBadge,
 * using distinct color palettes:
 * - FAILED: Red-toned warning card + Clipboard Copy button
 * - ROLLBACK_ABORTED: Blue/Slate-toned notification message
 * - ROLLED_BACK: Amber/Slate-toned reassurance message
 */

import React from 'react';
import { AlertTriangle, AlertCircle, RotateCcw, ShieldAlert, Info } from 'lucide-react';
import { ClipboardCopyButton } from '../common/ClipboardCopyButton.tsx';

export type RollbackAlertStatus =
  | 'FAILED'
  | 'ROLLBACK_ABORTED'
  | 'ROLLED_BACK'
  | 'failed'
  | 'rollback_aborted'
  | 'rolled_back';

export interface RollbackAlertCardProps {
  /** The outcome status of the replacement or rollback operation */
  status: RollbackAlertStatus | string;
  /** Custom notification or error message */
  message?: string;
  /** Suggested replacement text for one-click clipboard copying */
  suggestedText?: string;
  /** Original text segment (optional context) */
  originalText?: string;
  /** Optional custom CSS class */
  className?: string;
  /** Whether to show the clipboard copy button (defaults to true for FAILED with suggestedText) */
  showCopyButton?: boolean;
  /** Optional retry handler */
  onRetry?: () => void;
  /** Optional dismiss handler */
  onDismiss?: () => void;
  /** Optional copy callback */
  onCopy?: (copiedText: string) => void;
}

export const FAILED_DEFAULT_ALERT_MESSAGE =
  '⚠️ 서식이 복잡하여 자동 교체에 실패했습니다. 수동으로 확인해 주세요.';

export const ROLLBACK_ABORTED_DEFAULT_ALERT_MESSAGE =
  '사용자 편집이 감지되어 자동 롤백을 안전하게 건너뛰었습니다. 🔄';

export const ROLLED_BACK_DEFAULT_ALERT_MESSAGE =
  '치환 중 오류가 발생하여 변경 전 원본 상태로 안전하게 복원되었습니다.';

export const RollbackAlertCard: React.FC<RollbackAlertCardProps> = ({
  status,
  message,
  suggestedText,
  originalText: _originalText,
  className = '',
  showCopyButton,
  onRetry,
  onDismiss,
  onCopy,
}) => {
  const normStatus = (status || '').toUpperCase();
  const isFailed = normStatus === 'FAILED';
  const isRollbackAborted = normStatus === 'ROLLBACK_ABORTED';
  const isRolledBack = normStatus === 'ROLLED_BACK';

  // Determine display message
  const displayMessage =
    message ||
    (isFailed
      ? FAILED_DEFAULT_ALERT_MESSAGE
      : isRollbackAborted
      ? ROLLBACK_ABORTED_DEFAULT_ALERT_MESSAGE
      : isRolledBack
      ? ROLLED_BACK_DEFAULT_ALERT_MESSAGE
      : FAILED_DEFAULT_ALERT_MESSAGE);

  // Determine whether copy button should be shown
  const shouldShowCopy =
    showCopyButton !== undefined
      ? showCopyButton
      : isFailed && Boolean(suggestedText);

  // Styles configuration based on status
  const getContainerStyles = () => {
    if (isFailed) {
      return 'bg-rose-500/15 border-rose-500/40 text-rose-300 shadow-rose-950/20';
    }
    if (isRollbackAborted) {
      return 'bg-sky-500/15 border-sky-500/40 text-sky-300 shadow-sky-950/20';
    }
    if (isRolledBack) {
      return 'bg-amber-500/15 border-amber-500/40 text-amber-300 shadow-amber-950/20';
    }
    return 'bg-slate-800/90 border-slate-700 text-slate-300 shadow-slate-950/20';
  };

  const renderIcon = () => {
    if (isFailed) {
      return (
        <AlertTriangle
          data-testid="rollback-alert-icon-failed"
          className="w-4 h-4 text-rose-400 flex-none mt-0.5"
        />
      );
    }
    if (isRollbackAborted) {
      return (
        <ShieldAlert
          data-testid="rollback-alert-icon-aborted"
          className="w-4 h-4 text-sky-400 flex-none mt-0.5"
        />
      );
    }
    if (isRolledBack) {
      return (
        <RotateCcw
          data-testid="rollback-alert-icon-rolled-back"
          className="w-4 h-4 text-amber-400 flex-none mt-0.5"
        />
      );
    }
    return (
      <Info
        data-testid="rollback-alert-icon-default"
        className="w-4 h-4 text-slate-400 flex-none mt-0.5"
      />
    );
  };

  return (
    <div
      data-testid="rollback-alert-card"
      role="alert"
      aria-live="polite"
      className={`flex flex-col gap-2.5 p-3 rounded-lg border shadow-sm animate-in fade-in duration-200 font-sans ${getContainerStyles()} ${className}`}
    >
      {/* Header / Message Row */}
      <div className="flex items-start gap-2.5 justify-between">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          {renderIcon()}
          <div className="flex-1 min-w-0">
            <span
              data-testid="rollback-alert-message"
              className="text-xs font-medium leading-relaxed block break-words"
            >
              {displayMessage}
            </span>
          </div>
        </div>
      </div>

      {/* Action Footer: Copy Suggested Text / Retry / Dismiss */}
      {(shouldShowCopy || onRetry || onDismiss) && (
        <div
          data-testid="rollback-alert-actions"
          className="flex items-center flex-wrap gap-2 pt-1 border-t border-current/10"
        >
          {shouldShowCopy && suggestedText && (
            <ClipboardCopyButton
              text={suggestedText}
              label="수정 텍스트 클립보드 복사"
              copiedLabel="복사 완료! ✓"
              variant={isFailed ? 'danger' : 'secondary'}
              size="xs"
              onCopy={onCopy}
              className="flex-none"
            />
          )}

          {onRetry && (
            <button
              type="button"
              data-testid="rollback-alert-retry-btn"
              onClick={onRetry}
              className="px-2 py-1 text-[11px] font-medium rounded-lg bg-slate-800/90 text-slate-200 hover:bg-slate-750 border border-slate-700 transition-colors cursor-pointer"
            >
              다시 시도
            </button>
          )}

          {onDismiss && (
            <button
              type="button"
              data-testid="rollback-alert-dismiss-btn"
              onClick={onDismiss}
              className="px-2 py-1 text-[11px] font-medium rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
            >
              닫기
            </button>
          )}
        </div>
      )}
    </div>
  );
};
