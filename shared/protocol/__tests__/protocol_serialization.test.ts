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
    isTextHunk,
    isQaIssue,
    isLiveSnapshotRequest,
    isLiveSnapshotResponse,
    isLocateRequest,
    isLocateResponse,
    isEnumerateDocumentResponse,
    isDocumentGenerationProgress,
    isCancelTranslatedDocumentRequest,
    isContainerKind,
    isTableLocator,
    isScannedParagraphEntry,
    isDocumentGenerationParagraphPlan,
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

    describe('QaIssue suggestion compatibility', () => {
        const legacyIssue = {
            category: 'Grammar', originalSegment: 'old', suggestedSegment: 'new',
            reason: 'Legacy QA fixture', severity: 'MEDIUM',
        };

        it('accepts legacy issues with no suggestions', () => {
            assert.equal(isQaIssue(legacyIssue), true);
        });

        it('validates suggestion arrays and confidence bounds', () => {
            assert.equal(isQaIssue({
                ...legacyIssue,
                suggestions: [
                    { suggestedSegment: 'first', confidence: 0 },
                    { suggestedSegment: 'second', confidence: 1 },
                ],
            }), true);
            assert.equal(isQaIssue({ ...legacyIssue, suggestions: {} }), false);
            assert.equal(isQaIssue({ ...legacyIssue, suggestions: [] }), false);
            assert.equal(isQaIssue({ ...legacyIssue, suggestions: [{ suggestedSegment: 1 }] }), false);
            assert.equal(isQaIssue({ ...legacyIssue, suggestions: [{ suggestedSegment: 'new', confidence: -0.1 }] }), false);
            assert.equal(isQaIssue({ ...legacyIssue, suggestions: [{ suggestedSegment: 'new', confidence: Number.NaN }] }), false);
            assert.equal(isQaIssue({ ...legacyIssue, suggestions: [{ suggestedSegment: 'new', confidence: 1.1 }] }), false);
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
        it('validates live snapshot request and response envelopes', () => {
            const request = { requestId: 'snapshot-1', paragraphIds: ['word-para-123'], baseHash: 'full-hash' };
            const response = { requestId: 'snapshot-1', results: [{ paragraphId: 'word-para-123', status: 'FOUND' as const, currentText: 'Text', currentHash: 'full-hash' }] };
            assert.equal(isLiveSnapshotRequest(request), true);
            assert.equal(isLiveSnapshotResponse(response), true);
            assert.equal(isBridgeMessage({ type: 'LIVE_SNAPSHOT_REQUEST', payload: request }), true);
            assert.equal(isBridgeMessage({ type: 'LIVE_SNAPSHOT_RESPONSE', payload: response }), true);
            assert.equal(isLiveSnapshotRequest({ paragraphIds: [] }), false);
            assert.equal(isLiveSnapshotResponse({ requestId: 'x', results: [{ paragraphId: 'x', status: 'INVALID' }] }), false);
        });
        it('validates locate request and response envelopes', () => {
            const request = { requestId: 'locate-1', paragraphId: 'word-para-123', baseHash: 'full-hash' };
            const response = { requestId: 'locate-1', status: 'SELECTION_FAILED' as const, message: 'Unsupported' };
            assert.equal(isLocateRequest(request), true);
            assert.equal(isLocateResponse(response), true);
            assert.equal(isBridgeMessage({ type: 'LOCATE_REQUEST', payload: request }), true);
            assert.equal(isBridgeMessage({ type: 'LOCATE_RESPONSE', payload: response }), true);
            assert.equal(isLocateRequest({ requestId: 'x', paragraphId: 'p', startOffset: 2, endOffset: 1 }), false);
        });

        it('accepts document scans with and without an optional error message', () => {
            const response = {
                requestId: 'scan-1', sourceDocumentName: 'document.docx', paragraphs: [],
            };
            assert.equal(isEnumerateDocumentResponse(response), true);
            assert.equal(isEnumerateDocumentResponse({ ...response, error: 'Office.js document scan error: busy' }), true);
            assert.equal(isEnumerateDocumentResponse({ ...response, error: 123 }), false);
        });
        it('accepts an optional valid tagged scan source and rejects malformed tags', () => {
            const response = {
                requestId: 'scan-tags', sourceDocumentName: 'document.docx', paragraphs: [{
                    paragraphId: 'word-para-body-0-hash', text: 'Bold', hash: 'hash', documentOrderIndex: 0,
                    taggedSource: { tagStatus: 'valid', sourceTokens: [
                        { type: 'open', id: '1', kind: 'bold' }, { type: 'text', value: 'Bold' }, { type: 'close', id: '1', kind: 'bold' },
                    ] },
                }],
            };
            assert.equal(isEnumerateDocumentResponse(response), true);
            assert.equal(isEnumerateDocumentResponse({ ...response, paragraphs: [{ ...response.paragraphs[0], taggedSource: { tagStatus: 'valid', sourceTokens: [{}] } }] }), false);
        });
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

    describe('translated-document lifecycle wire compatibility', () => {
        it('accepts camelCase progress and cancellation while rejecting invalid units', () => {
            assert.equal(isDocumentGenerationProgress({ requestId: 'same-request', phase: 'materializing', completedUnits: 1, totalUnits: 2 }), true);
            assert.equal(isDocumentGenerationProgress({ requestId: 'same-request', phase: 'materializing', completedUnits: -1 }), false);
            assert.equal(isDocumentGenerationProgress({ requestId: 'same-request', phase: 'materializing', completedUnits: 3, totalUnits: 2 }), false);
            assert.equal(isCancelTranslatedDocumentRequest({ requestId: 'same-request' }), true);
            assert.equal(isBridgeMessage({ type: 'DOCUMENT_GENERATION_PROGRESS', payload: { requestId: 'same-request', phase: 'copying' } }), true);
            assert.equal(isBridgeMessage({ type: 'GENERATE_TRANSLATED_DOCUMENT_RESPONSE', payload: { requestId: 'same-request', status: 'CANCELLED' } }), true);
        });
    });

    describe('ContainerKind and TableLocator protocol validation', () => {
        it('validates ContainerKind correctly', () => {
            assert.equal(isContainerKind('BODY'), true);
            assert.equal(isContainerKind('TABLE'), true);
            assert.equal(isContainerKind('FOOTNOTE'), false);
            assert.equal(isContainerKind(''), false);
            assert.equal(isContainerKind(null), false);
        });

        it('validates TableLocator structure and integer bounds', () => {
            const valid: import('../types.ts').TableLocator = {
                tableIndex: 0,
                cellIndex: 1,
                cellName: '0:1',
                paragraphIndexInCell: 0,
                rowSpan: 1,
                columnSpan: 2,
            };
            assert.equal(isTableLocator(valid), true);
            assert.equal(isTableLocator({ ...valid, rowIndex: 0 }), true);
            assert.equal(isTableLocator({ tableIndex: 0, cellIndex: 0, paragraphIndexInCell: 0 }), true);

            // Reject negative or non-integer indices
            assert.equal(isTableLocator({ ...valid, tableIndex: -1 }), false);
            assert.equal(isTableLocator({ ...valid, cellIndex: 1.5 }), false);
            assert.equal(isTableLocator({ ...valid, paragraphIndexInCell: -1 }), false);
            assert.equal(isTableLocator({ ...valid, rowSpan: 0 }), false);
            assert.equal(isTableLocator({ ...valid, columnSpan: -2 }), false);
            assert.equal(isTableLocator(null), false);
            assert.equal(isTableLocator({}), false);
        });

        it('validates ScannedParagraphEntry and DocumentGenerationParagraphPlan with table metadata', () => {
            const locator: import('../types.ts').TableLocator = {
                tableIndex: 0,
                cellIndex: 2,
                cellName: '1:0',
                paragraphIndexInCell: 0,
                rowSpan: 1,
                columnSpan: 1,
            };
            const entry = {
                paragraphId: 'indesign-tablepara-10-0-2-0',
                text: 'Cell text',
                hash: 'hash-val',
                documentOrderIndex: 2,
                containerKind: 'TABLE' as const,
                tableLocator: locator,
            };
            assert.equal(isScannedParagraphEntry(entry), true);
            assert.equal(isScannedParagraphEntry({ ...entry, tableLocator: { ...locator, cellIndex: -1 } }), false);

            const plan = {
                paragraphId: 'indesign-tablepara-10-0-2-0',
                documentOrderIndex: 2,
                expectedSourceHash: 'hash-val',
                targetText: '번역 텍스트',
                containerKind: 'TABLE' as const,
                tableLocator: locator,
            };
            assert.equal(isDocumentGenerationParagraphPlan(plan), true);
            assert.equal(isDocumentGenerationParagraphPlan({ ...plan, containerKind: 'INVALID' as any }), false);
        });
    });
});
