/**
 * Unit Tests for Special Elements & Rich Paragraph Core Model
 *
 * Verifies:
 * 1. Markdown and run-based special elements paragraph construction.
 * 2. 0 offset drift errors and 100% preservation of footnotes and hyperlinks in reverse order.
 * 3. Tag extraction and integrity verification methods.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    SpecialElementsParagraph,
    type InlineElement,
} from '../special_elements.ts';
import { extractDiffHunks } from '../diff_engine.ts';
import { type TextHunk } from '../../protocol/types.ts';

describe('SmartLinter Special Elements & Rich Paragraph Engine', () => {
    describe('Paragraph Construction & Serialization', () => {
        const rawElements: InlineElement[] = [
            { type: 'text', text: 'According to ', format: { bold: false } },
            {
                type: 'hyperlink',
                text: 'SmartLinter specs',
                url: 'https://smartlinter.dev',
                format: { underline: true },
            },
            { type: 'text', text: ', the native format', format: { bold: false } },
            {
                type: 'footnote',
                footnoteId: 1,
                noteContent: 'Architecture section 2.A',
                format: { superscript: true },
            },
            { type: 'text', text: ' must be preserved perfectly.', format: { bold: false } },
        ];

        it('should correctly build plain text and markdown representations from runs', () => {
            const paragraph = SpecialElementsParagraph.fromRuns(rawElements);

            const plainText = paragraph.getPlainText();
            assert.equal(
                plainText,
                'According to SmartLinter specs, the native format[^1] must be preserved perfectly.'
            );

            const markdown = paragraph.toMarkdown();
            assert.equal(
                markdown,
                'According to [SmartLinter specs](https://smartlinter.dev), the native format[^1] must be preserved perfectly.'
            );
        });

        it('should parse markdown string into structured elements accurately in fromMarkdown()', () => {
            const md =
                'According to [SmartLinter specs](https://smartlinter.dev), the native format[^1] must be preserved perfectly.';
            const paragraph = SpecialElementsParagraph.fromMarkdown(md);

            assert.equal(paragraph.elements.length, 5);
            assert.equal(paragraph.elements[0].type, 'text');
            assert.equal(paragraph.elements[0].text, 'According to ');

            assert.equal(paragraph.elements[1].type, 'hyperlink');
            if (paragraph.elements[1].type === 'hyperlink') {
                assert.equal(paragraph.elements[1].text, 'SmartLinter specs');
                assert.equal(paragraph.elements[1].url, 'https://smartlinter.dev');
            }

            assert.equal(paragraph.elements[3].type, 'footnote');
            if (paragraph.elements[3].type === 'footnote') {
                assert.equal(paragraph.elements[3].footnoteId, 1);
            }

            assert.equal(paragraph.toMarkdown(), md);
            assert.equal(
                paragraph.getPlainText(),
                'According to SmartLinter specs, the native format[^1] must be preserved perfectly.'
            );
        });

        it('should compute exact element start and end character offsets', () => {
            const paragraph = SpecialElementsParagraph.fromRuns(rawElements);
            const offsets = paragraph.getElementOffsets();

            assert.equal(offsets.length, 5);

            // Element 0: "According to " [0..13]
            assert.equal(offsets[0].startOffset, 0);
            assert.equal(offsets[0].endOffset, 13);
            assert.equal(offsets[0].displayStr, 'According to ');

            // Element 1: "SmartLinter specs" [13..30]
            assert.equal(offsets[1].startOffset, 13);
            assert.equal(offsets[1].endOffset, 30);
            assert.equal(offsets[1].displayStr, 'SmartLinter specs');

            // Element 2: ", the native format" [30..49]
            assert.equal(offsets[2].startOffset, 30);
            assert.equal(offsets[2].endOffset, 49);

            // Element 3: "[^1]" [49..53]
            assert.equal(offsets[3].startOffset, 49);
            assert.equal(offsets[3].endOffset, 53);
            assert.equal(offsets[3].displayStr, '[^1]');

            // Element 4: " must be preserved perfectly." [53..82]
            assert.equal(offsets[4].startOffset, 53);
            assert.equal(offsets[4].endOffset, 82);
        });
    });

    describe('Multi-Hunk Replacement & 100% Special Tag Preservation', () => {
        const rawElements: InlineElement[] = [
            { type: 'text', text: 'According to ', format: { bold: false } },
            {
                type: 'hyperlink',
                text: 'SmartLinter specs',
                url: 'https://smartlinter.dev',
                format: { underline: true },
            },
            { type: 'text', text: ', the native format', format: { bold: false } },
            {
                type: 'footnote',
                footnoteId: 1,
                noteContent: 'Architecture section 2.A',
                format: { superscript: true },
            },
            { type: 'text', text: ' must be preserved perfectly.', format: { bold: false } },
        ];

        // Hunks:
        // 1. 'specs' [25..30] inside hyperlink -> 'specifications' (+9 chars)
        // 2. 'preserved' [62..71] after footnote -> 'maintained' (+1 char)
        const hunks: TextHunk[] = [
            { start: 25, end: 30, oldText: 'specs', newText: 'specifications' },
            { start: 62, end: 71, oldText: 'preserved', newText: 'maintained' },
        ];

        it('should preserve all footnote tags and hyperlinks with 0 drift errors in reverse order', () => {
            const originalDoc = SpecialElementsParagraph.fromRuns(rawElements);
            const doc = originalDoc.clone();

            const result = doc.applyHunks(hunks, true);

            assert.equal(result.isSuccess, true);
            assert.equal(result.driftErrors, 0);
            assert.equal(result.appliedHunks, 2);

            const expectedPlainText =
                'According to SmartLinter specifications, the native format[^1] must be maintained perfectly.';
            assert.equal(result.finalPlainText, expectedPlainText);

            const expectedMarkdown =
                'According to [SmartLinter specifications](https://smartlinter.dev), the native format[^1] must be maintained perfectly.';
            assert.equal(result.finalMarkdown, expectedMarkdown);

            // Verify 100% preservation of special elements
            assert.equal(doc.verifySpecialElementsPreserved(originalDoc), true);

            const tags = doc.extractSpecialTags();
            assert.equal(tags.footnotes.length, 1);
            assert.equal(tags.footnotes[0].footnoteId, 1);
            assert.equal(tags.footnotes[0].noteContent, 'Architecture section 2.A');

            assert.equal(tags.hyperlinks.length, 1);
            assert.equal(tags.hyperlinks[0].url, 'https://smartlinter.dev');
            assert.equal(tags.hyperlinks[0].text, 'SmartLinter specifications');
            assert.equal(tags.hyperlinks[0].format?.underline, true);
        });

        it('should detect drift error when applied in forward order on rich paragraph', () => {
            const originalDoc = SpecialElementsParagraph.fromRuns(rawElements);
            const doc = originalDoc.clone();

            const result = doc.applyHunks(hunks, false);

            // Hunk 1 applied to hyperlink increases length by 9.
            // Hunk 2 at fixed offset 62..71 now points to wrong slice -> DRIFT_MISMATCH
            assert.equal(result.isSuccess, false);
            assert.equal(result.driftErrors > 0, true);
            assert.ok(result.logs.some((l) => l.status === 'DRIFT_MISMATCH'));
        });

        it('should seamlessly integrate extractDiffHunks with SpecialElementsParagraph', () => {
            const doc = SpecialElementsParagraph.fromMarkdown(
                'Check [documentation](https://docs.smartlinter.dev) and notes[^alpha] for guidelines[^beta].'
            );
            const originalPlain = doc.getPlainText();
            // Original: "Check documentation and notes[^alpha] for guidelines[^beta]."
            const suggestedPlain =
                'Consult [documentation](https://docs.smartlinter.dev) and references[^alpha] for rules[^beta].';

            const extractedHunks = extractDiffHunks(doc.toMarkdown(), suggestedPlain);
            assert.ok(extractedHunks.length > 0);
        });

        it('should handle complex paragraphs with multiple footnotes and hyperlinks without corruption', () => {
            const md =
                'In [Chapter 1](https://example.com/ch1), system A[^10] communicates with [Bridge Server](https://example.com/bridge)[^11] over WebSocket.';
            const originalDoc = SpecialElementsParagraph.fromMarkdown(md);
            const doc = originalDoc.clone();

            // Multi-hunk edits:
            // 1. "Chapter 1" -> "Section 1"
            // 2. "communicates" -> "interacts"
            // 3. "Bridge Server" -> "Tauri Bridge Gateway"
            // 4. "WebSocket" -> "bidirectional WebSocket streams"
            const plain = doc.getPlainText();
            const hunk1: TextHunk = { start: plain.indexOf('Chapter 1'), end: plain.indexOf('Chapter 1') + 9, oldText: 'Chapter 1', newText: 'Section 1' };
            const hunk2: TextHunk = { start: plain.indexOf('communicates'), end: plain.indexOf('communicates') + 12, oldText: 'communicates', newText: 'interacts' };
            const hunk3: TextHunk = { start: plain.indexOf('Bridge Server'), end: plain.indexOf('Bridge Server') + 13, oldText: 'Bridge Server', newText: 'Tauri Bridge Gateway' };
            const hunk4: TextHunk = { start: plain.indexOf('WebSocket'), end: plain.indexOf('WebSocket') + 9, oldText: 'WebSocket', newText: 'bidirectional WebSocket streams' };

            const res = doc.applyHunks([hunk1, hunk2, hunk3, hunk4], true);

            assert.equal(res.isSuccess, true);
            assert.equal(res.driftErrors, 0);
            assert.equal(doc.verifySpecialElementsPreserved(originalDoc), true);

            const tags = doc.extractSpecialTags();
            assert.equal(tags.footnotes.length, 2);
            assert.equal(tags.footnotes[0].footnoteId, 10);
            assert.equal(tags.footnotes[1].footnoteId, 11);

            assert.equal(tags.hyperlinks.length, 2);
            assert.equal(tags.hyperlinks[0].url, 'https://example.com/ch1');
            assert.equal(tags.hyperlinks[0].text, 'Section 1');
            assert.equal(tags.hyperlinks[1].url, 'https://example.com/bridge');
            assert.equal(tags.hyperlinks[1].text, 'Tauri Bridge Gateway');
        });
    });
});
