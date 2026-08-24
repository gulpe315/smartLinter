/**
 * SmartLinter Dashboard Config & Guidelines Store (Zustand)
 *
 * Manages Ollama model discovery and selection with VRAM warning evaluation,
 * .agents guideline rule parsing and storage, Translation Memory (TM) loading,
 * and batch scan triggers with bridge synchronization and local persistence.
 */

import { create } from 'zustand';
import {
  type ModelInfo,
  type GuidelineSet,
  type TmEntry,
  DEFAULT_GUIDELINES,
} from '../types/config.ts';
import { getBridgeService } from '../services/tauriBridge.ts';
import { useBridgeStore } from './bridgeStore.ts';
import { parseGuidelineContent, parseTmContent } from '../utils/parserUtils.ts';

const STORAGE_KEYS = {
  SELECTED_MODEL: 'smartlinter_selected_model',
  OLLAMA_HOST: 'smartlinter_ollama_host',
  CUSTOM_GUIDELINE_RAW: 'smartlinter_custom_guideline_raw',
  CUSTOM_GUIDELINE_NAME: 'smartlinter_custom_guideline_name',
};

export interface ConfigState {
  // --- Ollama Model Configuration ---
  ollamaHost: string;
  installedModels: ModelInfo[];
  selectedModel: string;
  isLoadingModels: boolean;
  modelError: string | null;

  // --- Project Guidelines State ---
  guidelines: GuidelineSet;
  guidelineFileName: string | null;
  isCustomGuideline: boolean;

  // --- Translation Memory State ---
  tmEntries: TmEntry[];
  tmFileName: string | null;

  // --- Modal Open States ---
  isSettingsModalOpen: boolean;
  isGuidelineViewerOpen: boolean;

  // --- Actions: Settings Modal ---
  openSettingsModal: () => void;
  closeSettingsModal: () => void;
  toggleSettingsModal: () => void;

  // --- Actions: Guideline Viewer ---
  openGuidelineViewer: () => void;
  closeGuidelineViewer: () => void;
  toggleGuidelineViewer: () => void;

  // --- Actions: Ollama Models ---
  setOllamaHost: (host: string) => void;
  fetchModels: () => Promise<void>;
  setSelectedModel: (modelName: string) => Promise<void>;

  // --- Actions: Guidelines Management ---
  loadGuidelineFile: (fileOrData: File | { name: string; content: string }) => Promise<void>;
  loadGuidelineText: (content: string, filename?: string) => Promise<void>;
  resetToDefaultGuidelines: () => void;

  // --- Actions: TM Management ---
  loadTmFile: (fileOrData: File | { name: string; content: string }) => Promise<void>;
  loadTmText: (content: string, filename?: string) => Promise<void>;
  clearTm: () => void;

  // --- Actions: Batch Scan ---
  startBatchScan: (totalParagraphs?: number) => Promise<void>;
  abortBatchScan: () => Promise<void>;

  // --- Reset ---
  reset: () => void;
}

const getInitialSelectedModel = (): string => {
  if (typeof window !== 'undefined' && window.localStorage) {
    const saved = localStorage.getItem(STORAGE_KEYS.SELECTED_MODEL);
    if (saved) return saved;
  }
  return 'qwen2.5:7b';
};

const getInitialOllamaHost = (): string => {
  if (typeof window !== 'undefined' && window.localStorage) {
    const saved = localStorage.getItem(STORAGE_KEYS.OLLAMA_HOST);
    if (saved) return saved;
  }
  return 'http://127.0.0.1:11434';
};

export const useConfigStore = create<ConfigState>((set, get) => ({
  ollamaHost: getInitialOllamaHost(),
  installedModels: [],
  selectedModel: getInitialSelectedModel(),
  isLoadingModels: false,
  modelError: null,

  guidelines: DEFAULT_GUIDELINES,
  guidelineFileName: null,
  isCustomGuideline: false,

  tmEntries: [],
  tmFileName: null,

  isSettingsModalOpen: false,
  isGuidelineViewerOpen: false,

  openSettingsModal: () => set({ isSettingsModalOpen: true }),
  closeSettingsModal: () => set({ isSettingsModalOpen: false }),
  toggleSettingsModal: () => set((state) => ({ isSettingsModalOpen: !state.isSettingsModalOpen })),

  openGuidelineViewer: () => set({ isGuidelineViewerOpen: true }),
  closeGuidelineViewer: () => set({ isGuidelineViewerOpen: false }),
  toggleGuidelineViewer: () => set((state) => ({ isGuidelineViewerOpen: !state.isGuidelineViewerOpen })),

  setOllamaHost: (host: string) => {
    set({ ollamaHost: host });
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(STORAGE_KEYS.OLLAMA_HOST, host);
    }
  },

  fetchModels: async () => {
    const host = get().ollamaHost;
    set({ isLoadingModels: true, modelError: null });

    try {
      const bridge = getBridgeService();
      const models = await bridge.fetchOllamaModels(host);
      set({ installedModels: models, isLoadingModels: false });

      // If current selectedModel is not in list and models exist, keep or default
      const currentSelected = get().selectedModel;
      if (models.length > 0 && !models.some((m) => m.name === currentSelected || m.model === currentSelected)) {
        // Keep current if desired or select first model
      }
    } catch (err: any) {
      console.warn('Failed to fetch Ollama models:', err);
      set({
        isLoadingModels: false,
        modelError: err?.message || 'Ollama 모델 목록을 불러오지 못했습니다.',
      });
    }
  },

  setSelectedModel: async (modelName: string) => {
    set({ selectedModel: modelName });

    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(STORAGE_KEYS.SELECTED_MODEL, modelName);
    }

    try {
      const bridge = getBridgeService();
      await bridge.setOllamaModel(modelName);

      // Sync with bridgeStore
      useBridgeStore.getState().setLlmStatus({
        activeModel: modelName,
        isAlive: true,
      });
    } catch (err) {
      console.warn('Failed to switch Ollama model on backend:', err);
    }
  },

  loadGuidelineFile: async (fileOrData) => {
    let name: string;
    let content: string;

    if (fileOrData instanceof File) {
      name = fileOrData.name;
      content = await fileOrData.text();
    } else {
      name = fileOrData.name;
      content = fileOrData.content;
    }

    await get().loadGuidelineText(content, name);
  },

  loadGuidelineText: async (content: string, filename = '.agents') => {
    const parsedSet = parseGuidelineContent(content, filename);

    set({
      guidelines: parsedSet,
      guidelineFileName: filename,
      isCustomGuideline: true,
    });

    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(STORAGE_KEYS.CUSTOM_GUIDELINE_RAW, content);
      localStorage.setItem(STORAGE_KEYS.CUSTOM_GUIDELINE_NAME, filename);
    }

    // Sync bridgeStore
    useBridgeStore.getState().setGuidelinesLoaded(true, parsedSet.rules.length);
    useBridgeStore.getState().setTmStatus({
      guidelinesLoaded: true,
      guidelinesCount: parsedSet.rules.length,
    });

    try {
      const bridge = getBridgeService();
      await bridge.loadGuidelineContent(content, filename);
    } catch (err) {
      console.warn('Bridge loadGuidelineContent failed:', err);
    }
  },

  resetToDefaultGuidelines: () => {
    set({
      guidelines: DEFAULT_GUIDELINES,
      guidelineFileName: null,
      isCustomGuideline: false,
    });

    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem(STORAGE_KEYS.CUSTOM_GUIDELINE_RAW);
      localStorage.removeItem(STORAGE_KEYS.CUSTOM_GUIDELINE_NAME);
    }

    useBridgeStore.getState().setGuidelinesLoaded(false, DEFAULT_GUIDELINES.rules.length);
    useBridgeStore.getState().setTmStatus({
      guidelinesLoaded: false,
      guidelinesCount: DEFAULT_GUIDELINES.rules.length,
    });
  },

  loadTmFile: async (fileOrData) => {
    let name: string;
    let content: string;

    if (fileOrData instanceof File) {
      name = fileOrData.name;
      content = await fileOrData.text();
    } else {
      name = fileOrData.name;
      content = fileOrData.content;
    }

    await get().loadTmText(content, name);
  },

  loadTmText: async (content: string, filename = 'translation_memory.tmx') => {
    const entries = parseTmContent(content, filename);

    set({
      tmEntries: entries,
      tmFileName: filename,
    });

    // Sync bridgeStore
    useBridgeStore.getState().setTmStatus({
      tmLoaded: entries.length > 0,
      entriesCount: entries.length,
      fileName: filename,
    });

    try {
      const bridge = getBridgeService();
      await bridge.loadTmContent(content, filename);
    } catch (err) {
      console.warn('Bridge loadTmContent failed:', err);
    }
  },

  clearTm: () => {
    set({
      tmEntries: [],
      tmFileName: null,
    });

    useBridgeStore.getState().setTmStatus({
      tmLoaded: false,
      entriesCount: 0,
      fileName: undefined,
    });
  },

  startBatchScan: async (totalParagraphs = 25) => {
    useBridgeStore.getState().setBatchScanProgress({
      active: true,
      current: 0,
      total: totalParagraphs,
      percent: 0,
      isAborted: false,
    });

    try {
      const bridge = getBridgeService();
      await bridge.startBatchScan(totalParagraphs);
    } catch (err) {
      console.warn('Bridge startBatchScan failed:', err);
    }
  },

  abortBatchScan: async () => {
    useBridgeStore.getState().setBatchScanProgress({
      active: false,
      current: 0,
      total: 0,
      percent: 0,
      isAborted: true,
    });

    try {
      const bridge = getBridgeService();
      await bridge.abortBatchScan();
    } catch (err) {
      console.warn('Bridge abortBatchScan failed:', err);
    }
  },

  reset: () => {
    set({
      installedModels: [],
      isLoadingModels: false,
      modelError: null,
      guidelines: DEFAULT_GUIDELINES,
      guidelineFileName: null,
      isCustomGuideline: false,
      tmEntries: [],
      tmFileName: null,
      isSettingsModalOpen: false,
      isGuidelineViewerOpen: false,
    });
  },
}));
