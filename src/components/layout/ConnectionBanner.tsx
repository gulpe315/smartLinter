/**
 * SmartLinter Connection Reconnect Banner Component
 *
 * Displays a high-visibility yellow/amber alert banner across the top of the Situation Board
 * when network or editor bridge connection is dropped and exponential backoff auto-reconnect
 * is underway.
 */

import React from 'react';
import { RefreshCw, AlertTriangle, ArrowRight } from 'lucide-react';
import { useBridgeStore } from '../../stores/bridgeStore.ts';
import { getBridgeService } from '../../services/tauriBridge.ts';

export interface ConnectionBannerProps {
  /** Optional override for reconnecting state (useful for direct testing) */
  isReconnecting?: boolean;
  /** Optional override for current retry attempt index */
  attempt?: number;
  /** Optional override for next retry delay in milliseconds */
  delayMs?: number;
  /** Optional custom handler for immediate manual retry */
  onRetryNow?: () => void;
}

export const ConnectionBanner: React.FC<ConnectionBannerProps> = ({
  isReconnecting: propIsReconnecting,
  attempt: propAttempt,
  delayMs: propDelayMs,
  onRetryNow,
}) => {
  const store = useBridgeStore();

  const isReconnecting = propIsReconnecting ?? store.isReconnecting;
  const attempt = propAttempt ?? store.reconnectAttempt;
  const delayMs = propDelayMs ?? store.nextRetryDelayMs;

  if (!isReconnecting) {
    return null;
  }

  const handleRetry = () => {
    if (onRetryNow) {
      onRetryNow();
    } else {
      // Trigger bridge health check / reconnect
      getBridgeService()
        .fetchBridgeHealth()
        .then((status) => {
          store.setEditorStatus(status);
        })
        .catch(() => {
          // Still reconnecting
        });
    }
  };

  return (
    <div
      data-testid="connection-banner"
      role="alert"
      className="flex-none bg-amber-500 text-amber-950 px-4 py-2 flex items-center justify-between gap-3 shadow-md border-b border-amber-600 select-none z-40 transition-all duration-200"
    >
      {/* Left: Reconnecting Animation & Main Message */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-amber-600/30 text-amber-950">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span
            data-testid="connection-banner-text"
            className="text-xs font-bold tracking-tight"
          >
            연결 재시도 중...
          </span>
          <span className="text-[11px] text-amber-900 font-medium font-mono">
            {attempt > 0
              ? `(재시도 #${attempt}${delayMs > 0 ? ` · ${Math.round(delayMs / 1000)}초 후 재시도` : ''})`
              : '(지수 백오프 자동 복구 중)'}
          </span>
          <span className="hidden md:inline text-[11px] text-amber-900/80">
            에디터 또는 브릿지 서버 연결이 일시적으로 중단되었습니다.
          </span>
        </div>
      </div>

      {/* Right: Manual Retry Action */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          type="button"
          data-testid="connection-banner-retry-btn"
          onClick={handleRetry}
          className="flex items-center gap-1 px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white text-[11px] font-semibold transition-colors cursor-pointer shadow-sm"
          title="백오프 대기 시간 없이 즉시 연결 재시도"
        >
          <span>지금 재시도</span>
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};
