import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeParagraphHash } from '../../../shared/engine/hash_util.ts';
import { locateWordParagraph } from '../src/locate_provider.ts';

function requestFor(text: string, baseHash?: string, startOffset?: number, endOffset?: number) {
    const hash = computeParagraphHash(text);
    return { requestId: 'locate-1', paragraphId: `word-para-${hash.slice(0, 12)}`, baseHash, startOffset, endOffset };
}
function runnerFor(texts: string[], select?: () => void, searchOverride?: (needle: string) => any[]) {
    const selectRange = select || (() => {});
    return async (callback: (context: any) => Promise<any>) => callback({
        document: { body: { paragraphs: { load: () => {}, items: texts.map((text) => ({
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
    it('fails closed for zero and duplicate candidates', async () => {
        assert.equal((await locateWordParagraph(requestFor('Missing'), runnerFor(['Other']))).status, 'NOT_FOUND');
        assert.equal((await locateWordParagraph(requestFor('Same'), runnerFor(['Same', 'Same']))).status, 'AMBIGUOUS');
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
