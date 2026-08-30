import { computeParagraphHash } from '../../../shared/engine/hash_util.ts';
import type {
    EnumerateDocumentRequest,
    EnumerateDocumentResponse,
    ScannedParagraphEntry,
    TableLocator,
    TaggedSegmentData,
} from '../../../shared/protocol/types.ts';
import { extractParagraphTokens } from './inlineTagExtractor.ts';

interface TableParagraphEntry {
    rawParagraph: any;
    tableLocator: TableLocator;
    paragraphId: string;
    text: string;
    hash: string;
    taggedSource: TaggedSegmentData;
    consumed: boolean;
}

/** Enumerates all body and table paragraphs in a single non-invasive Word.run scan. */
export async function enumerateAllDocumentParagraphs(
    request: EnumerateDocumentRequest,
    wordRunner: (callback: (context: any) => Promise<any>) => Promise<any>,
): Promise<EnumerateDocumentResponse> {
    try {
        let sourceDocumentName = '';
        const paragraphs: ScannedParagraphEntry[] = [];
        await wordRunner(async (context: any) => {
            const bodyParagraphs = context.document.body?.paragraphs;
            const tables = context.document.body?.tables;
            const properties = context.document.properties;

            bodyParagraphs?.load?.('text');
            tables?.load?.('items');
            if (properties) properties.load?.('title');

            if (tables?.items) {
                for (const table of tables.items) {
                    table.load?.('items');
                    table.rows?.load?.('items');
                    if (table.rows?.items) {
                        for (const row of table.rows.items) {
                            row.load?.('items');
                            row.cells?.load?.('items');
                            if (row.cells?.items) {
                                for (const cell of row.cells.items) {
                                    cell.load?.('items');
                                    const cellParas = cell.body?.paragraphs || cell.paragraphs;
                                    cellParas?.load?.('text');
                                }
                            }
                        }
                    }
                }
            }

            await context.sync();
            sourceDocumentName = properties?.title || '';

            // 1. Build independent table paragraphs list
            const tableParagraphs: TableParagraphEntry[] = [];
            const tableItems = tables?.items || [];
            for (let tIdx = 0; tIdx < tableItems.length; tIdx++) {
                const table = tableItems[tIdx];
                const rows = table.rows?.items || [];
                for (let rIdx = 0; rIdx < rows.length; rIdx++) {
                    const row = rows[rIdx];
                    const cells = row.cells?.items || [];
                    for (let cIdx = 0; cIdx < cells.length; cIdx++) {
                        const cell = cells[cIdx];
                        const cellParas = cell.body?.paragraphs?.items || cell.paragraphs?.items || [];
                        for (let pIdx = 0; pIdx < cellParas.length; pIdx++) {
                            const paragraph = cellParas[pIdx];
                            const text = paragraph.text || '';
                            const hash = computeParagraphHash(text);
                            const extraction = await extractParagraphTokens(paragraph, wordRunner);
                            const tableLocator: TableLocator = {
                                tableIndex: tIdx,
                                rowIndex: rIdx,
                                cellIndex: cIdx,
                                paragraphIndexInCell: pIdx,
                            };
                            const paragraphId = `word-tablepara-${tIdx}-${rIdx}-${cIdx}-${pIdx}`;
                            const taggedSource: TaggedSegmentData = extraction.ok
                                ? {
                                    sourceTokens: extraction.tokens,
                                    tagStatus: 'valid',
                                    containerKind: 'TABLE',
                                    tableLocator,
                                }
                                : {
                                    sourceTokens: [{ type: 'text', value: text }],
                                    tagStatus: 'fallback-plain',
                                    fallbackReason: extraction.reason,
                                    containerKind: 'TABLE',
                                    tableLocator,
                                };
                            tableParagraphs.push({
                                rawParagraph: paragraph,
                                tableLocator,
                                paragraphId,
                                text,
                                hash,
                                taggedSource,
                                consumed: false,
                            });
                        }
                    }
                }
            }

            // 2. Deterministic merge and dedup with body.paragraphs.items
            let order = 0;
            const bodyItems = bodyParagraphs?.items || [];
            for (const bodyPara of bodyItems) {
                // Match by paragraph object reference equality
                const matchedTableEntry = tableParagraphs.find(
                    (tp) => !tp.consumed && tp.rawParagraph === bodyPara
                );

                if (matchedTableEntry) {
                    matchedTableEntry.consumed = true;
                    paragraphs.push({
                        paragraphId: matchedTableEntry.paragraphId,
                        text: matchedTableEntry.text,
                        hash: matchedTableEntry.hash,
                        documentOrderIndex: order++,
                        taggedSource: matchedTableEntry.taggedSource,
                        containerKind: 'TABLE',
                        tableLocator: matchedTableEntry.tableLocator,
                    });
                } else {
                    const text = bodyPara.text || '';
                    const hash = computeParagraphHash(text);
                    const extraction = await extractParagraphTokens(bodyPara, wordRunner);
                    paragraphs.push({
                        paragraphId: `word-para-body-${order}-${hash.slice(0, 12)}`,
                        text,
                        hash,
                        documentOrderIndex: order++,
                        taggedSource: extraction.ok
                            ? { sourceTokens: extraction.tokens, tagStatus: 'valid' }
                            : { sourceTokens: [{ type: 'text', value: text }], tagStatus: 'fallback-plain', fallbackReason: extraction.reason },
                    });
                }
            }

            // 3. Append remaining unconsumed table paragraphs (isolated-body mode)
            for (const unconsumed of tableParagraphs) {
                if (!unconsumed.consumed) {
                    unconsumed.consumed = true;
                    paragraphs.push({
                        paragraphId: unconsumed.paragraphId,
                        text: unconsumed.text,
                        hash: unconsumed.hash,
                        documentOrderIndex: order++,
                        taggedSource: unconsumed.taggedSource,
                        containerKind: 'TABLE',
                        tableLocator: unconsumed.tableLocator,
                    });
                }
            }
        });
        return {
            requestId: request.requestId,
            sourceDocumentName,
            paragraphs,
            summary: {
                totalCount: paragraphs.length,
                scannedParagraphs: paragraphs.length,
            },
        };
    } catch (error: any) {
        return {
            requestId: request.requestId,
            sourceDocumentName: '',
            paragraphs: [],
            error: `Office.js document scan error: ${error?.message || String(error)}`,
        };
    }
}
