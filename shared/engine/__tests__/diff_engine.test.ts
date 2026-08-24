/**
 * Unit Tests for SmartLinter Core Diff & Multi-Hunk Replacement Engine
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    sortHunksReverse,
    sortHunksForward,
    validateHunks,
    extractDiffHunks,
    replaceReverse,
    replaceForward,
} from '../diff_engine.ts';
import { type TextHunk } from '../../protocol/types.ts';

describe('SmartLinter Core Diff & Multi-Hunk Engine', () => {
    describe('sortHunksReverse() & sortHunksForward()', () => {
        const rawHunks: TextHunk[] = [
            { start: 10, end: 15, oldText: 'brown', newText: 'dark brown' },
            { start: 51, end: 56, oldText: 'sunny', newText: 'bright' },
            { start: 35, end: 39, oldText: 'lazy', newText: 'sleepy' },
        ];

        it('should sort hunks descending by start offset in sortHunksReverse()', () => {
            const reverse = sortHunksReverse(rawHunks);
            assert.equal(reverse[0].start, 51);
            assert.equal(reverse[1].start, 35);
            assert.equal(reverse[2].start, 10);
        });

        it('should sort hunks ascending by start offset in sortHunksForward()', () => {
            const forward = sortHunksForward(rawHunks);
            assert.equal(forward[0].start, 10);
            assert.equal(forward[1].start, 35);
            assert.equal(forward[2].start, 51);
        });

        it('should maintain immutability and not mutate original input array', () => {
            const originalCopy = [...rawHunks];
            sortHunksReverse(rawHunks);
            assert.deepEqual(rawHunks, originalCopy);
        });
    });

    describe('validateHunks()', () => {
        const sampleText = 'The quick brown fox jumps over the lazy dog in the sunny park.';

        it('should validate correctly aligned, non-overlapping hunks', () => {
            const validHunks: TextHunk[] = [
                { start: 10, end: 15, oldText: 'brown', newText: 'reddish' },
                { start: 35, end: 39, oldText: 'lazy', newText: 'sleepy' },
                { start: 51, end: 56, oldText: 'sunny', newText: 'bright' },
            ];

            const result = validateHunks(sampleText, validHunks);
            assert.equal(result.valid, true);
            assert.equal(result.errors.length, 0);
        });

        it('should detect out-of-bounds start and end offsets', () => {
            const oobHunks: TextHunk[] = [
                { start: -1, end: 5, oldText: 'The', newText: 'A' },
                { start: 50, end: 100, oldText: 'sunny park.', newText: 'garden.' },
            ];

            const result = validateHunks(sampleText, oobHunks);
            assert.equal(result.valid, false);
            assert.equal(result.errors.length, 2);
        });

        it('should detect oldText mismatches against actual text at given offset', () => {
            const mismatchHunks: TextHunk[] = [
                { start: 10, end: 15, oldText: 'WHITE', newText: 'reddish' }, // Actual is 'brown'
            ];

            const result = validateHunks(sampleText, mismatchHunks);
            assert.equal(result.valid, false);
            assert.match(result.errors[0], /text mismatch/i);
        });

        it('should detect overlapping hunks', () => {
            const overlappingHunks: TextHunk[] = [
                { start: 10, end: 20, oldText: 'brown fox ', newText: 'cat ' },
                { start: 16, end: 25, oldText: 'fox jumps', newText: 'leaps' },
            ];

            const result = validateHunks(sampleText, overlappingHunks);
            assert.equal(result.valid, false);
            assert.match(result.errors[0], /overlapping hunks detected/i);
        });
    });

    describe('extractDiffHunks()', () => {
        it('should return empty hunk array for identical strings', () => {
            const text = 'Identical unchanged paragraph.';
            const hunks = extractDiffHunks(text, text);
            assert.deepEqual(hunks, []);
        });

        it('should extract a single minimal hunk for a single word replacement', () => {
            const original = 'Hello beautiful world!';
            const suggested = 'Hello wonderful world!';
            const hunks = extractDiffHunks(original, suggested);

            assert.equal(hunks.length, 1);
            assert.equal(hunks[0].start, 6);
            assert.equal(hunks[0].end, 15);
            assert.equal(hunks[0].oldText, 'beautiful');
            assert.equal(hunks[0].newText, 'wonderful');
        });

        it('should extract 3 separate minimal hunks across a multi-part sentence', () => {
            const original = 'The quick brown fox jumps over the lazy dog in the sunny park.';
            const suggested = 'The quick dark reddish-brown fox jumps over the extremely sleepy dog in the bright park.';
            const hunks = extractDiffHunks(original, suggested);

            assert.equal(hunks.length, 3);

            // Hunk 1: brown -> dark reddish-brown
            assert.equal(hunks[0].start, 10);
            assert.equal(hunks[0].end, 15);
            assert.equal(hunks[0].oldText, 'brown');
            assert.equal(hunks[0].newText, 'dark reddish-brown');

            // Hunk 2: lazy -> extremely sleepy
            assert.equal(hunks[1].start, 35);
            assert.equal(hunks[1].end, 39);
            assert.equal(hunks[1].oldText, 'lazy');
            assert.equal(hunks[1].newText, 'extremely sleepy');

            // Hunk 3: sunny -> bright
            assert.equal(hunks[2].start, 51);
            assert.equal(hunks[2].end, 56);
            assert.equal(hunks[2].oldText, 'sunny');
            assert.equal(hunks[2].newText, 'bright');
        });

        it('should handle pure insertions and pure deletions', () => {
            // Insertion
            const beforeInsert = 'Start end.';
            const afterInsert = 'Start middle end.';
            const insertHunks = extractDiffHunks(beforeInsert, afterInsert);
            assert.equal(insertHunks.length, 1);
            const appliedInsert = replaceReverse(beforeInsert, insertHunks);
            assert.equal(appliedInsert.finalText, afterInsert);
            assert.equal(appliedInsert.isSuccess, true);

            // Deletion
            const beforeDelete = 'Alpha Beta Gamma';
            const afterDelete = 'Alpha Gamma';
            const deleteHunks = extractDiffHunks(beforeDelete, afterDelete);
            assert.equal(deleteHunks.length, 1);
            const appliedDelete = replaceReverse(beforeDelete, deleteHunks);
            assert.equal(appliedDelete.finalText, afterDelete);
            assert.equal(appliedDelete.isSuccess, true);
        });

        it('should handle Korean multilingual sentences correctly', () => {
            const origKo = '스마트 린터는 고속 TM 매칭과 서식 보존 치환을 지원합니다.';
            const suggKo = 'SmartLinter는 초고속 TM 매칭 및 원본 서식 보존 치환을 완벽 지원합니다.';
            const hunks = extractDiffHunks(origKo, suggKo);

            assert.ok(hunks.length >= 1);
            const applied = replaceReverse(origKo, hunks);
            assert.equal(applied.finalText, suggKo);
            assert.equal(applied.driftErrors, 0);
            assert.equal(applied.isSuccess, true);
        });
    });

    describe('replaceReverse() vs replaceForward() Offset Drift Defense', () => {
        const baseline = 'The quick brown fox jumps over the lazy dog in the sunny park.';
        const hunks: TextHunk[] = [
            { start: 10, end: 15, oldText: 'brown', newText: 'dark reddish-brown' }, // +13 chars
            { start: 35, end: 39, oldText: 'lazy', newText: 'extremely sleepy' }, // +12 chars
            { start: 51, end: 56, oldText: 'sunny', newText: 'bright' }, // +1 char
        ];
        const expectedFinal = 'The quick dark reddish-brown fox jumps over the extremely sleepy dog in the bright park.';

        it('should apply in reverse order with 0 drift errors and 100% exact text generation', () => {
            const reverseResult = replaceReverse(baseline, hunks);

            assert.equal(reverseResult.driftErrors, 0);
            assert.equal(reverseResult.appliedHunks, 3);
            assert.equal(reverseResult.isSuccess, true);
            assert.equal(reverseResult.finalText, expectedFinal);

            // Verify all logs report SUCCESS
            assert.equal(reverseResult.executionLog.every((l) => l.status === 'SUCCESS'), true);
        });

        it('should encounter offset drift errors when applying forward order with expanding hunks', () => {
            const forwardResult = replaceForward(baseline, hunks);

            // Hunk 1 applies, expanding text by 13 chars.
            // Hunk 2 at fixed offset 35..39 now points to wrong slice -> DRIFT_ERROR
            // Hunk 3 at fixed offset 51..56 now points to wrong slice -> DRIFT_ERROR
            assert.equal(forwardResult.driftErrors, 2);
            assert.equal(forwardResult.appliedHunks, 1);
            assert.equal(forwardResult.isSuccess, false);
            assert.notEqual(forwardResult.finalText, expectedFinal);
        });

        it('should roundtrip arbitrary extracted diffs via replaceReverse with 100% fidelity', () => {
            const original = 'Section 4: Cloud infrastructure deployment was performed manually without automation.';
            const suggested = 'Section 4: Cloud infrastructure orchestration is executed automatically via GitOps pipelines.';

            const extracted = extractDiffHunks(original, suggested);
            const applied = replaceReverse(original, extracted);

            assert.equal(applied.isSuccess, true);
            assert.equal(applied.driftErrors, 0);
            assert.equal(applied.finalText, suggested);
        });
    });
});
