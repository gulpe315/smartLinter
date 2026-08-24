import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  TauriBridgeService,
  MockBridgeService,
  getBridgeService,
  setBridgeService,
} from '../tauriBridge.ts';
import { type ReplacementCommand } from '../../../shared/protocol/types.ts';

describe('TauriBridgeService & IPC Integration', () => {
  beforeEach(() => {
    // Reset window.__TAURI__
    delete (window as any).__TAURI__;
  });

  afterEach(() => {
    delete (window as any).__TAURI__;
  });

  it('delegates to fallback MockBridgeService when window.__TAURI__ is absent', async () => {
    const service = new TauriBridgeService();

    const isPinned = await service.setAlwaysOnTop(true);
    expect(isPinned).toBe(true);

    const health = await service.fetchBridgeHealth();
    expect(health.version).toBe('0.1.0-mock');

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

  it('invokes Tauri command set_always_on_top when window.__TAURI__.core.invoke is present', async () => {
    const invokeMock = vi.fn().mockResolvedValue(true);
    (window as any).__TAURI__ = {
      core: {
        invoke: invokeMock,
      },
    };

    const service = new TauriBridgeService();
    const isPinned = await service.setAlwaysOnTop(true);

    expect(invokeMock).toHaveBeenCalledWith('set_always_on_top', { pinned: true });
    expect(isPinned).toBe(true);

    service.destroy();
  });

  it('invokes Tauri command get_bridge_status when window.__TAURI__.core.invoke is present', async () => {
    const invokeMock = vi.fn().mockResolvedValue({
      connected: true,
      editorType: 'Word',
      sessionId: 'sess-abc',
      version: '0.1.0',
    });
    (window as any).__TAURI__ = {
      core: {
        invoke: invokeMock,
      },
    };

    const service = new TauriBridgeService();
    const status = await service.fetchBridgeHealth();

    expect(invokeMock).toHaveBeenCalledWith('get_bridge_status');
    expect(status.connected).toBe(true);
    expect(status.editorType).toBe('Word');

    service.destroy();
  });

  it('listens to Tauri events and transforms BridgeStatusEvent from Rust session', async () => {
    let capturedHandler: ((evt: { payload: any }) => void) | null = null;
    const unlistenFn = vi.fn();
    const listenMock = vi.fn().mockImplementation((_event, cb) => {
      capturedHandler = cb;
      return Promise.resolve(unlistenFn);
    });

    (window as any).__TAURI__ = {
      event: {
        listen: listenMock,
      },
    };

    const service = new TauriBridgeService();
    const statusHandler = vi.fn();

    const unlisten = service.listen('bridge-status-changed', statusHandler);

    expect(listenMock).toHaveBeenCalledWith('bridge-status-changed', expect.any(Function));

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
