import { computeParagraphHash } from '../../../shared/engine/hash_util.ts';
import type { EnumerateDocumentRequest, EnumerateDocumentResponse } from '../../../shared/protocol/types.ts';
import { extractParagraphTokens } from './inlineTagExtractor.ts';

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
                const extraction = await extractParagraphTokens(paragraph, wordRunner);
                paragraphs.push({
                    paragraphId: `word-para-body-${documentOrderIndex}-${hash.slice(0, 12)}`,
                    text,
                    hash,
                    documentOrderIndex,
                    taggedSource: extraction.ok
                        ? { sourceTokens: extraction.tokens, tagStatus: 'valid' }
                        : { sourceTokens: [{ type: 'text', value: text }], tagStatus: 'fallback-plain', fallbackReason: extraction.reason },
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
