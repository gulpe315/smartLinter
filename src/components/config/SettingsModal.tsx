/**
 * SmartLinter Settings Modal Component
 *
 * Configures Ollama local LLM model selection (with GET /api/tags dynamic discovery,
 * parameter/quantization metadata, and 8GB VRAM budget warning badges),
 * host address settings, guidelines / TM upload access, and batch scan triggers.
 */

import React, { useEffect, useState } from 'react';
import {
  Settings,
  Sparkles,
  Cpu,
  Server,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  X,
  BookOpen,
  Database,
  Play,
  Layers,
  ChevronDown,
  Info,
  Languages,
} from 'lucide-react';
import { useConfigStore } from '../../stores/configStore.ts';
import { useBridgeStore } from '../../stores/bridgeStore.ts';
import { GuidelineViewer } from './GuidelineViewer.tsx';

export interface SettingsModalProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const {
    isSettingsModalOpen,
    closeSettingsModal,
    ollamaHost,
    setOllamaHost,
    installedModels,
    selectedModel,
    isLoadingModels,
    modelError,
    fetchModels,
    refreshLlmHealth,
    setSelectedModel,
    guidelines,
    tmEntries,
    startBatchScan,
    targetLang,
    explanationLang,
    setTargetLang,
    setExplanationLang,
  } = useConfigStore();

  const {
    llmAlive,
    llmLatency,
    batchScanning,
    batchCurrent,
    batchTotal,
  } = useBridgeStore();

  const [hostInput, setHostInput] = useState(ollamaHost);
  const [showGuidelineViewer, setShowGuidelineViewer] = useState(false);
  const [batchParagraphs, setBatchParagraphs] = useState(20);

  const modalOpen = isOpen !== undefined ? isOpen : isSettingsModalOpen;
  const handleClose = onClose || closeSettingsModal;

  useEffect(() => {
    if (modalOpen) {
      fetchModels();
    }
  }, [modalOpen, fetchModels]);

  if (!modalOpen) return null;

  const currentModelInfo = installedModels.find(
    (m) => m.name === selectedModel || m.model === selectedModel
  );

  const handleModelChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newModel = e.target.value;
    await setSelectedModel(newModel);
  };

  const handleTargetLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setTargetLang(e.target.value as 'ko' | 'en' | 'ja' | 'zh');
  };

  const handleExplanationLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setExplanationLang(e.target.value as 'ko' | 'en' | 'ja' | 'zh');
  };

  const handleSaveHost = async () => {
    setOllamaHost(hostInput);
    await Promise.all([fetchModels(), refreshLlmHealth()]);
  };

  const handleTriggerBatchScan = async () => {
    await startBatchScan(batchParagraphs);
    handleClose();
  };

  return (
    <div
      data-testid="settings-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={handleClose}
    >
      <div
        data-testid="settings-modal-container"
        className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-slate-100 animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex-none px-6 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/40 text-indigo-400">
              <Settings className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">SmartLinter 환경 설정</h2>
              <p className="text-xs text-slate-400 font-sans">
                로컬 Ollama LLM 모델, 하드웨어 VRAM 예산, 가이드라인 및 브릿지 동작을 구성합니다.
              </p>
            </div>
          </div>

          <button
            type="button"
            data-testid="settings-modal-close-btn"
            onClick={handleClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* 1. Ollama LLM Model Selection Section */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  로컬 LLM 추론 모델 설정 (Ollama)
                </h3>
              </div>

              <button
                type="button"
                data-testid="refresh-models-btn"
                onClick={() => fetchModels()}
                disabled={isLoadingModels}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-300 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 text-indigo-400 ${isLoadingModels ? 'animate-spin' : ''}`} />
                <span>모델 목록 새로고침</span>
              </button>
            </div>

            {/* Model Dropdown Card */}
            <div className="p-4 bg-slate-950/80 rounded-xl border border-slate-800 space-y-3">
              <div className="space-y-1.5">
                <label
                  htmlFor="ollama-model-select"
                  className="text-xs font-semibold text-slate-300 flex items-center justify-between"
                >
                  <span>추론 모델 선택 (GET /api/tags)</span>
                  <span className="text-[11px] font-mono text-slate-400">
                    선택 즉시 백엔드 및 큐에 반영됨
                  </span>
                </label>

                <div className="relative">
                  <select
                    id="ollama-model-select"
                    data-testid="ollama-model-select"
                    value={selectedModel}
                    onChange={handleModelChange}
                    className="w-full pl-3 pr-10 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-xs font-mono text-slate-100 appearance-none focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 cursor-pointer"
                  >
                    {installedModels.length > 0 ? (
                      installedModels.map((m) => (
                        <option key={m.name} value={m.name}>
                          {m.name} {m.parameterSize ? `(${m.parameterSize})` : ''} {m.quantizationLevel ? `[${m.quantizationLevel}]` : ''} {m.vramWarning ? '⚠️ VRAM 경고' : ''}
                        </option>
                      ))
                    ) : (
                      <option value={selectedModel}>{selectedModel} (기본값)</option>
                    )}
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-3 pointer-events-none" />
                </div>
              </div>

              {/* Model Metadata & Details Display */}
              {currentModelInfo && (
                <div
                  data-testid="model-metadata-card"
                  className="p-3 bg-slate-900/90 rounded-lg border border-slate-800 text-xs font-mono space-y-2"
                >
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                    <div>
                      <span className="text-slate-500 block">파라미터 크기</span>
                      <span className="text-slate-200 font-bold">
                        {currentModelInfo.parameterSize || 'N/A'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">양자화 수준</span>
                      <span className="text-slate-200 font-bold">
                        {currentModelInfo.quantizationLevel || 'N/A'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">디스크 용량</span>
                      <span className="text-slate-200 font-bold">
                        {(currentModelInfo.sizeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">형식 (Format)</span>
                      <span className="text-slate-200 font-bold">
                        {currentModelInfo.details?.format?.toUpperCase() || 'GGUF'}
                      </span>
                    </div>
                  </div>

                  {/* VRAM Warning Badge & Explanation (Does NOT block selection) */}
                  {currentModelInfo.vramWarning && (
                    <div
                      data-testid="vram-warning-badge"
                      className="mt-2 p-2.5 rounded-md bg-amber-950/60 border border-amber-800/80 text-amber-300 text-xs flex items-start gap-2"
                    >
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        <span className="font-bold flex items-center gap-1 text-[11px]">
                          ⚠️ 8GB VRAM 예산 초과 가능성 경고 (선택은 가능)
                        </span>
                        <p className="text-[11px] text-amber-200/90 leading-tight">
                          {currentModelInfo.vramWarningReason ||
                            '8GB VRAM 환경에서 에디터(Word/InDesign) 및 OS와 동시 실행 시 VRAM 스왑이나 응답 지연이 발생할 수 있습니다.'}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {modelError && (
                <div
                  data-testid="model-error-banner"
                  className="p-2.5 rounded bg-rose-950/60 border border-rose-800/80 text-rose-300 text-xs flex items-center gap-2"
                >
                  <AlertTriangle className="w-4 h-4 text-rose-400" />
                  <span>{modelError}</span>
                </div>
              )}
            </div>

            {/* Ollama Host URL Input */}
            <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800 flex items-center gap-3">
              <Server className="w-4 h-4 text-slate-400" />
              <div className="flex-1">
                <label className="text-[10px] text-slate-500 block uppercase font-mono">
                  Ollama REST API 호스트 URL
                </label>
                <input
                  type="text"
                  data-testid="ollama-host-input"
                  value={hostInput}
                  onChange={(e) => setHostInput(e.target.value)}
                  placeholder="http://127.0.0.1:11434"
                  className="w-full bg-transparent text-xs font-mono text-slate-200 focus:outline-none"
                />
              </div>
              <button
                type="button"
                data-testid="save-host-btn"
                onClick={handleSaveHost}
                className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs transition-colors cursor-pointer"
              >
                적용
              </button>
            </div>
          </section>

          {/* 2. QA Document Language Section */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Languages className="w-4 h-4 text-sky-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                문서 언어 설정
              </h3>
            </div>

            <div className="p-4 bg-slate-950/80 rounded-xl border border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="target-language-select"
                  className="text-xs font-semibold text-slate-300 flex items-center justify-between gap-2"
                >
                  <span>검토 대상 문서 언어</span>
                  {targetLang !== 'ko' && (
                    <span
                      data-testid="target-language-unvalidated-badge"
                      className="px-1.5 py-0.5 rounded bg-amber-950/60 border border-amber-800/80 text-amber-300 text-[10px] font-bold"
                    >
                      미검증
                    </span>
                  )}
                </label>
                <div className="relative">
                  <select
                    id="target-language-select"
                    data-testid="target-language-select"
                    value={targetLang}
                    onChange={handleTargetLanguageChange}
                    className="w-full pl-3 pr-10 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-100 appearance-none focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 cursor-pointer"
                  >
                    <option value="ko">한국어</option>
                    <option value="en">English</option>
                    <option value="ja">日本語</option>
                    <option value="zh">中文</option>
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-3 pointer-events-none" />
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="explanation-language-select"
                  className="text-xs font-semibold text-slate-300 flex items-center justify-between gap-2"
                >
                  <span>오류 설명 언어</span>
                  {explanationLang !== 'ko' && (
                    <span
                      data-testid="explanation-language-unvalidated-badge"
                      className="px-1.5 py-0.5 rounded bg-amber-950/60 border border-amber-800/80 text-amber-300 text-[10px] font-bold"
                    >
                      미검증
                    </span>
                  )}
                </label>
                <div className="relative">
                  <select
                    id="explanation-language-select"
                    data-testid="explanation-language-select"
                    value={explanationLang}
                    onChange={handleExplanationLanguageChange}
                    className="w-full pl-3 pr-10 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-slate-100 appearance-none focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 cursor-pointer"
                  >
                    <option value="ko">한국어</option>
                    <option value="en">English</option>
                    <option value="ja">日本語</option>
                    <option value="zh">中文</option>
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-3 pointer-events-none" />
                </div>
              </div>
            </div>
          </section>

          {/* 3. Guidelines & Translation Memory Section */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-violet-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                가이드라인 &amp; TM 관리
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Guidelines Card */}
              <div className="p-4 bg-slate-950/80 rounded-xl border border-slate-800 flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                      <BookOpen className="w-3.5 h-3.5 text-violet-400" />
                      .agents 가이드라인
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-violet-950 text-violet-300 border border-violet-800">
                      {guidelines.rules.length}개 규칙
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    {guidelines.name} ({guidelines.description || '규칙 세트 활성화됨'})
                  </p>
                </div>

                <button
                  type="button"
                  data-testid="open-guideline-viewer-btn"
                  onClick={() => setShowGuidelineViewer(true)}
                  className="w-full py-1.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
                  <span>가이드라인 / TM 뷰어 열기</span>
                </button>
              </div>

              {/* Translation Memory Card */}
              <div className="p-4 bg-slate-950/80 rounded-xl border border-slate-800 flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                      <Database className="w-3.5 h-3.5 text-cyan-400" />
                      번역 메모리 (TM)
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                      {tmEntries.length.toLocaleString()}건
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    {tmEntries.length > 0
                      ? '인메모리 N-gram 인덱싱 활성화 (0.1초 퍼지 매치)'
                      : 'TM 파일 미로드 (단일 QA 전용 모드)'}
                  </p>
                </div>

                <button
                  type="button"
                  data-testid="open-tm-loader-btn"
                  onClick={() => setShowGuidelineViewer(true)}
                  className="w-full py-1.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Database className="w-3.5 h-3.5 text-cyan-400" />
                  <span>TMX / JSON TM 파일 로드</span>
                </button>
              </div>
            </div>
          </section>

          {/* 4. Batch Scan Trigger Section (Testing / Large Documents) */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                대용량 문서 일괄 스캔 (Batch Scan)
              </h3>
            </div>

            <div className="p-4 bg-slate-950/80 rounded-xl border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="space-y-0.5">
                <span className="text-xs font-semibold text-slate-200">
                  전체 문서 순차 일괄 검수 트리거
                </span>
                <p className="text-[11px] text-slate-400">
                  백엔드 마이크로 큐(Concurrency=1)를 구동하여 문서 전체 문단을 순차 스캔합니다.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="500"
                  value={batchParagraphs}
                  onChange={(e) => setBatchParagraphs(Number(e.target.value))}
                  className="w-16 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs font-mono text-slate-200 text-center"
                  title="분석할 문단 수"
                />
                <button
                  type="button"
                  data-testid="trigger-batch-scan-btn"
                  disabled={batchScanning}
                  onClick={handleTriggerBatchScan}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-50 text-white text-xs font-medium transition-colors cursor-pointer shadow-sm"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>일괄 스캔 시작</span>
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex-none px-6 py-3.5 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="font-mono text-[11px]">
              {selectedModel} 활성화됨
            </span>
          </div>

          <button
            type="button"
            data-testid="settings-modal-done-btn"
            onClick={handleClose}
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors cursor-pointer shadow-sm"
          >
            확인 및 닫기
          </button>
        </div>
      </div>

      {/* Submodal for Guideline & TM Viewer */}
      {showGuidelineViewer && (
        <GuidelineViewer
          isOpen={showGuidelineViewer}
          asModal={true}
          onClose={() => setShowGuidelineViewer(false)}
        />
      )}
    </div>
  );
};
