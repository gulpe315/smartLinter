import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { computeParagraphHash } from '../../../shared/engine/hash_util.ts';
import { enumerateAllDocumentParagraphs } from '../src/document_scanner.ts';

(globalThis as any).DOMParser = new JSDOM().window.DOMParser;
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function runnerFor(texts: string[], title = 'Document.docx') {
    return async (callback: (context: any) => Promise<any>) => callback({
        document: {
            body: { paragraphs: { items: texts.map((text) => ({ text })), load: () => {} } },
            properties: { title, load: () => {} },
        },
        sync: async () => {},
    });
}

describe('Word document scanner', () => {
    it('enumerates paragraphs in body order with document title', async () => {
        const response = await enumerateAllDocumentParagraphs({ requestId: 'scan-1' }, runnerFor(['First', 'Second', 'Third']));
        assert.equal(response.sourceDocumentName, 'Document.docx');
        assert.deepEqual(response.paragraphs.map((p) => p.documentOrderIndex), [0, 1, 2]);
        assert.deepEqual(response.paragraphs.map((p) => p.text), ['First', 'Second', 'Third']);
        assert.equal(response.paragraphs[0].hash, computeParagraphHash('First'));
    });

    it('uses the body index to keep duplicate text paragraph IDs distinct', async () => {
        const response = await enumerateAllDocumentParagraphs({ requestId: 'scan-duplicates' }, runnerFor(['Repeated', 'Repeated']));
        assert.notEqual(response.paragraphs[0].paragraphId, response.paragraphs[1].paragraphId);
    });

    it('returns an empty array for an empty document', async () => {
        const response = await enumerateAllDocumentParagraphs({ requestId: 'scan-empty' }, runnerFor([]));
        assert.deepEqual(response.paragraphs, []);
        assert.equal(response.error, undefined);
    });

    it('does not throw when Word.run fails', async () => {
        const response = await enumerateAllDocumentParagraphs({ requestId: 'scan-error' }, async () => { throw new Error('Word busy'); });
        assert.deepEqual(response, {
            requestId: 'scan-error', sourceDocumentName: '', paragraphs: [],
            error: 'Office.js document scan error: Word busy',
        });
    });

    it('attaches valid inline tokens for formatted paragraphs', async () => {
        const xml = `<w:p ${NS}><w:r><w:t>Hello </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r></w:p>`;
        const formattedParagraph = {
            text: 'Hello bold', load: () => {}, getOoxml: () => ({ value: xml }),
        };
        const runner = async (callback: (context: any) => Promise<any>) => callback({
            document: {
                body: { paragraphs: { items: [formattedParagraph], load: () => {} } },
                properties: { title: 'Formatted.docx', load: () => {} },
            }, sync: async () => {},
        });
        const response = await enumerateAllDocumentParagraphs({ requestId: 'formatted' }, runner);
        assert.deepEqual(response.paragraphs[0].taggedSource, {
            tagStatus: 'valid', sourceTokens: [
                { type: 'text', value: 'Hello ' },
                { type: 'open', id: '1', kind: 'bold' }, { type: 'text', value: 'bold' }, { type: 'close', id: '1', kind: 'bold' },
            ],
        });
    });

    it('marks unsupported OOXML such as hyperlinks as fallback plain text', async () => {
        const xml = `<w:p ${NS}><w:hyperlink><w:r><w:t>Link</w:t></w:r></w:hyperlink></w:p>`;
        const hyperlinkParagraph = { text: 'Link', load: () => {}, getOoxml: () => ({ value: xml }) };
        const runner = async (callback: (context: any) => Promise<any>) => callback({
            document: { body: { paragraphs: { items: [hyperlinkParagraph], load: () => {} } }, properties: { title: '', load: () => {} } },
            sync: async () => {},
        });
        const response = await enumerateAllDocumentParagraphs({ requestId: 'hyperlink' }, runner);
        assert.equal(response.paragraphs[0].taggedSource?.tagStatus, 'fallback-plain');
        assert.equal(response.paragraphs[0].taggedSource?.fallbackReason, 'UNSUPPORTED_hyperlink');
    });
});
