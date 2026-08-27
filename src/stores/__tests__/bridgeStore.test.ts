import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useBridgeStore } from '../bridgeStore.ts';
import { MockBridgeService } from '../../services/tauriBridge.ts';
import { type ParagraphPayload } from '../../../shared/protocol/types.ts';

describe('SmartLinter Bridge Zustand Store', () => {
  let mockService: MockBridgeService;

  beforeEach(() => {
    useBridgeStore.getState().reset();
    mockService = new MockBridgeService();
  });

  afterEach(() => {
    mockService.destroy();
  });

  it('should initialize with expected default values', () => {
    const state = useBridgeStore.getState();
    expect(state.editorConnected).toBe(false);
    expect(state.editorType).toBeNull();
    expect(state.llmAlive).toBe(false);
    expect(state.llmModel).toBe('qwen2.5:7b');
    expect(state.tmLoaded).toBe(false);
    expect(state.tmEntriesCount).toBe(0);
    expect(state.splitMode).toBe('horizontal');
    expect(state.layoutPreset).toBe('balanced');
    expect(state.pinned).toBe(false);
    expect(state.paragraphs).toEqual([]);
    expect(state.activeParagraph).toBeNull();
  });

  it('should update editor status on setEditorStatus', () => {
    useBridgeStore.getState().setEditorStatus({
      connected: true,
      editorType: 'Word',
      activeDocument: 'Translation_Doc_v1.docx',
      sessionId: 'sess-12345',
    });

    const state = useBridgeStore.getState();
    expect(state.editorConnected).toBe(true);
    expect(state.editorType).toBe('Word');
    expect(state.activeDocument).toBe('Translation_Doc_v1.docx');
    expect(state.sessionId).toBe('sess-12345');
    expect(state.lastHeartbeat).toBeTypeOf('number');
  });

  it('should update LLM health on setLlmStatus', () => {
    useBridgeStore.getState().setLlmStatus({
      isAlive: true,
      provider: 'ollama',
      activeModel: 'qwen2.5:7b',
      latencyMs: 294,
    });

    const state = useBridgeStore.getState();
    expect(state.llmAlive).toBe(true);
    expect(state.llmModel).toBe('qwen2.5:7b');
    expect(state.llmLatency).toBe(294);
  });

  it('should update TM and guideline status', () => {
    useBridgeStore.getState().setTmStatus({
      tmLoaded: true,
      entriesCount: 1420,
      fileName: 'cloud_terms.tmx',
      guidelinesLoaded: true,
      guidelinesCount: 12,
    });

    const state = useBridgeStore.getState();
    expect(state.tmLoaded).toBe(true);
    expect(state.tmEntriesCount).toBe(1420);
    expect(state.tmFileName).toBe('cloud_terms.tmx');
    expect(state.guidelinesLoaded).toBe(true);
    expect(state.guidelinesCount).toBe(12);
  });

  it('should toggle and set split layout modes', () => {
    expect(useBridgeStore.getState().splitMode).toBe('horizontal');

    useBridgeStore.getState().toggleSplitMode();
    expect(useBridgeStore.getState().splitMode).toBe('vertical');

    useBridgeStore.getState().toggleSplitMode();
    expect(useBridgeStore.getState().splitMode).toBe('horizontal');

    useBridgeStore.getState().setSplitMode('vertical');
    expect(useBridgeStore.getState().splitMode).toBe('vertical');
  });

  it('should set layout presets independently from split mode', () => {
    expect(useBridgeStore.getState().layoutPreset).toBe('balanced');

    useBridgeStore.getState().setLayoutPreset('qa-focus');
    expect(useBridgeStore.getState().layoutPreset).toBe('qa-focus');
    expect(useBridgeStore.getState().splitMode).toBe('horizontal');

    useBridgeStore.getState().setLayoutPreset('tm-focus');
    expect(useBridgeStore.getState().layoutPreset).toBe('tm-focus');
  });

  it('should toggle and set pin mode (always-on-top) and call bridgeService', async () => {
    // Set default bridge service to mockService
    const { setBridgeService } = await import('../../services/tauriBridge.ts');
    setBridgeService(mockService);

    expect(useBridgeStore.getState().pinned).toBe(false);
    expect(mockService.isAlwaysOnTop()).toBe(false);

    // Toggle on
    useBridgeStore.getState().togglePin();
    expect(useBridgeStore.getState().pinned).toBe(true);
    expect(mockService.isAlwaysOnTop()).toBe(true);

    // Toggle off
    useBridgeStore.getState().togglePin();
    expect(useBridgeStore.getState().pinned).toBe(false);
    expect(mockService.isAlwaysOnTop()).toBe(false);

    // Explicit setPinned(true)
    useBridgeStore.getState().setPinned(true);
    expect(useBridgeStore.getState().pinned).toBe(true);
    expect(mockService.isAlwaysOnTop()).toBe(true);

    // Explicit setPinned(false)
    useBridgeStore.getState().setPinned(false);
    expect(useBridgeStore.getState().pinned).toBe(false);
    expect(mockService.isAlwaysOnTop()).toBe(false);
  });

  it('connects InDesign and refreshes the editor status', async () => {
    const { setBridgeService } = await import('../../services/tauriBridge.ts');
    const connectIndesign = vi.spyOn(mockService, 'connectIndesign');
    vi.spyOn(mockService, 'fetchBridgeHealth').mockResolvedValue({
      connected: true,
      editorType: 'InDesign',
      activeDocument: 'Catalog_2026.indd',
    });
    setBridgeService(mockService);

    const connecting = useBridgeStore.getState().connectIndesign();
    expect(useBridgeStore.getState().isConnectingIndesign).toBe(true);

    await connecting;

    expect(connectIndesign).toHaveBeenCalledOnce();
    expect(useBridgeStore.getState().isConnectingIndesign).toBe(false);
    expect(useBridgeStore.getState().editorConnected).toBe(true);
    expect(useBridgeStore.getState().editorType).toBe('InDesign');
    expect(useBridgeStore.getState().activeDocument).toBe('Catalog_2026.indd');
  });

  it('should manage paragraphs telemetry and deduplicate by paragraphId', () => {
    const p1: ParagraphPayload = {
      paragraphId: 'para-1',
      text: 'First test paragraph',
      hash: 'hash-aaa',
      source: 'Doc.docx',
      timestamp: 1000,
      editorType: 'Word',
    };

    const p2: ParagraphPayload = {
      paragraphId: 'para-2',
      text: 'Second test paragraph',
      hash: 'hash-bbb',
      source: 'Doc.docx',
      timestamp: 2000,
      editorType: 'Word',
    };

    useBridgeStore.getState().addParagraph(p1);
    expect(useBridgeStore.getState().paragraphs.length).toBe(1);
    expect(useBridgeStore.getState().activeParagraph).toEqual(p1);

    useBridgeStore.getState().addParagraph(p2);
    expect(useBridgeStore.getState().paragraphs.length).toBe(2);
    expect(useBridgeStore.getState().activeParagraph).toEqual(p2);

    // Re-adding p1 with updated text should replace and move to top
    const p1Updated: ParagraphPayload = {
      ...p1,
      text: 'Updated first paragraph text',
      hash: 'hash-aaa-updated',
    };
    useBridgeStore.getState().addParagraph(p1Updated);
    expect(useBridgeStore.getState().paragraphs.length).toBe(2);
    expect(useBridgeStore.getState().paragraphs[0].text).toBe('Updated first paragraph text');
    expect(useBridgeStore.getState().activeParagraph?.text).toBe('Updated first paragraph text');
  });

  it('should react to bridge events through initEventListener', () => {
    const unlisten = useBridgeStore.getState().initEventListener(mockService);

    // Emit bridge status event
    mockService.emit('bridge-status-changed', {
      connected: true,
      editorType: 'InDesign',
      activeDocument: 'Catalog_2026.indd',
    });

    expect(useBridgeStore.getState().editorConnected).toBe(true);
    expect(useBridgeStore.getState().editorType).toBe('InDesign');
    expect(useBridgeStore.getState().activeDocument).toBe('Catalog_2026.indd');

    // Emit paragraph event
    mockService.emit('new-paragraph-detected', {
      paragraphId: 'para-indesign-1',
      text: 'Adobe InDesign paragraph telemetry',
      hash: 'hash-id-1',
      source: 'Catalog_2026.indd',
      timestamp: Date.now(),
      editorType: 'InDesign',
    });

    expect(useBridgeStore.getState().paragraphs.length).toBe(1);
    expect(useBridgeStore.getState().activeParagraph?.paragraphId).toBe('para-indesign-1');

    // Emit LLM status event
    mockService.emit('llm-status-changed', {
      isAlive: true,
      provider: 'ollama',
      activeModel: 'qwen2.5:7b',
      latencyMs: 150,
    });
    expect(useBridgeStore.getState().llmAlive).toBe(true);
    expect(useBridgeStore.getState().llmLatency).toBe(150);

    // Clean up
    unlisten();

    // After unlistening, emitted events should not update the store
    mockService.emit('bridge-status-changed', {
      connected: false,
      editorType: null,
    });
    expect(useBridgeStore.getState().editorConnected).toBe(true);
  });
});
