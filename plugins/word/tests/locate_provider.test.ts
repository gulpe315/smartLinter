import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeParagraphHash } from '../../../shared/engine/hash_util.ts';
import { locateWordParagraph } from '../src/locate_provider.ts';

function requestFor(text: string, baseHash?: string) {
    const hash = computeParagraphHash(text);
    return { requestId: 'locate-1', paragraphId: `word-para-${hash.slice(0, 12)}`, baseHash };
}
function runnerFor(texts: string[], select?: () => void) {
    const selectRange = select || (() => {});
    return async (callback: (context: any) => Promise<any>) => callback({
        document: { body: { paragraphs: { load: () => {}, items: texts.map((text) => ({ text, getRange: () => ({ select: selectRange }) })) } } }, sync: async () => {},
    });
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
});
