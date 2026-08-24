/**
 * Unit Tests for SmartLinter Paragraph Hash & Normalization Utility
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';

import {
    normalizeParagraph,
    computeParagraphHash,
    verifyParagraphHash,
} from '../hash_util.ts';

describe('SmartLinter Paragraph Hash & Normalization Engine', () => {
    describe('normalizeParagraph()', () => {
        it('should normalize Windows CRLF (\\r\\n) and InDesign CR (\\r) to LF (\\n)', () => {
            const crlfText = 'Line 1\r\nLine 2\r\nLine 3';
            const crText = 'Line 1\rLine 2\rLine 3';
            const lfText = 'Line 1\nLine 2\nLine 3';

            assert.equal(normalizeParagraph(crlfText), lfText);
            assert.equal(normalizeParagraph(crText), lfText);
        });

        it('should normalize InDesign Unicode line separators (\\u2028)', () => {
            const separatorText = 'First part\u2028Second part';
            assert.equal(normalizeParagraph(separatorText), 'First part\nSecond part');
        });

        it('should normalize non-breaking spaces (\\u00A0, \\u202F) to standard ASCII spaces', () => {
            const nbspText = 'Word\u00A0with\u202Fnon-breaking\u00A0spaces';
            assert.equal(normalizeParagraph(nbspText), 'Word with non-breaking spaces');
        });

        it('should strip trailing line whitespace while preserving intentional indentation', () => {
            const indentedWithTrailing = '  function test() {   \n    return 42;  \t  \n  }';
            const expected = '  function test() {\n    return 42;\n  }';
            assert.equal(normalizeParagraph(indentedWithTrailing), expected);
        });

        it('should strip trailing newlines and trailing whitespace at paragraph end', () => {
            const textWithTrailingEnd = 'Paragraph content.\n\n   \n';
            assert.equal(normalizeParagraph(textWithTrailingEnd), 'Paragraph content.');
        });

        it('should apply Unicode NFC normalization consistently (e.g. Korean syllables)', () => {
            // Decomposed Hangul (NFD: ᄀ + ᅡ = 가) vs Composed (NFC: 가)
            const nfdHangul = '\u1100\u1161\u11AB'; // 간 (NFD)
            const nfcHangul = '\uAC04'; // 간 (NFC)
            assert.notEqual(nfdHangul, nfcHangul); // Raw strings differ

            const normalizedNFD = normalizeParagraph(nfdHangul);
            const normalizedNFC = normalizeParagraph(nfcHangul);
            assert.equal(normalizedNFD, normalizedNFC);
            assert.equal(normalizedNFD, '간');
        });

        it('should handle empty and non-string inputs gracefully', () => {
            assert.equal(normalizeParagraph(''), '');
            // @ts-expect-error Testing runtime invalid input
            assert.equal(normalizeParagraph(null), '');
            // @ts-expect-error Testing runtime invalid input
            assert.equal(normalizeParagraph(undefined), '');
        });
    });

    describe('computeParagraphHash()', () => {
        it('should compute valid 64-character lowercase SHA-256 hex string', () => {
            const text = 'SmartLinter core engine test';
            const hash = computeParagraphHash(text);
            assert.equal(typeof hash, 'string');
            assert.equal(hash.length, 64);
            assert.match(hash, /^[0-9a-f]{64}$/);
        });

        it('should yield identical hashes for text differing only by line endings or trailing spaces', () => {
            const text1 = 'Section 1: Introduction\r\nSmartLinter AI Assistant.\r\n   ';
            const text2 = 'Section 1: Introduction\nSmartLinter AI Assistant.\n';
            const text3 = 'Section 1: Introduction\rSmartLinter AI Assistant.';

            const hash1 = computeParagraphHash(text1);
            const hash2 = computeParagraphHash(text2);
            const hash3 = computeParagraphHash(text3);

            assert.equal(hash1, hash2);
            assert.equal(hash2, hash3);
        });

        it('should match Node.js standard crypto sha256 output for known baseline string', () => {
            const raw = 'Hello SmartLinter';
            const expectedHash = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
            assert.equal(computeParagraphHash(raw, false), expectedHash);
        });

        it('should match standard NIST SHA-256 test vectors (empty string and "abc")', () => {
            // NIST SHA-256 vector for empty string
            const emptyHash = computeParagraphHash('', false);
            assert.equal(emptyHash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

            // NIST SHA-256 vector for "abc"
            const abcHash = computeParagraphHash('abc', false);
            assert.equal(abcHash, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
        });

        it('should match Node.js crypto for complex multilingual, Korean, and emoji texts', () => {
            const testStrings = [
                '안녕하세요 SmartLinter 번역 검수 시스템입니다.',
                'Multi-byte characters: 日本語, 繁體中文, العربية, עברית',
                'Surrogate pairs & emojis: 🚀✨🔒📝🎯 12345!?',
                'Long text paragraph: '.repeat(50) + 'End of paragraph.',
                'Exactly 55 bytes string: 123456789012345678901234567890',
                'Boundary 56 bytes: 1234567890123456789012345678901234567',
                'Boundary 64 bytes: 123456789012345678901234567890123456789012345',
            ];

            for (const str of testStrings) {
                const nodeHash = crypto.createHash('sha256').update(str, 'utf8').digest('hex');
                const jsHash = computeParagraphHash(str, false);
                assert.equal(jsHash, nodeHash, `Mismatch for string: "${str.substring(0, 30)}..."`);
            }
        });

        it('should produce distinct hashes for different paragraph contents', () => {
            const textA = 'Original sentence version A.';
            const textB = 'Original sentence version B.';
            assert.notEqual(computeParagraphHash(textA), computeParagraphHash(textB));
        });
    });

    describe('verifyParagraphHash()', () => {
        it('should return true for matching hash (case-insensitive)', () => {
            const text = 'Verify paragraph integrity.';
            const hash = computeParagraphHash(text);

            assert.equal(verifyParagraphHash(text, hash), true);
            assert.equal(verifyParagraphHash(text, hash.toUpperCase()), true);
            assert.equal(verifyParagraphHash(text, `  ${hash}  `), true);
        });

        it('should return false for modified or stale text', () => {
            const originalText = 'Initial paragraph state.';
            const modifiedText = 'User edited paragraph state.';
            const baseHash = computeParagraphHash(originalText);

            assert.equal(verifyParagraphHash(modifiedText, baseHash), false);
        });

        it('should return false for invalid or empty expected hash', () => {
            assert.equal(verifyParagraphHash('Sample text', ''), false);
            assert.equal(verifyParagraphHash('Sample text', 'invalid-short-hash'), false);
        });
    });
});
