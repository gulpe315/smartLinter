import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
    MockWordEnvironment,
    WordMockWithTableInBody,
    WordMockIsolatedBody,
} from '../__tests__/mock_office_word.ts';
import { computeParagraphHash } from '../../../shared/engine/hash_util.ts';
import type { DocumentGenerationParagraphPlan } from '../../../shared/protocol/types.ts';
import { enumerateAllDocumentParagraphs } from '../src/document_scanner.ts';
import { generateTranslatedWordDocument } from '../src/document_generator.ts';

(globalThis as any).DOMParser = new JSDOM().window.DOMParser;

describe('Word Table Translation Test Suite (T6d-2)', () => {
    // 1. Basic 2x2 Table translation
    it('Scenario 1: scans a 2x2 table with containerKind TABLE and tableLocator, and generates translated document', async () => {
        const env = new MockWordEnvironment('', 'Table2x2.docx', {
            bodyMode: 'isolated-body',
            structure: [
                {
                    type: 'table',
                    rows: [
                        ['Cell A1', 'Cell B1'],
                        ['Cell A2', 'Cell B2'],
                    ],
                },
            ],
        });

        const scanResult = await enumerateAllDocumentParagraphs(
            { requestId: 'scan-2x2' },
            env.createWordRunner()
        );

        assert.equal(scanResult.paragraphs.length, 4);
        for (let i = 0; i < 4; i++) {
            const p = scanResult.paragraphs[i];
            assert.equal(p.containerKind, 'TABLE');
            assert.ok(p.tableLocator);
            assert.equal(p.tableLocator.tableIndex, 0);
            assert.equal(p.tableLocator.paragraphIndexInCell, 0);
            assert.equal(p.documentOrderIndex, i);
        }

        assert.equal(scanResult.paragraphs[0].paragraphId, 'word-tablepara-0-0-0-0');
        assert.equal(scanResult.paragraphs[0].text, 'Cell A1');
        assert.equal(scanResult.paragraphs[0].tableLocator?.rowIndex, 0);
        assert.equal(scanResult.paragraphs[0].tableLocator?.cellIndex, 0);

        assert.equal(scanResult.paragraphs[1].paragraphId, 'word-tablepara-0-0-1-0');
        assert.equal(scanResult.paragraphs[1].text, 'Cell B1');

        assert.equal(scanResult.paragraphs[2].paragraphId, 'word-tablepara-0-1-0-0');
        assert.equal(scanResult.paragraphs[2].text, 'Cell A2');

        assert.equal(scanResult.paragraphs[3].paragraphId, 'word-tablepara-0-1-1-0');
        assert.equal(scanResult.paragraphs[3].text, 'Cell B2');

        // Generation
        const plans: DocumentGenerationParagraphPlan[] = scanResult.paragraphs.map((p) => ({
            paragraphId: p.paragraphId,
            documentOrderIndex: p.documentOrderIndex,
            expectedSourceHash: p.hash,
            targetText: `TR_${p.text}`,
            runs: [{ text: `TR_${p.text}`, bold: false, italic: false, underline: false }],
            containerKind: 'TABLE',
            tableLocator: p.tableLocator,
        }));

        const genResult = await generateTranslatedWordDocument(
            { requestId: 'gen-2x2', paragraphPlans: plans },
            env.createWordRunner(),
            env.office
        );

        assert.equal(genResult.status, 'SUCCESS');
        assert.equal(genResult.appliedParagraphCount, 4);
        assert.equal(env.openCallCount, 1);

        // Verify copy document has translated text
        const createdTables = env.createdContext!.document.body.tables.items;
        assert.equal(createdTables[0].rows.items[0].cells.items[0].body.paragraphs.items[0].text, 'TR_Cell A1');
        assert.equal(createdTables[0].rows.items[0].cells.items[1].body.paragraphs.items[0].text, 'TR_Cell B1');
        assert.equal(createdTables[0].rows.items[1].cells.items[0].body.paragraphs.items[0].text, 'TR_Cell A2');
        assert.equal(createdTables[0].rows.items[1].cells.items[1].body.paragraphs.items[0].text, 'TR_Cell B2');

        // Verify original document is untouched
        const origTables = env.activeContext.document.body.tables.items;
        assert.equal(origTables[0].rows.items[0].cells.items[0].body.paragraphs.items[0].text, 'Cell A1');
        assert.equal(origTables[0].rows.items[0].cells.items[1].body.paragraphs.items[0].text, 'Cell B1');
        assert.equal(origTables[0].rows.items[1].cells.items[0].body.paragraphs.items[0].text, 'Cell A2');
        assert.equal(origTables[0].rows.items[1].cells.items[1].body.paragraphs.items[0].text, 'Cell B2');
    });

    // 2. Merged cells table translation
    it('Scenario 2: correctly scans and translates a table with merged cells (reduced row cell count)', async () => {
        const env = new MockWordEnvironment('', 'MergedTable.docx', {
            bodyMode: 'isolated-body',
            structure: [
                {
                    type: 'table',
                    rows: [
                        ['Merged Header Cell'], // Row 0 has 1 cell (horizontally merged)
                        ['Row 2 Cell 1', 'Row 2 Cell 2'], // Row 1 has 2 cells
                    ],
                },
            ],
        });

        const scanResult = await enumerateAllDocumentParagraphs(
            { requestId: 'scan-merged' },
            env.createWordRunner()
        );

        assert.equal(scanResult.paragraphs.length, 3);
        assert.equal(scanResult.paragraphs[0].paragraphId, 'word-tablepara-0-0-0-0');
        assert.equal(scanResult.paragraphs[0].text, 'Merged Header Cell');
        assert.equal(scanResult.paragraphs[0].tableLocator?.rowIndex, 0);
        assert.equal(scanResult.paragraphs[0].tableLocator?.cellIndex, 0);

        assert.equal(scanResult.paragraphs[1].paragraphId, 'word-tablepara-0-1-0-0');
        assert.equal(scanResult.paragraphs[1].text, 'Row 2 Cell 1');
        assert.equal(scanResult.paragraphs[1].tableLocator?.rowIndex, 1);
        assert.equal(scanResult.paragraphs[1].tableLocator?.cellIndex, 0);

        assert.equal(scanResult.paragraphs[2].paragraphId, 'word-tablepara-0-1-1-0');
        assert.equal(scanResult.paragraphs[2].text, 'Row 2 Cell 2');
        assert.equal(scanResult.paragraphs[2].tableLocator?.rowIndex, 1);
        assert.equal(scanResult.paragraphs[2].tableLocator?.cellIndex, 1);

        const plans: DocumentGenerationParagraphPlan[] = scanResult.paragraphs.map((p) => ({
            paragraphId: p.paragraphId,
            documentOrderIndex: p.documentOrderIndex,
            expectedSourceHash: p.hash,
            targetText: `TR_${p.text}`,
            runs: [{ text: `TR_${p.text}`, bold: false, italic: false, underline: false }],
            containerKind: 'TABLE',
            tableLocator: p.tableLocator,
        }));

        const genResult = await generateTranslatedWordDocument(
            { requestId: 'gen-merged', paragraphPlans: plans },
            env.createWordRunner(),
            env.office
        );

        assert.equal(genResult.status, 'SUCCESS');
        assert.equal(genResult.appliedParagraphCount, 3);
    });

    // 3. Empty cells and multiple paragraphs per cell
    it('Scenario 3: handles cells with multiple paragraphs and empty cells without index drift or omissions', async () => {
        const env = new MockWordEnvironment('', 'MultiPara.docx', {
            bodyMode: 'isolated-body',
            structure: [
                {
                    type: 'table',
                    rows: [
                        [[ 'Multi Para 1', 'Multi Para 2' ], ''],
                    ],
                },
            ],
        });

        const scanResult = await enumerateAllDocumentParagraphs(
            { requestId: 'scan-multi' },
            env.createWordRunner()
        );

        assert.equal(scanResult.paragraphs.length, 3);
        assert.equal(scanResult.paragraphs[0].paragraphId, 'word-tablepara-0-0-0-0');
        assert.equal(scanResult.paragraphs[0].text, 'Multi Para 1');
        assert.equal(scanResult.paragraphs[0].tableLocator?.paragraphIndexInCell, 0);

        assert.equal(scanResult.paragraphs[1].paragraphId, 'word-tablepara-0-0-0-1');
        assert.equal(scanResult.paragraphs[1].text, 'Multi Para 2');
        assert.equal(scanResult.paragraphs[1].tableLocator?.paragraphIndexInCell, 1);

        assert.equal(scanResult.paragraphs[2].paragraphId, 'word-tablepara-0-0-1-0');
        assert.equal(scanResult.paragraphs[2].text, '');
        assert.equal(scanResult.paragraphs[2].tableLocator?.paragraphIndexInCell, 0);

        const plans: DocumentGenerationParagraphPlan[] = scanResult.paragraphs.map((p) => ({
            paragraphId: p.paragraphId,
            documentOrderIndex: p.documentOrderIndex,
            expectedSourceHash: p.hash,
            targetText: p.text === '' ? '' : `TR_${p.text}`,
            runs: [{ text: p.text === '' ? '' : `TR_${p.text}`, bold: false, italic: false, underline: false }],
            containerKind: 'TABLE',
            tableLocator: p.tableLocator,
        }));

        const genResult = await generateTranslatedWordDocument(
            { requestId: 'gen-multi', paragraphPlans: plans },
            env.createWordRunner(),
            env.office
        );

        assert.equal(genResult.status, 'SUCCESS');
        assert.equal(genResult.appliedParagraphCount, 3);

        const createdTable = env.createdContext!.document.body.tables.items[0];
        const cell0Paras = createdTable.rows.items[0].cells.items[0].body.paragraphs.items;
        assert.equal(cell0Paras[0].text, 'TR_Multi Para 1');
        assert.equal(cell0Paras[1].text, 'TR_Multi Para 2');
        const cell1Paras = createdTable.rows.items[0].cells.items[1].body.paragraphs.items;
        assert.equal(cell1Paras[0].text, '');
    });

    // 4. Mixed body and table paragraphs global sequence and §3.5 sparse materialization
    it('Scenario 4: ensures strictly monotonic documentOrderIndex for mixed body and table paragraphs, and correctly replaces trailing body plans', async () => {
        const env = new WordMockWithTableInBody([
            { type: 'body', text: 'Header Body Paragraph' },
            {
                type: 'table',
                rows: [
                    ['Cell A1', 'Cell B1'],
                    ['Cell A2', 'Cell B2'],
                ],
            },
            { type: 'body', text: 'Footer Body Paragraph' },
        ], 'MixedDoc.docx');

        const scanResult = await enumerateAllDocumentParagraphs(
            { requestId: 'scan-mixed' },
            env.createWordRunner()
        );

        assert.equal(scanResult.paragraphs.length, 6);
        assert.deepEqual(
            scanResult.paragraphs.map((p) => p.documentOrderIndex),
            [0, 1, 2, 3, 4, 5]
        );

        assert.equal(scanResult.paragraphs[0].containerKind, undefined);
        assert.equal(scanResult.paragraphs[0].text, 'Header Body Paragraph');

        assert.equal(scanResult.paragraphs[1].containerKind, 'TABLE');
        assert.equal(scanResult.paragraphs[1].text, 'Cell A1');

        assert.equal(scanResult.paragraphs[2].containerKind, 'TABLE');
        assert.equal(scanResult.paragraphs[2].text, 'Cell B1');

        assert.equal(scanResult.paragraphs[3].containerKind, 'TABLE');
        assert.equal(scanResult.paragraphs[3].text, 'Cell A2');

        assert.equal(scanResult.paragraphs[4].containerKind, 'TABLE');
        assert.equal(scanResult.paragraphs[4].text, 'Cell B2');

        assert.equal(scanResult.paragraphs[5].containerKind, undefined);
        assert.equal(scanResult.paragraphs[5].text, 'Footer Body Paragraph');

        // Materialize plans to verify §3.5 sparse indexing replaces both table and body paragraphs correctly
        const plans: DocumentGenerationParagraphPlan[] = scanResult.paragraphs.map((p) => ({
            paragraphId: p.paragraphId,
            documentOrderIndex: p.documentOrderIndex,
            expectedSourceHash: p.hash,
            targetText: `TR_${p.text}`,
            runs: [{ text: `TR_${p.text}`, bold: false, italic: false, underline: false }],
            containerKind: p.containerKind,
            tableLocator: p.tableLocator,
        }));

        const genResult = await generateTranslatedWordDocument(
            { requestId: 'gen-mixed', paragraphPlans: plans },
            env.createWordRunner(),
            env.office
        );

        assert.equal(genResult.status, 'SUCCESS');
        assert.equal(genResult.appliedParagraphCount, 6);

        // Verify copy document
        const createdBody = env.createdContext!.document.body;
        assert.equal(createdBody.paragraphs.items[0].text, 'TR_Header Body Paragraph');
        assert.equal(createdBody.paragraphs.items[5].text, 'TR_Footer Body Paragraph');
        assert.equal(createdBody.tables.items[0].rows.items[0].cells.items[0].body.paragraphs.items[0].text, 'TR_Cell A1');

        // Verify source document untouched
        assert.equal(env.activeContext.document.body.paragraphs.items[0].text, 'Header Body Paragraph');
        assert.equal(env.activeContext.document.body.paragraphs.items[5].text, 'Footer Body Paragraph');
    });

    // 5. Fingerprint mismatch fail-closed rejection
    it('Scenario 5: fails closed with FINGERPRINT_MISMATCH when table cell paragraph hash is stale', async () => {
        const env = new MockWordEnvironment('', 'FingerprintFail.docx', {
            structure: [
                {
                    type: 'table',
                    rows: [
                        ['Cell 1', 'Cell 2'],
                    ],
                },
            ],
        });

        const scanResult = await enumerateAllDocumentParagraphs(
            { requestId: 'scan-fp' },
            env.createWordRunner()
        );

        const plans: DocumentGenerationParagraphPlan[] = scanResult.paragraphs.map((p) => ({
            paragraphId: p.paragraphId,
            documentOrderIndex: p.documentOrderIndex,
            expectedSourceHash: p.hash,
            targetText: `TR_${p.text}`,
            runs: [{ text: `TR_${p.text}`, bold: false, italic: false, underline: false }],
            containerKind: 'TABLE',
            tableLocator: p.tableLocator,
        }));

        // Tamper with the expectedSourceHash of the second cell
        plans[1].expectedSourceHash = '0000000000000000000000000000000000000000000000000000000000000000';

        const genResult = await generateTranslatedWordDocument(
            { requestId: 'gen-fp', paragraphPlans: plans },
            env.createWordRunner(),
            env.office
        );

        assert.equal(genResult.status, 'FINGERPRINT_MISMATCH');
        assert.equal(env.openCallCount, 0);

        // Source document remains completely pristine
        const origTable = env.activeContext.document.body.tables.items[0];
        assert.equal(origTable.rows.items[0].cells.items[0].body.paragraphs.items[0].text, 'Cell 1');
        assert.equal(origTable.rows.items[0].cells.items[1].body.paragraphs.items[0].text, 'Cell 2');
    });

    // 6. Preflight invalid TableLocator rejection
    it('Scenario 6: rejects invalid table locator in paragraph plan during preflight before opening copy', async () => {
        const env = new MockWordEnvironment('', 'BadLocator.docx', {
            structure: [
                {
                    type: 'table',
                    rows: [['Cell 1']],
                },
            ],
        });

        const badPlans: DocumentGenerationParagraphPlan[] = [{
            paragraphId: 'word-tablepara-0-0-0-0',
            documentOrderIndex: 0,
            expectedSourceHash: computeParagraphHash('Cell 1'),
            targetText: 'Translated Cell 1',
            runs: [{ text: 'Translated Cell 1', bold: false, italic: false, underline: false }],
            containerKind: 'TABLE',
            tableLocator: {
                tableIndex: -1,
                cellIndex: 0,
                paragraphIndexInCell: 0,
            },
        }];

        const genResult = await generateTranslatedWordDocument(
            { requestId: 'gen-bad-loc', paragraphPlans: badPlans },
            env.createWordRunner(),
            env.office
        );

        assert.equal(genResult.status, 'FAILED');
        assert.match(genResult.message || '', /Invalid table locator/);
        assert.equal(env.openCallCount, 0);
    });

    // 7. Cross-validation on both Mock modes (WordMockWithTableInBody vs WordMockIsolatedBody)
    it('Scenario 7: verifies identical, deduplicated scan and successful generation across WordMockWithTableInBody and WordMockIsolatedBody', async () => {
        const structure: MockDocumentEnvironmentOptions['structure'] = [
            { type: 'body', text: 'Intro Paragraph' },
            {
                type: 'table',
                rows: [
                    ['Header A', 'Header B'],
                    ['Data 1', 'Data 2'],
                ],
            },
            { type: 'body', text: 'Outro Paragraph' },
        ];

        // Mode 1: WordMockWithTableInBody
        const envWithTableInBody = new WordMockWithTableInBody(structure, 'DocModeA.docx');
        const scanA = await enumerateAllDocumentParagraphs({ requestId: 'scan-mode-a' }, envWithTableInBody.createWordRunner());

        // Mode 2: WordMockIsolatedBody
        const envIsolatedBody = new WordMockIsolatedBody(structure, 'DocModeB.docx');
        const scanB = await enumerateAllDocumentParagraphs({ requestId: 'scan-mode-b' }, envIsolatedBody.createWordRunner());

        // Both modes must scan exactly 6 paragraphs with no duplicates and no omissions
        assert.equal(scanA.paragraphs.length, 6);
        assert.equal(scanB.paragraphs.length, 6);

        // Document order indices must be strictly 0..5 in both
        assert.deepEqual(scanA.paragraphs.map((p) => p.documentOrderIndex), [0, 1, 2, 3, 4, 5]);
        assert.deepEqual(scanB.paragraphs.map((p) => p.documentOrderIndex), [0, 1, 2, 3, 4, 5]);

        // Verify table paragraphs have containerKind TABLE in both
        for (let i = 1; i <= 4; i++) {
            assert.equal(scanA.paragraphs[i].containerKind, 'TABLE');
            assert.ok(scanA.paragraphs[i].tableLocator);
        }

        // Verify generation succeeds in both modes
        const plansA: DocumentGenerationParagraphPlan[] = scanA.paragraphs.map((p) => ({
            paragraphId: p.paragraphId,
            documentOrderIndex: p.documentOrderIndex,
            expectedSourceHash: p.hash,
            targetText: `TR_${p.text}`,
            runs: [{ text: `TR_${p.text}`, bold: false, italic: false, underline: false }],
            containerKind: p.containerKind,
            tableLocator: p.tableLocator,
        }));

        const genA = await generateTranslatedWordDocument(
            { requestId: 'gen-a', paragraphPlans: plansA },
            envWithTableInBody.createWordRunner(),
            envWithTableInBody.office
        );
        assert.equal(genA.status, 'SUCCESS');
        assert.equal(genA.appliedParagraphCount, 6);

        const plansB: DocumentGenerationParagraphPlan[] = scanB.paragraphs.map((p) => ({
            paragraphId: p.paragraphId,
            documentOrderIndex: p.documentOrderIndex,
            expectedSourceHash: p.hash,
            targetText: `TR_${p.text}`,
            runs: [{ text: `TR_${p.text}`, bold: false, italic: false, underline: false }],
            containerKind: p.containerKind,
            tableLocator: p.tableLocator,
        }));

        const genB = await generateTranslatedWordDocument(
            { requestId: 'gen-b', paragraphPlans: plansB },
            envIsolatedBody.createWordRunner(),
            envIsolatedBody.office
        );
        assert.equal(genB.status, 'SUCCESS');
        assert.equal(genB.appliedParagraphCount, 6);

        // Verify pristine state of originals in both
        assert.equal(envWithTableInBody.activeContext.document.body.paragraphs.items[0].text, 'Intro Paragraph');
        assert.equal(envIsolatedBody.activeContext.document.body.paragraphs.items[0].text, 'Intro Paragraph');
    });

    // 8. Out-of-bounds TableLocator resolution failure fail-closed rejection
    it('Scenario 8: fails closed with LOCATOR_RESOLUTION_FAILED when tableLocator has out-of-bounds indices without falling back to other paragraphs', async () => {
        const env = new WordMockWithTableInBody([
            { type: 'body', text: 'Leading Body Paragraph' },
            {
                type: 'table',
                rows: [
                    ['Cell 1', 'Cell 2'],
                ],
            },
        ], 'OutOfBoundsDoc.docx');

        // Target hash matches the Leading Body Paragraph at documentOrderIndex 0,
        // so if resolveTargetParagraph wrongly falls back to resolvedByOrder[0],
        // the hash check would accidentally pass!
        const badPlans: DocumentGenerationParagraphPlan[] = [
            {
                paragraphId: 'word-tablepara-0-99-0-0',
                documentOrderIndex: 0,
                expectedSourceHash: computeParagraphHash('Leading Body Paragraph'),
                targetText: 'Translated Target',
                runs: [{ text: 'Translated Target', bold: false, italic: false, underline: false }],
                containerKind: 'TABLE',
                tableLocator: {
                    tableIndex: 0,
                    rowIndex: 99, // Out-of-bounds row index
                    cellIndex: 0,
                    paragraphIndexInCell: 0,
                },
            },
        ];

        const genResult = await generateTranslatedWordDocument(
            { requestId: 'gen-oob', paragraphPlans: badPlans },
            env.createWordRunner(),
            env.office
        );

        assert.equal(genResult.status, 'FAILED');
        assert.equal(genResult.message, 'LOCATOR_RESOLUTION_FAILED');
        assert.equal(env.openCallCount, 0);

        // Original document remains completely untouched
        assert.equal(env.activeContext.document.body.paragraphs.items[0].text, 'Leading Body Paragraph');
        assert.equal(env.activeContext.document.body.tables.items[0].rows.items[0].cells.items[0].body.paragraphs.items[0].text, 'Cell 1');
    });
});

