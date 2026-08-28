/**
 * SmartLinter MS Word Bridge Client
 *
 * Manages WebSocket & REST communication with the Local Tauri Bridge Server (127.0.0.1:49152),
 * handles automatic token pairing, heartbeats, paragraph telemetry dispatch, and incoming commands.
 */

import {
    type ParagraphPayload,
    type ReplacementCommand,
    type ReplacementResult,
    type LiveSnapshotRequest,
    type LiveSnapshotResponse,
    type LocateRequest,
    type LocateResponse,
    type AuthHandshake,
    type AuthResponse,
    type HeartbeatPayload,
    type BridgeMessage,
    isBridgeMessage,
    isParagraphPayload,
} from '../../../shared/protocol/types.ts';

const DEFAULT_DEV_PAIRING_TOKEN = 'smartlinter-default-dev-token-secret-32b';

export type BridgeConnectionStatus =
    | 'DISCONNECTED'
    | 'CONNECTING'
    | 'AUTHENTICATING'
    | 'CONNECTED'
    | 'ERROR';

export interface BridgeClientConfig {
    /** Bridge Server host (default: '127.0.0.1') */
    serverHost?: string;
    /** Bridge Server port (default: 49152) */
    serverPort?: number;
    /** Secret pairing token or token getter function */
    token?: string | (() => string | Promise<string>);
    /** Client version string (default: '0.1.0') */
    version?: string;
    /** Whether to connect via WebSocket (default: true) */
    enableWebSocket?: boolean;
    /** Periodic heartbeat interval in milliseconds (default: 5000, 0 to disable) */
    heartbeatIntervalMs?: number;
    /** Auto-reconnection retry delay in milliseconds (default: 2000) */
    reconnectDelayMs?: number;
    /** Maximum auto-reconnection attempts (-1 for infinite, default: 10) */
    maxReconnectAttempts?: number;
    /** Active document name provider */
    getDocumentName?: () => string;
}

export type CommandHandler = (command: ReplacementCommand) => void | Promise<void>;
export type SnapshotRequestHandler = (request: LiveSnapshotRequest) => void | Promise<void>;
export type LocateRequestHandler = (request: LocateRequest) => void | Promise<void>;
export type StatusChangeHandler = (status: BridgeConnectionStatus, message?: string) => void;

export class WordBridgeClient {
    private readonly serverHost: string;
    private readonly serverPort: number;
    private readonly tokenSupplier: string | (() => string | Promise<string>);
    private readonly version: string;
    private readonly enableWebSocket: boolean;
    private readonly heartbeatIntervalMs: number;
    private readonly reconnectDelayMs: number;
    private readonly maxReconnectAttempts: number;
    private readonly getDocumentName?: () => string;

    private status: BridgeConnectionStatus = 'DISCONNECTED';
    private ws: WebSocket | null = null;
    private sessionToken: string | null = null;
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectAttempts = 0;
    private isDisposed = false;

    private readonly commandHandlers: Set<CommandHandler> = new Set();
    private readonly snapshotRequestHandlers: Set<SnapshotRequestHandler> = new Set();
    private readonly locateRequestHandlers: Set<LocateRequestHandler> = new Set();
    private readonly statusHandlers: Set<StatusChangeHandler> = new Set();

    constructor(config: BridgeClientConfig = {}) {
        this.serverHost = config.serverHost || '127.0.0.1';
        this.serverPort = config.serverPort || 49152;
        this.tokenSupplier = config.token
            || import.meta.env?.VITE_SMARTLINTER_DEV_TOKEN
            || DEFAULT_DEV_PAIRING_TOKEN;
        this.version = config.version || '0.1.0';
        this.enableWebSocket = config.enableWebSocket !== false;
        this.heartbeatIntervalMs = config.heartbeatIntervalMs ?? 5000;
        this.reconnectDelayMs = config.reconnectDelayMs ?? 2000;
        this.maxReconnectAttempts = config.maxReconnectAttempts ?? 10;
        this.getDocumentName = config.getDocumentName;
    }

    /** Returns the base HTTP URL of the local bridge server */
    public getHttpUrl(): string {
        return `http://${this.serverHost}:${this.serverPort}`;
    }

    /** Returns the WebSocket URL of the local bridge server */
    public getWsUrl(token?: string): string {
        const queryParams = new URLSearchParams({ editorType: 'Word' });
        if (token) {
            queryParams.set('token', token);
        }
        return `ws://${this.serverHost}:${this.serverPort}/ws?${queryParams.toString()}`;
    }

    /** Current connection status */
    public getStatus(): BridgeConnectionStatus {
        return this.status;
    }

    /** Current session token if authenticated */
    public getSessionToken(): string | null {
        return this.sessionToken;
    }

    /** Subscribes to replacement commands from the server */
    public onCommand(handler: CommandHandler): () => void {
        this.commandHandlers.add(handler);
        return () => this.commandHandlers.delete(handler);
    }

    /** Subscribes to live snapshot requests received over the connected WebSocket. */
    public onSnapshotRequest(handler: SnapshotRequestHandler): () => void {
        this.snapshotRequestHandlers.add(handler);
        return () => this.snapshotRequestHandlers.delete(handler);
    }

    /** Subscribes to locate requests received over the connected WebSocket. */
    public onLocateRequest(handler: LocateRequestHandler): () => void {
        this.locateRequestHandlers.add(handler);
        return () => this.locateRequestHandlers.delete(handler);
    }

    /** Subscribes to status changes */
    public onStatusChange(handler: StatusChangeHandler): () => void {
        this.statusHandlers.add(handler);
        return () => this.statusHandlers.delete(handler);
    }

    /** Resolves the pairing token */
    public async resolveToken(): Promise<string> {
        if (typeof this.tokenSupplier === 'function') {
            return await this.tokenSupplier();
        }
        return this.tokenSupplier;
    }

    /** Initiates connection to the Bridge Server */
    public async connect(): Promise<boolean> {
        if (this.isDisposed) {
            return false;
        }

        this.clearReconnectTimer();
        const token = await this.resolveToken();

        if (this.enableWebSocket && typeof WebSocket !== 'undefined') {
            const wsOk = await this.connectWebSocket(token);
            if (wsOk || this.isDisposed) {
                return wsOk;
            }

            this.cleanupWebSocket();
            this.clearReconnectTimer();
        }

        return this.connectRestFallback(token);
    }

    /** Disconnects and cleans up resources */
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
        this.setStatus('DISCONNECTED', 'Client disconnected');
    }

    /**
     * Sends paragraph telemetry payload to the bridge server.
     * Uses active WebSocket connection if available and authenticated, otherwise falls back to REST POST.
     */
    public async sendParagraphPayload(payload: ParagraphPayload): Promise<boolean> {
        if (!isParagraphPayload(payload)) {
            throw new Error('Invalid ParagraphPayload structure');
        }

        // 1. Attempt WebSocket sending if connected & authenticated
        if (this.ws && this.ws.readyState === WebSocket.OPEN && this.status === 'CONNECTED') {
            try {
                const message: BridgeMessage = {
                    type: 'PARAGRAPH_PAYLOAD',
                    payload,
                };
                this.ws.send(JSON.stringify(message));
                return true;
            } catch (err) {
                // Fall back to REST if WS send fails
            }
        }

        // 2. REST HTTP POST fallback
        return this.sendTelemetryRest(payload);
    }

    /**
     * Sends heartbeat payload to keep connection alive and update active document title.
     */
    public async sendHeartbeat(): Promise<boolean> {
        const payload: HeartbeatPayload = {
            editorType: 'Word',
            timestamp: Date.now(),
            activeDocument: this.getDocumentName ? this.getDocumentName() : undefined,
        };

        if (this.ws && this.ws.readyState === WebSocket.OPEN && this.status === 'CONNECTED') {
            try {
                const message: BridgeMessage = {
                    type: 'HEARTBEAT',
                    payload,
                };
                this.ws.send(JSON.stringify(message));
                return true;
            } catch {
                return false;
            }
        }
        return false;
    }

    /**
     * Sends replacement execution result back to the bridge server.
     */
    public async sendReplacementResult(result: ReplacementResult): Promise<boolean> {
        if (!result || typeof result.commandId !== 'string') {
            throw new Error('Invalid ReplacementResult structure');
        }

        if (this.ws && this.ws.readyState === WebSocket.OPEN && this.status === 'CONNECTED') {
            try {
                const message: BridgeMessage = {
                    type: 'REPLACEMENT_RESULT',
                    payload: result,
                };
                this.ws.send(JSON.stringify(message));
                return true;
            } catch {
                // Fall back to REST if WS send fails
            }
        }

        try {
            const token = await this.resolveToken();
            const response = await fetch(`${this.getHttpUrl()}/replacement/result`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-bridge-token': token,
                },
                body: JSON.stringify(result),
                signal: AbortSignal.timeout(3000),
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    /** Sends a live snapshot response. Snapshot RPC is WebSocket-only: no REST fallback exists. */
    public sendSnapshotResponse(response: LiveSnapshotResponse): boolean {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.status !== 'CONNECTED') {
            return false;
        }
        try {
            const message: BridgeMessage = { type: 'LIVE_SNAPSHOT_RESPONSE', payload: response };
            this.ws.send(JSON.stringify(message));
            return true;
        } catch {
            return false;
        }
    }

    /** Sends a locate response. Locate RPC is WebSocket-only. */
    public sendLocateResponse(response: LocateResponse): boolean {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.status !== 'CONNECTED') return false;
        try {
            this.ws.send(JSON.stringify({ type: 'LOCATE_RESPONSE', payload: response } satisfies BridgeMessage));
            return true;
        } catch { return false; }
    }

    // --- Internal Connection Logic ---

    private connectWebSocket(token: string): Promise<boolean> {
        return new Promise((resolve) => {
            this.clearReconnectTimer();
            this.setStatus('CONNECTING');

            try {
                const wsUrl = this.getWsUrl(token);
                const socket = new WebSocket(wsUrl);
                this.ws = socket;

                let authResolved = false;

                socket.onopen = () => {
                    this.setStatus('AUTHENTICATING');
                    // Send explicit AUTH_HANDSHAKE envelope
                    const handshake: AuthHandshake = {
                        token,
                        editorType: 'Word',
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
                                    this.reconnectAttempts = 0;
                                    this.setStatus('CONNECTED', msg.payload.message);
                                    this.startHeartbeat();
                                    if (!authResolved) {
                                        authResolved = true;
                                        resolve(true);
                                    }
                                } else {
                                    this.setStatus('ERROR', msg.payload.message || 'Auth rejected');
                                    if (!authResolved) {
                                        authResolved = true;
                                        resolve(false);
                                    }
                                }
                            }
                        }
                    } catch (err) {
                        // Malformed JSON ignored
                    }
                };

                socket.onerror = () => {
                    if (!authResolved) {
                        authResolved = true;
                        resolve(false);
                    }
                };

                socket.onclose = (event) => {
                    this.clearHeartbeat();
                    if (!authResolved) {
                        authResolved = true;
                        resolve(false);
                        return;
                    }

                    if (this.status !== 'DISCONNECTED' && !this.isDisposed) {
                        this.setStatus('DISCONNECTED', `WebSocket closed (code: ${event.code})`);
                        this.scheduleReconnect();
                    }
                };
            } catch (err) {
                this.setStatus('ERROR', (err as Error).message);
                resolve(false);
            }
        });
    }

    private async connectRestFallback(token: string): Promise<boolean> {
        this.setStatus('AUTHENTICATING');
        try {
            const handshake: AuthHandshake = {
                token,
                editorType: 'Word',
                version: this.version,
                clientNonce: Math.random().toString(36).substring(2) + Date.now().toString(36),
            };

            const response = await fetch(`${this.getHttpUrl()}/auth/handshake`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(handshake),
                signal: AbortSignal.timeout(3000),
            });

            if (response.ok) {
                const authRes = (await response.json()) as AuthResponse;
                if (authRes.success) {
                    this.sessionToken = authRes.sessionToken || null;
                    this.reconnectAttempts = 0;
                    this.clearReconnectTimer();
                    this.setStatus('CONNECTED', 'REST connection verified');
                    this.startHeartbeat();
                    return true;
                }
            }

            this.setStatus('ERROR', 'REST Handshake authentication rejected');
            return false;
        } catch (err) {
            this.setStatus('DISCONNECTED', (err as Error).message);
            this.scheduleReconnect();
            return false;
        }
    }

    private async sendTelemetryRest(payload: ParagraphPayload): Promise<boolean> {
        try {
            const token = await this.resolveToken();
            const response = await fetch(`${this.getHttpUrl()}/telemetry`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'x-bridge-token': token,
                },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(3000),
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    private handleBridgeMessage(message: BridgeMessage): void {
        switch (message.type) {
            case 'REPLACEMENT_COMMAND':
                for (const handler of this.commandHandlers) {
                    try {
                        void Promise.resolve(handler(message.payload)).catch(() => {});
                    } catch {
                        // Error isolated
                    }
                }
                break;
            case 'LIVE_SNAPSHOT_REQUEST':
                for (const handler of this.snapshotRequestHandlers) {
                    try {
                        void Promise.resolve(handler(message.payload)).catch(() => {});
                    } catch {
                        // Error isolated
                    }
                }
                break;
            case 'LOCATE_REQUEST':
                for (const handler of this.locateRequestHandlers) {
                    try { void Promise.resolve(handler(message.payload)).catch(() => {}); } catch { /* isolated */ }
                }
                break;
            case 'AUTH_RESPONSE':
            case 'PARAGRAPH_PAYLOAD':
            case 'REPLACEMENT_RESULT':
            case 'LIVE_SNAPSHOT_RESPONSE':
            case 'LOCATE_RESPONSE':
            case 'HEARTBEAT':
            case 'AUTH_HANDSHAKE':
                break;
        }
    }

    private setStatus(newStatus: BridgeConnectionStatus, message?: string): void {
        if (this.status !== newStatus) {
            this.status = newStatus;
            for (const handler of this.statusHandlers) {
                try {
                    handler(newStatus, message);
                } catch {
                    // Handler error isolated
                }
            }
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

    private cleanupWebSocket(): void {
        if (this.ws) {
            try {
                this.ws.onopen = null;
                this.ws.onmessage = null;
                this.ws.onerror = null;
                this.ws.onclose = null;
                this.ws.close();
            } catch {
                // Ignore close errors
            }
            this.ws = null;
        }
    }

    private scheduleReconnect(): void {
        if (this.isDisposed || this.reconnectTimer) {
            return;
        }

        if (this.maxReconnectAttempts >= 0 && this.reconnectAttempts >= this.maxReconnectAttempts) {
            return;
        }

        this.reconnectAttempts++;
        const backoff = Math.min(this.reconnectDelayMs * Math.pow(1.5, this.reconnectAttempts - 1), 15000);

        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = null;
            if (!this.isDisposed) {
                await this.connect();
            }
        }, backoff);
    }

    private clearReconnectTimer(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
}
