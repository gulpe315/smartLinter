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

    function findCellAndTable(para) {
        if (!para || !para.parent) return { cell: null, table: null };
        var curr = para.parent;
        var cell = null;
        var table = null;
        var depth = 0;
        while (curr && depth < 16) {
            var tn = curr.typename;
            if (!cell && tn === 'Cell') {
                cell = curr;
            }
            if (tn === 'Table') {
                table = curr;
                break;
            }
            if (tn === 'Story' || tn === 'Document' || tn === 'Application') break;
            curr = curr.parent;
            depth++;
        }
        return { cell: cell, table: table };
    }

    function findFootnote(para) {
        if (!para || !para.parent) return null;
        var curr = para.parent;
        var depth = 0;
        while (curr && depth < 16) {
            if (curr.typename === 'Footnote') return curr;
            if (curr.typename === 'Story' || curr.typename === 'Document' || curr.typename === 'Application') break;
            curr = curr.parent;
            depth++;
        }
        return null;
    }

    function getFootnoteIndexInStory(story, footnote) {
        if (!story || !story.footnotes || !footnote) return 0;
        for (var i = 0; i < story.footnotes.length; i++) {
            if (story.footnotes[i] === footnote || (footnote.id && story.footnotes[i].id === footnote.id)) return i;
        }
        return 0;
    }

    function getParagraphIndexInFootnote(footnote, para) {
        if (!footnote || !footnote.paragraphs) return 0;
        for (var i = 0; i < footnote.paragraphs.length; i++) if (footnote.paragraphs[i] === para) return i;
        return 0;
    }

    function getTableIndexInStory(story, table) {
        if (!story || !story.tables || !table) return 0;
        for (var t = 0; t < story.tables.length; t++) {
            if (story.tables[t] === table || (table.id && story.tables[t].id === table.id)) {
                return t;
            }
        }
        if (typeof table.index === 'number') return table.index;
        return 0;
    }

    function getParagraphIndexInCell(cell, para) {
        if (!cell || !cell.paragraphs) return 0;
        for (var cp = 0; cp < cell.paragraphs.length; cp++) {
            if (cell.paragraphs[cp] === para) return cp;
        }
        return 0;
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
                    if (kind === 'TABLE') {
                        if (!placed && !options.includeUnplacedStories) {
                            summary.unplacedParagraphsPendingChoice++;
                            continue;
                        }
                        var ct = findCellAndTable(para);
                        var cell = ct.cell;
                        var table = ct.table;
                        var tableIndex = getTableIndexInStory(story, table);
                        var cellIndex = (cell && typeof cell.index === 'number') ? cell.index : 0;
                        var cellName = (cell && cell.name) ? String(cell.name) : '';
                        var pInCell = getParagraphIndexInCell(cell, para);
                        var rowSpan = (cell && typeof cell.rowSpan === 'number' && cell.rowSpan >= 1) ? cell.rowSpan : 1;
                        var columnSpan = (cell && typeof cell.columnSpan === 'number' && cell.columnSpan >= 1) ? cell.columnSpan : 1;

                        var text = String(para.contents || '');
                        var extraction = SmartLinterInlineTagExtractor.extractParagraphTokens(para);
                        var taggedSource = extraction.ok
                            ? { sourceTokens: extraction.tokens, tagStatus: 'valid', inDesignFontFaces: extraction.inDesignFontFaces }
                            : { sourceTokens: [{ type: 'text', value: text }], tagStatus: 'fallback-plain', fallbackReason: extraction.reason };

                        response.paragraphs.push({
                            paragraphId: 'indesign-tablepara-' + storyId + '-' + tableIndex + '-' + cellIndex + '-' + pInCell,
                            text: text,
                            hash: hashUtil.computeParagraphHash(text, true),
                            documentOrderIndex: order++,
                            storyId: storyId,
                            isOverset: overset,
                            coverageState: placed ? 'included' : 'requires-user-choice',
                            taggedSource: taggedSource,
                            containerKind: 'TABLE',
                            tableLocator: {
                                tableIndex: tableIndex,
                                cellIndex: cellIndex,
                                cellName: cellName,
                                paragraphIndexInCell: pInCell,
                                rowSpan: rowSpan,
                                columnSpan: columnSpan
                            }
                        });
                        summary.scannedParagraphs++;
                        if (overset) summary.oversetParagraphsIncluded++;
                        continue;
                    }
                    if (kind === 'FOOTNOTE') {
                        // v1 deliberately excludes footnotes nested in tables.
                        if (findCellAndTable(para).table) { summary.skippedUnsupportedCount++; continue; }
                        if (!placed && !options.includeUnplacedStories) {
                            summary.unplacedParagraphsPendingChoice++;
                            continue;
                        }
                        var footnote = findFootnote(para);
                        if (!footnote || footnote.isValid === false || typeof footnote.id !== 'number' || footnote.id <= 0) {
                            summary.skippedUnsupportedCount++;
                            continue;
                        }
                        var footnoteText = String(para.contents || '');
                        var footnoteExtraction = SmartLinterInlineTagExtractor.extractParagraphTokens(para);
                        var pInFootnote = getParagraphIndexInFootnote(footnote, para);
                        response.paragraphs.push({
                            paragraphId: 'indesign-footnotepara-' + storyId + '-' + footnote.id + '-' + pInFootnote,
                            text: footnoteText,
                            hash: hashUtil.computeParagraphHash(footnoteText, true),
                            documentOrderIndex: order++,
                            storyId: storyId,
                            isOverset: overset,
                            coverageState: placed ? 'included' : 'requires-user-choice',
                            taggedSource: footnoteExtraction.ok
                                ? { sourceTokens: footnoteExtraction.tokens, tagStatus: 'valid', inDesignFontFaces: footnoteExtraction.inDesignFontFaces, containerKind: 'FOOTNOTE', footnoteLocator: { host: 'InDesign', storyId: storyId, footnoteId: footnote.id, paragraphIndexInFootnote: pInFootnote } }
                                : { sourceTokens: [{ type: 'text', value: footnoteText }], tagStatus: 'fallback-plain', fallbackReason: footnoteExtraction.reason, containerKind: 'FOOTNOTE', footnoteLocator: { host: 'InDesign', storyId: storyId, footnoteId: footnote.id, paragraphIndexInFootnote: pInFootnote } },
                            containerKind: 'FOOTNOTE',
                            footnoteLocator: { host: 'InDesign', storyId: storyId, footnoteId: footnote.id, paragraphIndexInFootnote: pInFootnote }
                        });
                        // Retained as a locator fallback reference; never used as the primary key.
                        getFootnoteIndexInStory(story, footnote);
                        summary.scannedParagraphs++;
                        if (overset) summary.oversetParagraphsIncluded++;
                        continue;
                    }
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
