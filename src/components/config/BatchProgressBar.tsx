/**
 * SmartLinter Batch Scan Progress Bar Component
 *
 * Displays a real-time progress bar (0%~100%) with "현재 N / M 문단 분석 중..." status
 * and an immediate [취소] (Abort) action button to cancel backend micro-queue batch scans.
 */

import React from 'react';
import { RefreshCw, XCircle, CheckCircle2, AlertCircle, Sparkles } from 'lucide-react';
import { useBridgeStore } from '../../stores/bridgeStore.ts';
import { useConfigStore } from '../../stores/configStore.ts';

export interface BatchProgressBarProps {
  className?: string;
  onCancel?: () => void;
}

export const BatchProgressBar: React.FC<BatchProgressBarProps> = ({
  className = '',
  onCancel,
}) => {
  const {
    batchScanning,
    batchCurrent,
    batchTotal,
    batchPercent,
    batchAborted,
  } = useBridgeStore();

  const abortBatchScan = useConfigStore((state) => state.abortBatchScan);

  if (!batchScanning && !batchAborted) {
    return null;
  }

  const handleAbort = async () => {
    if (onCancel) {
      onCancel();
    }
    await abortBatchScan();
  };

  return (
    <div
      data-testid="batch-progress-bar-root"
      data-test-container="batch-progress"
      className={`bg-slate-900/95 border-b border-indigo-900/60 px-4 py-2.5 text-slate-100 shadow-md transition-all duration-300 backdrop-blur-sm ${className}`}
    >
      <div data-testid="batch-progress-container" className="flex flex-col sm:flex-row items-center justify-between gap-3">
        {/* Left: Animated Status Indicator & Paragraph Count */}
        <div className="flex items-center gap-2.5 min-w-0">
          {batchScanning ? (
            <div className="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-600/20 border border-indigo-500/40 text-indigo-400">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
            </div>
          ) : batchAborted ? (
            <div className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-600/20 border border-amber-500/40 text-amber-400">
              <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
            </div>
          ) : (
            <div className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-600/20 border border-emerald-500/40 text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            </div>
          )}

          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span
                data-testid="batch-progress-status-text"
                className="text-xs font-semibold text-slate-200 tracking-tight"
              >
                {batchScanning
                  ? `현재 ${batchCurrent} / ${batchTotal} 문단 분석 중...`
                  : batchAborted
                  ? '일괄 스캔이 중단(Abort)되었습니다.'
                  : '일괄 문서 분석이 완료되었습니다.'}
              </span>
              <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-300 border border-indigo-800">
                {batchPercent}%
              </span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">
              {batchScanning
                ? 'Micro-Scoping 큐 (Concurrency=1, VRAM 안전 모드)'
                : '스캔 작업 대기 중'}
            </span>
          </div>
        </div>

        {/* Center: Realtime Visual Progress Bar */}
        <div className="flex items-center gap-3 flex-1 max-w-md w-full">
          <div
            data-testid="progress-bar-track"
            className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800"
          >
            <div
              data-testid="progress-bar-fill"
              className={`h-full rounded-full transition-all duration-300 ${
                batchAborted
                  ? 'bg-amber-500'
                  : batchPercent >= 100
                  ? 'bg-emerald-500'
                  : 'bg-indigo-500 bg-gradient-to-r from-indigo-500 to-cyan-400'
              }`}
              style={{ width: `${Math.min(batchPercent, 100)}%` }}
            />
          </div>
        </div>

        {/* Right: Abort / Cancel Action Button */}
        <div className="flex items-center gap-2">
          {batchScanning && (
            <button
              type="button"
              data-testid="batch-cancel-btn"
              onClick={handleAbort}
              className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-rose-950/70 hover:bg-rose-900/90 active:bg-rose-800 text-rose-300 border border-rose-800/80 text-xs font-medium transition-colors cursor-pointer shadow-sm"
              title="백엔드 마이크로 큐의 일괄 스캔 작업을 즉시 중단합니다"
            >
              <XCircle className="w-3.5 h-3.5 text-rose-400" />
              <span>취소 (Cancel)</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
