/**
 * SmartLinter Paragraph Hash & Normalization Utility
 *
 * Provides deterministic whitespace/newline normalization and fast SHA-256
 * hash computation for paragraph integrity verification, stale conflict detection,
 * and Pre-rollback Hash Checks.
 */

import * as crypto from 'node:crypto';

/**
 * Options for paragraph text normalization.
 */
export interface NormalizationOptions {
    /** Whether to normalize Unicode strings to NFC form (default: true) */
    normalizeUnicode?: boolean;
    /** Whether to convert CRLF (\r\n) and CR (\r) line endings to LF (\n) (default: true) */
    normalizeLineEndings?: boolean;
    /** Whether to replace non-breaking spaces (\u00A0) with standard spaces (default: true) */
    normalizeSpaces?: boolean;
    /** Whether to strip trailing whitespace from each line (default: true) */
    trimLineTrailingWhitespace?: boolean;
    /** Whether to strip trailing newline/whitespace at the end of the entire paragraph (default: true) */
    trimParagraphEnd?: boolean;
}

/**
 * Default normalization configuration.
 */
const DEFAULT_NORMALIZATION_OPTIONS: Required<NormalizationOptions> = {
    normalizeUnicode: true,
    normalizeLineEndings: true,
    normalizeSpaces: true,
    trimLineTrailingWhitespace: true,
    trimParagraphEnd: true,
};

/**
 * Normalizes paragraph text to produce deterministic, cross-platform hash representations.
 * Handles differences in OS line endings, Word/InDesign paragraph break markers, and Unicode variations.
 *
 * @param text Raw paragraph text string
 * @param options Optional overrides for normalization behavior
 * @returns Normalized text string
 */
export function normalizeParagraph(text: string, options?: NormalizationOptions): string {
    if (typeof text !== 'string') {
        return '';
    }

    const opts = { ...DEFAULT_NORMALIZATION_OPTIONS, ...options };
    let result = text;

    // 1. Unicode NFC normalization
    if (opts.normalizeUnicode) {
        result = result.normalize('NFC');
    }

    // 2. Line ending normalization (\r\n -> \n, \r -> \n, \u2028 line separator -> \n)
    if (opts.normalizeLineEndings) {
        result = result.replace(/\r\n/g, '\n').replace(/[\r\u2028]/g, '\n');
    }

    // 3. Special whitespace normalization (non-breaking spaces, zero-width spaces)
    if (opts.normalizeSpaces) {
        // Replace non-breaking space (\u00A0) and narrow NBSP (\u202F) with standard space
        result = result.replace(/[\u00A0\u202F]/g, ' ');
    }

    // 4. Line-level trailing whitespace trimming
    if (opts.trimLineTrailingWhitespace) {
        result = result
            .split('\n')
            .map((line) => line.replace(/[ \t]+$/g, ''))
            .join('\n');
    }

    // 5. Overall paragraph trailing whitespace/newline trimming
    if (opts.trimParagraphEnd) {
        result = result.replace(/[\n\s]+$/g, '');
    }

    return result;
}

/**
 * Computes a 64-character lowercase hexadecimal SHA-256 hash of the paragraph.
 *
 * @param text Raw or normalized paragraph text
 * @param normalize Whether to apply normalizeParagraph before hashing (default: true)
 * @param options Specific normalization options if normalize is true
 * @returns 64-character lowercase hexadecimal SHA-256 hash
 */
export function computeParagraphHash(
    text: string,
    normalize: boolean = true,
    options?: NormalizationOptions
): string {
    const input = normalize ? normalizeParagraph(text, options) : text;
    return crypto.createHash('sha256').update(input, 'utf8').digest('hex').toLowerCase();
}

/**
 * Verifies whether the paragraph matches the expected SHA-256 hash.
 *
 * @param text The paragraph text to verify
 * @param expectedHash The expected 64-char hash string
 * @param normalize Whether to normalize text before computing hash (default: true)
 * @returns boolean True if the computed hash matches expectedHash
 */
export function verifyParagraphHash(
    text: string,
    expectedHash: string,
    normalize: boolean = true
): boolean {
    if (!expectedHash || typeof expectedHash !== 'string') {
        return false;
    }
    const actualHash = computeParagraphHash(text, normalize);
    return actualHash.toLowerCase() === expectedHash.trim().toLowerCase();
}
