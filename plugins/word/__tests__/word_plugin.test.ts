/**
 * Unit & Integration Test Suite for Task 7: MS Word Plugin
 * (Shared Runtime, Hide on Startup, Idle Debounce Monitor, and Telemetry Dispatch)
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as http from 'node:http';
import { fileURLToPath } from 'node:url';

import { WordRuntimeManager } from '../src/runtime_manager.ts';
import { WordBridgeClient } from '../src/bridge_client.ts';
import { WordDocumentListener } from '../src/document_listener.ts';
import { initializeWordAddin, btnToggleHide } from '../src/index.ts';
import { MockWordEnvironment } from './mock_office_word.ts';

import { computeParagraphHash, verifyParagraphHash } from '../../../shared/engine/hash_util.ts';
import {
    type ParagraphPayload,
    type AuthHandshake,
    type AuthResponse,
    type BridgeMessage,
    isParagraphPayload,
    isAuthHandshake,
} from '../../../shared/protocol/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const manifestPath = path.resolve(__dirname, '../manifest.xml');

describe('Task 7: MS Word Plugin (Shared Runtime & Idle Monitor)', () => {
    // =========================================================================
    // 1. Acceptance Criterion 1: manifest.xml Shared Runtime & Configuration
    // =========================================================================
    describe('Criterion (1): manifest.xml Shared Runtime Declaration', () => {
        it('should exist and contain valid XML structure', () => {
            assert.equal(fs.existsSync(manifestPath), true, 'manifest.xml must exist');
            const content = fs.readFileSync(manifestPath, 'utf8');
            assert.ok(content.startsWith('<?xml'), 'manifest.xml must have XML declaration');
            assert.ok(content.includes('<OfficeApp'), 'manifest.xml must have root <OfficeApp>');
        });

        it('should declare Shared Runtime with lifetime="long"', () => {
            const content = fs.readFileSync(manifestPath, 'utf8');
            assert.ok(
                content.includes('<Runtime resid="Taskpane.Url" lifetime="long" />') ||
                content.includes('lifetime="long"'),
                'manifest.xml must declare Shared Runtime with lifetime="long"'
            );
            assert.ok(content.includes('<Runtimes>'), 'manifest.xml must include <Runtimes> element');
        });

        it('should configure ReadWriteDocument permissions and Bridge server AppDomain', () => {
            const content = fs.readFileSync(manifestPath, 'utf8');
            assert.ok(content.includes('<Permissions>ReadWriteDocument</Permissions>'));
            assert.ok(content.includes('<AppDomain>http://127.0.0.1:49152</AppDomain>'));
            assert.ok(content.includes('<AppDomain>https://localhost:5173</AppDomain>'));
        });

        it('should define ribbon controls for toggle and show task pane', () => {
            const content = fs.readFileSync(manifestPath, 'utf8');
            assert.ok(content.includes('id="ShowTaskpaneButton"'));
            assert.ok(content.includes('id="HideTaskpaneButton"'));
            assert.ok(content.includes('<FunctionName>btnToggleHide</FunctionName>'));
        });
    });

    // =========================================================================
    // 2. Acceptance Criterion 2: Startup & Immediate Office.addin.hide()
    // =========================================================================
    describe('Criterion (2): Add-in Startup & Immediate Office.addin.hide()', () => {
        let env: MockWordEnvironment;

        beforeEach(() => {
            env = new MockWordEnvironment();
        });

        it('should call Office.addin.setStartupBehavior(Load) and Office.addin.hide() immediately on startup', async () => {
            const runtime = new WordRuntimeManager({
                officeHost: env.office,
                autoHideOnStartup: true,
                autoSetStartupBehavior: true,
                bridgeConfig: { enableWebSocket: false }, // avoid network in unit test
            });

            assert.equal(runtime.getVisibility(), 'Uninitialized');
            const initialized = await runtime.initialize();
            assert.equal(initialized, true);

            // Verify Office.addin.setStartupBehavior was called
            assert.equal(env.office.addin.startupBehavior, 'Load');

            // Verify Office.addin.hide() was called immediately
            assert.equal(env.office.addin.hideCallCount, 1);
            assert.equal(runtime.getVisibility(), 'Hidden');
            await runtime.shutdown();
        });

        it('should track visibility mode changes dynamically', async () => {
            const runtime = new WordRuntimeManager({
                officeHost: env.office,
                bridgeConfig: { enableWebSocket: false },
            });

            await runtime.initialize();
            assert.equal(runtime.getVisibility(), 'Hidden');

            const modes: string[] = [];
            runtime.onVisibilityChange((mode) => modes.push(mode));

            // User opens taskpane
            await runtime.showTaskPane();
            assert.equal(env.office.addin.showCallCount, 1);
            assert.equal(runtime.getVisibility(), 'Visible');

            // User hides taskpane
            await runtime.hideTaskPane();
            assert.equal(env.office.addin.hideCallCount, 2);
            assert.equal(runtime.getVisibility(), 'Hidden');

            assert.deepEqual(modes, ['Visible', 'Hidden']);
            await runtime.shutdown();
        });

        it('should support btnToggleHide ribbon action', async () => {
            const addin = await initializeWordAddin({
                runtimeConfig: { officeHost: env.office },
                bridgeConfig: { enableWebSocket: false },
            });

            assert.equal(addin.runtimeManager.getVisibility(), 'Hidden');

            let completedFired = false;
            await btnToggleHide({
                completed: () => {
                    completedFired = true;
                },
            });

            assert.equal(completedFired, true);
            assert.equal(addin.runtimeManager.getVisibility(), 'Visible');
            await addin.runtimeManager.shutdown();
        });
    });

    // =========================================================================
    // 3. Acceptance Criterion 3: Auto-pairing Token & Bridge Connection
    // =========================================================================
    describe('Criterion (3): Local Bridge Server Connection & Pairing', () => {
        let mockServer: http.Server;
        let serverPort: number;
        let receivedHandshake: AuthHandshake | null = null;
        let receivedTelemetry: ParagraphPayload | null = null;
        const validToken = 'test-secret-pairing-token-32b-word';

        beforeEach(async () => {
            receivedHandshake = null;
            receivedTelemetry = null;

            mockServer = http.createServer((req, res) => {
                let body = '';
                req.on('data', (chunk) => {
                    body += chunk;
                });
                req.on('end', () => {
                    const parsed = body ? JSON.parse(body) : {};

                    if (req.url === '/auth/handshake' && req.method === 'POST') {
                        receivedHandshake = parsed;
                        if (parsed.token === validToken) {
                            const response: AuthResponse = {
                                success: true,
                                sessionToken: 'session-word-test-123',
                                serverNonce: 'server-nonce-xyz',
                                message: 'Authenticated successfully',
                            };
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify(response));
                        } else {
                            const response: AuthResponse = {
                                success: false,
                                message: 'Unauthorized: Invalid token',
                            };
                            res.writeHead(401, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify(response));
                        }
                    } else if (req.url === '/telemetry' && req.method === 'POST') {
                        const authHeader = req.headers['authorization'] || req.headers['x-bridge-token'];
                        if (authHeader && authHeader.toString().includes(validToken)) {
                            receivedTelemetry = parsed;
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true, status: 'received' }));
                        } else {
                            res.writeHead(401, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false, error: 'Unauthorized' }));
                        }
                    } else {
                        res.writeHead(404);
                        res.end();
                    }
                });
            });

            await new Promise<void>((resolve) => {
                mockServer.listen(0, '127.0.0.1', () => {
                    const addr = mockServer.address() as any;
                    serverPort = addr.port;
                    resolve();
                });
            });
        });

        afterEach(async () => {
            await new Promise<void>((resolve) => {
                mockServer.close(() => resolve());
            });
        });

        it('should perform handshake with valid pairing token and connect successfully', async () => {
            const client = new WordBridgeClient({
                serverHost: '127.0.0.1',
                serverPort,
                token: validToken,
                enableWebSocket: false, // test REST fallback handshake
                version: '0.1.0',
            });

            const connected = await client.connect();
            assert.equal(connected, true);
            assert.equal(client.getStatus(), 'CONNECTED');
            assert.equal(client.getSessionToken(), 'session-word-test-123');

            assert.ok(receivedHandshake);
            assert.equal(isAuthHandshake(receivedHandshake!), true);
            assert.equal(receivedHandshake!.token, validToken);
            assert.equal(receivedHandshake!.editorType, 'Word');

            client.disconnect();
            assert.equal(client.getStatus(), 'DISCONNECTED');
        });

        it('should reject connection when invalid token is provided', async () => {
            const client = new WordBridgeClient({
                serverHost: '127.0.0.1',
                serverPort,
                token: 'wrong-invalid-token',
                enableWebSocket: false,
            });

            const connected = await client.connect();
            assert.equal(connected, false);
            assert.equal(client.getStatus(), 'ERROR');
            client.disconnect();
        });

        it('should transmit telemetry payload over authenticated connection', async () => {
            const client = new WordBridgeClient({
                serverHost: '127.0.0.1',
                serverPort,
                token: validToken,
                enableWebSocket: false,
            });

            await client.connect();

            const text = 'SmartLinter background telemetry transmission test.';
            const payload: ParagraphPayload = {
                paragraphId: 'para-word-001',
                text,
                hash: computeParagraphHash(text),
                source: 'AnnualReport.docx',
                target: 'ko-KR',
                timestamp: Date.now(),
                editorType: 'Word',
            };

            const sent = await client.sendParagraphPayload(payload);
            assert.equal(sent, true);
            assert.ok(receivedTelemetry);
            assert.equal(receivedTelemetry!.paragraphId, 'para-word-001');
            assert.equal(receivedTelemetry!.hash, computeParagraphHash(text));
            assert.equal(receivedTelemetry!.editorType, 'Word');

            client.disconnect();
        });
    });

    describe('WebSocket-to-REST connection fallback', () => {
        interface MockWebSocket {
            readyState: number;
            onopen: (() => void) | null;
            onmessage: ((event: { data: string }) => void) | null;
            onclose: ((event: { code: number }) => void) | null;
            onerror: (() => void) | null;
            send: (data: string) => void;
            close: () => void;
            triggerOpen: () => void;
            triggerError: () => void;
            triggerMessage: (data: BridgeMessage) => void;
            triggerClose: (code?: number) => void;
        }

        function createMockWebSocketHarness() {
            const instances: MockWebSocket[] = [];
            const waiters: Array<(socket: MockWebSocket) => void> = [];

            const WebSocketMock = function (this: unknown, _url: string) {
                const socket: MockWebSocket = {
                    readyState: 0,
                    onopen: null,
                    onmessage: null,
                    onclose: null,
                    onerror: null,
                    send: () => {},
                    close: () => {
                        socket.readyState = 3;
                        socket.onclose?.({ code: 1000 });
                    },
                    triggerOpen: () => {
                        socket.readyState = 1;
                        socket.onopen?.();
                    },
                    triggerError: () => socket.onerror?.(),
                    triggerMessage: (data) => socket.onmessage?.({ data: JSON.stringify(data) }),
                    triggerClose: (code = 1006) => {
                        socket.readyState = 3;
                        socket.onclose?.({ code });
                    },
                };
                instances.push(socket);
                waiters.shift()?.(socket);
                return socket;
            };

            return {
                instances,
                WebSocketMock,
                nextSocket: (): Promise<MockWebSocket> => {
                    const socket = instances.at(-1);
                    if (socket) {
                        return Promise.resolve(socket);
                    }
                    return new Promise((resolve) => waiters.push(resolve));
                },
            };
        }

        let originalWebSocket: unknown;
        let originalFetch: typeof fetch;

        beforeEach(() => {
            originalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;
            originalFetch = globalThis.fetch;
        });

        afterEach(() => {
            (globalThis as { WebSocket?: unknown }).WebSocket = originalWebSocket;
            globalThis.fetch = originalFetch;
        });

        it('falls back to REST when WebSocket is immediately rejected', async () => {
            const harness = createMockWebSocketHarness();
            (globalThis as { WebSocket?: unknown }).WebSocket = harness.WebSocketMock;
            let handshakeRequests = 0;
            globalThis.fetch = (async () => {
                handshakeRequests++;
                return { ok: true, json: async () => ({ success: true, sessionToken: 'rest-session' }) } as Response;
            }) as typeof fetch;

            const client = new WordBridgeClient({ token: 'test-token', heartbeatIntervalMs: 0 });
            try {
                const connected = client.connect();
                const socket = await harness.nextSocket();
                socket.triggerError();

                assert.equal(await connected, true);
                assert.equal(handshakeRequests, 1);
                assert.equal(client.getStatus(), 'CONNECTED');
                assert.equal(client.getSessionToken(), 'rest-session');
            } finally {
                client.disconnect();
            }
        });

        it('falls back to REST and reports an error when WebSocket authentication is rejected', async () => {
            const harness = createMockWebSocketHarness();
            (globalThis as { WebSocket?: unknown }).WebSocket = harness.WebSocketMock;
            let handshakeRequests = 0;
            globalThis.fetch = (async () => {
                handshakeRequests++;
                return { ok: false, json: async () => ({ success: false }) } as Response;
            }) as typeof fetch;

            const client = new WordBridgeClient({ token: 'test-token', heartbeatIntervalMs: 0 });
            try {
                const connected = client.connect();
                const socket = await harness.nextSocket();
                socket.triggerOpen();
                socket.triggerMessage({ type: 'AUTH_RESPONSE', payload: { success: false, message: 'Rejected' } });

                assert.equal(await connected, false);
                assert.equal(handshakeRequests, 1);
                assert.equal(client.getStatus(), 'ERROR');
            } finally {
                client.disconnect();
            }
        });

        it('does not leave a zombie WebSocket reconnect timer after REST fallback succeeds', async () => {
            const harness = createMockWebSocketHarness();
            (globalThis as { WebSocket?: unknown }).WebSocket = harness.WebSocketMock;
            globalThis.fetch = (async () => {
                return { ok: true, json: async () => ({ success: true, sessionToken: 'rest-session' }) } as Response;
            }) as typeof fetch;

            const client = new WordBridgeClient({
                token: 'test-token',
                heartbeatIntervalMs: 0,
                reconnectDelayMs: 15,
            });
            try {
                const connected = client.connect();
                const socket = await harness.nextSocket();
                socket.triggerClose();

                assert.equal(await connected, true);
                await new Promise((resolve) => setTimeout(resolve, 40));
                assert.equal(harness.instances.length, 1);
                assert.equal(client.getStatus(), 'CONNECTED');
            } finally {
                client.disconnect();
            }
        });

        it('schedules a WebSocket reconnect only after a normally authenticated connection drops', async () => {
            const harness = createMockWebSocketHarness();
            (globalThis as { WebSocket?: unknown }).WebSocket = harness.WebSocketMock;

            const client = new WordBridgeClient({
                token: 'test-token',
                heartbeatIntervalMs: 0,
                reconnectDelayMs: 15,
            });
            try {
                const connected = client.connect();
                const socket = await harness.nextSocket();
                socket.triggerOpen();
                socket.triggerMessage({ type: 'AUTH_RESPONSE', payload: { success: true, sessionToken: 'ws-session' } });
                assert.equal(await connected, true);

                socket.triggerClose();
                await new Promise((resolve) => setTimeout(resolve, 40));
                assert.equal(harness.instances.length, 2);
                assert.equal(client.getStatus(), 'CONNECTING');
            } finally {
                client.disconnect();
            }
        });
    });

    // =========================================================================
    // 4. Acceptance Criterion 4: Office Common API DocumentSelectionChanged & 1.5s Idle Debounce
    // =========================================================================
    describe('Criterion (4): Office Common API DocumentSelectionChanged & 1.5s Idle Debounce', () => {
        let env: MockWordEnvironment;
        let mockClient: WordBridgeClient;
        let dispatchedPayloads: ParagraphPayload[] = [];

        beforeEach(() => {
            env = new MockWordEnvironment('First paragraph text in active selection.');
            dispatchedPayloads = [];
            mockClient = new WordBridgeClient({ enableWebSocket: false });
            mockClient.sendParagraphPayload = async (payload: ParagraphPayload) => {
                dispatchedPayloads.push(payload);
                return true;
            };
        });

        afterEach(() => {
            mockClient.disconnect();
        });

        it('should debounce rapid selection changes and fire only after idle timeout', async () => {
            // Using 50ms debounce for rapid unit test verification
            const listener = new WordDocumentListener({
                bridgeClient: mockClient,
                idleDebounceMs: 50,
                wordRunner: env.createWordRunner(),
                officeHost: env.office,
            });

            await listener.start();
            assert.equal(listener.isActive(), true);
            assert.equal(dispatchedPayloads.length, 1, 'Initial capture is sent after handler registration');

            // Simulate rapid keystrokes/selection events (5 times in quick succession)
            env.triggerSelectionChanged();
            env.triggerSelectionChanged();
            env.triggerSelectionChanged();
            env.triggerSelectionChanged();
            env.triggerSelectionChanged();

            assert.equal(listener.isDebouncePending(), true);
            assert.equal(dispatchedPayloads.length, 1, 'Should not dispatch while rapidly changing');

            // Wait 20ms (< 50ms debounce)
            await new Promise((r) => setTimeout(r, 20));
            assert.equal(dispatchedPayloads.length, 1, 'Still pending within debounce window');

            // Fire another event to reset the debounce timer
            env.triggerSelectionChanged();

            // Wait 30ms (< 50ms from reset)
            await new Promise((r) => setTimeout(r, 30));
            assert.equal(dispatchedPayloads.length, 1, 'Timer was reset, still pending');

            // Wait 60ms (> 50ms idle)
            await new Promise((r) => setTimeout(r, 60));
            assert.equal(dispatchedPayloads.length, 1, 'Identical paragraph is deduplicated after idle timeout');

            assert.equal(listener.isDebouncePending(), false);
            await listener.stop();
        });

        it('should allow manual cancelDebounce() and flushDebounce()', async () => {
            const listener = new WordDocumentListener({
                bridgeClient: mockClient,
                idleDebounceMs: 200,
                wordRunner: env.createWordRunner(),
                officeHost: env.office,
            });

            await listener.start();
            assert.equal(dispatchedPayloads.length, 1);

            // Test cancelDebounce
            env.triggerSelectionChanged();
            assert.equal(listener.isDebouncePending(), true);
            listener.cancelDebounce();
            assert.equal(listener.isDebouncePending(), false);

            await new Promise((r) => setTimeout(r, 220));
            assert.equal(dispatchedPayloads.length, 1, 'Cancelled timer must not fire');

            // Test flushDebounce
            env.triggerSelectionChanged();
            assert.equal(listener.isDebouncePending(), true);
            const flushed = await listener.flushDebounce();
            assert.ok(flushed);
            assert.equal(dispatchedPayloads.length, 1, 'Identical flushed paragraph is deduplicated');
            assert.equal(listener.isDebouncePending(), false);

            await listener.stop();
        });

        it('does not report readiness when Common API handler registration fails', async () => {
            env.office.context.document.addHandlerAsync = (_eventType, _handler, callback) => {
                callback?.({ status: env.office.AsyncResultStatus.Failed, error: { message: 'registration denied' } });
            };
            const listener = new WordDocumentListener({
                bridgeClient: mockClient,
                wordRunner: env.createWordRunner(),
                officeHost: env.office,
            });

            assert.equal(await listener.start(), false);
            assert.equal(listener.isActive(), false);
        });

        it('retries a failed payload and only records it for deduplication after success', async () => {
            let attempts = 0;
            mockClient.sendParagraphPayload = async (payload: ParagraphPayload) => {
                dispatchedPayloads.push(payload);
                return ++attempts > 1;
            };
            const listener = new WordDocumentListener({
                bridgeClient: mockClient,
                wordRunner: env.createWordRunner(),
                officeHost: env.office,
            });

            await listener.start();
            assert.equal(listener.getLastSentPayload(), null);
            await new Promise((resolve) => setTimeout(resolve, 1050));
            assert.equal(dispatchedPayloads.length, 2);
            assert.ok(listener.getLastSentPayload());
            await listener.captureAndDispatchActiveParagraph();
            assert.equal(dispatchedPayloads.length, 2, 'successful retry updates deduplication state');
            await listener.stop();
        });
    });

    // =========================================================================
    // 5. Acceptance Criterion 5: Paragraph Extraction, paragraphId & SHA-256 Hash
    // =========================================================================
    describe('Criterion (5): Paragraph Extraction, paragraphId, SHA-256 Hash & Bridge Dispatch', () => {
        let env: MockWordEnvironment;
        let mockClient: WordBridgeClient;
        let sentPayloads: ParagraphPayload[] = [];

        beforeEach(() => {
            env = new MockWordEnvironment(
                'SmartLinter seamlessly linters MS Word documents with non-destructive reverse replacement.',
                'Quarterly_Report_2026.docx'
            );
            sentPayloads = [];
            mockClient = new WordBridgeClient({ enableWebSocket: false });
            mockClient.sendParagraphPayload = async (payload: ParagraphPayload) => {
                sentPayloads.push(payload);
                return true;
            };
        });

        afterEach(() => {
            mockClient.disconnect();
        });

        it('should extract paragraph text, generate stable paragraphId, and compute valid SHA-256 hash', async () => {
            const listener = new WordDocumentListener({
                bridgeClient: mockClient,
                idleDebounceMs: 10,
                wordRunner: env.createWordRunner(),
                officeHost: env.office,
            });

            await listener.start();
            const payload = await listener.captureAndDispatchActiveParagraph();

            assert.ok(payload);
            assert.equal(isParagraphPayload(payload!), true);

            // Verify content
            const expectedText =
                'SmartLinter seamlessly linters MS Word documents with non-destructive reverse replacement.';
            assert.equal(payload!.text, expectedText);
            assert.equal(payload!.source, 'Quarterly_Report_2026.docx');
            assert.equal(payload!.editorType, 'Word');

            // Verify SHA-256 hash calculation via hash_util
            const expectedHash = computeParagraphHash(expectedText);
            assert.equal(payload!.hash, expectedHash);
            assert.equal(verifyParagraphHash(expectedText, payload!.hash), true);

            // Verify paragraphId format
            assert.ok(payload!.paragraphId.startsWith('word-para-'));

            // Verify sent to bridge client
            assert.equal(sentPayloads.length, 1);
            assert.deepEqual(sentPayloads[0], payload);

            await listener.stop();
        });

        it('should avoid redundant transmission when cursor moves within identical paragraph', async () => {
            const listener = new WordDocumentListener({
                bridgeClient: mockClient,
                idleDebounceMs: 10,
                wordRunner: env.createWordRunner(),
                officeHost: env.office,
            });

            await listener.start();

            // Initial capture occurs during start.
            assert.equal(sentPayloads.length, 1);
            // First explicit capture is deduplicated.
            await listener.captureAndDispatchActiveParagraph();
            assert.equal(sentPayloads.length, 1);

            // Second capture with identical text
            await listener.captureAndDispatchActiveParagraph();
            assert.equal(sentPayloads.length, 1, 'Should not re-transmit unchanged paragraph');

            // Edit text in Word
            env.setParagraphText('Updated paragraph text with modified wording.');
            await listener.captureAndDispatchActiveParagraph();
            assert.equal(sentPayloads.length, 2, 'Should transmit newly modified paragraph');
            assert.equal(sentPayloads[1].text, 'Updated paragraph text with modified wording.');
            assert.equal(
                sentPayloads[1].hash,
                computeParagraphHash('Updated paragraph text with modified wording.')
            );

            await listener.stop();
        });
    });

    // =========================================================================
    // 6. Complete Integrated Simulation (100% Background Lifecycle)
    // =========================================================================
    describe('Integrated Simulation: Add-in Startup -> 100% Background Hide -> Word Edit -> Idle Telemetry', () => {
        it('should execute full lifecycle without UI intrusion and dispatch telemetry to bridge', async () => {
            const env = new MockWordEnvironment('Initial draft paragraph in Word.', 'SpecDocument.docx');
            const receivedTelemetryList: ParagraphPayload[] = [];

            const mockBridgeClient = new WordBridgeClient({
                enableWebSocket: false,
                token: 'mock-token-secret-32b',
            });
            mockBridgeClient.sendParagraphPayload = async (payload: ParagraphPayload) => {
                receivedTelemetryList.push(payload);
                return true;
            };

            // 1. Initialize Word Add-in
            const runtime = new WordRuntimeManager({
                officeHost: env.office,
                autoHideOnStartup: true,
                bridgeConfig: { enableWebSocket: false },
                listenerConfig: {
                    idleDebounceMs: 30,
                    wordRunner: env.createWordRunner(),
                },
            });

            await runtime.initialize();

            // 2. Verify Task Pane is 100% hidden in background
            assert.equal(runtime.getVisibility(), 'Hidden');
            assert.equal(env.office.addin.hideCallCount, 1);

            // 3. User types in Word document and moves cursor
            env.setParagraphText('Second paragraph draft after user edits.');
            const listener = runtime.getDocumentListener()!;
            assert.ok(listener);

            // Hook listener bridgeClient to our interceptor
            (listener as any).bridgeClient = mockBridgeClient;

            // Fire selection change (user stops typing)
            env.triggerSelectionChanged();

            // Wait 50ms for idle debounce to expire
            await new Promise((r) => setTimeout(r, 60));

            // 4. Verify telemetry packet received
            assert.equal(receivedTelemetryList.length, 1);
            const received = receivedTelemetryList[0];
            assert.equal(received.text, 'Second paragraph draft after user edits.');
            assert.equal(received.editorType, 'Word');
            assert.equal(received.hash, computeParagraphHash('Second paragraph draft after user edits.'));
            assert.equal(runtime.getVisibility(), 'Hidden', 'Add-in remained 100% in background');

            await runtime.shutdown();
        });
    });

    describe('Replacement command runtime wiring', () => {
        it('registers a command handler and replies with FAILED when Word.run is unavailable', async () => {
            const env = new MockWordEnvironment();
            const runtime = new WordRuntimeManager({
                officeHost: env.office,
                bridgeConfig: { enableWebSocket: false },
                listenerConfig: { wordRunner: env.createWordRunner() },
            });
            const originalWord = (globalThis as any).Word;
            delete (globalThis as any).Word;
            try {
                await runtime.initialize();
                const client = runtime.getBridgeClient()!;
                const results: any[] = [];
                client.sendReplacementResult = async (result: any) => {
                    results.push(result);
                    return true;
                };

                const handlers = (client as any).commandHandlers as Set<(command: any) => Promise<void>>;
                assert.equal(handlers.size, 1);
                await [...handlers][0]({
                    commandId: 'cmd-no-word-runner',
                    paragraphId: 'word-para-any',
                    baseHash: 'base',
                    expectedHash: 'expected',
                    hunks: [],
                });

                assert.deepEqual(results, [{
                    commandId: 'cmd-no-word-runner',
                    status: 'FAILED',
                    currentHash: '',
                    message: 'Office.js Word.run is unavailable',
                }]);
                await runtime.shutdown();
            } finally {
                (globalThis as any).Word = originalWord;
            }
        });
    });
});
