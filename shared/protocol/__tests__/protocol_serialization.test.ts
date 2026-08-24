/**
 * TypeScript Protocol Serialization & Cross-Compatibility Unit Tests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    type ParagraphPayload,
    type ReplacementCommand,
    type ReplacementResult,
    type AuthHandshake,
    type AuthResponse,
    type HeartbeatPayload,
    type BridgeMessage,
    type EditorType,
    type ReplacementStatus,
    isParagraphPayload,
    isReplacementCommand,
    isReplacementResult,
    isAuthHandshake,
    isAuthResponse,
    isHeartbeatPayload,
    isBridgeMessage,
    isEditorType,
    isReplacementStatus,
    isTextHunk
} from '../types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesPath = path.resolve(__dirname, '../../fixtures/protocol_samples.json');
const schemaPath = path.resolve(__dirname, '../schema.json');

describe('Shared Protocol Serialization & Compatibility Tests', () => {
    const rawFixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));

    describe('ParagraphPayload Serialization & Type Guards', () => {
        it('should correctly validate and serialize Word ParagraphPayload with optional target', () => {
            const sample = rawFixtures.paragraphPayloadWord as ParagraphPayload;
            assert.equal(isParagraphPayload(sample), true);
            assert.equal(sample.paragraphId, 'para-word-001');
            assert.equal(sample.editorType, 'Word');
            assert.equal(sample.target, 'ko-KR');

            const jsonStr = JSON.stringify(sample);
            const parsed = JSON.parse(jsonStr);
            assert.deepEqual(parsed, sample);
            assert.equal(isParagraphPayload(parsed), true);
        });

        it('should correctly validate and serialize InDesign ParagraphPayload without target', () => {
            const sample = rawFixtures.paragraphPayloadInDesign as ParagraphPayload;
            assert.equal(isParagraphPayload(sample), true);
            assert.equal(sample.paragraphId, 'para-id-042');
            assert.equal(sample.editorType, 'InDesign');
            assert.equal(sample.target, undefined);

            const jsonStr = JSON.stringify(sample);
            const parsed = JSON.parse(jsonStr);
            assert.deepEqual(parsed, sample);
            assert.equal(isParagraphPayload(parsed), true);
        });

        it('should reject invalid ParagraphPayload with missing fields or wrong types', () => {
            assert.equal(isParagraphPayload(null), false);
            assert.equal(isParagraphPayload({}), false);
            assert.equal(isParagraphPayload({ paragraphId: 123 }), false);
            assert.equal(isParagraphPayload({ ...rawFixtures.paragraphPayloadWord, editorType: 'Notepad' }), false);
            assert.equal(isParagraphPayload({ ...rawFixtures.paragraphPayloadWord, timestamp: 'invalid-time' }), false);
        });
    });

    describe('ReplacementCommand & TextHunk Serialization', () => {
        it('should correctly validate and serialize ReplacementCommand with multi-hunk diffs', () => {
            const sample = rawFixtures.replacementCommand as ReplacementCommand;
            assert.equal(isReplacementCommand(sample), true);
            assert.equal(sample.commandId, 'cmd-tx-789');
            assert.equal(sample.hunks.length, 3);

            // Verify hunk offsets
            assert.equal(sample.hunks[0].start, 51);
            assert.equal(sample.hunks[0].end, 56);
            assert.equal(sample.hunks[0].oldText, 'sunny');
            assert.equal(sample.hunks[0].newText, 'bright');

            const jsonStr = JSON.stringify(sample);
            const parsed = JSON.parse(jsonStr);
            assert.deepEqual(parsed, sample);
            assert.equal(isReplacementCommand(parsed), true);
        });

        it('should reject invalid TextHunk structures', () => {
            assert.equal(isTextHunk(null), false);
            assert.equal(isTextHunk({ start: -1, end: 5, oldText: 'a', newText: 'b' }), false);
            assert.equal(isTextHunk({ start: 10, end: 5, oldText: 'a', newText: 'b' }), false); // end < start
            assert.equal(isTextHunk({ start: 0, end: 5, oldText: 123, newText: 'b' }), false);
        });
    });

    describe('ReplacementResult Statuses & Serialization', () => {
        it('should validate SUCCESS status result without message', () => {
            const sample = rawFixtures.replacementResultSuccess as ReplacementResult;
            assert.equal(isReplacementResult(sample), true);
            assert.equal(sample.status, 'SUCCESS');
            assert.equal(sample.message, undefined);

            const jsonStr = JSON.stringify(sample);
            const parsed = JSON.parse(jsonStr);
            assert.deepEqual(parsed, sample);
        });

        it('should validate STALE_REJECTED status result with message', () => {
            const sample = rawFixtures.replacementResultStale as ReplacementResult;
            assert.equal(isReplacementResult(sample), true);
            assert.equal(sample.status, 'STALE_REJECTED');
            assert.match(sample.message ?? '', /mismatch/i);
        });

        it('should validate ROLLED_BACK status result with compensating message', () => {
            const sample = rawFixtures.replacementResultRolledBack as ReplacementResult;
            assert.equal(isReplacementResult(sample), true);
            assert.equal(sample.status, 'ROLLED_BACK');
            assert.match(sample.message ?? '', /rolled back/i);
        });

        it('should validate FAILED status result', () => {
            const sample = rawFixtures.replacementResultFailed as ReplacementResult;
            assert.equal(isReplacementResult(sample), true);
            assert.equal(sample.status, 'FAILED');
        });

        it('should reject unknown replacement statuses', () => {
            assert.equal(isReplacementStatus('UNKNOWN_STATUS'), false);
            assert.equal(isReplacementStatus('PENDING'), false);
            assert.equal(isReplacementResult({ commandId: 'c1', status: 'INVALID', currentHash: 'hash' }), false);
        });
    });

    describe('AuthHandshake & AuthResponse Serialization', () => {
        it('should validate Word and InDesign handshake payloads', () => {
            const wordHandshake = rawFixtures.authHandshakeWord as AuthHandshake;
            const indesignHandshake = rawFixtures.authHandshakeInDesign as AuthHandshake;

            assert.equal(isAuthHandshake(wordHandshake), true);
            assert.equal(wordHandshake.editorType, 'Word');
            assert.equal(wordHandshake.version, '0.1.0');

            assert.equal(isAuthHandshake(indesignHandshake), true);
            assert.equal(indesignHandshake.editorType, 'InDesign');

            const roundtrip = JSON.parse(JSON.stringify(wordHandshake));
            assert.deepEqual(roundtrip, wordHandshake);
        });

        it('should validate AuthResponse success and failure structures', () => {
            const authSuccess = rawFixtures.authResponseSuccess as AuthResponse;
            const authFailure = rawFixtures.authResponseFailure as AuthResponse;

            assert.equal(isAuthResponse(authSuccess), true);
            assert.equal(authSuccess.success, true);
            assert.ok(authSuccess.sessionToken);

            assert.equal(isAuthResponse(authFailure), true);
            assert.equal(authFailure.success, false);
            assert.equal(authFailure.sessionToken, undefined);
        });
    });

    describe('Heartbeat & Multiplexed BridgeMessage', () => {
        it('should validate HeartbeatPayload structure', () => {
            const heartbeat = rawFixtures.heartbeatPayload as HeartbeatPayload;
            assert.equal(isHeartbeatPayload(heartbeat), true);
            assert.equal(heartbeat.editorType, 'Word');
            assert.equal(heartbeat.activeDocument, 'Annual_Report_Final.docx');
        });

        it('should validate tagged BridgeMessage envelope', () => {
            const bridgeMsg = rawFixtures.bridgeMessageParagraph as BridgeMessage;
            assert.equal(isBridgeMessage(bridgeMsg), true);
            assert.equal(bridgeMsg.type, 'PARAGRAPH_PAYLOAD');
            assert.equal(bridgeMsg.payload.paragraphId, 'para-word-001');

            const roundtrip = JSON.parse(JSON.stringify(bridgeMsg));
            assert.deepEqual(roundtrip, bridgeMsg);
            assert.equal(isBridgeMessage(roundtrip), true);
        });

        it('should reject malformed bridge messages', () => {
            assert.equal(isBridgeMessage({ type: 'UNKNOWN_TYPE', payload: {} }), false);
            assert.equal(isBridgeMessage({ type: 'HEARTBEAT', payload: { editorType: 'InvalidEditor' } }), false);
        });
    });

    describe('JSON Schema File Integrity Check', () => {
        it('should contain all required definitions in schema.json', () => {
            const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
            assert.ok(schema.definitions, 'schema should have definitions');
            assert.ok(schema.definitions.ParagraphPayload);
            assert.ok(schema.definitions.ReplacementCommand);
            assert.ok(schema.definitions.ReplacementResult);
            assert.ok(schema.definitions.AuthHandshake);
            assert.ok(schema.definitions.TextHunk);
            assert.ok(schema.definitions.EditorType);
            assert.ok(schema.definitions.ReplacementStatus);
            assert.ok(schema.definitions.AuthResponse);
            assert.ok(schema.definitions.HeartbeatPayload);
            assert.ok(schema.definitions.BridgeMessage);
        });
    });
});
