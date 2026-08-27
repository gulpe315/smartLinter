import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { listen as listenTauriEvent } from '@tauri-apps/api/event';
import {
  TauriBridgeService,
  MockBridgeService,
  getBridgeService,
  setBridgeService,
} from '../tauriBridge.ts';
import { type ParagraphPayload, type ReplacementCommand } from '../../../shared/protocol/types.ts';
import { type GuidelineSet } from '../../types/config.ts';

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(),
  listen: vi.fn(),
}));

describe('TauriBridgeService & IPC Integration', () => {
  beforeEach(() => {
    delete (window as any).isTauri;
    delete (window as any).__TAURI_INTERNALS__;
    vi.mocked(listenTauriEvent).mockReset();
  });

  afterEach(() => {
    delete (window as any).isTauri;
    delete (window as any).__TAURI_INTERNALS__;
  });

  it('delegates to fallback MockBridgeService when the Tauri runtime is absent', async () => {
    const service = new TauriBridgeService();

    const isPinned = await service.setAlwaysOnTop(true);
    expect(isPinned).toBe(true);

    const health = await service.fetchBridgeHealth();
    expect(health.version).toBe('0.1.0-mock');

    expect(await service.checkIndesignStatus()).toBe(false);
    await expect(service.connectIndesign()).resolves.toBeUndefined();

    const command: ReplacementCommand = {
      commandId: 'cmd-1',
      paragraphId: 'para-1',
      baseHash: 'h1',
      expectedHash: 'h2',
      hunks: [],
    };
    const result = await service.sendReplacementCommand(command);
    expect(result.status).toBe('SUCCESS');

    service.destroy();
  });

  it('invokes Tauri command set_always_on_top through the official API bindings', async () => {
    const invokeMock = vi.fn().mockResolvedValue(true);
    (window as any).isTauri = true;
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeMock };

    const service = new TauriBridgeService();
    const isPinned = await service.setAlwaysOnTop(true);

    expect(invokeMock).toHaveBeenCalledWith('set_always_on_top', { pinned: true }, undefined);
    expect(isPinned).toBe(true);

    service.destroy();
  });

  it('invokes InDesign commands through Tauri when available', async () => {
    const invokeMock = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(undefined);
    (window as any).isTauri = true;
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeMock };

    const service = new TauriBridgeService();

    expect(await service.checkIndesignStatus()).toBe(true);
    await expect(service.connectIndesign()).resolves.toBeUndefined();
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'check_indesign_status', {}, undefined);
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'connect_indesign', {}, undefined);

    service.destroy();
  });

  it('invokes Tauri command get_bridge_status through the official API bindings', async () => {
    const invokeMock = vi.fn().mockResolvedValue({
      connected: true,
      editorType: 'Word',
      sessionId: 'sess-abc',
      version: '0.1.0',
    });
    (window as any).isTauri = true;
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeMock };

    const service = new TauriBridgeService();
    const status = await service.fetchBridgeHealth();

    expect(invokeMock).toHaveBeenCalledWith('get_bridge_status', {}, undefined);
    expect(status.connected).toBe(true);
    expect(status.editorType).toBe('Word');

    service.destroy();
  });

  it('forwards analysis options to Tauri only when guidelines are present', async () => {
    const invokeMock = vi.fn().mockResolvedValue({ status: 'PASS', issues: [] });
    (window as any).isTauri = true;
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeMock };
    const service = new TauriBridgeService();
    const paragraph: ParagraphPayload = {
      paragraphId: 'para-guidelines', text: 'Text', hash: 'hash', source: '', timestamp: 1, editorType: 'InDesign',
    };
    const guidelines: GuidelineSet = {
      language: 'ko',
      name: 'Project rules', rules: [{ category: 'Terminology', description: 'Keep product names.' }], rawContent: '',
    };

    await service.analyzeParagraph(paragraph, { guidelines });
    await service.analyzeParagraph(paragraph);

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'analyze_paragraph', { paragraph, options: { guidelines } }, undefined);
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'analyze_paragraph', { paragraph }, undefined);
    service.destroy();
  });

  it('returns FAILED replacement result when Tauri replacement IPC fails without using fallback', async () => {
    const error = new Error('Editor connection lost');
    const invokeMock = vi.fn().mockRejectedValue(error);
    (window as any).isTauri = true;
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeMock };
    const service = new TauriBridgeService();
    const fallbackSpy = vi.spyOn((service as any).fallbackService, 'sendReplacementCommand');
    const command: ReplacementCommand = {
      commandId: 'cmd-failed', paragraphId: 'para-failed', baseHash: 'base-hash', expectedHash: 'expected-hash', hunks: [],
    };

    await expect(service.sendReplacementCommand(command)).resolves.toEqual({
      commandId: command.commandId,
      status: 'FAILED',
      currentHash: command.baseHash,
      message: error.message,
    });
    expect(fallbackSpy).not.toHaveBeenCalled();
    service.destroy();
  });

  it('rejects Tauri analysis IPC failures without using fallback', async () => {
    const error = new Error('Ollama unavailable');
    const invokeMock = vi.fn().mockRejectedValue(error);
    (window as any).isTauri = true;
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeMock };
    const service = new TauriBridgeService();
    const fallbackSpy = vi.spyOn((service as any).fallbackService, 'analyzeParagraph');
    const paragraph: ParagraphPayload = {
      paragraphId: 'para-fallback', text: 'Text', hash: 'hash', source: '', timestamp: 1, editorType: 'InDesign',
    };

    await expect(service.analyzeParagraph(paragraph)).rejects.toThrow(error);
    expect(fallbackSpy).not.toHaveBeenCalled();
    service.destroy();
  });

  it('rejects Tauri AI command IPC failures without using fallback', async () => {
    const error = new Error('Ollama unavailable');
    const invokeMock = vi.fn().mockRejectedValue(error);
    (window as any).isTauri = true;
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeMock };
    const service = new TauriBridgeService();
    const fallbackSpy = vi.spyOn((service as any).fallbackService, 'executeAiCommand');
    const paragraph: ParagraphPayload = {
      paragraphId: 'para-ai-failure', text: 'Text', hash: 'hash', source: '', timestamp: 1, editorType: 'InDesign',
    };

    await expect(service.executeAiCommand('Rewrite this', paragraph)).rejects.toThrow(error);
    expect(fallbackSpy).not.toHaveBeenCalled();
    service.destroy();
  });

  it('listens to Tauri events and transforms BridgeStatusEvent from Rust session', async () => {
    let capturedHandler: ((evt: { payload: any }) => void) | null = null;
    const unlistenFn = vi.fn();
    vi.mocked(listenTauriEvent).mockImplementation((_event, cb) => {
      capturedHandler = cb;
      return Promise.resolve(unlistenFn);
    });
    (window as any).isTauri = true;

    const service = new TauriBridgeService();
    const statusHandler = vi.fn();

    const unlisten = service.listen('bridge-status-changed', statusHandler);

    expect(listenTauriEvent).toHaveBeenCalledWith('bridge-status-changed', expect.any(Function));

    // Simulate event payload from Rust BridgeStatusEvent
    if (capturedHandler) {
      capturedHandler({
        payload: {
          eventName: 'bridge-status-changed',
          state: {
            status: 'CONNECTED',
            editorType: 'InDesign',
            sessionId: 'sess-indesign-99',
            activeDocument: 'Magazine.indd',
          },
          timestamp: 123456789,
        },
      });
    }

    expect(statusHandler).toHaveBeenCalledWith({
      connected: true,
      editorType: 'InDesign',
      sessionId: 'sess-indesign-99',
      activeDocument: 'Magazine.indd',
    });

    unlisten();
    service.destroy();
  });

  it('manages singleton getBridgeService and setBridgeService', () => {
    const mock = new MockBridgeService();
    setBridgeService(mock);
    expect(getBridgeService()).toBe(mock);
  });
});
