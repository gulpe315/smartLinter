#targetengine "smartlinter_persistent_engine"

(function(global) {
    'use strict';

    function classifyRun(run) {
        var fontStyle = String(run.fontStyle || '').toLowerCase();
        return {
            bold: fontStyle.indexOf('bold') !== -1,
            italic: fontStyle.indexOf('italic') !== -1 || fontStyle.indexOf('oblique') !== -1,
            underline: run.underline === true
        };
    }

    function sameFormat(a, b) {
        return a.bold === b.bold && a.italic === b.italic && a.underline === b.underline;
    }

    /** Extracts a paragraph's text-style ranges into a linear token stream. */
    function extractParagraphTokens(paragraph) {
        try {
            var ranges = paragraph.textStyleRanges;
            var mergedRuns = [];
            var plainText = '';
            for (var i = 0; i < ranges.length; i++) {
                var range = ranges[i];
                var text = range.contents;
                if (!text) continue;
                var format = classifyRun(range);
                var last = mergedRuns[mergedRuns.length - 1];
                if (last && sameFormat(last.format, format)) {
                    last.text += text;
                } else {
                    mergedRuns.push({ text: text, format: format });
                }
                plainText += text;
            }
            if (plainText !== paragraph.contents) {
                return { ok: false, tokens: [], plainText: paragraph.contents };
            }

            var tokens = [];
            var nextId = 1;
            for (var j = 0; j < mergedRuns.length; j++) {
                var run = mergedRuns[j];
                var kinds = [];
                if (run.format.bold) kinds.push('bold');
                if (run.format.italic) kinds.push('italic');
                if (run.format.underline) kinds.push('underline');
                for (var k = 0; k < kinds.length; k++) tokens.push({ type: 'open', id: String(nextId), kind: kinds[k] });
                tokens.push({ type: 'text', value: run.text });
                for (var m = kinds.length - 1; m >= 0; m--) tokens.push({ type: 'close', id: String(nextId), kind: kinds[m] });
                if (kinds.length > 0) nextId++;
            }
            return { ok: true, tokens: tokens, plainText: plainText };
        } catch (e) {
            return { ok: false, tokens: [], plainText: paragraph.contents || '' };
        }
    }

    if (typeof $ !== 'undefined' && $.global) {
        $.global.SmartLinterInlineTagExtractor = { extractParagraphTokens: extractParagraphTokens };
    } else if (typeof global !== 'undefined') {
        global.SmartLinterInlineTagExtractor = { extractParagraphTokens: extractParagraphTokens };
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { extractParagraphTokens: extractParagraphTokens };
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
