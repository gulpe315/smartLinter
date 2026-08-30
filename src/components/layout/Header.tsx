/**
 * SmartLinter Dashboard Header Component
 *
 * Displays native editor connection indicator (Word/InDesign),
 * LLM status (Ollama model & latency), TM/guidelines load badge,
 * layout switcher buttons, and triggers for settings & guideline panels.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  Database,
  BookOpen,
  Columns,
  Rows,
  Radio,
  AlertCircle,
  RefreshCw,
  Settings,
} from 'lucide-react';
import { useBridgeStore } from '../../stores/bridgeStore.ts';
import { useConfigStore } from '../../stores/configStore.ts';
import { useQaStore } from '../../stores/qaStore.ts';
import { PinToggleButton } from './PinToggleButton.tsx';
import { BatchProgressBar } from '../config/BatchProgressBar.tsx';
import { TranslationScanProgressBar } from '../translation/TranslationScanProgressBar.tsx';
import { EditorConnectionControl } from './EditorConnectionControl.tsx';
import { useTranslationSessionStore, type DocumentGenerationPreparation } from '../../stores/translationSessionStore.ts';
import { buildXliffDocument } from '../../utils/xliffExport.ts';
import { XliffConflictModal } from '../translation/XliffConflictModal.tsx';
import type { XliffConflictItem, XliffConflictResolution } from '../../utils/xliffImport.ts';

export const Header: React.FC = () => {
  const [translationExportMessage, setTranslationExportMessage] = useState<string | null>(null);
  const [generationConfirmation, setGenerationConfirmation] = useState<Extract<DocumentGenerationPreparation, { ok: true }> | null>(null);
  const [pendingConflicts, setPendingConflicts] = useState<XliffConflictItem[] | null>(null);
  const xliffFileInputRef = useRef<HTMLInputElement>(null);
  const conflictResolverRef = useRef<((resolutions: XliffConflictResolution[]) => void) | null>(null);
  const {
    llmAlive,
    llmModel,
    llmLatency,
    tmLoaded,
    tmEntriesCount,
    guidelinesLoaded,
    guidelinesCount,
    splitMode,
    toggleSplitMode,
    layoutPreset,
    setLayoutPreset,
    activeDocument,
  } = useBridgeStore();

  const { openSettingsModal, openGuidelineViewer, sourceLang, targetLang } = useConfigStore();
  const resetQaCards = useQaStore((state) => state.resetQaCards);
  const { isTranslationModeActive, segments, isScanning, scanError, lastScanSummary, lastImportSummary, importError, documentGenerationMessage, activeDocumentGeneration } = useTranslationSessionStore();
  const exportableSegmentCount = segments.filter((segment) => segment.status !== 'needs-validation').length;
  const needsValidationCount = segments.length - exportableSegmentCount;
  const isTranslationExportDisabled = segments.length === 0 || needsValidationCount > 0 || isScanning;

  useEffect(() => {
    if (needsValidationCount === 0) {
      setTranslationExportMessage(null);
    }
  }, [needsValidationCount]);

  const handleTranslationExport = () => {
    if (useTranslationSessionStore.getState().isScanning) return;
    const result = buildXliffDocument(segments, {
      sourceLang,
      targetLang,
      originalFileName: activeDocument || undefined,
    });
    if (!result.ok) {
      setTranslationExportMessage(`검증 필요 세그먼트 ${result.needsValidationCount}개가 있습니다. 해당 문단을 다시 수신한 뒤 내보내십시오.`);
      return;
    }

    const url = URL.createObjectURL(new Blob([result.xml], { type: 'application/xliff+xml' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `smartlinter-translation-${Date.now()}.xlf`;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setTranslationExportMessage(null);
  };

  const handleGenerateDocument = async () => {
    const result = await useTranslationSessionStore.getState().prepareDocumentGeneration();
    if (!result.ok) {
      useTranslationSessionStore.setState({ documentGenerationMessage: result.reason });
      return;
    }
    setGenerationConfirmation(result);
  };

  const handleXliffFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const xmlContent = await file.text();
    await useTranslationSessionStore.getState().importXliff(xmlContent, (analysis) => {
      if (analysis.conflicts.length === 0) return Promise.resolve([]);
      return new Promise((resolve) => {
        conflictResolverRef.current = resolve;
        setPendingConflicts(analysis.conflicts);
      });
    });
  };

  return (
    <header className="flex-none bg-slate-900 border-b border-slate-800 text-slate-100 select-none shadow-md z-30">
      <div className="px-4 py-2.5 flex items-center justify-between gap-4">
        {/* Left: Brand Logo & Title */}
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/40 text-indigo-400 font-bold">
            <Radio className="w-4 h-4 text-indigo-400 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold tracking-tight text-slate-100 text-base">SmartLinter</span>
              <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-800/60">
                Dashboard
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-mono">
              AI Linter &amp; TQA Native Bridge
            </p>
          </div>
        </div>

        {/* Center: Realtime Status Badges (Interactive triggers) */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <EditorConnectionControl />

          <button
            type="button"
            data-testid="translation-mode-toggle"
            aria-pressed={isTranslationModeActive}
            onClick={() => useTranslationSessionStore.getState().setTranslationMode(!isTranslationModeActive)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
              isTranslationModeActive
                ? 'bg-emerald-950/50 border-emerald-700/60 text-emerald-300'
                : 'bg-slate-800/70 border-slate-700 text-slate-400'
            }`}
            title="번역 모드 전환"
          >
            번역 모드 {isTranslationModeActive ? 'ON' : 'OFF'}
          </button>

          {/* LLM Status Indicator (Click to open Settings) */}
          <button
            type="button"
            data-testid="llm-status-badge"
            onClick={openSettingsModal}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer hover:border-indigo-500 ${
              llmAlive
                ? 'bg-indigo-950/50 border-indigo-700/60 text-indigo-300'
                : 'bg-amber-950/40 border-amber-800/60 text-amber-300'
            }`}
            title={`LLM 설정 열기: ${llmModel || 'qwen2.5:7b'}`}
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span className="font-mono text-[11px]">
              {llmModel || 'qwen2.5:7b'}
            </span>
            {llmAlive ? (
              <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-indigo-900/60 text-indigo-200">
                {llmLatency ? `${llmLatency}ms` : 'Ready'}
              </span>
            ) : (
              <span className="text-[10px] font-mono text-amber-400 flex items-center gap-0.5">
                <AlertCircle className="w-2.5 h-2.5" /> Standby
              </span>
            )}
          </button>

          {/* TM Load Badge (Click to open TM Manager) */}
          <button
            type="button"
            data-testid="tm-status-badge"
            onClick={openGuidelineViewer}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer hover:border-cyan-500 ${
              tmLoaded
                ? 'bg-cyan-950/50 border-cyan-700/60 text-cyan-300'
                : 'bg-slate-800/70 border-slate-700 text-slate-400'
            }`}
            title={tmLoaded ? `TM 로드 완료 (${tmEntriesCount.toLocaleString()}개 엔트리) - 클릭하여 관리` : 'TM 미로드 - 클릭하여 로드'}
          >
            <Database className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-mono text-[11px]">
              {tmLoaded ? `TM: ${tmEntriesCount.toLocaleString()}건` : 'TM: 미로드'}
            </span>
          </button>

          {/* Guidelines Badge (Click to open Guidelines) */}
          <button
            type="button"
            data-testid="guidelines-status-badge"
            onClick={openGuidelineViewer}
            className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer hover:border-violet-500 ${
              guidelinesLoaded
                ? 'bg-violet-950/50 border-violet-700/60 text-violet-300'
                : 'bg-slate-800/70 border-slate-700 text-slate-400'
            }`}
            title={guidelinesLoaded ? `가이드라인 규칙 ${guidelinesCount}개 적용 중 - 클릭하여 검토` : '기본 규칙 적용 중 - 클릭하여 검토'}
          >
            <BookOpen className="w-3.5 h-3.5 text-violet-400" />
            <span className="font-mono text-[11px]">
              {guidelinesLoaded ? `.agents (${guidelinesCount})` : '.agents'}
            </span>
          </button>
        </div>

        {/* Right: Layout Switcher, Pin Toggle & Settings Action Controls */}
        <div className="flex items-center gap-2">
          <div className="flex flex-col text-[10px] leading-tight text-slate-400" data-testid="translation-export-status">
            <span>{exportableSegmentCount}개 수집됨</span>
            {needsValidationCount > 0 && <span className="text-amber-400">검증 필요 {needsValidationCount}개</span>}
          </div>
          <button
            type="button"
            data-testid="translation-scan-btn"
            disabled={isScanning}
            onClick={() => useTranslationSessionStore.getState().scanFullDocument()}
            className="px-2.5 py-1 rounded-md bg-indigo-900/50 hover:bg-indigo-800/60 disabled:bg-slate-800 disabled:text-slate-500 disabled:border-slate-700 border border-indigo-700/70 text-indigo-200 text-xs font-medium transition-colors"
            title="Word 문서 전체를 스캔해 번역 세션에 병합합니다"
          >
            {isScanning ? '스캔 중...' : '전체 문서 스캔'}
          </button>
          <input
            ref={xliffFileInputRef}
            type="file"
            accept=".xlf,.xliff,.xml"
            data-testid="translation-import-file-input"
            className="hidden"
            onChange={handleXliffFileSelected}
          />
          <button
            type="button"
            data-testid="translation-import-btn"
            disabled={isScanning || segments.length === 0}
            onClick={() => xliffFileInputRef.current?.click()}
            className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 disabled:bg-slate-800 disabled:text-slate-500 border border-slate-700 text-slate-300 text-xs font-medium transition-colors"
            title="외부 CAT 툴에서 검토한 XLIFF 파일을 가져옵니다"
          >
            XLIFF 가져오기
          </button>
          <button
            type="button"
            data-testid="translation-export-btn"
            disabled={isTranslationExportDisabled}
            onClick={handleTranslationExport}
            className="px-2.5 py-1 rounded-md bg-emerald-900/50 hover:bg-emerald-800/60 disabled:bg-slate-800 disabled:text-slate-500 disabled:border-slate-700 border border-emerald-700/70 text-emerald-200 text-xs font-medium transition-colors"
            title={isTranslationExportDisabled ? '검증이 필요한 세그먼트를 해결한 뒤 내보낼 수 있습니다' : 'XLIFF 파일로 내보내기'}
          >
            XLIFF 내보내기 ({exportableSegmentCount})
          </button>
          <button
            type="button"
            data-testid="translation-generate-btn"
            disabled={segments.length === 0 || isScanning}
            onClick={handleGenerateDocument}
            className="px-2.5 py-1 rounded-md bg-cyan-900/50 hover:bg-cyan-800/60 disabled:bg-slate-800 disabled:text-slate-500 disabled:border-slate-700 border border-cyan-700/70 text-cyan-200 text-xs font-medium transition-colors"
          >
            번역 문서 생성
          </button>
          <button
            type="button"
            data-testid="qa-reset-btn"
            onClick={resetQaCards}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800 hover:bg-rose-950/50 active:bg-rose-950 border border-slate-700 hover:border-rose-800 text-slate-300 hover:text-rose-200 text-xs font-medium transition-colors cursor-pointer"
            title="저장된 QA 카드와 처리 기록을 초기화하고 다시 스캔합니다"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span className="hidden lg:inline text-[11px]">상태 초기화</span>
          </button>

          {/* Always-on-top Pin Mode Toggle Button */}
          <PinToggleButton />

          <div
            aria-label="레이아웃 비율 프리셋"
            className="flex items-center rounded-md bg-slate-800/80 p-0.5 border border-slate-700/80 text-[11px] text-slate-400"
          >
            <button
              type="button"
              data-testid="layout-preset-qa-focus"
              onClick={() => setLayoutPreset('qa-focus')}
              className={layoutPreset === 'qa-focus' ? 'px-2 py-0.5 rounded transition-colors bg-indigo-600 text-white font-semibold shadow-sm' : 'px-2 py-0.5 rounded transition-colors hover:text-slate-200'}
            >
              QA 중심
            </button>
            <button
              type="button"
              data-testid="layout-preset-balanced"
              onClick={() => setLayoutPreset('balanced')}
              className={layoutPreset === 'balanced' ? 'px-2 py-0.5 rounded transition-colors bg-indigo-600 text-white font-semibold shadow-sm' : 'px-2 py-0.5 rounded transition-colors hover:text-slate-200'}
            >
              균등
            </button>
            <button
              type="button"
              data-testid="layout-preset-tm-focus"
              onClick={() => setLayoutPreset('tm-focus')}
              className={layoutPreset === 'tm-focus' ? 'px-2 py-0.5 rounded transition-colors bg-indigo-600 text-white font-semibold shadow-sm' : 'px-2 py-0.5 rounded transition-colors hover:text-slate-200'}
            >
              TM 중심
            </button>
          </div>

          {/* Layout Split Mode Switcher (Horizontal vs Vertical) */}
          <button
            type="button"
            data-testid="layout-switcher-btn"
            onClick={toggleSplitMode}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-700 text-slate-300 hover:text-slate-100 text-xs font-medium transition-colors cursor-pointer"
            title={`레이아웃 전환 (현재: ${splitMode === 'horizontal' ? '좌우 분할' : '상하 분할'})`}
          >
            {splitMode === 'horizontal' ? (
              <>
                <Columns className="w-3.5 h-3.5 text-indigo-400" />
                <span className="hidden md:inline text-[11px]">좌우 분할</span>
              </>
            ) : (
              <>
                <Rows className="w-3.5 h-3.5 text-indigo-400" />
                <span className="hidden md:inline text-[11px]">상하 분할</span>
              </>
            )}
          </button>

          {/* Settings Modal Button */}
          <button
            type="button"
            data-testid="header-settings-btn"
            onClick={openSettingsModal}
            className="flex items-center justify-center p-1.5 rounded-md bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-slate-700 text-slate-300 hover:text-slate-100 transition-colors cursor-pointer"
            title="환경 설정 (Ollama 모델, 가이드라인, TM)"
          >
            <Settings className="w-3.5 h-3.5 text-slate-300" />
          </button>
        </div>
      </div>

      {/* Top Real-time Batch Progress Bar */}
      <BatchProgressBar />
      <TranslationScanProgressBar />
      {lastScanSummary && (lastScanSummary.unplacedStories ?? 0) > 0 && !lastScanSummary.includeUnplacedStories && (
        <div className="px-4 pb-2 flex items-center gap-2 text-xs text-amber-300">
          <span>
            미배치 스토리 {lastScanSummary.unplacedStories}개(문단 {lastScanSummary.unplacedParagraphsPendingChoice}개)가 제외됐습니다.
          </span>
          <button
            type="button"
            data-testid="translation-rescan-unplaced-btn"
            disabled={isScanning}
            onClick={() => useTranslationSessionStore.getState().scanFullDocument({ includeUnplacedStories: true })}
            className="underline text-amber-200 hover:text-amber-100 disabled:text-slate-500"
          >
            미배치 스토리 포함 재스캔
          </button>
        </div>
      )}
      {activeDocumentGeneration ? (
        <div role="status" className="flex items-center gap-2 px-4 pb-2 text-xs text-cyan-300">
          <span>{({ preflight: '사전 점검', copying: '복사본 생성', 'verifying-copy': '복사본 검증', materializing: '번역 적용', finalizing: '저장 및 마무리' } as const)[activeDocumentGeneration.phase]}{activeDocumentGeneration.totalUnits !== undefined ? ` (${activeDocumentGeneration.completedUnits ?? 0}/${activeDocumentGeneration.totalUnits})` : ''}{activeDocumentGeneration.cancelRequested ? ` — 취소 요청됨: ${activeDocumentGeneration.hostConstraint}` : ''}</span>
          <button disabled={activeDocumentGeneration.cancelRequested} onClick={() => { void useTranslationSessionStore.getState().cancelDocumentGeneration(); }} className="rounded border border-cyan-500 px-2 py-0.5 disabled:opacity-50">Cancel</button>
        </div>
      ) : documentGenerationMessage ? (
        <p role="status" className="px-4 pb-2 text-xs text-cyan-300">{documentGenerationMessage}</p>
      ) : importError ? (
        <p role="status" className="px-4 pb-2 text-xs text-amber-300">{importError}</p>
      ) : scanError ? (
        <p role="status" className="px-4 pb-2 text-xs text-amber-300">{scanError}</p>
      ) : lastImportSummary ? (
        <p role="status" className="px-4 pb-2 text-xs text-emerald-300">
          XLIFF 가져오기 완료: {lastImportSummary.appliedCount}개 반영, {lastImportSummary.conflictCount}개 충돌 처리, {lastImportSummary.skippedSourceMismatchCount + lastImportSummary.skippedNotFoundCount}개 원문 변경/미존재로 건너뜀, {lastImportSummary.notProvidedCount}개 번역 미제공
        </p>
      ) : needsValidationCount > 0 && translationExportMessage ? (
        <p role="status" className="px-4 pb-2 text-xs text-amber-300">{translationExportMessage}</p>
      ) : null}
      {pendingConflicts && (
        <XliffConflictModal
          conflicts={pendingConflicts}
          onResolve={(resolutions) => {
            conflictResolverRef.current?.(resolutions);
            conflictResolverRef.current = null;
            setPendingConflicts(null);
          }}
          onCancel={() => {
            conflictResolverRef.current?.([]);
            conflictResolverRef.current = null;
            setPendingConflicts(null);
          }}
        />
      )}
      {generationConfirmation && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
          <div className="max-w-md rounded-lg border border-slate-700 bg-slate-900 p-5 text-slate-100 shadow-xl">
            <h2 className="text-sm font-semibold">번역 문서 생성</h2>
            <p className="mt-3 text-sm">{generationConfirmation.translatedParagraphCount}개 문단에 번역을 적용하고, {generationConfirmation.untranslatedParagraphCount}개 문단은 원문으로 유지합니다.</p>
            <p className="mt-3 rounded border border-amber-700/60 bg-amber-950/30 p-2 text-xs text-amber-200">이번 버전은 스캔된 본문 문단만 번역합니다. 표, 머리말/바닥글, 각주·미주 및 기타 제외된 컨테이너는 원문으로 유지됩니다.</p>
            <div className="mt-4 flex justify-end gap-2"><button onClick={() => setGenerationConfirmation(null)} className="px-3 py-1 text-xs">취소</button><button onClick={() => { const plans = generationConfirmation.plans; setGenerationConfirmation(null); void useTranslationSessionStore.getState().generateTranslatedDocument(plans); }} className="rounded bg-cyan-700 px-3 py-1 text-xs">생성</button></div>
          </div>
        </div>
      )}
    </header>
  );
};
