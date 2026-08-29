import { computeParagraphHash } from '../../../shared/engine/hash_util.ts';
import type { EnumerateDocumentRequest, EnumerateDocumentResponse } from '../../../shared/protocol/types.ts';

/** Enumerates all body paragraphs in a single non-invasive Word.run scan. */
export async function enumerateAllDocumentParagraphs(
    request: EnumerateDocumentRequest,
    wordRunner: (callback: (context: any) => Promise<any>) => Promise<any>,
): Promise<EnumerateDocumentResponse> {
    try {
        let sourceDocumentName = '';
        const paragraphs: EnumerateDocumentResponse['paragraphs'] = [];
        await wordRunner(async (context: any) => {
            const bodyParagraphs = context.document.body.paragraphs;
            const properties = context.document.properties;
            bodyParagraphs.load('text');
            if (properties) properties.load('title');
            await context.sync();
            sourceDocumentName = properties?.title || '';
            for (const [documentOrderIndex, paragraph] of (bodyParagraphs.items || []).entries()) {
                const text = paragraph.text || '';
                const hash = computeParagraphHash(text);
                paragraphs.push({
                    paragraphId: `word-para-body-${documentOrderIndex}-${hash.slice(0, 12)}`,
                    text,
                    hash,
                    documentOrderIndex,
                });
            }
        });
        return { requestId: request.requestId, sourceDocumentName, paragraphs };
    } catch (error: any) {
        return {
            requestId: request.requestId,
            sourceDocumentName: '',
            paragraphs: [],
            error: `Office.js document scan error: ${error?.message || String(error)}`,
        };
    }
}
