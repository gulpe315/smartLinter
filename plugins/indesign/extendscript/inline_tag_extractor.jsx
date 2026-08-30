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

    function readFace(run) {
        var font = run.appliedFont;
        if (!font || font.isValid === false || !font.fontFamily || !font.fontStyleName) return null;
        return { fontFamily: String(font.fontFamily), fontStyleName: String(font.fontStyleName) };
    }

    function sameFormat(a, b) {
        return a.bold === b.bold && a.italic === b.italic && a.underline === b.underline
            && a.fontFamily === b.fontFamily && a.fontStyleName === b.fontStyleName;
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
                var format = classifyRun(range), face = readFace(range);
                if (!face) return { ok: false, tokens: [], plainText: paragraph.contents || '', reason: 'SOURCE_FONT_FACE_UNAVAILABLE' };
                format.fontFamily = face.fontFamily; format.fontStyleName = face.fontStyleName;
                var last = mergedRuns[mergedRuns.length - 1];
                if (last && sameFormat(last.format, format)) {
                    last.text += text;
                } else {
                    mergedRuns.push({ text: text, format: format });
                }
                plainText += text;
            }
            if (plainText !== paragraph.contents) {
                return { ok: false, tokens: [], plainText: paragraph.contents, reason: 'PLAIN_TEXT_MISMATCH' };
            }

            var tokens = [];
            var nextId = 1;
            var faces = { byFormatId: {} }, defaultFace = null;
            for (var j = 0; j < mergedRuns.length; j++) {
                var run = mergedRuns[j];
                var kinds = [];
                if (run.format.bold) kinds.push('bold');
                if (run.format.italic) kinds.push('italic');
                if (run.format.underline) kinds.push('underline');
                var id = String(nextId);
                for (var k = 0; k < kinds.length; k++) tokens.push({ type: 'open', id: id, kind: kinds[k] });
                tokens.push({ type: 'text', value: run.text });
                for (var m = kinds.length - 1; m >= 0; m--) tokens.push({ type: 'close', id: id, kind: kinds[m] });
                if (kinds.length > 0) { faces.byFormatId[id] = { fontFamily: run.format.fontFamily, fontStyleName: run.format.fontStyleName }; nextId++; }
                else if (!defaultFace) defaultFace = { fontFamily: run.format.fontFamily, fontStyleName: run.format.fontStyleName };
                else if (defaultFace.fontFamily !== run.format.fontFamily || defaultFace.fontStyleName !== run.format.fontStyleName) return { ok: false, tokens: [], plainText: plainText, reason: 'AMBIGUOUS_DEFAULT_FONT_FACE' };
            }
            if (!defaultFace) return { ok: false, tokens: [], plainText: plainText, reason: 'DEFAULT_FONT_FACE_UNAVAILABLE' };
            faces.defaultFontFace = defaultFace;
            return { ok: true, tokens: tokens, plainText: plainText, inDesignFontFaces: faces };
        } catch (e) {
            return { ok: false, tokens: [], plainText: paragraph.contents || '', reason: 'EXTRACTION_ERROR' };
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
