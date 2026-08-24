/**
 * Unit Test: Protocol Serialization & Cross-Compatibility
 *
 * Path: tests/unit/protocol_serialization_test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    isParagraphPayload,
    isReplacementCommand,
    isReplacementResult,
    isAuthHandshake,
    isAuthResponse,
    isHeartbeatPayload,
    isBridgeMessage,
    type ParagraphPayload,
    type ReplacementCommand,
    type ReplacementResult,
    type AuthHandshake
} from '../../shared/protocol/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesPath = path.resolve(__dirname, '../../shared/fixtures/protocol_samples.json');

describe('Unit Test: Protocol Serialization (tests/unit)', () => {
    const rawFixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));

    it('should verify ParagraphPayload bidirectional compatibility', () => {
        const sample = rawFixtures.paragraphPayloadWord as ParagraphPayload;
        assert.equal(isParagraphPayload(sample), true);
        const serialized = JSON.stringify(sample);
        const parsed = JSON.parse(serialized);
        assert.deepEqual(parsed, sample);
    });

    it('should verify ReplacementCommand multi-hunk structure', () => {
        const sample = rawFixtures.replacementCommand as ReplacementCommand;
        assert.equal(isReplacementCommand(sample), true);
        assert.equal(sample.hunks.length, 3);
    });

    it('should verify all 4 ReplacementResult statuses', () => {
        assert.equal(isReplacementResult(rawFixtures.replacementResultSuccess), true);
        assert.equal(isReplacementResult(rawFixtures.replacementResultStale), true);
        assert.equal(isReplacementResult(rawFixtures.replacementResultRolledBack), true);
        assert.equal(isReplacementResult(rawFixtures.replacementResultFailed), true);
    });

    it('should verify AuthHandshake for both Word and InDesign', () => {
        assert.equal(isAuthHandshake(rawFixtures.authHandshakeWord), true);
        assert.equal(isAuthHandshake(rawFixtures.authHandshakeInDesign), true);
    });

    it('should verify BridgeMessage multiplex envelope', () => {
        assert.equal(isBridgeMessage(rawFixtures.bridgeMessageParagraph), true);
    });
});
