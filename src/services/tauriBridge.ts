/**
 * SmartLinter Bridge Service & Event Subscription Abstraction
 *
 * Provides strongly-typed abstraction layer for communication with
 * Tauri Rust backend and the Local Bridge Server (127.0.0.1:49152).
 */

import {
  type EditorType,
  type ParagraphPayload,
  type ReplacementCommand,
  type ReplacementResult,
} from '../../shared/protocol/types.ts';

/** Bridge status event payload */
export interface BridgeStatusPayload {
  connected: boolean;
  editorType: EditorType | null;
  sessionId?: string;
  activeDocument?: string;
  version?: string;
}

/** LLM health and connectivity payload */
export interface LlmStatusPayload {
  isAlive: boolean;
  provider: string;
  activeModel?: string;
  latencyMs?: number;
  message?: string;
}

/** TM & Guideline loaded status payload */
export interface TmStatusPayload {
  tmLoaded: boolean;
  entriesCount: number;
  fileName?: string;
  guidelinesLoaded: boolean;
  guidelinesCount: number;
}

/** Batch scan progress event payload */
export interface BatchScanProgressPayload {
  active: boolean;
  current: number;
  total: number;
  percent: number;
  isAborted: boolean;
}

/** Supported Bridge Event Map */
export interface BridgeEventMap {
  'bridge-status-changed': BridgeStatusPayload;
  'new-paragraph-detected': ParagraphPayload;
  'replacement-result': ReplacementResult;
  'llm-status-changed': LlmStatusPayload;
  'tm-status-changed': TmStatusPayload;
  'batch-scan-progress': BatchScanProgressPayload;
}

export type BridgeEventName = keyof BridgeEventMap;
export type BridgeEventHandler<K extends BridgeEventName> = (payload: BridgeEventMap[K]) => void;

/**
 * Abstract interface for event subscription & backend communication
 */
export interface IBridgeService {
  /** Subscribes to a strongly-typed backend event. Returns an unlisten cleanup function. */
  listen<K extends BridgeEventName>(event: K, handler: BridgeEventHandler<K>): () => void;

  /** Emits an event (useful in mock / testing environments) */
  emit<K extends BridgeEventName>(event: K, payload: BridgeEventMap[K]): void;

  /** Sends a text replacement command to the native editor via bridge */
  sendReplacementCommand(command: ReplacementCommand): Promise<ReplacementResult>;

  /** Fetches current bridge health and status */
  fetchBridgeHealth(): Promise<BridgeStatusPayload>;

  /** Aborts ongoing batch scan */
  abortBatchScan(): Promise<boolean>;

  /** Disconnects all listeners and cleans up resources */
  destroy(): void;
}

/**
 * In-memory / Mock Bridge Service for browser development and unit testing
 */
export class MockBridgeService implements IBridgeService {
  private listeners: Map<string, Set<(payload: any) => void>> = new Map();

  listen<K extends BridgeEventName>(event: K, handler: BridgeEventHandler<K>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const handlers = this.listeners.get(event)!;
    handlers.add(handler as (payload: any) => void);

    return () => {
      handlers.delete(handler as (payload: any) => void);
    };
  }

  emit<K extends BridgeEventName>(event: K, payload: BridgeEventMap[K]): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach((h) => {
        try {
          h(payload);
        } catch (err) {
          console.error(`Error executing listener for ${event}:`, err);
        }
      });
    }
  }

  async sendReplacementCommand(command: ReplacementCommand): Promise<ReplacementResult> {
    const result: ReplacementResult = {
      commandId: command.commandId,
      status: 'SUCCESS',
      currentHash: command.expectedHash,
      message: 'Mock replacement applied successfully',
    };
    this.emit('replacement-result', result);
    return result;
  }

  async fetchBridgeHealth(): Promise<BridgeStatusPayload> {
    return {
      connected: false,
      editorType: null,
      version: '0.1.0-mock',
    };
  }

  async abortBatchScan(): Promise<boolean> {
    this.emit('batch-scan-progress', {
      active: false,
      current: 0,
      total: 0,
      percent: 0,
      isAborted: true,
    });
    return true;
  }

  destroy(): void {
    this.listeners.clear();
  }
}

/**
 * Tauri IPC Bridge Service (delegates to window.__TAURI__ when running in Tauri webview)
 */
export class TauriBridgeService implements IBridgeService {
  private fallbackService = new MockBridgeService();
  private unlisteners: Array<() => void> = [];

  private isTauriAvailable(): boolean {
    return typeof window !== 'undefined' && '__TAURI__' in window;
  }

  listen<K extends BridgeEventName>(event: K, handler: BridgeEventHandler<K>): () => void {
    if (!this.isTauriAvailable()) {
      return this.fallbackService.listen(event, handler);
    }

    try {
      const tauri = (window as any).__TAURI__;
      if (tauri?.event?.listen) {
        let active = true;
        let tauriUnlisten: (() => void) | null = null;

        tauri.event
          .listen(event, (evt: { payload: BridgeEventMap[K] }) => {
            if (active) {
              handler(evt.payload);
            }
          })
          .then((unlistenFn: () => void) => {
            if (!active) {
              unlistenFn();
            } else {
              tauriUnlisten = unlistenFn;
            }
          })
          .catch((err: unknown) => {
            console.warn(`Failed to attach Tauri event listener for ${event}:`, err);
          });

        const unlisten = () => {
          active = false;
          if (tauriUnlisten) {
            tauriUnlisten();
          }
        };
        this.unlisteners.push(unlisten);
        return unlisten;
      }
    } catch (e) {
      console.warn('Tauri event listen invocation failed, using fallback:', e);
    }

    return this.fallbackService.listen(event, handler);
  }

  emit<K extends BridgeEventName>(event: K, payload: BridgeEventMap[K]): void {
    if (!this.isTauriAvailable()) {
      this.fallbackService.emit(event, payload);
      return;
    }

    try {
      const tauri = (window as any).__TAURI__;
      if (tauri?.event?.emit) {
        tauri.event.emit(event, payload);
        return;
      }
    } catch (e) {
      console.warn('Tauri event emit failed:', e);
    }

    this.fallbackService.emit(event, payload);
  }

  async sendReplacementCommand(command: ReplacementCommand): Promise<ReplacementResult> {
    if (!this.isTauriAvailable()) {
      return this.fallbackService.sendReplacementCommand(command);
    }

    try {
      const tauri = (window as any).__TAURI__;
      if (tauri?.core?.invoke) {
        return await tauri.core.invoke('send_replacement_command', { command });
      }
    } catch (e) {
      console.warn('Tauri invoke send_replacement_command failed, using fallback:', e);
    }

    return this.fallbackService.sendReplacementCommand(command);
  }

  async fetchBridgeHealth(): Promise<BridgeStatusPayload> {
    if (!this.isTauriAvailable()) {
      return this.fallbackService.fetchBridgeHealth();
    }

    try {
      const tauri = (window as any).__TAURI__;
      if (tauri?.core?.invoke) {
        return await tauri.core.invoke('get_bridge_status');
      }
    } catch (e) {
      console.warn('Tauri invoke get_bridge_status failed:', e);
    }

    return this.fallbackService.fetchBridgeHealth();
  }

  async abortBatchScan(): Promise<boolean> {
    if (!this.isTauriAvailable()) {
      return this.fallbackService.abortBatchScan();
    }

    try {
      const tauri = (window as any).__TAURI__;
      if (tauri?.core?.invoke) {
        return await tauri.core.invoke('abort_batch_scan');
      }
    } catch (e) {
      console.warn('Tauri invoke abort_batch_scan failed:', e);
    }

    return this.fallbackService.abortBatchScan();
  }

  destroy(): void {
    this.unlisteners.forEach((u) => u());
    this.unlisteners = [];
    this.fallbackService.destroy();
  }
}

/** Singleton instance provider */
let defaultBridgeService: IBridgeService | null = null;

export function getBridgeService(): IBridgeService {
  if (!defaultBridgeService) {
    defaultBridgeService = new TauriBridgeService();
  }
  return defaultBridgeService;
}

export function setBridgeService(service: IBridgeService): void {
  if (defaultBridgeService && defaultBridgeService !== service) {
    defaultBridgeService.destroy();
  }
  defaultBridgeService = service;
}
