/**
 * SmartLinter Paragraph Hash & Normalization Utility
 *
 * Provides deterministic whitespace/newline normalization and fast SHA-256
 * hash computation for paragraph integrity verification, stale conflict detection,
 * and Pre-rollback Hash Checks.
 */

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
 * Pure JavaScript UTF-8 Byte Encoder (Node.js, Browser, Office.js, ExtendScript compatible).
 * @param str Input string
 * @returns Array of byte values (0-255)
 */
export function utf8Encode(str: string): number[] {
    if (!str || typeof str !== 'string') {
        return [];
    }
    if (typeof TextEncoder !== 'undefined') {
        const uint8 = new TextEncoder().encode(str);
        return Array.from(uint8);
    }
    const bytes: number[] = [];
    for (let i = 0; i < str.length; i++) {
        let code = str.charCodeAt(i);
        if (code < 0x80) {
            bytes.push(code);
        } else if (code < 0x800) {
            bytes.push(0xc0 | (code >> 6));
            bytes.push(0x80 | (code & 0x3f));
        } else if (code < 0xd800 || code >= 0xe000) {
            bytes.push(0xe0 | (code >> 12));
            bytes.push(0x80 | ((code >> 6) & 0x3f));
            bytes.push(0x80 | (code & 0x3f));
        } else {
            // UTF-16 surrogate pair
            i++;
            if (i < str.length) {
                const low = str.charCodeAt(i);
                code = 0x10000 + (((code & 0x3ff) << 10) | (low & 0x3ff));
                bytes.push(0xf0 | (code >> 18));
                bytes.push(0x80 | ((code >> 12) & 0x3f));
                bytes.push(0x80 | ((code >> 6) & 0x3f));
                bytes.push(0x80 | (code & 0x3f));
            }
        }
    }
    return bytes;
}

/**
 * Bitwise right rotate helper (32-bit unsigned).
 */
function rightRotate(value: number, amount: number): number {
    return (value >>> amount) | (value << (32 - amount));
}

/**
 * SHA-256 Round Constants K (FIPS PUB 180-4).
 */
const K: readonly number[] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/**
 * Pure JavaScript SHA-256 hash implementation.
 * Produces identical 64-character lowercase hex digest as Node.js crypto.createHash('sha256').
 * Runs synchronously without external dependencies in Node, Browser (WebView2), Office.js, and ExtendScript.
 *
 * @param str Input string
 * @returns 64-character lowercase hexadecimal SHA-256 hash
 */
export function sha256(str: string): string {
    let h0 = 0x6a09e667;
    let h1 = 0xbb67ae85;
    let h2 = 0x3c6ef372;
    let h3 = 0xa54ff53a;
    let h4 = 0x510e527f;
    let h5 = 0x9b05688c;
    let h6 = 0x1f83d9ab;
    let h7 = 0x5be0cd19;

    const bytes = utf8Encode(str);
    const bitLen = bytes.length * 8;

    // Append 0x80 byte (bit '1')
    bytes.push(0x80);

    // Pad with zeros until length in bytes === 56 (mod 64)
    while (bytes.length % 64 !== 56) {
        bytes.push(0);
    }

    // 64-bit length (big-endian)
    const highBitLen = Math.floor(bitLen / 0x100000000);
    const lowBitLen = (bitLen & 0xffffffff) >>> 0;

    bytes.push((highBitLen >>> 24) & 0xff);
    bytes.push((highBitLen >>> 16) & 0xff);
    bytes.push((highBitLen >>> 8) & 0xff);
    bytes.push(highBitLen & 0xff);

    bytes.push((lowBitLen >>> 24) & 0xff);
    bytes.push((lowBitLen >>> 16) & 0xff);
    bytes.push((lowBitLen >>> 8) & 0xff);
    bytes.push(lowBitLen & 0xff);

    const w = new Int32Array(64);

    for (let chunk = 0; chunk < bytes.length; chunk += 64) {
        for (let i = 0; i < 16; i++) {
            const offset = chunk + (i * 4);
            w[i] = ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) | 0;
        }
        for (let i = 16; i < 64; i++) {
            const s0 = (rightRotate(w[i - 15], 7) ^ rightRotate(w[i - 15], 18) ^ (w[i - 15] >>> 3)) | 0;
            const s1 = (rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ (w[i - 2] >>> 10)) | 0;
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
        }

        let a = h0;
        let b = h1;
        let c = h2;
        let d = h3;
        let e = h4;
        let f = h5;
        let g = h6;
        let h = h7;

        for (let i = 0; i < 64; i++) {
            const S1 = (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) | 0;
            const ch = ((e & f) ^ ((~e) & g)) | 0;
            const temp1 = (h + S1 + ch + K[i] + w[i]) | 0;
            const S0 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) | 0;
            const maj = ((a & b) ^ (a & c) ^ (b & c)) | 0;
            const temp2 = (S0 + maj) | 0;

            h = g;
            g = f;
            f = e;
            e = (d + temp1) | 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) | 0;
        }

        h0 = (h0 + a) | 0;
        h1 = (h1 + b) | 0;
        h2 = (h2 + c) | 0;
        h3 = (h3 + d) | 0;
        h4 = (h4 + e) | 0;
        h5 = (h5 + f) | 0;
        h6 = (h6 + g) | 0;
        h7 = (h7 + h) | 0;
    }

    function toHex(n: number): string {
        const hex = (n >>> 0).toString(16);
        return hex.padStart(8, '0');
    }

    return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4) + toHex(h5) + toHex(h6) + toHex(h7);
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
    return sha256(input).toLowerCase();
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
