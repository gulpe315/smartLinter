/**
 * Unit Tests for SmartLinter ConfigStore
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useConfigStore } from '../configStore.ts';
import { useBridgeStore } from '../bridgeStore.ts';
import { useQaStore } from '../qaStore.ts';
import { MockBridgeService, setBridgeService } from '../../services/tauriBridge.ts';
import { DEFAULT_GUIDELINES } from '../../types/config.ts';

describe('useConfigStore', () => {
  let mockBridge: MockBridgeService;

  beforeEach(() => {
    mockBridge = new MockBridgeService();
    setBridgeService(mockBridge);
    useConfigStore.getState().reset();
    useBridgeStore.getState().reset();
    useQaStore.getState().reset();
    localStorage.clear();
  });

  it('should initialize with default state and guidelines', () => {
    const state = useConfigStore.getState();
    expect(state.selectedModel).toBe('qwen2.5:7b');
    expect(state.targetLang).toBe('ko');
    expect(state.explanationLang).toBe('ko');
    expect(state.guidelines.rules.length).toBe(DEFAULT_GUIDELINES.rules.length);
    expect(state.isCustomGuideline).toBe(false);
    expect(state.tmEntries.length).toBe(0);
    expect(state.isSettingsModalOpen).toBe(false);
  });

  it('persists independently selected QA language settings', () => {
    useConfigStore.getState().setTargetLang('ja');
    useConfigStore.getState().setExplanationLang('en');

    expect(useConfigStore.getState().targetLang).toBe('ja');
    expect(useConfigStore.getState().explanationLang).toBe('en');
    expect(localStorage.getItem('smartlinter_target_lang')).toBe('ja');
    expect(localStorage.getItem('smartlinter_explanation_lang')).toBe('en');
  });

  it('clears the QA analysis error when either QA language setting changes', () => {
    useQaStore.getState().setAnalysisError('Unvalidated language profile');
    useConfigStore.getState().setTargetLang('ja');
    expect(useQaStore.getState().analysisError).toBeNull();

    useQaStore.getState().setAnalysisError('Unvalidated language profile');
    useConfigStore.getState().setExplanationLang('en');
    expect(useQaStore.getState().analysisError).toBeNull();
  });

  it('should fetch installed Ollama models successfully', async () => {
    await useConfigStore.getState().fetchModels();
    const state = useConfigStore.getState();

    expect(state.installedModels.length).toBeGreaterThan(0);
    expect(state.installedModels.some((m) => m.name === 'qwen2.5:7b')).toBe(true);
    expect(state.installedModels.some((m) => m.name === 'qwen2.5:14b' && m.vramWarning)).toBe(true);
  });

  it('should switch selected model immediately and sync bridgeStore and localStorage', async () => {
    await useConfigStore.getState().setSelectedModel('llama3.1:8b');

    expect(useConfigStore.getState().selectedModel).toBe('llama3.1:8b');
    expect(localStorage.getItem('smartlinter_selected_model')).toBe('llama3.1:8b');
    expect(useBridgeStore.getState().llmModel).toBe('llama3.1:8b');
    expect(useBridgeStore.getState().llmAlive).toBe(true);
  });

  it('synchronizes the restored selected model to the backend queue on startup', async () => {
    useConfigStore.setState({ selectedModel: 'gemma2:latest' });
    const setModelSpy = vi.spyOn(mockBridge, 'setOllamaModel');

    await useConfigStore.getState().syncSelectedModel();

    expect(setModelSpy).toHaveBeenCalledWith('gemma2:latest');
    expect(useBridgeStore.getState().llmModel).toBe('gemma2:latest');
  });

  it('keeps the newest Ollama health result when requests resolve out of order', async () => {
    let resolveFirst!: (value: any) => void;
    let resolveSecond!: (value: any) => void;
    mockBridge.checkOllamaHealth = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));

    const first = useConfigStore.getState().refreshLlmHealth();
    const second = useConfigStore.getState().refreshLlmHealth();
    resolveSecond({ isAlive: true, provider: 'ollama', activeModel: 'qwen2.5:7b' });
    await second;
    resolveFirst({ isAlive: false, provider: 'ollama', activeModel: 'qwen2.5:7b', message: 'stale' });
    await first;

    expect(useBridgeStore.getState().llmAlive).toBe(true);
  });

  it('should load custom guideline text, sync bridgeStore and allow reset', async () => {
    const customMd = `# Special Project Rules\n## Terminology\n- [UI] Use [저장] instead of [Save]`;

    await useConfigStore.getState().loadGuidelineText(customMd, 'custom.agents');

    const state = useConfigStore.getState();
    expect(state.isCustomGuideline).toBe(true);
    expect(state.guidelineFileName).toBe('custom.agents');
    expect(state.guidelines.rules.length).toBe(1);
    expect(state.guidelines.rules[0].description).toBe('Use [저장] instead of [Save]');

    // Check bridgeStore sync
    expect(useBridgeStore.getState().guidelinesLoaded).toBe(true);
    expect(useBridgeStore.getState().guidelinesCount).toBe(1);

    // Reset to defaults
    useConfigStore.getState().resetToDefaultGuidelines();
    const resetState = useConfigStore.getState();
    expect(resetState.isCustomGuideline).toBe(false);
    expect(resetState.guidelines.rules.length).toBe(DEFAULT_GUIDELINES.rules.length);
    expect(useBridgeStore.getState().guidelinesLoaded).toBe(false);
  });

  it('should load TM file, sync bridgeStore and clear TM correctly', async () => {
    const tmJson = JSON.stringify({
      units: [
        { source: 'Settings', target: '설정' },
        { source: 'Dashboard', target: '대시보드' },
      ],
    });

    await useConfigStore.getState().loadTmText(tmJson, 'sample.json');

    expect(useConfigStore.getState().tmEntries.length).toBe(2);
    expect(useConfigStore.getState().tmFileName).toBe('sample.json');
    expect(useBridgeStore.getState().tmLoaded).toBe(true);
    expect(useBridgeStore.getState().tmEntriesCount).toBe(2);

    // Clear TM
    useConfigStore.getState().clearTm();
    expect(useConfigStore.getState().tmEntries.length).toBe(0);
    expect(useBridgeStore.getState().tmLoaded).toBe(false);
    expect(useBridgeStore.getState().tmEntriesCount).toBe(0);
  });

  it('should trigger batch scan and handle abort correctly', async () => {
    await useConfigStore.getState().startBatchScan(10);
    expect(useBridgeStore.getState().batchScanning).toBe(true);
    expect(useBridgeStore.getState().batchTotal).toBe(10);

    await useConfigStore.getState().abortBatchScan();
    expect(useBridgeStore.getState().batchScanning).toBe(false);
    expect(useBridgeStore.getState().batchAborted).toBe(true);
  });

  it('resets batch scan progress when starting the bridge scan fails', async () => {
    mockBridge.startBatchScan = vi.fn().mockRejectedValue(new Error('Tauri backend unavailable'));

    await useConfigStore.getState().startBatchScan(10);

    expect(useBridgeStore.getState()).toMatchObject({
      batchScanning: false,
      batchCurrent: 0,
      batchTotal: 0,
      batchPercent: 0,
      batchAborted: false,
    });
  });

  it('should open and close modals', () => {
    useConfigStore.getState().openSettingsModal();
    expect(useConfigStore.getState().isSettingsModalOpen).toBe(true);

    useConfigStore.getState().closeSettingsModal();
    expect(useConfigStore.getState().isSettingsModalOpen).toBe(false);

    useConfigStore.getState().openGuidelineViewer();
    expect(useConfigStore.getState().isGuidelineViewerOpen).toBe(true);

    useConfigStore.getState().closeGuidelineViewer();
    expect(useConfigStore.getState().isGuidelineViewerOpen).toBe(false);
  });
});
