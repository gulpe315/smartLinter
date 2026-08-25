#targetengine "smartlinter_persistent_engine"

/**
 * SmartLinter InDesign Text Observer & Hash Extractor
 * 
 * Observes the active InDesign selection (TextFrame / Story / Paragraph),
 * normalizes text (handling CR/LF, line separators, NBSP, trailing whitespace),
 * computes deterministic SHA-256 hashes matching shared/engine/hash_util.ts,
 * and produces ParagraphPayload telemetry.
 */

(function(global) {
    'use strict';

    /**
     * Pure JavaScript UTF-8 Byte Encoder (ExtendScript compatible)
     * @param {string} str
     * @returns {number[]} array of byte values (0-255)
     */
    function utf8Encode(str) {
        if (!str || typeof str !== 'string') {
            return [];
        }
        var bytes = [];
        for (var i = 0; i < str.length; i++) {
            var code = str.charCodeAt(i);
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
                code = 0x10000 + (((code & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
                bytes.push(0xf0 | (code >> 18));
                bytes.push(0x80 | ((code >> 12) & 0x3f));
                bytes.push(0x80 | ((code >> 6) & 0x3f));
                bytes.push(0x80 | (code & 0x3f));
            }
        }
        return bytes;
    }

    /**
     * Bitwise right rotate helper (32-bit unsigned)
     */
    function rightRotate(value, amount) {
        return (value >>> amount) | (value << (32 - amount));
    }

    /**
     * Pure JavaScript SHA-256 implementation
     * Produces identical 64-character lowercase hex digest as Node.js crypto.createHash('sha256').
     * @param {string} str
     * @returns {string} 64-character lowercase hex SHA-256 hash
     */
    function sha256(str) {
        var k = [
            0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
            0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
            0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
            0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
            0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
            0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
            0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
            0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
        ];

        var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a,
            h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

        var bytes = utf8Encode(str);
        var bitLen = bytes.length * 8;

        // Append 0x80 byte (bit '1')
        bytes.push(0x80);

        // Pad with zeros until length in bytes = 56 (mod 64)
        while ((bytes.length % 64) !== 56) {
            bytes.push(0);
        }

        // 64-bit length (big-endian)
        var highBitLen = Math.floor(bitLen / 0x100000000);
        var lowBitLen = bitLen >>> 0;

        bytes.push((highBitLen >>> 24) & 0xff);
        bytes.push((highBitLen >>> 16) & 0xff);
        bytes.push((highBitLen >>> 8) & 0xff);
        bytes.push(highBitLen & 0xff);

        bytes.push((lowBitLen >>> 24) & 0xff);
        bytes.push((lowBitLen >>> 16) & 0xff);
        bytes.push((lowBitLen >>> 8) & 0xff);
        bytes.push(lowBitLen & 0xff);

        var w = new Array(64);
        for (var chunk = 0; chunk < bytes.length; chunk += 64) {
            for (var i = 0; i < 16; i++) {
                var offset = chunk + (i * 4);
                w[i] = ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) | 0;
            }
            for (var i = 16; i < 64; i++) {
                var s0 = (rightRotate(w[i - 15], 7) ^ rightRotate(w[i - 15], 18) ^ (w[i - 15] >>> 3)) | 0;
                var s1 = (rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ (w[i - 2] >>> 10)) | 0;
                w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
            }

            var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

            for (var i = 0; i < 64; i++) {
                var S1 = (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) | 0;
                var ch = ((e & f) ^ ((~e) & g)) | 0;
                var temp1 = (h + S1 + ch + k[i] + w[i]) | 0;
                var S0 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) | 0;
                var maj = ((a & b) ^ (a & c) ^ (b & c)) | 0;
                var temp2 = (S0 + maj) | 0;

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

        function toHex(n) {
            var hex = (n >>> 0).toString(16);
            while (hex.length < 8) {
                hex = '0' + hex;
            }
            return hex;
        }

        return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4) + toHex(h5) + toHex(h6) + toHex(h7);
    }

    /**
     * Normalizes paragraph text to produce deterministic cross-platform hash representations.
     * Matches `normalizeParagraph` in shared/engine/hash_util.ts.
     * @param {string} text
     * @returns {string}
     */
    function normalizeParagraph(text) {
        if (typeof text !== 'string') {
            return '';
        }

        var result = text;

        // 1. Unicode NFC normalization (if String.prototype.normalize exists)
        if (typeof result.normalize === 'function') {
            result = result.normalize('NFC');
        }

        // 2. Line ending normalization (\r\n -> \n, \r -> \n, \u2028 -> \n)
        result = result.replace(/\r\n/g, '\n').replace(/[\r\u2028]/g, '\n');

        // 3. Special whitespace normalization (non-breaking spaces \u00A0 and \u202F)
        result = result.replace(/[\u00A0\u202F]/g, ' ');

        // 4. Line-level trailing whitespace trimming
        var lines = result.split('\n');
        for (var i = 0; i < lines.length; i++) {
            lines[i] = lines[i].replace(/[ \t]+$/g, '');
        }
        result = lines.join('\n');

        // 5. Paragraph trailing whitespace and newline trimming
        result = result.replace(/[\n\s]+$/g, '');

        return result;
    }

    /**
     * Computes SHA-256 hash for paragraph text with normalization.
     * @param {string} text
     * @param {boolean} [normalize] default true
     * @returns {string}
     */
    function computeParagraphHash(text, normalize) {
        var shouldNormalize = normalize !== false;
        var input = shouldNormalize ? normalizeParagraph(text) : text;
        return sha256(input).toLowerCase();
    }

    /**
     * SmartLinterTextObserver
     * @param {Object} [config]
     */
    function SmartLinterTextObserver(config) {
        config = config || {};
        this.targetLanguage = config.targetLanguage || null;
        this.lastSentParagraphId = null;
        this.lastSentHash = null;
        this.lastSentPayload = null;
    }

    SmartLinterTextObserver.prototype.normalize = normalizeParagraph;
    SmartLinterTextObserver.prototype.computeHash = computeParagraphHash;

    /**
     * Extracts active paragraph info from InDesign application selection.
     * @param {Object} appInstance InDesign `app` object
     * @returns {Object|null} { text, paragraphId, hash, source, storyId, paragraphRef }
     */
    SmartLinterTextObserver.prototype.getActiveParagraph = function(appInstance) {
        try {
            var inApp = appInstance || (typeof app !== 'undefined' ? app : null);
            if (!inApp || !inApp.documents || inApp.documents.length === 0) {
                return null;
            }

            var doc = inApp.activeDocument;
            if (!doc) {
                return null;
            }

            var sel = inApp.selection;
            if (!sel || sel.length === 0) {
                return null;
            }

            var selectedItem = sel[0];
            var targetParagraph = null;

            // 1. Direct paragraph selection or text range with paragraphs collection
            if (selectedItem.paragraphs && selectedItem.paragraphs.length > 0) {
                targetParagraph = selectedItem.paragraphs[0];
            } else if (selectedItem.texts && selectedItem.texts.length > 0 && selectedItem.texts[0].paragraphs && selectedItem.texts[0].paragraphs.length > 0) {
                // TextFrame object containing texts
                targetParagraph = selectedItem.texts[0].paragraphs[0];
            } else if (selectedItem.parentStory && selectedItem.parentStory.paragraphs && selectedItem.parentStory.paragraphs.length > 0) {
                // Character, Word, InsertionPoint or nested item
                targetParagraph = selectedItem.parentStory.paragraphs[0];
            } else if (selectedItem.story && selectedItem.story.paragraphs && selectedItem.story.paragraphs.length > 0) {
                targetParagraph = selectedItem.story.paragraphs[0];
            }

            if (!targetParagraph) {
                return null;
            }

            var rawText = targetParagraph.contents || '';
            var docName = doc.name || 'Untitled.indd';
            var storyId = targetParagraph.parentStory ? (targetParagraph.parentStory.id || 'story-0') : 'story-0';
            var normalizedText = normalizeParagraph(rawText);
            var hash = computeParagraphHash(rawText, true);
            // A paragraph id identifies its location, not its contents.  `Story.id` is
            // unique within the document and Paragraph.index identifies the paragraph's
            // text position in that story while its own text is edited. Keeping the SHA-256 value separate
            // lets downstream stale-result handling notice text changes without turning
            // every keystroke into a new paragraph.
            var paragraphIndex = (typeof targetParagraph.index === 'number') ? targetParagraph.index : 0;
            var pId = 'indesign-para-' + storyId + '-' + paragraphIndex;

            return {
                text: rawText,
                normalizedText: normalizedText,
                paragraphId: pId,
                hash: hash,
                source: docName,
                storyId: storyId,
                paragraphRef: targetParagraph
            };
        } catch (err) {
            return null;
        }
    };

    /**
     * Observes current InDesign selection and dispatches ParagraphPayload if changed.
     * @param {Object} appInstance
     * @param {Object} [bridgeSocket] SmartLinterBridgeSocket instance
     * @returns {Object|null} ParagraphPayload if captured and dispatched, otherwise null
     */
    SmartLinterTextObserver.prototype.captureActiveParagraph = function(appInstance, bridgeSocket) {
        var extracted = this.getActiveParagraph(appInstance);
        if (!extracted || !extracted.text) {
            return null;
        }

        // Suppress duplicate transmission if identical paragraphId and hash
        if (this.lastSentParagraphId === extracted.paragraphId && this.lastSentHash === extracted.hash) {
            return null;
        }

        var payload = {
            paragraphId: extracted.paragraphId,
            text: extracted.text,
            hash: extracted.hash,
            source: extracted.source,
            target: this.targetLanguage || undefined,
            timestamp: (new Date()).getTime(),
            editorType: 'InDesign'
        };

        this.lastSentParagraphId = extracted.paragraphId;
        this.lastSentHash = extracted.hash;
        this.lastSentPayload = payload;

        if (bridgeSocket && bridgeSocket.status === 'CONNECTED') {
            try {
                bridgeSocket.sendTelemetry(payload);
            } catch (e) {}
        }

        return payload;
    };

    /**
     * Resets internal cache state
     */
    SmartLinterTextObserver.prototype.reset = function() {
        this.lastSentParagraphId = null;
        this.lastSentHash = null;
        this.lastSentPayload = null;
    };

    // Register globally in ExtendScript
    if (typeof $ !== 'undefined' && $.global) {
        $.global.SmartLinterTextObserver = SmartLinterTextObserver;
        $.global.SmartLinterHashUtil = {
            normalizeParagraph: normalizeParagraph,
            computeParagraphHash: computeParagraphHash,
            sha256: sha256,
            utf8Encode: utf8Encode
        };
    } else if (typeof global !== 'undefined') {
        global.SmartLinterTextObserver = SmartLinterTextObserver;
        global.SmartLinterHashUtil = {
            normalizeParagraph: normalizeParagraph,
            computeParagraphHash: computeParagraphHash,
            sha256: sha256,
            utf8Encode: utf8Encode
        };
    }

    // CommonJS export for Node.js / unit tests
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            SmartLinterTextObserver: SmartLinterTextObserver,
            normalizeParagraph: normalizeParagraph,
            computeParagraphHash: computeParagraphHash,
            sha256: sha256,
            utf8Encode: utf8Encode
        };
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
