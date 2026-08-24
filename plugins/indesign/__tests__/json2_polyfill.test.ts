/**
 * Unit Test Suite for Task: ExtendScript JSON Polyfill (json2_polyfill.jsx)
 * 
 * Verifies Douglas Crockford json2.js-based polyfill in an isolated ECMAScript 3 VM sandbox
 * where native JSON is completely absent (simulating Adobe InDesign ExtendScript engine).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const polyfillScriptPath = path.resolve(__dirname, '../extendscript/json2_polyfill.jsx');

/**
 * Normalizes VM-realm objects to host-realm objects for cross-realm assertion comparison.
 */
function toHost(val: any): any {
    if (val === undefined) return undefined;
    return JSON.parse(JSON.stringify(val));
}

/**
 * Loads json2_polyfill.jsx in a clean VM context without native JSON
 */
function createExtendScriptContext(withNativeJson: boolean = false): {
    sandbox: Record<string, any>;
    evaluate: (code: string) => any;
} {
    const polyfillSource = fs.readFileSync(polyfillScriptPath, 'utf8');

    const sandbox: Record<string, any> = {
        console,
        Date,
        Math,
        String,
        Number,
        Boolean,
        Array,
        Object,
        RegExp,
        parseInt,
        parseFloat,
        isFinite,
        isNaN,
        module: { exports: {} },
        exports: {}
    };

    if (withNativeJson) {
        sandbox.JSON = JSON;
    }

    // ExtendScript $.global mock
    sandbox.$ = {
        global: sandbox,
        writeln: () => {}
    };
    sandbox.global = sandbox;

    const ctx = vm.createContext(sandbox);

    // Run polyfill
    vm.runInContext(polyfillSource, ctx, { filename: 'json2_polyfill.jsx' });

    return {
        sandbox,
        evaluate: (code: string) => vm.runInContext(code, ctx)
    };
}

describe('ExtendScript JSON Polyfill (json2_polyfill.jsx)', () => {
    describe('Initialization & Environment Guarding', () => {
        it('should define global JSON object when native JSON is absent', () => {
            const { sandbox } = createExtendScriptContext(false);
            assert.ok(sandbox.JSON, 'JSON should be defined');
            assert.strictEqual(typeof sandbox.JSON, 'object');
            assert.strictEqual(typeof sandbox.JSON.stringify, 'function');
            assert.strictEqual(typeof sandbox.JSON.parse, 'function');
            assert.strictEqual(sandbox.$.global.JSON, sandbox.JSON);
        });

        it('should not overwrite existing native JSON when present', () => {
            const nativeJsonRef = JSON;
            const { sandbox } = createExtendScriptContext(true);
            assert.strictEqual(sandbox.JSON, nativeJsonRef, 'Native JSON reference should be preserved');
        });
    });

    describe('JSON.stringify() Primitives & Edge Cases', () => {
        let polyJson: any;

        beforeEach(() => {
            const { sandbox } = createExtendScriptContext(false);
            polyJson = sandbox.JSON;
        });

        it('should stringify numbers, booleans, and null', () => {
            assert.strictEqual(polyJson.stringify(0), '0');
            assert.strictEqual(polyJson.stringify(-1234.56), '-1234.56');
            assert.strictEqual(polyJson.stringify(true), 'true');
            assert.strictEqual(polyJson.stringify(false), 'false');
            assert.strictEqual(polyJson.stringify(null), 'null');
            assert.strictEqual(polyJson.stringify(Infinity), 'null');
            assert.strictEqual(polyJson.stringify(-Infinity), 'null');
            assert.strictEqual(polyJson.stringify(NaN), 'null');
        });

        it('should stringify strings with proper escape sequences', () => {
            assert.strictEqual(polyJson.stringify(''), '""');
            assert.strictEqual(polyJson.stringify('hello world'), '"hello world"');
            assert.strictEqual(polyJson.stringify('quote " test'), '"quote \\" test"');
            assert.strictEqual(polyJson.stringify('backslash \\ test'), '"backslash \\\\ test"');
            assert.strictEqual(polyJson.stringify('line1\nline2\r\ntab\t'), '"line1\\nline2\\r\\ntab\\t"');
        });

        it('should properly stringify Korean multilingual and Unicode strings', () => {
            const korean = '스마트린터 인디자인 데몬 브릿지 통신';
            assert.strictEqual(polyJson.stringify(korean), JSON.stringify(korean));

            const specialSeparators = '단락 1\u2028단락 2\u00A0비공백';
            const polyResult = polyJson.stringify(specialSeparators);
            // Verify roundtrip fidelity
            assert.strictEqual(JSON.parse(polyResult), specialSeparators);
        });

        it('should stringify Date objects in ISO-8601 UTC format', () => {
            const d = new Date('2026-08-24T05:12:00.000Z');
            assert.strictEqual(polyJson.stringify(d), '"2026-08-24T05:12:00.000Z"');
        });

        it('should respect custom toJSON methods on objects', () => {
            const customObj = {
                id: 100,
                toJSON: () => ({ custom: 'serialized' })
            };
            assert.strictEqual(polyJson.stringify(customObj), '{"custom":"serialized"}');
        });
    });

    describe('JSON.stringify() Complex Structures & Options', () => {
        let polyJson: any;

        beforeEach(() => {
            const { sandbox } = createExtendScriptContext(false);
            polyJson = sandbox.JSON;
        });

        it('should stringify arrays, nested arrays, and sparse/omitted elements', () => {
            assert.strictEqual(polyJson.stringify([]), '[]');
            assert.strictEqual(polyJson.stringify([1, 'two', true, null]), '[1,"two",true,null]');
            assert.strictEqual(polyJson.stringify([[1, 2], [3, 4]]), '[[1,2],[3,4]]');
            // Functions/undefined in arrays become null
            assert.strictEqual(polyJson.stringify([undefined, () => {}, 1]), '[null,null,1]');
        });

        it('should stringify objects and nested objects', () => {
            assert.strictEqual(polyJson.stringify({}), '{}');
            const data = {
                name: 'SmartLinter',
                version: '21.4.1',
                active: true,
                ports: [49152, 49153]
            };
            assert.strictEqual(polyJson.stringify(data), JSON.stringify(data));
        });

        it('should omit undefined and function properties in objects', () => {
            const objWithFunctions = {
                valid: 'yes',
                ignoredFunc: () => {},
                ignoredUndefined: undefined
            };
            assert.strictEqual(polyJson.stringify(objWithFunctions), '{"valid":"yes"}');
        });

        it('should support replacer function and replacer array of keys', () => {
            const obj = { a: 1, b: 2, c: 3 };
            const replacerArray = polyJson.stringify(obj, ['a', 'c']);
            assert.strictEqual(replacerArray, '{"a":1,"c":3}');

            const replacerFunc = polyJson.stringify(obj, (k: string, v: any) => {
                if (k === 'b') return undefined;
                if (typeof v === 'number') return v * 10;
                return v;
            });
            assert.strictEqual(replacerFunc, '{"a":10,"c":30}');
        });

        it('should support space parameter for indentation', () => {
            const obj = { a: 1 };
            const pretty2 = polyJson.stringify(obj, null, 2);
            assert.strictEqual(pretty2, '{\n  "a": 1\n}');

            const prettyTab = polyJson.stringify(obj, null, '\t');
            assert.strictEqual(prettyTab, '{\n\t"a": 1\n}');
        });
    });

    describe('JSON.parse() Parsing & Validation', () => {
        let polyJson: any;

        beforeEach(() => {
            const { sandbox } = createExtendScriptContext(false);
            polyJson = sandbox.JSON;
        });

        it('should parse primitive JSON values', () => {
            assert.strictEqual(polyJson.parse('0'), 0);
            assert.strictEqual(polyJson.parse('-42.5'), -42.5);
            assert.strictEqual(polyJson.parse('true'), true);
            assert.strictEqual(polyJson.parse('false'), false);
            assert.strictEqual(polyJson.parse('null'), null);
            assert.strictEqual(polyJson.parse('"hello"'), 'hello');
        });

        it('should parse complex nested objects and arrays', () => {
            const jsonStr = '{"commandId":"cmd-1","status":"SUCCESS","hunks":[{"start":0,"end":5,"oldText":"hello","newText":"hi"}]}';
            const parsed = polyJson.parse(jsonStr);
            assert.deepStrictEqual(toHost(parsed), {
                commandId: 'cmd-1',
                status: 'SUCCESS',
                hunks: [
                    { start: 0, end: 5, oldText: 'hello', newText: 'hi' }
                ]
            });
        });

        it('should parse Unicode escape sequences correctly', () => {
            const jsonStr = '{"greeting":"\\uC548\\uB155\\uD558\\uC138\\uC694"}';
            const parsed = polyJson.parse(jsonStr);
            assert.strictEqual(parsed.greeting, '안녕하세요');
        });

        it('should support reviver transformation function', () => {
            const jsonStr = '{"count": 5, "nested": {"val": 10}}';
            const parsed = polyJson.parse(jsonStr, (k: string, v: any) => {
                return (typeof v === 'number') ? v * 2 : v;
            });
            assert.deepStrictEqual(toHost(parsed), {
                count: 10,
                nested: { val: 20 }
            });
        });

        it('should throw SyntaxError on malformed or dangerous JSON inputs', () => {
            assert.throws(() => polyJson.parse('{ bad: 1 }'), (err: any) => err && (err instanceof SyntaxError || err.name === 'SyntaxError'));
            assert.throws(() => polyJson.parse('[1, 2,'), (err: any) => err && (err instanceof SyntaxError || err.name === 'SyntaxError'));
            assert.throws(() => polyJson.parse('undefined'), (err: any) => err && (err instanceof SyntaxError || err.name === 'SyntaxError'));
            assert.throws(() => polyJson.parse(''), (err: any) => err && (err instanceof SyntaxError || err.name === 'SyntaxError'));
            assert.throws(() => polyJson.parse('function() { return 1; }()'), (err: any) => err && (err instanceof SyntaxError || err.name === 'SyntaxError'));
        });
    });

    describe('Bridge Protocol Message Roundtrips', () => {
        let polyJson: any;

        beforeEach(() => {
            const { sandbox } = createExtendScriptContext(false);
            polyJson = sandbox.JSON;
        });

        it('should roundtrip AuthHandshake and AuthResponse payloads', () => {
            const handshake = {
                editor: 'INDESIGN',
                version: '21.4.1',
                token: 'sec-tok-1234567890abcdef',
                documentName: 'Layout_2026_Final.indd'
            };
            const jsonStr = polyJson.stringify(handshake);
            const parsed = polyJson.parse(jsonStr);
            assert.deepStrictEqual(toHost(parsed), handshake);
        });

        it('should roundtrip ParagraphPayload with multilingual Korean text', () => {
            const payload = {
                paragraphId: 'p-1002',
                text: '인디자인 2026 배경 감시 데몬이 전역 JSON 폴리필을 통해 정상 통신합니다.',
                hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
                timestamp: 1724479900000,
                editorType: 'INDESIGN',
                target: null
            };
            const jsonStr = polyJson.stringify(payload);
            const parsed = polyJson.parse(jsonStr);
            assert.deepStrictEqual(toHost(parsed), payload);
        });

        it('should roundtrip ReplacementCommand with reverse-order multi-hunks', () => {
            const command = {
                commandId: 'cmd-multi-001',
                paragraphId: 'p-1002',
                baseHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
                hunks: [
                    { start: 30, end: 35, oldText: '정상 통신합니다', newText: '완벽히 동작합니다' },
                    { start: 0, end: 8, oldText: '인디자인 2026', newText: 'Adobe InDesign 2026' }
                ]
            };
            const jsonStr = polyJson.stringify(command);
            const parsed = polyJson.parse(jsonStr);
            assert.deepStrictEqual(toHost(parsed), command);
        });
    });

    describe('Daemon Script #include Integration (Zero Native JSON in Engine)', () => {
        it('should enable smartlinter_daemon.jsx and components to use JSON when native JSON is undefined', () => {
            const daemonPath = path.resolve(__dirname, '../extendscript/smartlinter_daemon.jsx');
            let content = fs.readFileSync(daemonPath, 'utf8');
            const dir = path.dirname(daemonPath);

            // Preprocess #include recursively (exact ExtendScript loader simulation)
            content = content.replace(/^[ \t]*#include\s+["']([^"']+)["']/gm, (_match, relPath) => {
                const fullIncludePath = path.resolve(dir, relPath);
                if (fs.existsSync(fullIncludePath)) {
                    const incContent = fs.readFileSync(fullIncludePath, 'utf8')
                        .replace(/^[ \t]*#targetengine[^\n]*/gm, '// #targetengine (included)');
                    return `\n// --- Begin #include "${relPath}" ---\n` + incContent + `\n// --- End #include "${relPath}" ---\n`;
                }
                return _match;
            });
            content = content.replace(/^[ \t]*#[a-zA-Z_]+/gm, '// $&');

            // Strictly NO native JSON in sandbox
            const sandbox: Record<string, any> = {
                console,
                Date,
                Math,
                String,
                Number,
                Boolean,
                Array,
                Object,
                RegExp,
                parseInt,
                parseFloat,
                isFinite,
                isNaN,
                setTimeout: () => {},
                clearTimeout: () => {},
                setInterval: () => {},
                clearInterval: () => {},
                module: { exports: {} },
                exports: {}
            };
            sandbox.$ = { global: sandbox, writeln: () => {} };
            sandbox.global = sandbox;

            const ctx = vm.createContext(sandbox);
            // Must execute without "JSON is undefined" error
            assert.doesNotThrow(() => {
                vm.runInContext(content, ctx, { filename: 'smartlinter_daemon.jsx' });
            });

            // Verify JSON is available and operational inside the daemon engine
            assert.ok(sandbox.JSON, 'JSON must be defined after running daemon bundle');
            assert.strictEqual(typeof sandbox.JSON.stringify, 'function');
            assert.strictEqual(typeof sandbox.JSON.parse, 'function');

            // Verify SmartLinterAtomicReplacer parses JSON string commands without native JSON
            const replacer = new sandbox.SmartLinterAtomicReplacer();
            
            // 1. Invalid JSON string returns 'Invalid JSON command'
            const invalidRes = replacer.execute('{ malformed json');
            assert.strictEqual(invalidRes.status, 'FAILED');
            assert.ok(invalidRes.message.indexOf('Invalid JSON command') !== -1);

            // 2. Valid JSON string with missing commandId is successfully parsed and validated
            const validJsonStr = sandbox.JSON.stringify({
                paragraphId: 'p-1',
                baseHash: 'hash'
                // missing commandId & hunks
            });
            const res = replacer.execute(validJsonStr);
            assert.strictEqual(res.status, 'FAILED');
            assert.ok(res.message.indexOf('Invalid ReplacementCommand') !== -1, 'Replacer successfully parsed JSON payload');
            assert.strictEqual(res.commandId, 'unknown');
        });

        it('should execute httpRequest parsing in daemon bundle when String.prototype.trim is undefined', () => {
            const daemonPath = path.resolve(__dirname, '../extendscript/smartlinter_daemon.jsx');
            let content = fs.readFileSync(daemonPath, 'utf8');
            const dir = path.dirname(daemonPath);

            // Preprocess #include recursively
            content = content.replace(/^[ \t]*#include\s+["']([^"']+)["']/gm, (_match, relPath) => {
                const fullIncludePath = path.resolve(dir, relPath);
                if (fs.existsSync(fullIncludePath)) {
                    const incContent = fs.readFileSync(fullIncludePath, 'utf8')
                        .replace(/^[ \t]*#targetengine[^\n]*/gm, '// #targetengine (included)');
                    return `\n// --- Begin #include "${relPath}" ---\n` + incContent + `\n// --- End #include "${relPath}" ---\n`;
                }
                return _match;
            });
            content = content.replace(/^[ \t]*#[a-zA-Z_]+/gm, '// $&');

            const sandbox: Record<string, any> = {
                console,
                Date,
                Math,
                Number,
                Boolean,
                Array,
                Object,
                RegExp,
                parseInt,
                parseFloat,
                isFinite,
                isNaN,
                setTimeout: () => {},
                clearTimeout: () => {},
                setInterval: () => {},
                clearInterval: () => {},
                module: { exports: {} },
                exports: {}
            };
            sandbox.$ = { global: sandbox, writeln: () => {} };
            sandbox.global = sandbox;

            const ctx = vm.createContext(sandbox);
            // Strictly delete String.prototype.trim
            vm.runInContext('delete String.prototype.trim;', ctx);
            assert.strictEqual(vm.runInContext('typeof String.prototype.trim', ctx), 'undefined');

            vm.runInContext(content, ctx, { filename: 'smartlinter_daemon.jsx' });

            // Mock socket returning HTTP 200 with whitespace-padded JSON response
            let socketEof = false;
            const mockSocket = {
                timeout: 3,
                encoding: 'UTF-8',
                get eof() { return socketEof; },
                open: () => { socketEof = false; return true; },
                write: () => true,
                read: () => {
                    socketEof = true;
                    return 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n  {"success":true,"sessionToken":"poly-token-123"}  \r\n';
                },
                close: () => { socketEof = true; return true; }
            };

            const bridgeSocket = new sandbox.SmartLinterBridgeSocket({
                socketFactory: () => mockSocket
            });

            const res = bridgeSocket.httpRequest('POST', '/auth/handshake', { token: 't' });
            assert.strictEqual(res.ok, true);
            assert.strictEqual(res.statusCode, 200);
            assert.ok(res.body, 'Body must be parsed without trim() exception');
            assert.strictEqual(res.body.success, true);
            assert.strictEqual(res.body.sessionToken, 'poly-token-123');
        });
    });
});

