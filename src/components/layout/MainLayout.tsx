/**
 * SmartLinter Main Dashboard Layout Component
 *
 * Responsive split view containing the Quality Assurance (QA) panel
 * and Translation Memory (TM) panel. When TM is not loaded, the QA panel
 * automatically expands to 100% full width/height.
 */

import React from 'react';
import {
  ShieldCheck,
  Database,
  Layers,
  Sparkles,
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Info,
  Clock,
  FileText,
} from 'lucide-react';
import { useBridgeStore, type LayoutPreset } from '../../stores/bridgeStore.ts';

const HORIZONTAL_QA_WIDTH: Record<LayoutPreset, string> = {
  'qa-focus': 'w-full md:w-[65%] h-full overflow-hidden flex flex-col',
  balanced: 'w-full md:w-1/2 h-full overflow-hidden flex flex-col',
  'tm-focus': 'w-full md:w-[35%] h-full overflow-hidden flex flex-col',
};

const HORIZONTAL_TM_WIDTH: Record<LayoutPreset, string> = {
  'qa-focus': 'w-full md:w-[35%] h-full overflow-hidden flex flex-col bg-slate-900/30',
  balanced: 'w-full md:w-1/2 h-full overflow-hidden flex flex-col bg-slate-900/30',
  'tm-focus': 'w-full md:w-[65%] h-full overflow-hidden flex flex-col bg-slate-900/30',
};

const VERTICAL_QA_HEIGHT: Record<LayoutPreset, string> = {
  'qa-focus': 'w-full h-[65%] overflow-hidden flex flex-col',
  balanced: 'w-full h-1/2 overflow-hidden flex flex-col',
  'tm-focus': 'w-full h-[35%] overflow-hidden flex flex-col',
};

const VERTICAL_TM_HEIGHT: Record<LayoutPreset, string> = {
  'qa-focus': 'w-full h-[35%] overflow-hidden flex flex-col bg-slate-900/30',
  balanced: 'w-full h-1/2 overflow-hidden flex flex-col bg-slate-900/30',
  'tm-focus': 'w-full h-[65%] overflow-hidden flex flex-col bg-slate-900/30',
};

interface MainLayoutProps {
  qaSlot?: React.ReactNode;
  tmSlot?: React.ReactNode;
}

export const MainLayout: React.FC<MainLayoutProps> = ({ qaSlot, tmSlot }) => {
  const { tmLoaded, splitMode, layoutPreset } =
    useBridgeStore();

  return (
    <main
      data-testid="main-layout-container"
      className="flex-1 min-h-0 bg-slate-950 text-slate-100 overflow-hidden flex flex-col"
    >
      {/* Dynamic Layout Split Area */}
      {!tmLoaded ? (
        /* TM Unloaded: QA Panel expands to 100% full viewport width & height */
        <div
          data-testid="qa-full-width"
          className="flex-1 w-full h-full overflow-hidden flex flex-col"
        >
          {qaSlot || <DefaultQAPanelPlaceholder fullWidth />}
        </div>
      ) : (
        /* TM Loaded: Split Mode (Horizontal side-by-side or Vertical stacked) */
        <div
          data-testid="split-layout-container"
          className={`flex-1 w-full h-full overflow-hidden flex ${
            splitMode === 'horizontal'
              ? 'flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-slate-800'
              : 'flex-col divide-y divide-slate-800'
          }`}
        >
          {/* QA Panel Area */}
          <div
            data-testid="qa-panel-container"
            className={
              splitMode === 'horizontal'
                ? HORIZONTAL_QA_WIDTH[layoutPreset]
                : VERTICAL_QA_HEIGHT[layoutPreset]
            }
          >
            {qaSlot || <DefaultQAPanelPlaceholder fullWidth={false} />}
          </div>

          {/* TM & TQA Panel Area */}
          <div
            data-testid="tm-panel-container"
            className={
              splitMode === 'horizontal'
                ? HORIZONTAL_TM_WIDTH[layoutPreset]
                : VERTICAL_TM_HEIGHT[layoutPreset]
            }
          >
            {tmSlot || <DefaultTMPanelPlaceholder />}
          </div>
        </div>
      )}
    </main>
  );
};

/**
 * Placeholder Skeleton for Quality Assurance (QA) Panel (Task 13 Skeleton)
 */
interface QAPlaceholderProps {
  fullWidth?: boolean;
}

const DefaultQAPanelPlaceholder: React.FC<QAPlaceholderProps> = ({ fullWidth }) => {
  const { activeParagraph, paragraphs, editorConnected } = useBridgeStore();

  return (
    <div
      data-testid="qa-panel-placeholder"
      className="flex-1 h-full flex flex-col overflow-hidden bg-slate-950/60"
    >
      {/* QA Header & Filter Controls Bar */}
      <div className="flex-none px-4 py-2.5 bg-slate-900/80 border-b border-slate-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
            QA 위반 사항 검수
          </h2>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
            0건 발견
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md bg-slate-800/80 p-0.5 border border-slate-700/80 text-[11px] text-slate-400">
            <button className="px-2 py-0.5 rounded bg-indigo-600/80 text-white font-medium">전체</button>
            <button className="px-2 py-0.5 rounded hover:text-slate-200">High</button>
            <button className="px-2 py-0.5 rounded hover:text-slate-200">Medium</button>
            <button className="px-2 py-0.5 rounded hover:text-slate-200">Low</button>
          </div>
        </div>
      </div>

      {/* QA Body Content / Telemetry Monitor */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {activeParagraph ? (
          /* Active Paragraph Live Card Preview */
          <div className="p-3.5 rounded-lg bg-slate-900 border border-indigo-900/50 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800">
                  {activeParagraph.editorType} 문단 감지
                </span>
                <span className="text-[11px] font-mono text-slate-400">
                  ID: {activeParagraph.paragraphId.slice(0, 8)}...
                </span>
              </div>
              <span className="text-[10px] font-mono text-slate-500">
                {new Date(activeParagraph.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <p className="text-xs text-slate-200 font-mono bg-slate-950/80 p-2.5 rounded border border-slate-800/80 leading-relaxed break-words">
              {activeParagraph.text}
            </p>
            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
              <span className="font-mono text-[10px] text-slate-500">
                Hash: {activeParagraph.hash.slice(0, 12)}...
              </span>
              <span className="text-emerald-400 flex items-center gap-1 text-[10px]">
                <CheckCircle2 className="w-3 h-3" /> 비동기 검수 대기 중
              </span>
            </div>
          </div>
        ) : (
          /* Empty State Guide */
          <div className="h-full flex flex-col items-center justify-center text-center p-8 border border-dashed border-slate-800/80 rounded-xl bg-slate-900/20">
            <div className="w-12 h-12 rounded-2xl bg-indigo-950/50 border border-indigo-800/50 flex items-center justify-center text-indigo-400 mb-3 shadow-inner">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-slate-200 mb-1">
              {editorConnected ? '상시 모니터링 활성화됨' : '에디터 연결 대기 중'}
            </h3>
            <p className="text-xs text-slate-400 max-w-sm leading-relaxed mb-4">
              Word 또는 InDesign에서 문단을 작성하거나 수정하면, 타이핑 중단 시점에 방금 수정한 문단이 대시보드로 자동 전송되어 즉시 분석됩니다.
            </p>
            <div className="flex items-center gap-2 text-[11px] font-mono text-indigo-300/80 bg-indigo-950/40 px-3 py-1.5 rounded-md border border-indigo-800/40">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span>Micro-Scoping &amp; No Samples 엔진 대기 중</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Placeholder Skeleton for Translation Memory (TM) & TQA Panel (Task 14 Skeleton)
 */
const DefaultTMPanelPlaceholder: React.FC = () => {
  const { tmEntriesCount, tmFileName } = useBridgeStore();

  return (
    <div
      data-testid="tm-panel-placeholder"
      className="flex-1 h-full flex flex-col overflow-hidden bg-slate-900/40"
    >
      {/* TM Header Bar */}
      <div className="flex-none px-4 py-2.5 bg-slate-900/80 border-b border-slate-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-cyan-400" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
            번역 메모리 (TM &amp; TQA)
          </h2>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800">
            {tmEntriesCount.toLocaleString()}건
          </span>
        </div>

        <div className="text-[11px] font-mono text-slate-400 truncate max-w-[150px]">
          {tmFileName || 'TMX 로드됨'}
        </div>
      </div>

      {/* TM Search & Fuzzy Matching Placeholder */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="font-semibold text-cyan-300 flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5" /> Fuzzy Match 제안
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
              95% 일치
            </span>
          </div>
          <div className="space-y-1.5 text-xs font-mono">
            <div className="text-slate-400 bg-slate-950/60 p-2 rounded border border-slate-800/60">
              <span className="text-[10px] text-slate-500 font-bold block mb-0.5">SRC</span>
              Click the Settings button to configure bridge preferences.
            </div>
            <div className="text-slate-200 bg-slate-950/60 p-2 rounded border border-cyan-900/40">
              <span className="text-[10px] text-cyan-400 font-bold block mb-0.5">TGT (TM 제안)</span>
              브릿지 환경 설정을 구성하려면 설정 버튼을 클릭하십시오.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
