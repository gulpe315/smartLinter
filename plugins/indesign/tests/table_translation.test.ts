import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { MockInDesignEnvironment, MockUserInteractionLevels, MockSaveOptions } from '../__tests__/mock_indesign.ts';
import { computeParagraphHash } from '../../../shared/engine/hash_util.ts';
import { type DocumentGenerationParagraphPlan } from '../../../shared/protocol/types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadModule(relativePath: string, extraSandbox: Record<string, any> = {}) {
    const filePath = path.resolve(__dirname, relativePath);
    let source = fs.readFileSync(filePath, 'utf8');
    source = source.replace(/^[ \t]*#include\s+["']([^"']+)["']/gm, (_match, rel) => {
        const fullRel = path.resolve(path.dirname(filePath), rel);
        return fs.readFileSync(fullRel, 'utf8').replace(/^[ \t]*#targetengine[^\n]*/gm, '');
    }).replace(/^[ \t]*#targetengine[^\n]*/gm, '');

    const sandbox: Record<string, any> = {
        console,
        JSON,
        String,
        Boolean,
        Array,
        Object,
        Math,
        Date,
        module: { exports: {} },
        UserInteractionLevels: MockUserInteractionLevels,
        SaveOptions: MockSaveOptions,
        Folder: { temp: { fsName: '/tmp' } },
        File: function(name: string) {
            return {
                fsName: name,
                exists: true,
                remove: () => {}
            };
        },
        SmartLinterHashUtil: { computeParagraphHash },
        ...extraSandbox,
    };
    sandbox.global = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.$ = { global: sandbox };

    vm.runInNewContext(source, sandbox, { filename: filePath });
    return { exports: sandbox.module.exports, sandbox };
}

const defaultFontMetadata = {
    inDesignDefaultFontFace: { fontFamily: 'Minion Pro', fontStyleName: 'Regular' },
    inDesignFontFaceByFormatId: {}
};

describe('InDesign Table Translation Test Suite (T6d-2)', () => {
    // 1. 2x2 Basic table translation
    it('Scenario 1: scans a 2x2 table with containerKind TABLE and tableLocator, and generates translated document', () => {
        const env = new MockInDesignEnvironment();
        env.stories.length = 0;
        const story = env.createStory([], { id: 'story-1' });
        env.createTable('story-1', 2, 2, [
            ['Cell A1', 'Cell B1'],
            ['Cell A2', 'Cell B2'],
        ]);

        const { sandbox: scannerSandbox } = loadModule('../extendscript/document_scanner.jsx', {
            SmartLinterInlineTagExtractor: {
                extractParagraphTokens: () => ({ ok: false, reason: 'FALLBACK' })
            }
        });
        const scanResult = scannerSandbox.SmartLinterDocumentScanner.enumerateAllDocumentParagraphs(env.activeDocument, { requestId: 'scan-2x2' });

        assert.equal(scanResult.paragraphs.length, 4);
        for (let i = 0; i < 4; i++) {
            const p = scanResult.paragraphs[i];
            assert.equal(p.containerKind, 'TABLE');
            assert.ok(p.tableLocator);
            assert.equal(p.tableLocator.tableIndex, 0);
            assert.equal(p.tableLocator.cellIndex, i);
            assert.equal(p.tableLocator.paragraphIndexInCell, 0);
        }

        assert.equal(scanResult.paragraphs[0].paragraphId, 'indesign-tablepara-story-1-0-0-0');
        assert.equal(scanResult.paragraphs[1].paragraphId, 'indesign-tablepara-story-1-0-1-0');
        assert.equal(scanResult.paragraphs[2].paragraphId, 'indesign-tablepara-story-1-0-2-0');
        assert.equal(scanResult.paragraphs[3].paragraphId, 'indesign-tablepara-story-1-0-3-0');

        // Generator materialization
        const plans: DocumentGenerationParagraphPlan[] = scanResult.paragraphs.map((p: any, idx: number) => ({
            paragraphId: p.paragraphId,
            documentOrderIndex: p.documentOrderIndex,
            expectedSourceHash: p.hash,
            targetText: `Translated ${p.text}`,
            runs: [{ text: `Translated ${p.text}`, bold: false, italic: false, underline: false }],
            containerKind: 'TABLE',
            tableLocator: p.tableLocator,
            ...defaultFontMetadata,
        }));

        const { sandbox: replacerSandbox } = loadModule('../extendscript/atomic_replacer.jsx');
        const { sandbox: materializerSandbox } = loadModule('../extendscript/translation_materializer.jsx', {
            SmartLinterAtomicReplacer: replacerSandbox.SmartLinterAtomicReplacer
        });
        const { sandbox: generatorSandbox } = loadModule('../extendscript/document_generator.jsx', {
            SmartLinterAtomicReplacer: replacerSandbox.SmartLinterAtomicReplacer,
            SmartLinterInDesignTranslationMaterializer: materializerSandbox.SmartLinterInDesignTranslationMaterializer
        });

        const genResult = generatorSandbox.SmartLinterDocumentGenerator.generateTranslatedDocument({
            requestId: 'gen-2x2',
            destinationPath: '/output/table_2x2_translated.indd',
            paragraphPlans: plans
        }, { appInstance: env.getApp() });

        assert.equal(genResult.status, 'SUCCESS');
        assert.equal(genResult.appliedParagraphCount, 4);

        // Verify source document untouched
        assert.equal(story.paragraphs[0].contents, 'Cell A1');
        assert.equal(story.paragraphs[1].contents, 'Cell B1');
        assert.equal(story.paragraphs[2].contents, 'Cell A2');
        assert.equal(story.paragraphs[3].contents, 'Cell B2');
    });

    // 2. Merged cells table translation (rowSpan / colSpan)
    it('Scenario 2: correctly scans and translates a table with merged cells (rowSpan & colSpan)', () => {
        const env = new MockInDesignEnvironment();
        env.stories.length = 0;
        const story = env.createStory([], { id: 'story-merge' });
        const table = env.createTable('story-merge', 2, 2, [
            ['Merged Row', 'Cell 1:0'],
            ['(Merged)', 'Cell 1:1'],
        ]);
        // Merge (0,0) with rowSpan 2
        env.mergeCells(table, 0, 0, 2, 1);

        const { sandbox: scannerSandbox } = loadModule('../extendscript/document_scanner.jsx', {
            SmartLinterInlineTagExtractor: {
                extractParagraphTokens: () => ({ ok: false, reason: 'FALLBACK' })
            }
        });
        const scanResult = scannerSandbox.SmartLinterDocumentScanner.enumerateAllDocumentParagraphs(env.activeDocument, { requestId: 'scan-merge' });

        // 3 remaining cells: (0:0 merged rowSpan 2), (1:0), (1:1)
        assert.equal(scanResult.paragraphs.length, 3);
        const mergedPara = scanResult.paragraphs[0];
        assert.equal(mergedPara.containerKind, 'TABLE');
        assert.equal(mergedPara.tableLocator.rowSpan, 2);
        assert.equal(mergedPara.tableLocator.columnSpan, 1);
        assert.equal(mergedPara.tableLocator.cellName, '0:0');

        const plans: DocumentGenerationParagraphPlan[] = scanResult.paragraphs.map((p: any) => ({
            paragraphId: p.paragraphId,
            documentOrderIndex: p.documentOrderIndex,
            expectedSourceHash: p.hash,
            targetText: `TR_${p.text}`,
            runs: [{ text: `TR_${p.text}`, bold: false, italic: false, underline: false }],
            containerKind: 'TABLE',
            tableLocator: p.tableLocator,
            ...defaultFontMetadata,
        }));

        const { sandbox: replacerSandbox } = loadModule('../extendscript/atomic_replacer.jsx');
        const { sandbox: materializerSandbox } = loadModule('../extendscript/translation_materializer.jsx', {
            SmartLinterAtomicReplacer: replacerSandbox.SmartLinterAtomicReplacer
        });
        const { sandbox: generatorSandbox } = loadModule('../extendscript/document_generator.jsx', {
            SmartLinterAtomicReplacer: replacerSandbox.SmartLinterAtomicReplacer,
            SmartLinterInDesignTranslationMaterializer: materializerSandbox.SmartLinterInDesignTranslationMaterializer
        });

        const genResult = generatorSandbox.SmartLinterDocumentGenerator.generateTranslatedDocument({
            requestId: 'gen-merge',
            destinationPath: '/output/table_merge_translated.indd',
            paragraphPlans: plans
        }, { appInstance: env.getApp() });

        assert.equal(genResult.status, 'SUCCESS');
        assert.equal(genResult.appliedParagraphCount, 3);
    });

    // 3. Empty cells / multiple paragraphs per cell
    it('Scenario 3: handles cells with multiple paragraphs and empty cells without index drift or omissions', () => {
        const env = new MockInDesignEnvironment();
        env.stories.length = 0;
        const story = env.createStory([], { id: 'story-multi' });
        env.createTable('story-multi', 1, 2, [
            [['Multi Para 1', 'Multi Para 2'], ''],
        ]);

        const { sandbox: scannerSandbox } = loadModule('../extendscript/document_scanner.jsx', {
            SmartLinterInlineTagExtractor: {
                extractParagraphTokens: () => ({ ok: false, reason: 'FALLBACK' })
            }
        });
        const scanResult = scannerSandbox.SmartLinterDocumentScanner.enumerateAllDocumentParagraphs(env.activeDocument, { requestId: 'scan-multi' });

        assert.equal(scanResult.paragraphs.length, 3); // 2 in cell 0, 1 in cell 1
        assert.equal(scanResult.paragraphs[0].tableLocator.cellIndex, 0);
        assert.equal(scanResult.paragraphs[0].tableLocator.paragraphIndexInCell, 0);
        assert.equal(scanResult.paragraphs[0].paragraphId, 'indesign-tablepara-story-multi-0-0-0');

        assert.equal(scanResult.paragraphs[1].tableLocator.cellIndex, 0);
        assert.equal(scanResult.paragraphs[1].tableLocator.paragraphIndexInCell, 1);
        assert.equal(scanResult.paragraphs[1].paragraphId, 'indesign-tablepara-story-multi-0-0-1');

        assert.equal(scanResult.paragraphs[2].tableLocator.cellIndex, 1);
        assert.equal(scanResult.paragraphs[2].tableLocator.paragraphIndexInCell, 0);
        assert.equal(scanResult.paragraphs[2].paragraphId, 'indesign-tablepara-story-multi-0-1-0');
        assert.equal(scanResult.paragraphs[2].text, '');

        const plans: DocumentGenerationParagraphPlan[] = scanResult.paragraphs.map((p: any) => ({
            paragraphId: p.paragraphId,
            documentOrderIndex: p.documentOrderIndex,
            expectedSourceHash: p.hash,
            targetText: p.text === '' ? '' : `Translated: ${p.text}`,
            runs: [{ text: p.text === '' ? '' : `Translated: ${p.text}`, bold: false, italic: false, underline: false }],
            containerKind: 'TABLE',
            tableLocator: p.tableLocator,
            ...defaultFontMetadata,
        }));

        const { sandbox: replacerSandbox } = loadModule('../extendscript/atomic_replacer.jsx');
        const { sandbox: materializerSandbox } = loadModule('../extendscript/translation_materializer.jsx', {
            SmartLinterAtomicReplacer: replacerSandbox.SmartLinterAtomicReplacer
        });
        const { sandbox: generatorSandbox } = loadModule('../extendscript/document_generator.jsx', {
            SmartLinterAtomicReplacer: replacerSandbox.SmartLinterAtomicReplacer,
            SmartLinterInDesignTranslationMaterializer: materializerSandbox.SmartLinterInDesignTranslationMaterializer
        });

        const genResult = generatorSandbox.SmartLinterDocumentGenerator.generateTranslatedDocument({
            requestId: 'gen-multi',
            destinationPath: '/output/table_multi_translated.indd',
            paragraphPlans: plans
        }, { appInstance: env.getApp() });

        assert.equal(genResult.status, 'SUCCESS');
        assert.equal(genResult.appliedParagraphCount, 3);
    });

    // 4. Body + table mixed document documentOrderIndex global sequence
    it('Scenario 4: ensures strictly monotonic documentOrderIndex for mixed body and table paragraphs', () => {
        const env = new MockInDesignEnvironment();
        env.stories.length = 0;
        const story = env.createStory(['Header Body Paragraph'], { id: 'story-mixed' });
        env.createTable('story-mixed', 1, 2, [
            ['Table Cell 1', 'Table Cell 2'],
        ]);
        const footerPara = env.createParagraph('Footer Body Paragraph', 'story-mixed');
        footerPara.parent = { typename: 'Story' };
        footerPara.index = story.paragraphs.length;
        story.paragraphs.push(footerPara);

        const { sandbox: scannerSandbox } = loadModule('../extendscript/document_scanner.jsx', {
            SmartLinterInlineTagExtractor: {
                extractParagraphTokens: () => ({ ok: false, reason: 'FALLBACK' })
            }
        });
        const scanResult = scannerSandbox.SmartLinterDocumentScanner.enumerateAllDocumentParagraphs(env.activeDocument, { requestId: 'scan-mixed' });

        assert.equal(scanResult.paragraphs.length, 4);
        assert.deepEqual(Array.from(scanResult.paragraphs, (p: any) => p.documentOrderIndex), [0, 1, 2, 3]);

        assert.equal(scanResult.paragraphs[0].containerKind, undefined); // Body
        assert.equal(scanResult.paragraphs[0].text, 'Header Body Paragraph');

        assert.equal(scanResult.paragraphs[1].containerKind, 'TABLE');
        assert.equal(scanResult.paragraphs[1].text, 'Table Cell 1');

        assert.equal(scanResult.paragraphs[2].containerKind, 'TABLE');
        assert.equal(scanResult.paragraphs[2].text, 'Table Cell 2');

        assert.equal(scanResult.paragraphs[3].containerKind, undefined); // Body
        assert.equal(scanResult.paragraphs[3].text, 'Footer Body Paragraph');
    });

    // 5. Fingerprint mismatch fail-closed rejection
    it('Scenario 5: fails closed with FINGERPRINT_MISMATCH when table cell paragraph hash is stale', () => {
        const env = new MockInDesignEnvironment();
        env.stories.length = 0;
        const story = env.createStory([], { id: 'story-fp' });
        env.createTable('story-fp', 1, 2, [
            ['Cell 1', 'Cell 2'],
        ]);

        const { sandbox: scannerSandbox } = loadModule('../extendscript/document_scanner.jsx', {
            SmartLinterInlineTagExtractor: {
                extractParagraphTokens: () => ({ ok: false, reason: 'FALLBACK' })
            }
        });
        const scanResult = scannerSandbox.SmartLinterDocumentScanner.enumerateAllDocumentParagraphs(env.activeDocument, { requestId: 'scan-fp' });

        const plans: DocumentGenerationParagraphPlan[] = scanResult.paragraphs.map((p: any) => ({
            paragraphId: p.paragraphId,
            documentOrderIndex: p.documentOrderIndex,
            expectedSourceHash: p.hash,
            targetText: `TR_${p.text}`,
            runs: [{ text: `TR_${p.text}`, bold: false, italic: false, underline: false }],
            containerKind: 'TABLE',
            tableLocator: p.tableLocator,
            ...defaultFontMetadata,
        }));

        // Tamper with expectedSourceHash on the second table cell
        plans[1].expectedSourceHash = '0000000000000000000000000000000000000000000000000000000000000000';

        const { sandbox: replacerSandbox } = loadModule('../extendscript/atomic_replacer.jsx');
        const { sandbox: materializerSandbox } = loadModule('../extendscript/translation_materializer.jsx', {
            SmartLinterAtomicReplacer: replacerSandbox.SmartLinterAtomicReplacer
        });
        const { sandbox: generatorSandbox } = loadModule('../extendscript/document_generator.jsx', {
            SmartLinterAtomicReplacer: replacerSandbox.SmartLinterAtomicReplacer,
            SmartLinterInDesignTranslationMaterializer: materializerSandbox.SmartLinterInDesignTranslationMaterializer
        });

        const genResult = generatorSandbox.SmartLinterDocumentGenerator.generateTranslatedDocument({
            requestId: 'gen-fp',
            destinationPath: '/output/table_fp_fail.indd',
            paragraphPlans: plans
        }, { appInstance: env.getApp() });

        assert.equal(genResult.status, 'FINGERPRINT_MISMATCH');

        // Source document remains completely pristine
        assert.equal(story.paragraphs[0].contents, 'Cell 1');
        assert.equal(story.paragraphs[1].contents, 'Cell 2');
    });

    // 6. Preflight invalid table locator rejection
    it('rejects invalid table locator in paragraph plan during preflight before opening copy', () => {
        const env = new MockInDesignEnvironment();
        env.stories.length = 0;
        env.createStory([], { id: 'story-invalid-loc' });
        env.createTable('story-invalid-loc', 1, 1, [['Cell 1']]);

        const { sandbox: replacerSandbox } = loadModule('../extendscript/atomic_replacer.jsx');
        const { sandbox: materializerSandbox } = loadModule('../extendscript/translation_materializer.jsx', {
            SmartLinterAtomicReplacer: replacerSandbox.SmartLinterAtomicReplacer
        });
        const { sandbox: generatorSandbox } = loadModule('../extendscript/document_generator.jsx', {
            SmartLinterAtomicReplacer: replacerSandbox.SmartLinterAtomicReplacer,
            SmartLinterInDesignTranslationMaterializer: materializerSandbox.SmartLinterInDesignTranslationMaterializer
        });

        const badPlans: DocumentGenerationParagraphPlan[] = [{
            paragraphId: 'indesign-tablepara-story-invalid-loc-0-0-0',
            documentOrderIndex: 0,
            expectedSourceHash: computeParagraphHash('Cell 1'),
            targetText: 'Translated Cell 1',
            runs: [{ text: 'Translated Cell 1', bold: false, italic: false, underline: false }],
            containerKind: 'TABLE',
            tableLocator: {
                tableIndex: -1,
                cellIndex: 0,
                paragraphIndexInCell: 0
            } as any,
            ...defaultFontMetadata,
        }];

        const genResult = generatorSandbox.SmartLinterDocumentGenerator.generateTranslatedDocument({
            requestId: 'gen-bad-loc',
            destinationPath: '/output/bad_loc.indd',
            paragraphPlans: badPlans
        }, { appInstance: env.getApp() });

        assert.equal(genResult.status, 'FAILED');
        assert.match(genResult.message, /Invalid table locator/);
    });
});
