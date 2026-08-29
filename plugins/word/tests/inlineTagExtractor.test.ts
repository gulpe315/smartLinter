import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { extractOoxmlRuns, extractParagraphTokens } from '../src/inlineTagExtractor.ts';

(globalThis as any).DOMParser = new JSDOM().window.DOMParser;

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const paragraph = (contents: string) => `<w:p ${NS}>${contents}</w:p>`;
const run = (text: string, properties = '') => `<w:r>${properties}<w:t>${text}</w:t></w:r>`;
const properties = (inner: string) => `<w:rPr>${inner}</w:rPr>`;

function tags(result: ReturnType<typeof extractOoxmlRuns>) {
    return result.tokens.filter((token) => token.type !== 'text');
}

describe('Word OOXML inline tag extractor', () => {
    it('extracts plain text', () => {
        const result = extractOoxmlRuns(paragraph(run('Hello')), 'Hello');
        assert.deepEqual(result, { ok: true, plainText: 'Hello', tokens: [{ type: 'text', value: 'Hello' }] });
    });

    it('extracts each supported single formatting kind', () => {
        for (const [property, kind] of [['b', 'bold'], ['i', 'italic'], ['u', 'underline']] as const) {
            const result = extractOoxmlRuns(paragraph(run('Styled', properties(`<w:${property}/>`))), 'Styled');
            assert.equal(result.ok, true);
            assert.deepEqual(tags(result), [
                { type: 'open', id: '1', kind }, { type: 'close', id: '1', kind },
            ]);
        }
    });

    it('honors explicit false values, including underline none', () => {
        const result = extractOoxmlRuns(paragraph(run('Off', properties('<w:b w:val="0"/><w:i w:val="false"/><w:u w:val="none"/>'))), 'Off');
        assert.equal(result.ok, true);
        assert.deepEqual(result.tokens, [{ type: 'text', value: 'Off' }]);
    });

    it('maps tabs and line breaks to text characters', () => {
        const xml = paragraph('<w:r><w:t>A</w:t><w:tab/><w:t>B</w:t><w:br/><w:t>C</w:t></w:r>');
        const result = extractOoxmlRuns(xml, 'A\tB\nC');
        assert.equal(result.ok, true);
        assert.equal(result.plainText, 'A\tB\nC');
    });

    it('safely falls back for a hyperlink', () => {
        const xml = paragraph(`<w:hyperlink>${run('Link')}</w:hyperlink>`);
        const result = extractOoxmlRuns(xml, 'Link');
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'UNSUPPORTED_hyperlink');
    });

    it('merges adjacent runs with identical formatting', () => {
        const xml = paragraph(run('join', properties('<w:b/>')) + run('ed', properties('<w:b/>')));
        const result = extractOoxmlRuns(xml, 'joined');
        assert.equal(result.ok, true);
        assert.deepEqual(result.tokens, [
            { type: 'open', id: '1', kind: 'bold' }, { type: 'text', value: 'joined' }, { type: 'close', id: '1', kind: 'bold' },
        ]);
    });

    it('safely falls back when parsed text differs from Office text', () => {
        const result = extractOoxmlRuns(paragraph(run('OOXML')), 'Office');
        assert.deepEqual(result, { ok: false, tokens: [], plainText: 'OOXML', reason: 'TEXT_MISMATCH' });
    });

    it('uses one Office sync and one getOoxml call in the paragraph wrapper', async () => {
        const xml = paragraph(run('Wrapped', properties('<w:i/>')));
        let syncCalls = 0;
        let getOoxmlCalls = 0;
        let loadCalls = 0;
        const mockParagraph = {
            text: 'Wrapped',
            load: (property: string) => { assert.equal(property, 'text'); loadCalls++; },
            getOoxml: () => { getOoxmlCalls++; return { value: xml }; },
        };
        const runner = async (callback: (context: any) => Promise<any>) => callback({ sync: async () => { syncCalls++; } });
        const result = await extractParagraphTokens(mockParagraph, runner);
        assert.equal(result.ok, true);
        assert.equal(loadCalls, 1);
        assert.equal(getOoxmlCalls, 1);
        assert.equal(syncCalls, 1);
    });
});
