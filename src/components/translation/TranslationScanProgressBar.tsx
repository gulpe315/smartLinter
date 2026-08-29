import React from 'react';
import { CheckCircle2, RefreshCw } from 'lucide-react';
import { useTranslationSessionStore } from '../../stores/translationSessionStore.ts';

/** Progress state for the independent full-document translation scan. */
export const TranslationScanProgressBar: React.FC = () => {
  const { isScanning, lastScanSummary } = useTranslationSessionStore();

  if (!isScanning && !lastScanSummary) return null;

  return (
    <div data-testid="translation-scan-progress-bar" className="bg-slate-900/95 border-b border-indigo-900/60 px-4 py-2.5 text-slate-100 shadow-md transition-all duration-300 backdrop-blur-sm">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`flex items-center justify-center w-6 h-6 rounded-full border ${isScanning
            ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-400'
            : 'bg-emerald-600/20 border-emerald-500/40 text-emerald-400'}`}
          >
            {isScanning ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-slate-200 tracking-tight">
              {isScanning ? '전체 Word 문서를 스캔하는 중...' : `문서 스캔 완료: ${lastScanSummary!.totalCount}개 문단`}
            </span>
            <span className="text-[10px] text-slate-400 font-mono">번역 세션에 안전하게 병합합니다</span>
          </div>
        </div>
        <div className="flex-1 max-w-md w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
          <div className={`h-full rounded-full transition-all duration-300 ${isScanning
            ? 'w-3/4 animate-pulse bg-gradient-to-r from-indigo-500 to-cyan-400'
            : 'w-full bg-emerald-500'}`}
          />
        </div>
      </div>
    </div>
  );
};
