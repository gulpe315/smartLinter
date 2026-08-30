#targetengine "smartlinter_persistent_engine"

#include "text_observer.jsx"
#include "inline_tag_extractor.jsx"

(function(global) {
    'use strict';

    function getParagraphContainerKind(para) {
        if (!para || !para.parent) return 'BODY';
        var curr = para.parent;
        var depth = 0;
        while (curr && depth < 16) {
            var tn = curr.typename;
            if (tn === 'Cell' || tn === 'Table' || tn === 'Row' || tn === 'Column') return 'TABLE';
            if (tn === 'Footnote') return 'FOOTNOTE';
            if (tn === 'Endnote' || tn === 'EndnoteTextFrame') return 'ENDNOTE';
            if (tn === 'Note') return 'NOTE';
            if (tn === 'Story' || tn === 'Document' || tn === 'Application') break;
            curr = curr.parent;
            depth++;
        }
        return 'BODY';
    }

    function isStoryPlaced(story) {
        try { return Boolean(story.textContainers && story.textContainers.length > 0); }
        catch (e) { return false; }
    }

    function getHashUtil() {
        if (typeof SmartLinterHashUtil !== 'undefined') return SmartLinterHashUtil;
        if (typeof $ !== 'undefined' && $.global && $.global.SmartLinterHashUtil) return $.global.SmartLinterHashUtil;
        if (global && global.SmartLinterHashUtil) return global.SmartLinterHashUtil;
        return null;
    }

    function enumerateAllDocumentParagraphs(doc, options) {
        options = options || {};
        var requestId = options.requestId || 'unknown';
        var response = { requestId: requestId, sourceDocumentName: '', paragraphs: [] };
        try {
            if (!doc) {
                response.error = 'No active InDesign document';
                return response;
            }
            response.sourceDocumentName = String(doc.name || '');
            var summary = {
                totalCount: 0, scannedParagraphs: 0, oversetParagraphsIncluded: 0,
                unplacedStories: 0, unplacedParagraphsPendingChoice: 0,
                skippedTablesCount: 0, skippedFootnotesCount: 0, skippedUnsupportedCount: 0
            };
            var hashUtil = getHashUtil();
            if (!hashUtil || typeof hashUtil.computeParagraphHash !== 'function') {
                response.error = 'SmartLinterHashUtil is not initialized';
                return response;
            }
            var order = 0;
            for (var s = 0; s < doc.stories.length; s++) {
                var story = doc.stories[s];
                var storyId = String(story.id);
                var placed = isStoryPlaced(story);
                if (!placed) summary.unplacedStories++;
                var overset = Boolean(story.overflows);
                for (var p = 0; p < story.paragraphs.length; p++) {
                    var para = story.paragraphs[p];
                    var kind = getParagraphContainerKind(para);
                    if (kind === 'TABLE') { summary.skippedTablesCount++; continue; }
                    if (kind === 'FOOTNOTE') { summary.skippedFootnotesCount++; continue; }
                    if (kind === 'ENDNOTE' || kind === 'NOTE') { summary.skippedUnsupportedCount++; continue; }
                    if (!placed && !options.includeUnplacedStories) {
                        summary.unplacedParagraphsPendingChoice++;
                        continue;
                    }
                    var text = String(para.contents || '');
                    var extraction = SmartLinterInlineTagExtractor.extractParagraphTokens(para);
                    var taggedSource = extraction.ok
                        ? { sourceTokens: extraction.tokens, tagStatus: 'valid', inDesignFontFaces: extraction.inDesignFontFaces }
                        : { sourceTokens: [{ type: 'text', value: text }], tagStatus: 'fallback-plain', fallbackReason: extraction.reason };
                    response.paragraphs.push({
                        paragraphId: 'indesign-para-' + storyId + '-' + p,
                        text: text,
                        hash: hashUtil.computeParagraphHash(text, true),
                        documentOrderIndex: order++,
                        storyId: storyId,
                        isOverset: overset,
                        coverageState: placed ? 'included' : 'requires-user-choice',
                        taggedSource: taggedSource
                    });
                    summary.scannedParagraphs++;
                    if (overset) summary.oversetParagraphsIncluded++;
                }
            }
            summary.totalCount = response.paragraphs.length;
            response.summary = summary;
            return response;
        } catch (e) {
            response.error = 'InDesign document scan failed: ' + e;
            return response;
        }
    }

    if (typeof $ !== 'undefined' && $.global) {
        $.global.SmartLinterDocumentScanner = { isStoryPlaced: isStoryPlaced, getParagraphContainerKind: getParagraphContainerKind, enumerateAllDocumentParagraphs: enumerateAllDocumentParagraphs };
    } else if (typeof global !== 'undefined') {
        global.SmartLinterDocumentScanner = { isStoryPlaced: isStoryPlaced, getParagraphContainerKind: getParagraphContainerKind, enumerateAllDocumentParagraphs: enumerateAllDocumentParagraphs };
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { isStoryPlaced: isStoryPlaced, getParagraphContainerKind: getParagraphContainerKind, enumerateAllDocumentParagraphs: enumerateAllDocumentParagraphs };
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
