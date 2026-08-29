import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeParagraphHash } from '../../../shared/engine/hash_util.ts';
import { queryLiveParagraphSnapshots } from '../src/snapshot_provider.ts';

function requestFor(text: string, baseHash?: string) {
    const hash = computeParagraphHash(text);
    return { requestId: 'snapshot-1', paragraphIds: [`word-para-${hash.slice(0, 12)}`], baseHash };
}

function runnerFor(texts: string[]) {
    return async (callback: (context: any) => Promise<any>) => callback({
        document: { body: { paragraphs: {
            items: texts.map((text) => ({ text })),
            load: () => {},
        } } },
        sync: async () => {},
    });
}

describe('Word live snapshot provider', () => {
    it('returns FOUND for one matching paragraph', async () => {
        const response = await queryLiveParagraphSnapshots(requestFor('One paragraph'), runnerFor(['Other', 'One paragraph']));
        assert.equal(response.results[0].status, 'FOUND');
        assert.equal(response.results[0].currentText, 'One paragraph');
    });

    it('returns NOT_FOUND when no paragraph matches', async () => {
        const response = await queryLiveParagraphSnapshots(requestFor('Missing'), runnerFor(['Present']));
        assert.equal(response.results[0].status, 'NOT_FOUND');
    });

    it('fails closed as AMBIGUOUS for duplicate candidates', async () => {
        const response = await queryLiveParagraphSnapshots(requestFor('Repeated'), runnerFor(['Repeated', 'Repeated']));
        assert.equal(response.results[0].status, 'AMBIGUOUS');
    });

    it('resolves a scanned body ID to its exact duplicate-text position', async () => {
        const text = 'Repeated';
        const hash = computeParagraphHash(text);
        const response = await queryLiveParagraphSnapshots({
            requestId: 'snapshot-scanned',
            paragraphIds: [`word-para-body-1-${hash.slice(0, 12)}`, `word-para-${hash.slice(0, 12)}`],
        }, runnerFor([text, text]));
        assert.equal(response.results[0].status, 'FOUND');
        assert.equal(response.results[1].status, 'AMBIGUOUS');
    });

    it('does not resolve a scanned body ID after its index shifts', async () => {
        const text = 'Target';
        const hash = computeParagraphHash(text);
        const response = await queryLiveParagraphSnapshots({
            requestId: 'snapshot-shifted', paragraphIds: [`word-para-body-0-${hash.slice(0, 12)}`],
        }, runnerFor(['Inserted', text]));
        assert.equal(response.results[0].status, 'NOT_FOUND');
    });

    it('uses baseHash to retain exactly one full-hash candidate', async () => {
        const response = await queryLiveParagraphSnapshots(requestFor('Target', computeParagraphHash('Target')), runnerFor(['Target']));
        assert.equal(response.results[0].status, 'FOUND');
    });

    it('returns ERROR for Word.run failures', async () => {
        const response = await queryLiveParagraphSnapshots(requestFor('Any'), async () => { throw new Error('Word busy'); });
        assert.equal(response.results[0].status, 'ERROR');
    });
});
