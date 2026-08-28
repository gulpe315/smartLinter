import { computeParagraphHash } from '../../../shared/engine/hash_util.ts';
import type { LocateRequest, LocateResponse } from '../../../shared/protocol/types.ts';

interface Candidate { paragraph: any; hash: string; }

/** Activating the host window is optional: older Word clients may not expose it. */
function activateWordWindow(context: any): void {
    try {
        if (!globalThis.Office?.context?.requirements?.isSetSupported?.('WordApiDesktop', '1.4')) return;
        const activeWindow = context.document.activeWindow;
        if (activeWindow && typeof activeWindow.activate === 'function') activeWindow.activate();
    } catch {
        // WordApiDesktop 1.4 may be unavailable; selection can still succeed.
    }
}

function occurrenceOffsets(text: string, needle: string): number[] {
    const offsets: number[] = [];
    for (let offset = text.indexOf(needle); offset !== -1; offset = text.indexOf(needle, offset + needle.length)) {
        offsets.push(offset);
    }
    return offsets;
}

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
                const paragraph = candidates[0].paragraph;
                if (request.startOffset === undefined && request.endOffset === undefined) {
                    const range = paragraph.getRange ? paragraph.getRange('Whole') : paragraph;
                    if (!range || typeof range.select !== 'function') throw new Error('Word Range.select is unavailable');
                    activateWordWindow(context);
                    range.select('Select');
                    await context.sync();
                    return;
                }

                const text = paragraph.text || '';
                const startOffset = request.startOffset;
                const endOffset = request.endOffset;
                if (startOffset === undefined || endOffset === undefined || startOffset < 0 || startOffset >= endOffset || endOffset > text.length) {
                    throw new Error('Requested span offsets are invalid for the matched paragraph');
                }
                const needle = text.substring(startOffset, endOffset);
                if (!needle) throw new Error('Requested span is empty');
                const offsets = occurrenceOffsets(text, needle);
                const ordinal = offsets.indexOf(startOffset);
                if (ordinal === -1) throw new Error('Requested span does not match paragraph text');

                if (typeof paragraph.search !== 'function') throw new Error('Word Paragraph.search is unavailable');
                const results = paragraph.search(needle, { matchCase: true, matchWholeWord: false, matchWildcards: false });
                if (!results || typeof results.load !== 'function') throw new Error('Word search results are unavailable');
                results.load('text');
                await context.sync();
                const ranges = results.items || [];
                if (ranges.length !== offsets.length || ranges.some((range: any) => range.text !== needle) || !ranges[ordinal]) {
                    throw new Error('Word search results could not verify the requested span');
                }
                if (typeof ranges[ordinal].select !== 'function') throw new Error('Word Range.select is unavailable');
                activateWordWindow(context);
                ranges[ordinal].select('Select');
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
