import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeParagraphHash } from '../../../shared/engine/hash_util.ts';
import { enumerateAllDocumentParagraphs } from '../src/document_scanner.ts';

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
    });

    it('does not throw when Word.run fails', async () => {
        const response = await enumerateAllDocumentParagraphs({ requestId: 'scan-error' }, async () => { throw new Error('Word busy'); });
        assert.deepEqual(response, { requestId: 'scan-error', sourceDocumentName: '', paragraphs: [] });
    });
});
