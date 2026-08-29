import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeParagraphHash } from '../../../shared/engine/hash_util.ts';
import { locateWordParagraph } from '../src/locate_provider.ts';

function requestFor(text: string, baseHash?: string, startOffset?: number, endOffset?: number) {
    const hash = computeParagraphHash(text);
    return { requestId: 'locate-1', paragraphId: `word-para-${hash.slice(0, 12)}`, baseHash, startOffset, endOffset };
}
function runnerFor(texts: string[], select?: () => void, searchOverride?: (needle: string) => any[], activeWindow?: any) {
    const selectRange = select || (() => {});
    return async (callback: (context: any) => Promise<any>) => callback({
        document: { activeWindow, body: { paragraphs: { load: () => {}, items: texts.map((text) => ({
            text,
            getRange: () => ({ select: selectRange }),
            search: (needle: string) => ({
                load: () => {},
                items: searchOverride ? searchOverride(needle) : occurrenceRanges(text, needle, selectRange),
            }),
        })) } } }, sync: async () => {},
    });
}
function occurrenceRanges(text: string, needle: string, select: () => void) {
    const ranges: any[] = [];
    for (let offset = text.indexOf(needle); offset !== -1; offset = text.indexOf(needle, offset + needle.length)) {
        ranges.push({ text: needle, select });
    }
    return ranges;
}
describe('Word locate provider', () => {
    it('selects the sole matching paragraph', async () => {
        let selected = 0;
        const response = await locateWordParagraph(requestFor('Target'), runnerFor(['Other', 'Target'], () => { selected++; }));
        assert.equal(response.status, 'FOUND'); assert.equal(selected, 1);
    });
    it('activates the Word window before selecting', async () => {
        let activated = 0;
        const originalOffice = (globalThis as any).Office;
        try {
            (globalThis as any).Office = { context: { requirements: { isSetSupported: () => true } } };
            const response = await locateWordParagraph(
                requestFor('Target'),
                runnerFor(['Target'], undefined, undefined, { activate: () => { activated++; } }),
            );
            assert.equal(response.status, 'FOUND'); assert.equal(activated, 1);
        } finally {
            (globalThis as any).Office = originalOffice;
        }
    });
    it('does not activate when WordApiDesktop 1.4 is unsupported', async () => {
        let activated = 0;
        const originalOffice = (globalThis as any).Office;
        try {
            (globalThis as any).Office = { context: { requirements: { isSetSupported: () => false } } };
            const response = await locateWordParagraph(
                requestFor('Target'),
                runnerFor(['Target'], undefined, undefined, { activate: () => { activated++; } }),
            );
            assert.equal(response.status, 'FOUND'); assert.equal(activated, 0);
        } finally {
            (globalThis as any).Office = originalOffice;
        }
    });
    it('continues safely when the Office global is unavailable', async () => {
        let activated = 0;
        const originalOffice = (globalThis as any).Office;
        try {
            delete (globalThis as any).Office;
            const response = await locateWordParagraph(
                requestFor('Target'),
                runnerFor(['Target'], undefined, undefined, { activate: () => { activated++; } }),
            );
            assert.equal(response.status, 'FOUND'); assert.equal(activated, 0);
        } finally {
            (globalThis as any).Office = originalOffice;
        }
    });
    it('continues locating when window activation is unavailable or fails', async () => {
        for (const activeWindow of [undefined, {}, { activate: () => { throw new Error('unsupported'); } }]) {
            assert.equal((await locateWordParagraph(requestFor('Target'), runnerFor(['Target'], undefined, undefined, activeWindow))).status, 'FOUND');
        }
    });
    it('fails closed for zero and duplicate candidates', async () => {
        assert.equal((await locateWordParagraph(requestFor('Missing'), runnerFor(['Other']))).status, 'NOT_FOUND');
        assert.equal((await locateWordParagraph(requestFor('Same'), runnerFor(['Same', 'Same']))).status, 'AMBIGUOUS');
    });
    it('locates the exact duplicate-text paragraph requested by a scanned body ID', async () => {
        let selected = 0;
        const text = 'Same';
        const hash = computeParagraphHash(text);
        const response = await locateWordParagraph({
            requestId: 'locate-scanned', paragraphId: `word-para-body-1-${hash.slice(0, 12)}`,
        }, runnerFor([text, text], () => { selected++; }));
        assert.equal(response.status, 'FOUND'); assert.equal(selected, 1);
    });
    it('uses baseHash and reports selection failures', async () => {
        assert.equal((await locateWordParagraph(requestFor('Target', computeParagraphHash('Target')), runnerFor(['Target']))).status, 'FOUND');
        assert.equal((await locateWordParagraph(requestFor('Target'), runnerFor(['Target'], () => { throw new Error('unsupported'); }))).status, 'SELECTION_FAILED');
    });
    it('selects a single verified span when offsets are supplied', async () => {
        let selected = 0;
        const text = '앞 대상 뒤';
        const response = await locateWordParagraph(requestFor(text, undefined, 2, 4), runnerFor([text], () => { selected++; }));
        assert.equal(response.status, 'FOUND'); assert.equal(selected, 1);
    });
    it('selects the ordinal matching duplicate span', async () => {
        const selected: number[] = [];
        const text = '책과 책';
        const response = await locateWordParagraph(requestFor(text, undefined, 3, 4), runnerFor([text], undefined, (needle) => [
            { text: needle, select: () => selected.push(0) },
            { text: needle, select: () => selected.push(1) },
        ]));
        assert.equal(response.status, 'FOUND'); assert.deepEqual(selected, [1]);
    });
    it('fails closed when Word search cannot verify the requested occurrence', async () => {
        const text = '책과 책';
        const response = await locateWordParagraph(requestFor(text, undefined, 3, 4), runnerFor([text], undefined, (needle) => [{ text: needle, select: () => {} }]));
        assert.equal(response.status, 'SELECTION_FAILED');
    });
    it('fails closed for out-of-range offsets', async () => {
        assert.equal((await locateWordParagraph(requestFor('Target', undefined, 0, 99), runnerFor(['Target']))).status, 'SELECTION_FAILED');
    });
});
