import { computeParagraphHash } from '../../../shared/engine/hash_util.ts';
import type { LocateRequest, LocateResponse } from '../../../shared/protocol/types.ts';

interface Candidate { paragraph: any; hash: string; }

/** Finds a content-derived paragraph ID and selects it only when it is unique. */
export async function locateWordParagraph(request: LocateRequest, wordRunner: (callback: (context: any) => Promise<any>) => Promise<any>): Promise<LocateResponse> {
    try {
        let candidates: Candidate[] = [];
        await wordRunner(async (context: any) => {
            const paragraphs = context.document.body.paragraphs;
            paragraphs.load('text');
            await context.sync();
            candidates = (paragraphs.items || [])
                .map((paragraph: any) => ({ paragraph, hash: computeParagraphHash(paragraph.text || '') }))
                .filter((candidate: Candidate) => `word-para-${candidate.hash.slice(0, 12)}` === request.paragraphId);
            if (request.baseHash) candidates = candidates.filter((candidate) => candidate.hash === request.baseHash);
            if (candidates.length !== 1) return;
            try {
                const range = candidates[0].paragraph.getRange ? candidates[0].paragraph.getRange('Whole') : candidates[0].paragraph;
                if (!range || typeof range.select !== 'function') throw new Error('Word Range.select is unavailable');
                range.select('Select');
                await context.sync();
            } catch (error: any) { throw new SelectionError(error?.message || String(error)); }
        });
        if (candidates.length === 0) return { requestId: request.requestId, status: 'NOT_FOUND', message: 'Paragraph not found in active Word document' };
        if (candidates.length > 1) return { requestId: request.requestId, status: 'AMBIGUOUS', message: `Multiple (${candidates.length}) paragraphs matched paragraphId '${request.paragraphId}'` };
        return { requestId: request.requestId, status: 'FOUND' };
    } catch (error: any) {
        if (error instanceof SelectionError) return { requestId: request.requestId, status: 'SELECTION_FAILED', message: error.message };
        return { requestId: request.requestId, status: 'ERROR', message: `Office.js locate error: ${error?.message || String(error)}` };
    }
}
class SelectionError extends Error {}
