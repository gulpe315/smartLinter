/**
 * SmartLinter Stale Notification Badge Component (Task 16)
 *
 * Displays a prominent yellow/amber notification badge on QA cards when a text
 * replacement is rejected due to concurrent editor typing (STALE_REJECTED).
 * Indicates immediate background single-paragraph rescan in progress.
 */

import React from 'react';
import { RotateCw } from 'lucide-react';

export interface StaleNotificationBadgeProps {
  /** Custom notification message, defaults to standard Korean prompt */
  message?: string;
  /** Whether the refresh spinner should be animated */
  isRefreshing?: boolean;
  /** Optional custom class name */
  className?: string;
  /** Optional click handler to cancel or dismiss */
  onCancel?: () => void;
}

export const STALE_DEFAULT_BADGE_MESSAGE =
  '문서가 방금 수정되었습니다. 최신 상태로 새로고침합니다 🔄';

export const StaleNotificationBadge: React.FC<StaleNotificationBadgeProps> = ({
  message = STALE_DEFAULT_BADGE_MESSAGE,
  isRefreshing = true,
  className = '',
}) => {
  return (
    <div
      data-testid="stale-notification-badge"
      role="status"
      aria-live="polite"
      className={`flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-medium shadow-sm shadow-amber-950/20 animate-in fade-in duration-200 ${className}`}
    >
      <RotateCw
        data-testid="stale-badge-spinner"
        className={`w-3.5 h-3.5 text-amber-400 flex-none ${
          isRefreshing ? 'animate-spin' : ''
        }`}
      />
      <span
        data-testid="stale-badge-text"
        className="leading-tight select-none font-sans"
      >
        {message}
      </span>
    </div>
  );
};
