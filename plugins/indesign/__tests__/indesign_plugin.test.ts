/**
 * Unit & Integration Test Suite for Task 9: Adobe InDesign Plugin
 * (ExtendScript Persistent Background Engine, 1s IdleTask Loop, Bridge Socket, Hash Telemetry & UXP Panel)
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as http from 'node:http';
import * as vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import * as uxpController from '../uxp/index.js';

import { MockInDesignEnvironment } from './mock_indesign.ts';
import { computeParagraphHash as nodeComputeParagraphHash } from '../../../shared/engine/hash_util.ts';
import {
    type ParagraphPayload,
    type AuthHandshake,
    type AuthResponse,
    isParagraphPayload,
} from '../../../shared/protocol/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const daemonScriptPath = path.resolve(__dirname, '../extendscript/smartlinter_daemon.jsx');
const bridgeSocketPath = path.resolve(__dirname, '../extendscript/bridge_socket.jsx');
const textObserverPath = path.resolve(__dirname, '../extendscript/text_observer.jsx');
const uxpManifestPath = path.resolve(__dirname, '../uxp/manifest.json');
const uxpHtmlPath = path.resolve(__dirname, '../uxp/index.html');
const uxpJsPath = path.resolve(__dirname, '../uxp/index.js');

/**
 * ExtendScript File Loader & Preprocessor
 * Simulates InDesign's ExtendScript engine preprocessor (#include, #targetengine) and executes in sandbox.
 */
function loadExtendScript(filePath: string, context: Record<string, any> = {}) {
    let content = fs.readFileSync(filePath, 'utf8');
    const dir = path.dirname(filePath);

    // Resolve #include directives recursively
    content = content.replace(/^[ \t]*#include\s+["']([^"']+)["']/gm, (_match, relPath) => {
        const fullIncludePath = path.resolve(dir, relPath);
        if (fs.existsSync(fullIncludePath)) {
            const incContent = fs.readFileSync(fullIncludePath, 'utf8')
                .replace(/^[ \t]*#targetengine[^\n]*/gm, '// #targetengine (included)');
            return `\n// --- Begin #include "${relPath}" ---\n` + incContent + `\n// --- End #include "${relPath}" ---\n`;
        }
        return _match;
    });

    // Replace ExtendScript preprocessor directives starting with # with comment
    content = content.replace(/^[ \t]*#[a-zA-Z_]+/gm, '// $&');

    const sandbox: Record<string, any> = {
        console,
        Buffer,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Date,
        Math,
        JSON,
        String,
        Array,
        Object,
        parseInt,
        parseFloat,
        module: { exports: {} },
        exports: {},
        ...context
    };

    sandbox.global = sandbox;
    sandbox.globalThis = sandbox;
    if (!sandbox.File) {
        sandbox.File = class MockExtendScriptFile {
            fsName: string;
            exists: boolean;
            private isOpen: boolean = false;
            constructor(filePath: string) {
                this.fsName = filePath;
                this.exists = fs.existsSync(filePath);
            }
            open(mode: string) {
                this.isOpen = true;
                return true;
            }
            read() {
                if (!this.isOpen || !fs.existsSync(this.fsName)) return '';
                return fs.readFileSync(this.fsName, 'utf8');
            }
            close() {
                this.isOpen = false;
                return true;
            }
        };
    }
    if (!sandbox.$) {
        sandbox.$ = {
            global: sandbox,
            writeln: () => {},
            getenv: (key: string) => process.env[key] || null
        };
    } else {
        sandbox.$.global = sandbox;
        if (!sandbox.$.getenv) {
            sandbox.$.getenv = (key: string) => process.env[key] || null;
        }
    }

    vm.createContext(sandbox);
    vm.runInContext(content, sandbox, { filename: filePath });
    return sandbox;
}

describe('Task 9: Adobe InDesign Plugin (ExtendScript Persistent Daemon & Bridge)', () => {

    // =========================================================================
    // 1. Acceptance Criterion (1): #targetengine "smartlinter_persistent_engine"
    // =========================================================================
    describe('Criterion (1): #targetengine "smartlinter_persistent_engine" Persistent Declaration', () => {
        it('should declare #targetengine "smartlinter_persistent_engine" across all ExtendScript files', () => {
            const files = [daemonScriptPath, bridgeSocketPath, textObserverPath];
            for (const filePath of files) {
                assert.equal(fs.existsSync(filePath), true, `File must exist: ${filePath}`);
                const content = fs.readFileSync(filePath, 'utf8');
                assert.ok(
                    content.includes('#targetengine "smartlinter_persistent_engine"') ||
                    content.includes("#targetengine 'smartlinter_persistent_engine'"),
                    `${path.basename(filePath)} must declare #targetengine "smartlinter_persistent_engine"`
                );
            }
        });

        it('should expose global singletons and constructors to ExtendScript global scope', () => {
            const sandbox = loadExtendScript(daemonScriptPath);
            assert.ok(sandbox.SmartLinterDaemon, 'SmartLinterDaemon must be defined in global scope');
            assert.ok(sandbox.SmartLinterBridgeSocket, 'SmartLinterBridgeSocket must be loaded via #include');
            assert.ok(sandbox.SmartLinterTextObserver, 'SmartLinterTextObserver must be loaded via #include');

            const daemon = new sandbox.SmartLinterDaemon();
            assert.ok(daemon);
            assert.equal(daemon.engineId, 'smartlinter_persistent_monitor');
            assert.equal(daemon.getStatus().engine, 'smartlinter_persistent_engine');
        });
    });

    // =========================================================================
    // 2. Acceptance Criterion (2): app.idleTasks.add 1-second Idle Loop
    // =========================================================================
    describe('Criterion (2): app.idleTasks 1-Second Idle Polling Loop', () => {
        let env: MockInDesignEnvironment;

        beforeEach(() => {
            env = new MockInDesignEnvironment();
        });

        it('should register an IdleTask with sleep: 1000ms on daemon.start()', () => {
            const sandbox = loadExtendScript(daemonScriptPath, { app: env.getApp() });
            const daemon = new sandbox.SmartLinterDaemon({
                appInstance: env.getApp(),
                sleepMs: 1000
            });

            const started = daemon.start();
            assert.equal(started, true);
            assert.equal(daemon.isRunning, true);

            // Verify task was registered in app.idleTasks
            const task = env.idleTaskList.get('smartlinter_persistent_monitor');
            assert.ok(task, 'IdleTask must be registered in app.idleTasks');
            assert.equal(task!.sleep, 1000);
            assert.equal(task!.isValid, true);

            daemon.stop();
            assert.equal(daemon.isRunning, false);
            assert.equal(task!.isValid, false);
        });

        it('should clean up existing/stale idle tasks before registering a new one', () => {
            const app = env.getApp();
            app.idleTasks.add({ name: 'smartlinter_persistent_monitor', sleep: 2000 });
            assert.equal(env.idleTaskList.get('smartlinter_persistent_monitor')?.sleep, 2000);

            const sandbox = loadExtendScript(daemonScriptPath, { app });
            const daemon = new sandbox.SmartLinterDaemon({
                appInstance: app,
                sleepMs: 1000
            });

            daemon.start();
            const task = env.idleTaskList.get('smartlinter_persistent_monitor');
            assert.equal(task?.sleep, 1000);
            daemon.stop();
        });

        it('should increment tick count and process events during idle cycles', () => {
            const sandbox = loadExtendScript(daemonScriptPath, { app: env.getApp() });
            const daemon = new sandbox.SmartLinterDaemon({
                appInstance: env.getApp(),
                sleepMs: 1000
            });

            daemon.start();
            assert.equal(daemon.tickCount, 0);

            // Simulate 5 idle ticks
            for (let i = 0; i < 5; i++) {
                env.triggerIdleTick('smartlinter_persistent_monitor');
            }

            assert.equal(daemon.tickCount, 5);
            assert.equal(daemon.getStatus().tickCount, 5);
            daemon.stop();
        });
    });

    // =========================================================================
    // 3. Acceptance Criterion (3): Bridge Socket & Local Server Pairing / Heartbeat
    // =========================================================================
    describe('Criterion (3): Socket / HTTP Module & Local Bridge Server Pairing & Heartbeat', () => {
        let mockServer: http.Server;
        let serverPort: number;
        let receivedHandshake: AuthHandshake | null = null;
        let receivedTelemetry: any = null;
        const validToken = 'test-indesign-token-secret-32b';

        beforeEach(async () => {
            receivedHandshake = null;
            receivedTelemetry = null;

            mockServer = http.createServer((req, res) => {
                let body = '';
                req.on('data', (chunk) => { body += chunk; });
                req.on('end', () => {
                    const parsed = body ? JSON.parse(body) : {};

                    if (req.url === '/auth/handshake' && req.method === 'POST') {
                        receivedHandshake = parsed;
                        if (parsed.token === validToken) {
                            const response: AuthResponse = {
                                success: true,
                                sessionToken: 'session-id-indesign-999',
                                serverNonce: 'nonce-indesign-123',
                                message: 'Authenticated successfully'
                            };
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify(response));
                        } else {
                            res.writeHead(401, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                        }
                    } else if (req.url === '/telemetry' && req.method === 'POST') {
                        const tokenHeader = req.headers['authorization'] || req.headers['x-bridge-token'];
                        if (tokenHeader && tokenHeader.toString().includes(validToken)) {
                            receivedTelemetry = parsed;
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true, status: 'received' }));
                        } else {
                            res.writeHead(401, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false, error: 'Unauthorized' }));
                        }
                    } else if (req.url === '/replacement/result' && req.method === 'POST') {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
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

        it('should format valid HTTP 1.1 POST and complete handshake with valid token', () => {
            const socketHandler = (req: string) => {
                assert.ok(req.startsWith('POST /auth/handshake HTTP/1.1\r\n'));
                assert.ok(req.includes(`Host: 127.0.0.1:${serverPort}`));
                assert.ok(req.includes(`Authorization: Bearer ${validToken}`));
                assert.ok(req.includes(`x-bridge-token: ${validToken}`));

                const bodyStr = JSON.stringify({
                    success: true,
                    sessionToken: 'session-id-indesign-999',
                    serverNonce: 'nonce-indesign-123'
                });
                return `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${bodyStr.length}\r\n\r\n${bodyStr}`;
            };

            const env = new MockInDesignEnvironment();
            env.socketHandler = socketHandler;

            const sandbox = loadExtendScript(bridgeSocketPath);
            const bridgeSocket = new sandbox.SmartLinterBridgeSocket({
                host: '127.0.0.1',
                port: serverPort,
                token: validToken,
                version: '0.1.0',
                socketFactory: env.createSocketFactory()
            });

            const connected = bridgeSocket.handshake();
            assert.equal(connected, true);
            assert.equal(bridgeSocket.status, 'CONNECTED');
            assert.equal(bridgeSocket.sessionToken, 'session-id-indesign-999');
        });

        it('should complete authentication handshake and parse HTTP response when String.prototype.trim is undefined (ExtendScript ES3 engine)', () => {
            const env = new MockInDesignEnvironment();
            const serverPort = 49152;
            const validToken = 'smartlinter-default-dev-token-secret-32b';

            env.socketHandler = (req: string) => {
                const bodyStr = JSON.stringify({
                    success: true,
                    sessionToken: 'session-id-indesign-no-trim',
                    serverNonce: 'nonce-indesign-no-trim'
                });
                return `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${bodyStr.length}\r\n\r\n  ${bodyStr}  \r\n`;
            };

            // Create isolated VM context where String.prototype.trim is deleted
            const sandbox: Record<string, any> = {
                console,
                Date,
                Math,
                JSON,
                parseInt,
                parseFloat,
                module: { exports: {} },
                exports: {}
            };
            sandbox.global = sandbox;
            sandbox.globalThis = sandbox;
            const ctx = vm.createContext(sandbox);
            vm.runInContext('delete String.prototype.trim;', ctx);

            const isTrimUndefined = vm.runInContext('typeof String.prototype.trim === "undefined"', ctx);
            assert.strictEqual(isTrimUndefined, true, 'String.prototype.trim must be undefined in simulation context');

            const bridgeScript = fs.readFileSync(bridgeSocketPath, 'utf8')
                .replace(/^[ \t]*#[a-zA-Z_]+/gm, '// $&');
            vm.runInContext(bridgeScript, ctx, { filename: 'bridge_socket.jsx' });

            const bridgeSocket = new sandbox.SmartLinterBridgeSocket({
                host: '127.0.0.1',
                port: serverPort,
                token: validToken,
                version: '0.1.0',
                socketFactory: env.createSocketFactory()
            });

            // 1. Verify httpRequest parses response body without error
            const res = bridgeSocket.httpRequest('POST', '/auth/handshake', {
                token: validToken,
                editorType: 'InDesign',
                version: '0.1.0',
                clientNonce: 'test-nonce'
            });
            assert.strictEqual(res.ok, true);
            assert.strictEqual(res.statusCode, 200);
            assert.ok(res.body, 'Parsed body must exist');
            assert.strictEqual(res.body.success, true);
            assert.strictEqual(res.body.sessionToken, 'session-id-indesign-no-trim');

            // 2. Verify full handshake flow succeeds and sets status to CONNECTED
            const connected = bridgeSocket.handshake();
            assert.strictEqual(connected, true);
            assert.strictEqual(bridgeSocket.status, 'CONNECTED');
            assert.strictEqual(bridgeSocket.sessionToken, 'session-id-indesign-no-trim');
        });

        it('should handle authentication rejection (401 Unauthorized)', () => {
            const env = new MockInDesignEnvironment();
            env.socketHandler = () => {
                const bodyStr = JSON.stringify({ success: false, message: 'Invalid token' });
                return `HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: ${bodyStr.length}\r\n\r\n${bodyStr}`;
            };

            const sandbox = loadExtendScript(bridgeSocketPath);
            const bridgeSocket = new sandbox.SmartLinterBridgeSocket({
                host: '127.0.0.1',
                port: serverPort,
                token: 'wrong-token',
                socketFactory: env.createSocketFactory()
            });

            const connected = bridgeSocket.handshake();
            assert.equal(connected, false);
            assert.equal(bridgeSocket.status, 'ERROR');
        });

        it('should transmit periodic Heartbeat and paragraph telemetry', () => {
            let lastDispatchedPayload: any = null;
            let lastDispatchedPath: string | null = null;
            const env = new MockInDesignEnvironment();
            env.socketHandler = (req: string) => {
                const firstLine = req.split('\r\n')[0];
                const parts = firstLine.split(' ');
                if (parts.length >= 2) {
                    lastDispatchedPath = parts[1];
                }
                const bodyIndex = req.indexOf('\r\n\r\n');
                if (bodyIndex !== -1) {
                    lastDispatchedPayload = JSON.parse(req.substring(bodyIndex + 4));
                }
                const bodyStr = JSON.stringify({ success: true, status: 'ok' });
                return `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${bodyStr.length}\r\n\r\n${bodyStr}`;
            };

            const sandbox = loadExtendScript(bridgeSocketPath);
            const bridgeSocket = new sandbox.SmartLinterBridgeSocket({
                host: '127.0.0.1',
                port: serverPort,
                token: validToken,
                socketFactory: env.createSocketFactory()
            });

            // 1. Send Heartbeat
            const hbSent = bridgeSocket.sendHeartbeat('Magazine_Issue_42.indd');
            assert.equal(hbSent, true);
            assert.equal(lastDispatchedPath, '/heartbeat');
            assert.ok(lastDispatchedPayload);
            assert.equal(lastDispatchedPayload.editorType, 'InDesign');
            assert.equal(lastDispatchedPayload.activeDocument, 'Magazine_Issue_42.indd');

            // 2. Send Telemetry
            const paraPayload: ParagraphPayload = {
                paragraphId: 'indesign-para-123456',
                text: 'InDesign typography monitoring sample paragraph.',
                hash: nodeComputeParagraphHash('InDesign typography monitoring sample paragraph.'),
                source: 'Magazine_Issue_42.indd',
                timestamp: Date.now(),
                editorType: 'InDesign'
            };
            const telSent = bridgeSocket.sendTelemetry(paraPayload);
            assert.equal(telSent, true);
            assert.equal(lastDispatchedPath, '/telemetry');
            assert.equal(lastDispatchedPayload.paragraphId, 'indesign-para-123456');
            assert.equal(lastDispatchedPayload.editorType, 'InDesign');
        });

        it('should demote status to ERROR when heartbeat fails (e.g. 404 Not Found on expired session)', () => {
            const env = new MockInDesignEnvironment();
            env.socketHandler = (req: string) => {
                if (req.includes('POST /heartbeat')) {
                    const bodyStr = JSON.stringify({ success: false, error: '404 Not Found: No active editor session' });
                    return `HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\nContent-Length: ${bodyStr.length}\r\n\r\n${bodyStr}`;
                }
                const bodyStr = JSON.stringify({ success: true });
                return `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${bodyStr.length}\r\n\r\n${bodyStr}`;
            };

            const sandbox = loadExtendScript(bridgeSocketPath);
            const bridgeSocket = new sandbox.SmartLinterBridgeSocket({
                host: '127.0.0.1',
                port: serverPort,
                token: validToken,
                socketFactory: env.createSocketFactory()
            });

            // Simulate previously connected socket
            bridgeSocket.status = 'CONNECTED';
            assert.equal(bridgeSocket.status, 'CONNECTED');

            // Send Heartbeat against mock server returning 404
            const hbSent = bridgeSocket.sendHeartbeat('Magazine_Issue_42.indd');
            assert.equal(hbSent, false);
            assert.equal(bridgeSocket.status, 'ERROR');
            assert.ok(bridgeSocket.lastError);
            assert.ok(bridgeSocket.lastError.includes('404') || bridgeSocket.lastError.includes('No active editor session'));
        });

        it('should bootstrap pairing token from local pairing_token.txt file when present (Task 18.5)', () => {
            const tempDir = fs.mkdtempSync(path.join(path.resolve(__dirname, '../../../'), 'temp-token-test-'));
            const appDataSmartLinterDir = path.join(tempDir, 'SmartLinter');
            fs.mkdirSync(appDataSmartLinterDir, { recursive: true });

            const testFileToken = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
            fs.writeFileSync(path.join(appDataSmartLinterDir, 'pairing_token.txt'), testFileToken + '\r\n', 'utf8');

            try {
                const sandbox = loadExtendScript(bridgeSocketPath, {
                    $: {
                        getenv: (k: string) => k === 'LOCALAPPDATA' ? tempDir : null,
                        writeln: () => {}
                    }
                });

                // Socket created without explicit token -> should load testFileToken from file
                const bridgeSocket = new sandbox.SmartLinterBridgeSocket();
                assert.equal(bridgeSocket.token, testFileToken, 'Should resolve token from pairing_token.txt');
            } finally {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        });

        it('should fallback to default development token when pairing_token.txt is absent (Task 18.5)', () => {
            const tempDir = fs.mkdtempSync(path.join(path.resolve(__dirname, '../../../'), 'temp-token-empty-'));
            try {
                const sandbox = loadExtendScript(bridgeSocketPath, {
                    $: {
                        getenv: (k: string) => k === 'LOCALAPPDATA' ? tempDir : null,
                        writeln: () => {}
                    }
                });

                const bridgeSocket = new sandbox.SmartLinterBridgeSocket();
                assert.equal(bridgeSocket.token, 'smartlinter-default-dev-token-secret-32b');
            } finally {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        });

        it('should prioritize explicit config.token over local file token (Task 18.5)', () => {
            const tempDir = fs.mkdtempSync(path.join(path.resolve(__dirname, '../../../'), 'temp-token-override-'));
            const appDataSmartLinterDir = path.join(tempDir, 'SmartLinter');
            fs.mkdirSync(appDataSmartLinterDir, { recursive: true });
            fs.writeFileSync(path.join(appDataSmartLinterDir, 'pairing_token.txt'), 'file-token-12345', 'utf8');

            try {
                const sandbox = loadExtendScript(bridgeSocketPath, {
                    $: {
                        getenv: (k: string) => k === 'LOCALAPPDATA' ? tempDir : null,
                        writeln: () => {}
                    }
                });

                const bridgeSocket = new sandbox.SmartLinterBridgeSocket({ token: 'explicit-override-token' });
                assert.equal(bridgeSocket.token, 'explicit-override-token');
            } finally {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        });
    });

    // =========================================================================
    // 4. Acceptance Criterion (4): TextFrame/Story Extraction & SHA-256 Hash
    // =========================================================================
    describe('Criterion (4): Paragraph & SHA-256 Hash Extraction & Bridge Dispatch', () => {
        let env: MockInDesignEnvironment;

        beforeEach(() => {
            env = new MockInDesignEnvironment(
                'Adobe InDesign typography with pristine kerning and layout.',
                'Catalog_Autumn_2026.indd'
            );
        });

        it('should normalize paragraph and compute SHA-256 hash identical to shared/engine/hash_util.ts', () => {
            const sandbox = loadExtendScript(textObserverPath);

            const testCases = [
                'Single line paragraph.',
                'Line 1\rLine 2\rLine 3\r\nLine 4',
                'InDesign\u2028Line\u00A0Separator\u202Fand\u00A0NBSP',
                '  Indented code line   \n  with trailing spaces   \n',
                '스마트린터 인디자인 한글 단락 해시 테스트 123 !@#$'
            ];

            for (const text of testCases) {
                const nodeHash = nodeComputeParagraphHash(text);
                const esHash = sandbox.SmartLinterHashUtil.computeParagraphHash(text);
                assert.equal(
                    esHash,
                    nodeHash,
                    `ExtendScript hash must match Node.js hash for: "${text}"`
                );
            }
        });

        it('should extract active paragraph from InDesign selection DOM and generate valid ParagraphPayload', () => {
            const sandbox = loadExtendScript(textObserverPath);
            const observer = new sandbox.SmartLinterTextObserver({ targetLanguage: 'ko-KR' });
            const extracted = observer.getActiveParagraph(env.getApp());

            assert.ok(extracted);
            assert.equal(extracted.text, 'Adobe InDesign typography with pristine kerning and layout.');
            assert.equal(extracted.source, 'Catalog_Autumn_2026.indd');
            assert.ok(extracted.paragraphId.startsWith('indesign-para-'));

            const expectedHash = nodeComputeParagraphHash('Adobe InDesign typography with pristine kerning and layout.');
            assert.equal(extracted.hash, expectedHash);
        });

        it('should dispatch ParagraphPayload to bridge and suppress redundant duplicate transmissions', () => {
            const sandbox = loadExtendScript(textObserverPath);
            const dispatched: ParagraphPayload[] = [];
            const mockBridgeSocket = {
                status: 'CONNECTED',
                sendTelemetry: (payload: ParagraphPayload) => {
                    dispatched.push(payload);
                    return true;
                }
            };

            const observer = new sandbox.SmartLinterTextObserver();

            // First capture
            const payload1 = observer.captureActiveParagraph(env.getApp(), mockBridgeSocket);
            assert.ok(payload1);
            assert.equal(isParagraphPayload(payload1!), true);
            assert.equal(dispatched.length, 1);
            assert.equal(dispatched[0].text, 'Adobe InDesign typography with pristine kerning and layout.');

            // Second capture without modification -> should be suppressed
            const payload2 = observer.captureActiveParagraph(env.getApp(), mockBridgeSocket);
            assert.equal(payload2, null);
            assert.equal(dispatched.length, 1, 'Duplicate paragraph must not be re-transmitted');

            // Modify text in InDesign
            env.setSelectionText('Modified InDesign paragraph text.');
            const payload3 = observer.captureActiveParagraph(env.getApp(), mockBridgeSocket);
            assert.ok(payload3);
            assert.equal(dispatched.length, 2);
            assert.equal(dispatched[1].text, 'Modified InDesign paragraph text.');
            assert.equal(dispatched[1].hash, nodeComputeParagraphHash('Modified InDesign paragraph text.'));
        });
    });

    // =========================================================================
    // 5. Acceptance Criterion (5): UXP Closed State & Background Daemon Retention
    // =========================================================================
    describe('Criterion (5): Daemon Survival & 100% Retention When UXP Panel is Closed', () => {
        it('should maintain 100% daemon event loop and telemetry processing when UXP transitions Shown -> Hidden -> Destroyed (Closed)', async () => {
            const env = new MockInDesignEnvironment('Initial story paragraph.', 'Brochure.indd');
            const dispatchedPayloads: ParagraphPayload[] = [];

            env.socketHandler = (req: string) => {
                const bodyIndex = req.indexOf('\r\n\r\n');
                if (bodyIndex !== -1) {
                    const parsed = JSON.parse(req.substring(bodyIndex + 4));
                    if (parsed.paragraphId) {
                        dispatchedPayloads.push(parsed);
                    }
                }
                const bodyStr = JSON.stringify({ success: true });
                return `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${bodyStr.length}\r\n\r\n${bodyStr}`;
            };

            const sandbox = loadExtendScript(daemonScriptPath, { app: env.getApp() });

            const bridgeSocket = new sandbox.SmartLinterBridgeSocket({
                host: '127.0.0.1',
                port: 49152,
                token: 'test-token',
                socketFactory: env.createSocketFactory()
            });

            const textObserver = new sandbox.SmartLinterTextObserver();
            const daemon = new sandbox.SmartLinterDaemon({
                appInstance: env.getApp(),
                bridgeSocket,
                textObserver,
                sleepMs: 1000
            });

            // 1. Start ExtendScript Daemon (#targetengine)
            daemon.start();
            bridgeSocket.status = 'CONNECTED';
            assert.equal(daemon.isRunning, true);

            // Phase 1: UXP Panel SHOWN
            uxpController.setLifecycleState('SHOWN');
            env.triggerIdleTick();
            assert.equal(dispatchedPayloads.length, 1);
            assert.equal(daemon.tickCount, 1);

            // Phase 2: UXP Panel HIDDEN (docked/collapsed behind another tab)
            uxpController.setLifecycleState('HIDDEN');
            env.setSelectionText('Paragraph edited while UXP is HIDDEN.');
            env.triggerSelectionChange();
            assert.equal(dispatchedPayloads.length, 2);
            assert.equal(dispatchedPayloads[1].text, 'Paragraph edited while UXP is HIDDEN.');

            for (let i = 0; i < 5; i++) {
                env.triggerIdleTick();
            }
            assert.equal(daemon.tickCount, 6);

            // Phase 3: UXP Panel DESTROYED / CLOSED (user explicitly closes the panel with X button)
            uxpController.setLifecycleState('DESTROYED');
            uxpController.stopUIPolling();
            assert.equal(uxpController.getLifecycleState(), 'DESTROYED');

            // CRITICAL TEST: ExtendScript Daemon continues running with 0% event loss
            env.setSelectionText('Paragraph edited while UXP panel is COMPLETELY CLOSED.');
            env.triggerAttributeChange();
            assert.equal(dispatchedPayloads.length, 3, 'Daemon must capture events when UXP is closed');
            assert.equal(dispatchedPayloads[2].text, 'Paragraph edited while UXP panel is COMPLETELY CLOSED.');

            for (let i = 0; i < 10; i++) {
                env.triggerIdleTick();
            }
            assert.equal(daemon.tickCount, 16, 'IdleTask ticks must continue 100% uninterrupted');
            assert.equal(daemon.isRunning, true);

            daemon.stop();
        });
    });

    // =========================================================================
    // 6. Acceptance Criterion (6): Lightweight UXP Settings & Status Panel
    // =========================================================================
    describe('Criterion (6): UXP Panel Manifest & UI Controls Integrity', () => {
        it('should have valid UXP manifest.json (v5, ID host >= 18.5, network permissions)', () => {
            assert.equal(fs.existsSync(uxpManifestPath), true, 'manifest.json must exist');
            const manifest = JSON.parse(fs.readFileSync(uxpManifestPath, 'utf8'));

            assert.equal(manifest.manifestVersion, 5);
            assert.equal(manifest.id, 'com.smartlinter.indesign.bridge');
            assert.ok(Array.isArray(manifest.host));
            assert.equal(manifest.host[0].app, 'ID');
            assert.equal(manifest.host[0].minVersion, '18.5');

            assert.ok(manifest.entrypoints);
            assert.equal(manifest.entrypoints[0].id, 'smartlinterPanel');

            assert.ok(manifest.requiredPermissions);
            assert.ok(manifest.requiredPermissions.network.domains.includes('http://127.0.0.1:49152'));
        });

        it('should provide index.html with settings inputs and status indicators', () => {
            assert.equal(fs.existsSync(uxpHtmlPath), true, 'index.html must exist');
            const html = fs.readFileSync(uxpHtmlPath, 'utf8');

            assert.ok(html.includes('id="bridgeStatusPill"'));
            assert.ok(html.includes('id="statTickCount"'));
            assert.ok(html.includes('id="serverHost"'));
            assert.ok(html.includes('id="serverPort"'));
            assert.ok(html.includes('id="secretToken"'));
            assert.ok(html.includes('id="btnConnect"'));
            assert.ok(html.includes('id="btnRescan"'));
            assert.ok(html.includes('id="btnRestartDaemon"'));
            assert.ok(html.includes('id="logBox"'));
        });

        it('should export UXP lifecycle and control helpers from index.js', () => {
            assert.equal(fs.existsSync(uxpJsPath), true, 'index.js must exist');
            assert.equal(typeof uxpController.initPanelUI, 'function');
            assert.equal(typeof uxpController.handleConnectBridge, 'function');
            assert.equal(typeof uxpController.handleRescanActiveParagraph, 'function');
            assert.equal(typeof uxpController.handleRestartDaemon, 'function');
        });
    });
});
