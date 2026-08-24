import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateExponentialBackoff,
  InMemoryTokenStorage,
  LocalStorageTokenStorage,
  ConnectionManager,
  DEFAULT_BACKOFF_CONFIG,
} from '../connection_manager.ts';
import { type ParagraphPayload, type ReplacementCommand, type ReplacementResult } from '../types.ts';

describe('Task 18: Connection Manager & Auto-Pairing Resilience Engine', () => {
  describe('Exponential Backoff Calculation (1s, 2s, 4s, 8s, max 10s)', () => {
    it('should follow 1s, 2s, 4s, 8s sequence with default configuration', () => {
      assert.equal(calculateExponentialBackoff(0), 1000, 'Attempt 0 -> 1000ms (1s)');
      assert.equal(calculateExponentialBackoff(1), 2000, 'Attempt 1 -> 2000ms (2s)');
      assert.equal(calculateExponentialBackoff(2), 4000, 'Attempt 2 -> 4000ms (4s)');
      assert.equal(calculateExponentialBackoff(3), 8000, 'Attempt 3 -> 8000ms (8s)');
    });

    it('should cap at maximum 10s (10000ms) for attempts 4 and beyond', () => {
      assert.equal(calculateExponentialBackoff(4), 10000, 'Attempt 4 -> 10000ms (10s max cap)');
      assert.equal(calculateExponentialBackoff(5), 10000, 'Attempt 5 -> 10000ms');
      assert.equal(calculateExponentialBackoff(10), 10000, 'Attempt 10 -> 10000ms');
      assert.equal(calculateExponentialBackoff(100), 10000, 'Attempt 100 -> 10000ms');
    });

    it('should handle custom backoff configuration properly', () => {
      const customConfig = {
        initialDelayMs: 500,
        backoffMultiplier: 3,
        maxDelayMs: 5000,
      };

      assert.equal(calculateExponentialBackoff(0, customConfig), 500);
      assert.equal(calculateExponentialBackoff(1, customConfig), 1500);
      assert.equal(calculateExponentialBackoff(2, customConfig), 4500);
      assert.equal(calculateExponentialBackoff(3, customConfig), 5000, 'Capped at max 5000ms');
    });
  });

  describe('Secure Token Storage & Persistence', () => {
    it('should store, retrieve, and delete pairing token with InMemoryTokenStorage', async () => {
      const storage = new InMemoryTokenStorage();
      assert.equal(await storage.getToken(), null);

      await storage.setToken('custom-token-12345');
      assert.equal(await storage.getToken(), 'custom-token-12345');

      await storage.deleteToken();
      assert.equal(await storage.getToken(), null);
    });

    it('should resolve existing stored token or initialize with defaultToken without user prompt', async () => {
      const storage = new InMemoryTokenStorage();
      const manager = new ConnectionManager({
        tokenStorage: storage,
        defaultToken: 'auto-generated-token-xyz',
      });

      const token1 = await manager.resolvePairingToken();
      assert.equal(token1, 'auto-generated-token-xyz');

      // Subsequent retrieval gets persisted token
      assert.equal(await storage.getToken(), 'auto-generated-token-xyz');

      // Modifying token updates resolved token
      await manager.setPairingToken('rotated-token-abc');
      assert.equal(await manager.resolvePairingToken(), 'rotated-token-abc');
    });
  });

  describe('Connection Lifecycle & WebSocket Mock Harness', () => {
    interface MockWebSocket {
      url: string;
      readyState: number;
      send: ReturnType<typeof mock.fn>;
      close: ReturnType<typeof mock.fn>;
      addEventListener: (event: string, fn: Function) => void;
      onopen: Function | null;
      onmessage: Function | null;
      onclose: Function | null;
      onerror: Function | null;
      triggerOpen: () => void;
      triggerMessage: (data: any) => void;
      triggerClose: (code?: number) => void;
    }

    function createMockWebSocketHarness() {
      const instances: MockWebSocket[] = [];
      const waiters: ((ws: MockWebSocket) => void)[] = [];
      let consumedCount = 0;

      const factory = (url: string) => {
        const listeners: Record<string, Function[]> = {};
        const ws: MockWebSocket = {
          url,
          readyState: 0, // CONNECTING
          send: mock.fn((_data: string) => {}),
          close: mock.fn(() => {
            ws.readyState = 3; // CLOSED
            if (listeners['close']) {
              listeners['close'].forEach((fn) => fn({ code: 1006 }));
            }
          }),
          addEventListener: (event: string, fn: Function) => {
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(fn);
          },
          set onopen(fn: Function) {
            listeners['open'] = [fn];
          },
          get onopen() {
            return listeners['open']?.[0] || null;
          },
          set onmessage(fn: Function) {
            listeners['message'] = [fn];
          },
          get onmessage() {
            return listeners['message']?.[0] || null;
          },
          set onclose(fn: Function) {
            listeners['close'] = [fn];
          },
          get onclose() {
            return listeners['close']?.[0] || null;
          },
          set onerror(fn: Function) {
            listeners['error'] = [fn];
          },
          get onerror() {
            return listeners['error']?.[0] || null;
          },
          // Test trigger helpers
          triggerOpen: () => {
            ws.readyState = 1; // OPEN
            if (listeners['open']) {
              listeners['open'].forEach((fn) => fn());
            }
          },
          triggerMessage: (data: any) => {
            if (listeners['message']) {
              listeners['message'].forEach((fn) => fn({ data: JSON.stringify(data) }));
            }
          },
          triggerClose: (code = 1006) => {
            ws.readyState = 3;
            if (listeners['close']) {
              listeners['close'].forEach((fn) => fn({ code }));
            }
          },
        };

        instances.push(ws);
        const waiter = waiters.shift();
        if (waiter) {
          waiter(ws);
        }

        return ws as unknown as WebSocket;
      };

      const getNextSocket = (): Promise<MockWebSocket> => {
        if (consumedCount < instances.length) {
          const ws = instances[consumedCount];
          consumedCount++;
          return Promise.resolve(ws);
        }
        return new Promise<MockWebSocket>((resolve) => {
          waiters.push((ws) => {
            consumedCount++;
            resolve(ws);
          });
        });
      };

      return {
        factory,
        instances,
        getNextSocket,
      };
    }

    it('should complete handshake and reach CONNECTED state automatically', async () => {
      const storage = new InMemoryTokenStorage('test-pairing-token-32b');
      const harness = createMockWebSocketHarness();
      const manager = new ConnectionManager({
        tokenStorage: storage,
        websocketFactory: harness.factory,
        editorType: 'Word',
      });

      try {
        const stateChanges: string[] = [];
        manager.onStateChange((state) => stateChanges.push(state));

        const connectPromise = manager.connect();
        const ws = await harness.getNextSocket();

        // Trigger socket open
        assert.equal(ws.readyState, 0);
        ws.triggerOpen();

        // Ensure AUTH_HANDSHAKE envelope was sent
        assert.equal(ws.send.mock.callCount(), 1);
        const sentPayload = JSON.parse(ws.send.mock.calls[0].arguments[0]);
        assert.equal(sentPayload.type, 'AUTH_HANDSHAKE');
        assert.equal(sentPayload.payload.token, 'test-pairing-token-32b');
        assert.equal(sentPayload.payload.editorType, 'Word');

        // Server responds with AUTH_RESPONSE
        ws.triggerMessage({
          type: 'AUTH_RESPONSE',
          payload: {
            success: true,
            sessionToken: 'session-token-xyz',
            message: 'Authenticated successfully',
          },
        });

        const connected = await connectPromise;
        assert.equal(connected, true);
        assert.equal(manager.getState(), 'CONNECTED');
        assert.equal(manager.getSessionToken(), 'session-token-xyz');
        assert.equal(manager.getRetryAttempts(), 0);

        manager.disconnect();
        assert.equal(manager.getState(), 'DISCONNECTED');
      } finally {
        manager.disconnect();
      }
    });

    it('should trigger exponential backoff retry pipeline on sudden disconnect', async () => {
      const storage = new InMemoryTokenStorage('test-token');
      const harness = createMockWebSocketHarness();
      const manager = new ConnectionManager({
        tokenStorage: storage,
        websocketFactory: harness.factory,
        backoffConfig: {
          initialDelayMs: 100, // Speed up for test
          backoffMultiplier: 2,
          maxDelayMs: 1000,
        },
      });

      try {
        const connectPromise = manager.connect();
        const ws = await harness.getNextSocket();
        ws.triggerOpen();
        ws.triggerMessage({
          type: 'AUTH_RESPONSE',
          payload: { success: true, sessionToken: 'session-1' },
        });
        await connectPromise;
        assert.equal(manager.getState(), 'CONNECTED');

        // Track reconnect notifications
        const reconnectDetails: any[] = [];
        manager.onReconnecting((detail) => reconnectDetails.push(detail));

        // Simulate unexpected server socket drop
        ws.triggerClose(1006);

        assert.equal(manager.getState(), 'RECONNECTING');
        assert.equal(manager.getRetryAttempts(), 1);
        assert.equal(manager.getNextRetryDelay(), 100);
        assert.equal(reconnectDetails.length, 1);
        assert.equal(reconnectDetails[0].attempt, 1);
        assert.equal(reconnectDetails[0].delayMs, 100);
      } finally {
        manager.disconnect();
      }
    });

    it('should bypass backoff delay when retryNow() is manually invoked', async () => {
      const storage = new InMemoryTokenStorage('test-token');
      const harness = createMockWebSocketHarness();
      const manager = new ConnectionManager({
        tokenStorage: storage,
        websocketFactory: harness.factory,
        backoffConfig: {
          initialDelayMs: 50000, // Very high delay
        },
      });

      try {
        const connectPromise = manager.connect();
        const ws1 = await harness.getNextSocket();
        ws1.triggerOpen();
        ws1.triggerMessage({
          type: 'AUTH_RESPONSE',
          payload: { success: true, sessionToken: 'session-1' },
        });
        await connectPromise;

        // Drop connection
        ws1.triggerClose(1006);
        assert.equal(manager.getState(), 'RECONNECTING');

        // Invoke retryNow()
        const retryPromise = manager.retryNow();
        const ws2 = await harness.getNextSocket();
        ws2.triggerOpen();
        ws2.triggerMessage({
          type: 'AUTH_RESPONSE',
          payload: { success: true, sessionToken: 'session-2' },
        });

        const retryResult = await retryPromise;
        assert.equal(retryResult, true);
        assert.equal(manager.getState(), 'CONNECTED');
        assert.equal(manager.getRetryAttempts(), 0);
      } finally {
        manager.disconnect();
      }
    });

    it('should dispatch incoming REPLACEMENT_COMMAND to registered command listeners', async () => {
      const storage = new InMemoryTokenStorage('test-token');
      const harness = createMockWebSocketHarness();
      const manager = new ConnectionManager({
        tokenStorage: storage,
        websocketFactory: harness.factory,
      });

      try {
        const receivedCommands: ReplacementCommand[] = [];
        manager.onCommand((cmd) => receivedCommands.push(cmd));

        const connectPromise = manager.connect();
        const ws = await harness.getNextSocket();
        ws.triggerOpen();
        ws.triggerMessage({
          type: 'AUTH_RESPONSE',
          payload: { success: true, sessionToken: 'session-1' },
        });
        await connectPromise;

        const mockCommand: ReplacementCommand = {
          commandId: 'cmd-1234',
          paragraphId: 'p-1',
          baseHash: 'oldhash',
          expectedHash: 'newhash',
          hunks: [
            { start: 0, end: 5, oldText: 'Hello', newText: 'Hi' },
          ],
        };

        ws.triggerMessage({
          type: 'REPLACEMENT_COMMAND',
          payload: mockCommand,
        });

        assert.equal(receivedCommands.length, 1);
        assert.equal(receivedCommands[0].commandId, 'cmd-1234');
        assert.equal(receivedCommands[0].hunks[0].newText, 'Hi');
      } finally {
        manager.disconnect();
      }
    });
  });
});
