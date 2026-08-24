/**
 * SmartLinter Dashboard Bridge Store (Zustand)
 *
 * Central reactive state store managing editor bridge connections, LLM health,
 * Translation Memory (TM) state, split layout modes, and paragraph telemetry.
 */

import { create } from 'zustand';
import {
  type EditorType,
  type ParagraphPayload,
  type ReplacementResult,
} from '../../shared/protocol/types.ts';
import {
  type BridgeStatusPayload,
  type LlmStatusPayload,
  type TmStatusPayload,
  type BatchScanProgressPayload,
  type IBridgeService,
  getBridgeService,
} from '../services/tauriBridge.ts';

export type SplitLayoutMode = 'horizontal' | 'vertical';

export interface BridgeState {
  // --- Editor Connection ---
  editorConnected: boolean;
  editorType: EditorType | null;
  activeDocument: string | null;
  sessionId: string | null;
  lastHeartbeat: number | null;

  // --- LLM Status ---
  llmAlive: boolean;
  llmProvider: string;
  llmModel: string | null;
  llmLatency: number | null;
  llmMessage: string | null;

  // --- TM & Guidelines Status ---
  tmLoaded: boolean;
  tmEntriesCount: number;
  tmFileName: string | null;
  guidelinesLoaded: boolean;
  guidelinesCount: number;

  // --- Batch Scan Progress ---
  batchScanning: boolean;
  batchCurrent: number;
  batchTotal: number;
  batchPercent: number;
  batchAborted: boolean;

  // --- Layout Configuration ---
  splitMode: SplitLayoutMode;

  // --- Telemetry & Active Paragraph ---
  activeParagraph: ParagraphPayload | null;
  paragraphs: ParagraphPayload[];
  lastReplacementResult: ReplacementResult | null;

  // --- Bottom AI Command Input ---
  commandInput: string;
  isAiProcessing: boolean;

  // --- Actions ---
  setEditorStatus: (status: Partial<BridgeStatusPayload>) => void;
  setLlmStatus: (status: Partial<LlmStatusPayload>) => void;
  setTmStatus: (status: Partial<TmStatusPayload>) => void;
  setGuidelinesLoaded: (loaded: boolean, count: number) => void;
  setBatchScanProgress: (progress: Partial<BatchScanProgressPayload>) => void;
  setSplitMode: (mode: SplitLayoutMode) => void;
  toggleSplitMode: () => void;
  addParagraph: (payload: ParagraphPayload) => void;
  setActiveParagraph: (paragraph: ParagraphPayload | null) => void;
  setLastReplacementResult: (result: ReplacementResult | null) => void;
  setCommandInput: (input: string) => void;
  setIsAiProcessing: (processing: boolean) => void;
  initEventListener: (service?: IBridgeService) => () => void;
  reset: () => void;
}

const initialState = {
  editorConnected: false,
  editorType: null as EditorType | null,
  activeDocument: null as string | null,
  sessionId: null as string | null,
  lastHeartbeat: null as number | null,

  llmAlive: false,
  llmProvider: 'ollama',
  llmModel: 'qwen2.5:7b',
  llmLatency: null as number | null,
  llmMessage: null as string | null,

  tmLoaded: false,
  tmEntriesCount: 0,
  tmFileName: null as string | null,
  guidelinesLoaded: false,
  guidelinesCount: 0,

  batchScanning: false,
  batchCurrent: 0,
  batchTotal: 0,
  batchPercent: 0,
  batchAborted: false,

  splitMode: 'horizontal' as SplitLayoutMode,

  activeParagraph: null as ParagraphPayload | null,
  paragraphs: [] as ParagraphPayload[],
  lastReplacementResult: null as ReplacementResult | null,

  commandInput: '',
  isAiProcessing: false,
};

export const useBridgeStore = create<BridgeState>((set, get) => ({
  ...initialState,

  setEditorStatus: (status) =>
    set((state) => ({
      editorConnected: status.connected ?? state.editorConnected,
      editorType: status.editorType !== undefined ? status.editorType : state.editorType,
      activeDocument: status.activeDocument !== undefined ? status.activeDocument : state.activeDocument,
      sessionId: status.sessionId !== undefined ? status.sessionId : state.sessionId,
      lastHeartbeat: Date.now(),
    })),

  setLlmStatus: (status) =>
    set((state) => ({
      llmAlive: status.isAlive ?? state.llmAlive,
      llmProvider: status.provider ?? state.llmProvider,
      llmModel: status.activeModel !== undefined ? status.activeModel : state.llmModel,
      llmLatency: status.latencyMs !== undefined ? status.latencyMs : state.llmLatency,
      llmMessage: status.message !== undefined ? status.message : state.llmMessage,
    })),

  setTmStatus: (status) =>
    set((state) => ({
      tmLoaded: status.tmLoaded ?? state.tmLoaded,
      tmEntriesCount: status.entriesCount !== undefined ? status.entriesCount : state.tmEntriesCount,
      tmFileName: status.fileName !== undefined ? status.fileName : state.tmFileName,
      guidelinesLoaded: status.guidelinesLoaded ?? state.guidelinesLoaded,
      guidelinesCount: status.guidelinesCount !== undefined ? status.guidelinesCount : state.guidelinesCount,
    })),

  setGuidelinesLoaded: (loaded, count) =>
    set(() => ({
      guidelinesLoaded: loaded,
      guidelinesCount: count,
    })),

  setBatchScanProgress: (progress) =>
    set((state) => ({
      batchScanning: progress.active ?? state.batchScanning,
      batchCurrent: progress.current ?? state.batchCurrent,
      batchTotal: progress.total ?? state.batchTotal,
      batchPercent: progress.percent ?? state.batchPercent,
      batchAborted: progress.isAborted ?? state.batchAborted,
    })),

  setSplitMode: (mode) => set({ splitMode: mode }),

  toggleSplitMode: () =>
    set((state) => ({
      splitMode: state.splitMode === 'horizontal' ? 'vertical' : 'horizontal',
    })),

  addParagraph: (payload) =>
    set((state) => {
      // Deduplicate or append at beginning
      const filtered = state.paragraphs.filter((p) => p.paragraphId !== payload.paragraphId);
      return {
        paragraphs: [payload, ...filtered],
        activeParagraph: payload,
      };
    }),

  setActiveParagraph: (paragraph) => set({ activeParagraph: paragraph }),

  setLastReplacementResult: (result) => set({ lastReplacementResult: result }),

  setCommandInput: (input) => set({ commandInput: input }),

  setIsAiProcessing: (processing) => set({ isAiProcessing: processing }),

  initEventListener: (service) => {
    const bridgeService = service || getBridgeService();
    const unlisteners: Array<() => void> = [];

    // Subscribe to bridge status events
    unlisteners.push(
      bridgeService.listen('bridge-status-changed', (payload) => {
        get().setEditorStatus(payload);
      })
    );

    // Subscribe to incoming paragraph telemetry
    unlisteners.push(
      bridgeService.listen('new-paragraph-detected', (payload) => {
        get().addParagraph(payload);
      })
    );

    // Subscribe to replacement results
    unlisteners.push(
      bridgeService.listen('replacement-result', (payload) => {
        get().setLastReplacementResult(payload);
      })
    );

    // Subscribe to LLM health updates
    unlisteners.push(
      bridgeService.listen('llm-status-changed', (payload) => {
        get().setLlmStatus(payload);
      })
    );

    // Subscribe to TM status updates
    unlisteners.push(
      bridgeService.listen('tm-status-changed', (payload) => {
        get().setTmStatus(payload);
      })
    );

    // Subscribe to batch scan progress updates
    unlisteners.push(
      bridgeService.listen('batch-scan-progress', (payload) => {
        get().setBatchScanProgress(payload);
      })
    );

    return () => {
      unlisteners.forEach((u) => u());
    };
  },

  reset: () => set({ ...initialState }),
}));
