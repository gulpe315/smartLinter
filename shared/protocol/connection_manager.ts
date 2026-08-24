/**
 * SmartLinter Shared Connection Manager & Auto-Pairing Resilience Engine
 *
 * Implements OS Keyring/Token Storage persistence, zero-friction auto-connect,
 * and Exponential Backoff (1s, 2s, 4s, up to 10s) auto-reconnect pipeline for
 * seamless recovery from network disconnects or process restarts.
 */

import {
  type EditorType,
  type ParagraphPayload,
  type ReplacementCommand,
  type ReplacementResult,
  type AuthHandshake,
  type AuthResponse,
  type HeartbeatPayload,
  type BridgeMessage,
  isBridgeMessage,
  isParagraphPayload,
} from './types.ts';

/** Connection lifecycle states */
export type ConnectionState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'AUTHENTICATING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'ERROR';

/** Exponential backoff configuration options */
export interface ExponentialBackoffConfig {
  /** Initial retry delay in milliseconds (default: 1000ms / 1s) */
  initialDelayMs?: number;
  /** Multiplier for each subsequent retry attempt (default: 2.0) */
  backoffMultiplier?: number;
  /** Maximum retry delay cap in milliseconds (default: 10000ms / 10s) */
  maxDelayMs?: number;
  /** Maximum number of retry attempts (-1 for infinite, default: -1) */
  maxAttempts?: number;
}

/** Default exponential backoff constants (1s -> 2s -> 4s -> ... max 10s) */
export const DEFAULT_BACKOFF_CONFIG: Required<ExponentialBackoffConfig> = {
  initialDelayMs: 1000,
  backoffMultiplier: 2.0,
  maxDelayMs: 10000,
  maxAttempts: -1,
};

/**
 * Calculates exponential backoff delay based on 0-indexed attempt number.
 * Sequence with defaults:
 * - Attempt 0: 1,000ms (1s)
 * - Attempt 1: 2,000ms (2s)
 * - Attempt 2: 4,000ms (4s)
 * - Attempt 3: 8,000ms (8s)
 * - Attempt 4+: 10,000ms (capped at 10s)
 */
export function calculateExponentialBackoff(
  attemptIndex: number,
  config?: ExponentialBackoffConfig
): number {
  const initial = config?.initialDelayMs ?? DEFAULT_BACKOFF_CONFIG.initialDelayMs;
  const multiplier = config?.backoffMultiplier ?? DEFAULT_BACKOFF_CONFIG.backoffMultiplier;
  const maxDelay = config?.maxDelayMs ?? DEFAULT_BACKOFF_CONFIG.maxDelayMs;

  const delay = initial * Math.pow(multiplier, Math.max(0, attemptIndex));
  return Math.min(Math.round(delay), maxDelay);
}

/** Abstract interface for local pairing token persistence */
export interface ITokenStorage {
  getToken(): Promise<string | null> | string | null;
  setToken(token: string): Promise<void> | void;
  deleteToken(): Promise<void> | void;
}

/** In-memory token storage (default for testing or stateless runners) */
export class InMemoryTokenStorage implements ITokenStorage {
  private token: string | null = null;

  constructor(initialToken?: string) {
    if (initialToken) {
      this.token = initialToken;
    }
  }

  getToken(): string | null {
    return this.token;
  }

  setToken(token: string): void {
    this.token = token;
  }

  deleteToken(): void {
    this.token = null;
  }
}

/** Browser/Webview LocalStorage-backed token storage */
export class LocalStorageTokenStorage implements ITokenStorage {
  private readonly storageKey: string;

  constructor(storageKey = 'smartlinter_pairing_token') {
    this.storageKey = storageKey;
  }

  getToken(): string | null {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(this.storageKey);
      }
    } catch {
      // Storage access blocked or restricted
    }
    return null;
  }

  setToken(token: string): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(this.storageKey, token);
      }
    } catch {
      // Storage access blocked or restricted
    }
  }

  deleteToken(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(this.storageKey);
      }
    } catch {
      // Storage access blocked or restricted
    }
  }
}

/** Reconnect event details payload */
export interface ReconnectDetail {
  attempt: number;
  delayMs: number;
  nextRetryTimestamp: number;
}

/** Configuration options for ConnectionManager */
export interface ConnectionManagerConfig {
  /** Local Bridge host (default: '127.0.0.1') */
  host?: string;
  /** Local Bridge port (default: 49152) */
  port?: number;
  /** Editor type (default: 'Word') */
  editorType?: EditorType;
  /** Client version string (default: '0.1.0') */
  version?: string;
  /** Pairing token storage backend */
  tokenStorage?: ITokenStorage;
  /** Default pairing token fallback if storage is empty */
  defaultToken?: string;
  /** Exponential backoff retry configuration */
  backoffConfig?: ExponentialBackoffConfig;
  /** Heartbeat interval in milliseconds (default: 5000, 0 to disable) */
  heartbeatIntervalMs?: number;
  /** Active document title provider */
  getDocumentName?: () => string;
  /** Custom WebSocket factory (for testing or mock environments) */
  websocketFactory?: (url: string) => WebSocket;
}

/** Event listener types */
export type StateChangeHandler = (state: ConnectionState, detail?: string) => void;
export type ReconnectHandler = (detail: ReconnectDetail) => void;
export type CommandHandler = (command: ReplacementCommand) => void | Promise<void>;

/**
 * SmartLinter Connection Manager
 *
 * Manages zero-friction pairing token persistence, automatic authentication,
 * and resilient exponential backoff reconnect pipeline.
 */
export class ConnectionManager {
  private readonly host: string;
  private readonly port: number;
  private readonly editorType: EditorType;
  private readonly version: string;
  private readonly tokenStorage: ITokenStorage;
  private readonly defaultToken: string;
  private readonly backoffConfig: Required<ExponentialBackoffConfig>;
  private readonly heartbeatIntervalMs: number;
  private readonly getDocumentName?: () => string;
  private readonly websocketFactory?: (url: string) => WebSocket;

  private state: ConnectionState = 'DISCONNECTED';
  private ws: WebSocket | null = null;
  private sessionToken: string | null = null;
  private retryAttempts = 0;
  private nextRetryDelay = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private isDisposed = false;

  private readonly stateListeners: Set<StateChangeHandler> = new Set();
  private readonly reconnectListeners: Set<ReconnectHandler> = new Set();
  private readonly commandListeners: Set<CommandHandler> = new Set();

  constructor(config: ConnectionManagerConfig = {}) {
    this.host = config.host || '127.0.0.1';
    this.port = config.port || 49152;
    this.editorType = config.editorType || 'Word';
    this.version = config.version || '0.1.0';
    this.tokenStorage = config.tokenStorage || new InMemoryTokenStorage();
    this.defaultToken = config.defaultToken || 'smartlinter-default-dev-token-secret-32b';
    this.backoffConfig = {
      initialDelayMs: config.backoffConfig?.initialDelayMs ?? DEFAULT_BACKOFF_CONFIG.initialDelayMs,
      backoffMultiplier:
        config.backoffConfig?.backoffMultiplier ?? DEFAULT_BACKOFF_CONFIG.backoffMultiplier,
      maxDelayMs: config.backoffConfig?.maxDelayMs ?? DEFAULT_BACKOFF_CONFIG.maxDelayMs,
      maxAttempts: config.backoffConfig?.maxAttempts ?? DEFAULT_BACKOFF_CONFIG.maxAttempts,
    };
    this.heartbeatIntervalMs = config.heartbeatIntervalMs ?? 5000;
    this.getDocumentName = config.getDocumentName;
    this.websocketFactory = config.websocketFactory;
  }

  /** Current connection state */
  public getState(): ConnectionState {
    return this.state;
  }

  /** Number of consecutive failed reconnection attempts */
  public getRetryAttempts(): number {
    return this.retryAttempts;
  }

  /** Next planned retry delay in milliseconds (0 if connected or disconnected) */
  public getNextRetryDelay(): number {
    return this.nextRetryDelay;
  }

  /** Active session token once authenticated */
  public getSessionToken(): string | null {
    return this.sessionToken;
  }

  /** HTTP Bridge Base URL */
  public getHttpUrl(): string {
    return `http://${this.host}:${this.port}`;
  }

  /** WebSocket Bridge URL */
  public getWsUrl(token?: string): string {
    const params = new URLSearchParams({ editorType: this.editorType });
    if (token) {
      params.set('token', token);
    }
    return `ws://${this.host}:${this.port}/ws?${params.toString()}`;
  }

  /**
   * Resolves pairing token from secure storage or fallback.
   * If token is stored, returns it; otherwise persists defaultToken and returns it.
   */
  public async resolvePairingToken(): Promise<string> {
    const stored = await this.tokenStorage.getToken();
    if (stored && stored.trim().length > 0) {
      return stored.trim();
    }

    // Persist default token for subsequent zero-friction auto-connect
    await this.tokenStorage.setToken(this.defaultToken);
    return this.defaultToken;
  }

  /**
   * Updates pairing token in secure storage.
   */
  public async setPairingToken(newToken: string): Promise<void> {
    await this.tokenStorage.setToken(newToken);
  }

  /**
   * Clears pairing token from secure storage.
   */
  public async clearPairingToken(): Promise<void> {
    await this.tokenStorage.deleteToken();
  }

  /** Subscribes to connection state changes */
  public onStateChange(handler: StateChangeHandler): () => void {
    this.stateListeners.add(handler);
    return () => this.stateListeners.delete(handler);
  }

  /** Subscribes to reconnection attempt notifications (for banners/countdown) */
  public onReconnecting(handler: ReconnectHandler): () => void {
    this.reconnectListeners.add(handler);
    return () => this.reconnectListeners.delete(handler);
  }

  /** Subscribes to replacement commands */
  public onCommand(handler: CommandHandler): () => void {
    this.commandListeners.add(handler);
    return () => this.commandListeners.delete(handler);
  }

  /**
   * Initiates connection to the Local Bridge Server.
   * Uses WebSocket connection if available, with REST fallback.
   */
  public async connect(): Promise<boolean> {
    if (this.isDisposed) {
      return false;
    }

    this.clearReconnectTimer();
    this.setState('CONNECTING');

    const token = await this.resolvePairingToken();

    // Check if WebSocket is available
    if (this.websocketFactory || (typeof WebSocket !== 'undefined')) {
      return this.connectWebSocket(token);
    } else {
      return this.connectRest(token);
    }
  }

  /**
   * Triggers an immediate reconnection attempt, bypassing remaining backoff wait.
   */
  public async retryNow(): Promise<boolean> {
    this.clearReconnectTimer();
    return this.connect();
  }

  /**
   * Disconnects cleanly and cancels active reconnection timers.
   */
  public disconnect(): void {
    this.isDisposed = true;
    this.clearHeartbeat();
    this.clearReconnectTimer();

    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore close errors
      }
      this.ws = null;
    }

    this.sessionToken = null;
    this.retryAttempts = 0;
    this.nextRetryDelay = 0;
    this.setState('DISCONNECTED', 'Manual disconnect');
  }

  /**
   * Sends paragraph telemetry payload to the bridge server.
   */
  public async sendParagraph(payload: ParagraphPayload): Promise<boolean> {
    if (!isParagraphPayload(payload)) {
      throw new Error('Invalid ParagraphPayload');
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.state === 'CONNECTED') {
      try {
        const msg: BridgeMessage = {
          type: 'PARAGRAPH_PAYLOAD',
          payload,
        };
        this.ws.send(JSON.stringify(msg));
        return true;
      } catch {
        // Fall back to REST if WS send fails
      }
    }

    return this.sendTelemetryRest(payload);
  }

  /**
   * Sends periodic heartbeat payload.
   */
  public async sendHeartbeat(): Promise<boolean> {
    const payload: HeartbeatPayload = {
      editorType: this.editorType,
      timestamp: Date.now(),
      activeDocument: this.getDocumentName ? this.getDocumentName() : undefined,
    };

    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.state === 'CONNECTED') {
      try {
        const msg: BridgeMessage = {
          type: 'HEARTBEAT',
          payload,
        };
        this.ws.send(JSON.stringify(msg));
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  /**
   * Sends replacement execution result back to the server.
   */
  public async sendReplacementResult(result: ReplacementResult): Promise<boolean> {
    if (!result || !result.commandId) {
      throw new Error('Invalid ReplacementResult');
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.state === 'CONNECTED') {
      try {
        const msg: BridgeMessage = {
          type: 'REPLACEMENT_RESULT',
          payload,
        } as any;
        this.ws.send(JSON.stringify({ type: 'REPLACEMENT_RESULT', payload: result }));
        return true;
      } catch {
        // Fall back to REST
      }
    }

    try {
      const token = await this.resolvePairingToken();
      const res = await fetch(`${this.getHttpUrl()}/replacement/result`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'x-bridge-token': token,
        },
        body: JSON.stringify(result),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // --- Internal WebSocket Connection Pipeline ---

  private connectWebSocket(token: string): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const wsUrl = this.getWsUrl(token);
        const socket = this.websocketFactory ? this.websocketFactory(wsUrl) : new WebSocket(wsUrl);
        this.ws = socket;

        let authResolved = false;

        socket.onopen = () => {
          this.setState('AUTHENTICATING');

          const handshake: AuthHandshake = {
            token,
            editorType: this.editorType,
            version: this.version,
            clientNonce: Math.random().toString(36).substring(2) + Date.now().toString(36),
          };

          const envelope: BridgeMessage = {
            type: 'AUTH_HANDSHAKE',
            payload: handshake,
          };

          socket.send(JSON.stringify(envelope));
        };

        socket.onmessage = (event) => {
          try {
            const rawData = typeof event.data === 'string' ? event.data : event.data.toString();
            const msg = JSON.parse(rawData);

            if (isBridgeMessage(msg)) {
              this.handleBridgeMessage(msg);

              if (msg.type === 'AUTH_RESPONSE') {
                if (msg.payload.success) {
                  this.sessionToken = msg.payload.sessionToken || null;
                  this.retryAttempts = 0;
                  this.nextRetryDelay = 0;
                  this.setState('CONNECTED', msg.payload.message);
                  this.startHeartbeat();
                  if (!authResolved) {
                    authResolved = true;
                    resolve(true);
                  }
                } else {
                  this.setState('ERROR', msg.payload.message || 'Authentication rejected');
                  if (!authResolved) {
                    authResolved = true;
                    resolve(false);
                  }
                }
              }
            }
          } catch {
            // Ignore malformed message
          }
        };

        socket.onerror = () => {
          if (!authResolved) {
            authResolved = true;
            resolve(false);
          }
        };

        socket.onclose = () => {
          this.clearHeartbeat();
          if (this.state !== 'DISCONNECTED' && !this.isDisposed) {
            this.handleUnexpectedDisconnect();
          }
          if (!authResolved) {
            authResolved = true;
            resolve(false);
          }
        };
      } catch (err) {
        this.handleUnexpectedDisconnect((err as Error).message);
        resolve(false);
      }
    });
  }

  private async connectRest(token: string): Promise<boolean> {
    this.setState('AUTHENTICATING');
    try {
      const handshake: AuthHandshake = {
        token,
        editorType: this.editorType,
        version: this.version,
        clientNonce: Math.random().toString(36).substring(2) + Date.now().toString(36),
      };

      const res = await fetch(`${this.getHttpUrl()}/auth/handshake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(handshake),
      });

      if (res.ok) {
        const authRes = (await res.json()) as AuthResponse;
        if (authRes.success) {
          this.sessionToken = authRes.sessionToken || null;
          this.retryAttempts = 0;
          this.nextRetryDelay = 0;
          this.setState('CONNECTED', 'REST connection established');
          this.startHeartbeat();
          return true;
        }
      }

      this.setState('ERROR', 'REST authentication failed');
      return false;
    } catch (err) {
      this.handleUnexpectedDisconnect((err as Error).message);
      return false;
    }
  }

  private async sendTelemetryRest(payload: ParagraphPayload): Promise<boolean> {
    try {
      const token = await this.resolvePairingToken();
      const res = await fetch(`${this.getHttpUrl()}/telemetry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'x-bridge-token': token,
        },
        body: JSON.stringify(payload),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private handleBridgeMessage(message: BridgeMessage): void {
    if (message.type === 'REPLACEMENT_COMMAND') {
      for (const handler of this.commandListeners) {
        try {
          handler(message.payload);
        } catch {
          // Isolate subscriber error
        }
      }
    }
  }

  private handleUnexpectedDisconnect(reason?: string): void {
    if (this.isDisposed) {
      return;
    }

    if (
      this.backoffConfig.maxAttempts >= 0 &&
      this.retryAttempts >= this.backoffConfig.maxAttempts
    ) {
      this.setState('ERROR', `Reconnection attempts exhausted (${this.retryAttempts})`);
      return;
    }

    // Calculate next backoff delay
    const delay = calculateExponentialBackoff(this.retryAttempts, this.backoffConfig);
    this.retryAttempts++;
    this.nextRetryDelay = delay;

    this.setState('RECONNECTING', reason || `Reconnecting in ${delay}ms...`);

    const detail: ReconnectDetail = {
      attempt: this.retryAttempts,
      delayMs: delay,
      nextRetryTimestamp: Date.now() + delay,
    };

    for (const listener of this.reconnectListeners) {
      try {
        listener(detail);
      } catch {
        // Isolate subscriber error
      }
    }

    this.scheduleReconnect(delay);
  }

  private scheduleReconnect(delayMs: number): void {
    this.clearReconnectTimer();

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.isDisposed) {
        await this.connect();
      }
    }, delayMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    if (this.heartbeatIntervalMs > 0) {
      this.heartbeatTimer = setInterval(() => {
        this.sendHeartbeat().catch(() => {});
      }, this.heartbeatIntervalMs);
    }
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private setState(newState: ConnectionState, detail?: string): void {
    if (this.state !== newState) {
      this.state = newState;
      for (const listener of this.stateListeners) {
        try {
          listener(newState, detail);
        } catch {
          // Isolate subscriber error
        }
      }
    }
  }
}
