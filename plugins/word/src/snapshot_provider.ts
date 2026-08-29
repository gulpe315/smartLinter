import { computeParagraphHash } from '../../../shared/engine/hash_util.ts';
import type {
    LiveSnapshotItem,
    LiveSnapshotRequest,
    LiveSnapshotResponse,
} from '../../../shared/protocol/types.ts';

interface MatchedCandidate {
    text: string;
    hash: string;
}

/**
 * Resolves requested paragraph IDs using one non-invasive full-document Word.run scan.
 * Every candidate is collected before deciding FOUND versus AMBIGUOUS.
 */
export async function queryLiveParagraphSnapshots(
    request: LiveSnapshotRequest,
    wordRunner: (callback: (context: any) => Promise<any>) => Promise<any>,
): Promise<LiveSnapshotResponse> {
    const targetIds = new Set(request.paragraphIds);
    const candidateMap = new Map<string, MatchedCandidate[]>();
    for (const id of request.paragraphIds) candidateMap.set(id, []);

    try {
        await wordRunner(async (context: any) => {
            const paragraphs = context.document.body.paragraphs;
            paragraphs.load('text');
            await context.sync();

            for (const [documentOrderIndex, paragraph] of (paragraphs.items || []).entries()) {
                const text = paragraph.text || '';
                const hash = computeParagraphHash(text);
                const legacyId = `word-para-${hash.slice(0, 12)}`;
                const scannedId = `word-para-body-${documentOrderIndex}-${hash.slice(0, 12)}`;
                if (targetIds.has(legacyId)) candidateMap.get(legacyId)!.push({ text, hash });
                if (targetIds.has(scannedId)) candidateMap.get(scannedId)!.push({ text, hash });
            }
        });

        const results: LiveSnapshotItem[] = request.paragraphIds.map((paragraphId) => {
            const candidates = candidateMap.get(paragraphId) || [];
            if (candidates.length === 0) {
                return {
                    paragraphId,
                    status: 'NOT_FOUND',
                    message: 'Paragraph not found in active Word document',
                };
            }
            if (candidates.length > 1) {
                const exactMatches = request.baseHash
                    ? candidates.filter((candidate) => candidate.hash === request.baseHash)
                    : [];
                if (exactMatches.length === 1) {
                    return {
                        paragraphId,
                        status: 'FOUND',
                        currentText: exactMatches[0].text,
                        currentHash: exactMatches[0].hash,
                    };
                }
                return {
                    paragraphId,
                    status: 'AMBIGUOUS',
                    message: `Multiple (${candidates.length}) paragraphs matched paragraphId '${paragraphId}'`,
                };
            }
            const match = candidates[0];
            if (request.baseHash && match.hash !== request.baseHash) {
                return {
                    paragraphId,
                    status: 'NOT_FOUND',
                    message: 'Paragraph hash mismatch with requested baseHash',
                };
            }
            return {
                paragraphId,
                status: 'FOUND',
                currentText: match.text,
                currentHash: match.hash,
            };
        });
        return { requestId: request.requestId, results };
    } catch (error: any) {
        return {
            requestId: request.requestId,
            results: request.paragraphIds.map((paragraphId) => ({
                paragraphId,
                status: 'ERROR',
                message: `Office.js snapshot error: ${error?.message || String(error)}`,
            })),
        };
    }
}
