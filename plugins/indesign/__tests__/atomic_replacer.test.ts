/**
 * Unit & Integration Test Suite for Task 10: Adobe InDesign Plugin
 * (Atomic Reverse-Order Replacement & app.doScript UndoModes.ENTIRE_SCRIPT Transaction Rollback)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import {
    MockInDesignEnvironment,
    MockUndoModes,
    MockScriptLanguage
} from './mock_indesign.ts';
import { computeParagraphHash } from '../../../shared/engine/hash_util.ts';
import { extractDiffHunks, sortHunksReverse } from '../../../shared/engine/diff_engine.ts';
import { SpecialElementsParagraph } from '../../../shared/engine/special_elements.ts';
import {
    type ReplacementCommand,
    type ReplacementResult,
    type TextHunk,
    isReplacementResult
} from '../../../shared/protocol/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const replacerScriptPath = path.resolve(__dirname, '../extendscript/atomic_replacer.jsx');
const runnerScriptPath = path.resolve(__dirname, '../extendscript/transaction_runner.jsx');
const daemonScriptPath = path.resolve(__dirname, '../extendscript/smartlinter_daemon.jsx');
const testScriptPath = path.resolve(__dirname, '../tests/test_atomic_replacement.jsx');

/**
 * ExtendScript File Loader & Preprocessor
 * Simulates InDesign's ExtendScript engine preprocessor (#include, #targetengine) and executes in sandbox.
 */
function loadExtendScript(filePath: string, context: Record<string, any> = {}) {
    let content = fs.readFileSync(filePath, 'utf8');
    const dir = path.dirname(filePath);

    // Resolve #include directives recursively
    content = content.replace(/^[ \t]*#include\s+["']([^"']+)["']/gm, (_match, relPath) => {
        const fullIncludePath = path.resolve(dir, relPath);
        if (fs.existsSync(fullIncludePath)) {
            const incContent = fs.readFileSync(fullIncludePath, 'utf8')
                .replace(/^[ \t]*#targetengine[^\n]*/gm, '// #targetengine (included)');
            return `\n// --- Begin #include "${relPath}" ---\n` + incContent + `\n// --- End #include "${relPath}" ---\n`;
        }
        return _match;
    });

    // Replace ExtendScript preprocessor directives starting with # with comment
    content = content.replace(/^[ \t]*#[a-zA-Z_]+/gm, '// $&');

    const sandbox: Record<string, any> = {
        console,
        Buffer,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Date,
        Math,
        JSON,
        String,
        Array,
        Object,
        parseInt,
        parseFloat,
        UndoModes: MockUndoModes,
        ScriptLanguage: MockScriptLanguage,
        module: { exports: {} },
        exports: {},
        ...context
    };

    sandbox.global = sandbox;
    sandbox.globalThis = sandbox;
    if (!sandbox.$) {
        sandbox.$ = {
            global: sandbox,
            writeln: () => {}
        };
    } else {
        sandbox.$.global = sandbox;
    }

    vm.createContext(sandbox);
    vm.runInContext(content, sandbox, { filename: filePath });
    return sandbox;
}

describe('Task 10: Adobe InDesign Plugin (Atomic Reverse Replacement & doScript Rollback)', () => {

    // =========================================================================
    // 1. Acceptance Criterion (1): Stale Paragraph Rejection (STALE_REJECTED)
    // =========================================================================
    describe('Criterion (1): Base Hash Verification & Stale Conflict Rejection (STALE_REJECTED)', () => {
        let env: MockInDesignEnvironment;

        beforeEach(() => {
            env = new MockInDesignEnvironment(
                'Current active InDesign paragraph that was recently modified by user.',
                'Book_Chapter_1.indd'
            );
        });

        it('should return STALE_REJECTED when active paragraph hash does not match command baseHash', () => {
            const currentDocText = 'Current active InDesign paragraph that was recently modified by user.';
            const staleBaseText = 'Old paragraph text before recent edits.';
            const staleBaseHash = computeParagraphHash(staleBaseText);

            const sandbox = loadExtendScript(replacerScriptPath, { app: env.getApp() });
            const replacer = new sandbox.SmartLinterAtomicReplacer({
                appInstance: env.getApp()
            });

            const command: ReplacementCommand = {
                commandId: 'cmd-stale-indesign-001',
                paragraphId: 'indesign-para-1',
                baseHash: staleBaseHash,
                expectedHash: computeParagraphHash('Target text'),
                hunks: [
                    { start: 0, end: 3, oldText: 'Old', newText: 'Updated' }
                ]
            };

            const result: ReplacementResult = replacer.execute(command);

            assert.equal(isReplacementResult(result), true);
            assert.equal(result.commandId, 'cmd-stale-indesign-001');
            assert.equal(result.status, 'STALE_REJECTED');
            assert.equal(result.currentHash, computeParagraphHash(currentDocText));
            assert.ok(result.message && result.message.includes('Paragraph hash mismatch'));

            // Document in InDesign must remain 100% untouched
            const selectedPara = env.getSelectedParagraph();
            assert.ok(selectedPara);
            assert.equal(selectedPara!.contents, currentDocText);
        });

        it('uses command.paragraphId instead of a different paragraph at the current selection', () => {
            const targetText = 'Paragraph A is the command target.';
            const selectedText = 'Paragraph B is selected but must remain unchanged.';
            const replacementText = 'Paragraph A is the updated command target.';
            const targetParagraph = env.createParagraph(targetText, 'story-500');
            const selectedParagraph = env.createParagraph(selectedText, 'story-500');
            targetParagraph.index = 0;
            selectedParagraph.index = 1;

            // The document contains both paragraphs, while the InDesign cursor is
            // deliberately on B. This reproduces the stale-card disconnect case.
            (env.activeDocument as any).stories = {
                itemByID: (storyId: string) => storyId === 'story-500'
                    ? { paragraphs: [targetParagraph, selectedParagraph] }
                    : null
            };
            env.selection = [{
                paragraphs: [selectedParagraph],
                texts: [{ paragraphs: [selectedParagraph] }],
                parentStory: { id: 'story-500' }
            }];

            const sandbox = loadExtendScript(replacerScriptPath, { app: env.getApp() });
            const replacer = new sandbox.SmartLinterAtomicReplacer({ appInstance: env.getApp() });
            const result = replacer.execute({
                commandId: 'cmd-paragraph-id-target-001',
                paragraphId: 'indesign-para-story-500-0',
                baseHash: computeParagraphHash(targetText),
                expectedHash: computeParagraphHash(replacementText),
                hunks: extractDiffHunks(targetText, replacementText)
            });

            assert.equal(result.status, 'SUCCESS');
            assert.equal(targetParagraph.contents, replacementText);
            assert.equal(selectedParagraph.contents, selectedText);
        });

        it('locates and selects a paragraph by its id and base hash without editing it', () => {
            const paragraphText = 'Locate this paragraph without changing it.';
            const targetParagraph = env.createParagraph(paragraphText, 'locate-story');
            (env.activeDocument as any).stories = {
                itemByID: (storyId: string) => storyId === 'locate-story'
                    ? { paragraphs: [targetParagraph] }
                    : null
            };
            const app = env.getApp();
            let selected: unknown = null;
            app.select = (value: unknown) => { selected = value; };
            const sandbox = loadExtendScript(replacerScriptPath, { app });
            const replacer = new sandbox.SmartLinterAtomicReplacer({ appInstance: app });

            const result = replacer.locateParagraph({
                commandId: 'locate-001',
                paragraphId: 'indesign-para-locate-story-0',
                baseHash: computeParagraphHash(paragraphText)
            });

            assert.equal(result.status, 'FOUND');
            assert.equal(selected, targetParagraph);
            assert.equal(targetParagraph.contents, paragraphText);
        });

        it('returns NOT_FOUND when a completed story scan finds no hash matches', () => {
            const paragraphText = 'This paragraph has changed.';
            const targetParagraph = env.createParagraph(paragraphText, 'locate-stale');
            (env.activeDocument as any).stories = {
                itemByID: (storyId: string) => storyId === 'locate-stale'
                    ? { paragraphs: [targetParagraph] }
                    : null
            };
            const app = env.getApp();
            let selected = false;
            app.select = () => { selected = true; };
            const sandbox = loadExtendScript(replacerScriptPath, { app });
            const replacer = new sandbox.SmartLinterAtomicReplacer({ appInstance: app });

            const result = replacer.locateParagraph({
                commandId: 'locate-stale-001',
                paragraphId: 'indesign-para-locate-stale-0',
                baseHash: computeParagraphHash('Original paragraph text.')
            });

            assert.equal(result.status, 'NOT_FOUND');
            assert.equal(selected, false);
            assert.equal(targetParagraph.contents, paragraphText);
        });

        it('returns AMBIGUOUS when a story scan finds multiple hash matches', () => {
            const paragraphText = 'Duplicate paragraph text.';
            const firstParagraph = env.createParagraph(paragraphText, 'locate-ambiguous');
            const secondParagraph = env.createParagraph(paragraphText, 'locate-ambiguous');
            (env.activeDocument as any).stories = {
                itemByID: (storyId: string) => storyId === 'locate-ambiguous'
                    ? { paragraphs: [firstParagraph, secondParagraph] }
                    : null
            };
            const app = env.getApp();
            let selected = false;
            app.select = () => { selected = true; };
            const sandbox = loadExtendScript(replacerScriptPath, { app });
            const replacer = new sandbox.SmartLinterAtomicReplacer({ appInstance: app });

            const result = replacer.locateParagraph({
                commandId: 'locate-ambiguous-001',
                paragraphId: 'indesign-para-locate-ambiguous-99',
                baseHash: computeParagraphHash(paragraphText)
            });

            assert.equal(result.status, 'AMBIGUOUS');
            assert.equal(selected, false);
        });

        it('returns SELECTION_FAILED when a located paragraph cannot be selected', () => {
            const paragraphText = 'Selection failure paragraph.';
            const targetParagraph = env.createParagraph(paragraphText, 'locate-selection-failure');
            (env.activeDocument as any).stories = {
                itemByID: (storyId: string) => storyId === 'locate-selection-failure'
                    ? { paragraphs: [targetParagraph] }
                    : null
            };
            const app = env.getApp();
            app.select = () => { throw new Error('Selection is unavailable'); };
            const sandbox = loadExtendScript(replacerScriptPath, { app });
            const replacer = new sandbox.SmartLinterAtomicReplacer({ appInstance: app });

            const result = replacer.locateParagraph({
                commandId: 'locate-selection-failure-001',
                paragraphId: 'indesign-para-locate-selection-failure-0',
                baseHash: computeParagraphHash(paragraphText)
            });

            assert.equal(result.status, 'SELECTION_FAILED');
            assert.equal(targetParagraph.contents, paragraphText);
        });

        it('gets a live snapshot at the indexed paragraph even when its hash has changed, without selecting or activating', () => {
            const currentText = 'Current paragraph text after user edits.';
            const targetParagraph = env.createParagraph(currentText, 'live-snapshot-index');
            (env.activeDocument as any).stories = {
                itemByID: (storyId: string) => storyId === 'live-snapshot-index'
                    ? { paragraphs: [targetParagraph] }
                    : null
            };
            const app = env.getApp();
            app.select = () => { throw new Error('select must not be called'); };
            (env.activeDocument as any).windows = [{ activate: () => { throw new Error('activate must not be called'); } }];
            const sandbox = loadExtendScript(replacerScriptPath, { app });
            const replacer = new sandbox.SmartLinterAtomicReplacer({ appInstance: app });

            const result = replacer.getLiveParagraphSnapshot({
                commandId: 'live-snapshot-index-001',
                paragraphId: 'indesign-para-live-snapshot-index-0',
                baseHash: computeParagraphHash('Original paragraph text.')
            });

            assert.equal(result.status, 'FOUND');
            assert.equal(result.currentText, currentText);
            assert.equal(result.currentHash, computeParagraphHash(currentText));
        });

        it('gets one moved paragraph by hash and reports no or duplicate matches without selecting', () => {
            const originalText = 'Original paragraph moved in this story.';
            const movedParagraph = env.createParagraph(originalText, 'live-snapshot-scan');
            const app = env.getApp();
            app.select = () => { throw new Error('select must not be called'); };
            (env.activeDocument as any).windows = [{ activate: () => { throw new Error('activate must not be called'); } }];
            const sandbox = loadExtendScript(replacerScriptPath, { app });
            const replacer = new sandbox.SmartLinterAtomicReplacer({ appInstance: app });

            (env.activeDocument as any).stories = {
                itemByID: (storyId: string) => storyId === 'live-snapshot-scan'
                    ? { paragraphs: [env.createParagraph('Replacement at the old index.', 'live-snapshot-scan'), movedParagraph] }
                    : null
            };
            const found = replacer.getLiveParagraphSnapshot({
                commandId: 'live-snapshot-scan-001',
                paragraphId: 'indesign-para-live-snapshot-scan-99',
                baseHash: computeParagraphHash(originalText)
            });
            assert.equal(found.status, 'FOUND');
            assert.equal(found.currentText, originalText);

            (env.activeDocument as any).stories.itemByID = () => ({ paragraphs: [env.createParagraph('No matching paragraph.', 'live-snapshot-scan')] });
            const notFound = replacer.getLiveParagraphSnapshot({ commandId: 'live-snapshot-scan-002', paragraphId: 'indesign-para-live-snapshot-scan-2', baseHash: computeParagraphHash(originalText) });
            assert.equal(notFound.status, 'NOT_FOUND');

            const duplicate = env.createParagraph(originalText, 'live-snapshot-scan');
            (env.activeDocument as any).stories.itemByID = () => ({ paragraphs: [env.createParagraph('Replacement at the old index.', 'live-snapshot-scan'), movedParagraph, duplicate] });
            const ambiguous = replacer.getLiveParagraphSnapshot({ commandId: 'live-snapshot-scan-003', paragraphId: 'indesign-para-live-snapshot-scan-99', baseHash: computeParagraphHash(originalText) });
            assert.equal(ambiguous.status, 'AMBIGUOUS');
        });

        it('gets batch live snapshots independently without selecting or activating', () => {
            const foundParagraph = env.createParagraph('Batch current paragraph.', 'batch-live');
            (env.activeDocument as any).stories = {
                itemByID: (storyId: string) => storyId === 'batch-live'
                    ? { paragraphs: [foundParagraph] }
                    : null
            };
            const app = env.getApp();
            app.select = () => { throw new Error('select must not be called'); };
            (env.activeDocument as any).windows = [{ activate: () => { throw new Error('activate must not be called'); } }];
            const sandbox = loadExtendScript(replacerScriptPath, { app });
            const replacer = new sandbox.SmartLinterAtomicReplacer({ appInstance: app });

            const result = replacer.getLiveParagraphSnapshots({
                commandId: 'batch-live-001',
                paragraphIds: [
                    'indesign-para-batch-live-0',
                    'indesign-para-batch-live-1',
                    'indesign-para-missing-story-0'
                ]
            });

            assert.equal(result.commandId, 'batch-live-001');
            assert.deepEqual(Array.from(result.results, (entry: any) => entry.status), ['FOUND', 'NOT_FOUND', 'ERROR']);
            assert.equal(result.results[0].currentText, 'Batch current paragraph.');
            assert.equal(result.results[0].currentHash, computeParagraphHash('Batch current paragraph.'));
        });

        it('rejects replacement before opening a transaction when the text frame is locked', () => {
            const text = 'This approved copy must remain unchanged.';
            const paragraph = env.getSelectedParagraph()!;
            paragraph.contents = text;
            paragraph.parentTextFrames = [{ isValid: true, locked: true, itemLayer: { locked: false } }];
            const sandbox = loadExtendScript(replacerScriptPath, { app: env.getApp() });
            const replacer = new sandbox.SmartLinterAtomicReplacer({ appInstance: env.getApp() });

            const result = replacer.execute({
                commandId: 'cmd-locked-frame-001',
                paragraphId: 'manual-test-target',
                baseHash: computeParagraphHash(text),
                expectedHash: computeParagraphHash('This approved copy changed.'),
                hunks: extractDiffHunks(text, 'This approved copy changed.')
            });

            assert.equal(result.status, 'FAILED');
            assert.match(result.message, /잠겨/);
            assert.equal(paragraph.contents, text);
            assert.equal(env.doScriptHistory.length, 0);
        });

        it('rejects replacement before opening a transaction when the frame layer is locked', () => {
            const text = 'Layer-protected legal notice.';
            const paragraph = env.getSelectedParagraph()!;
            paragraph.contents = text;
            paragraph.parentTextFrames = [{ isValid: true, locked: false, itemLayer: { locked: true } }];
            const sandbox = loadExtendScript(replacerScriptPath, { app: env.getApp() });
            const replacer = new sandbox.SmartLinterAtomicReplacer({ appInstance: env.getApp() });

            const result = replacer.execute({
                commandId: 'cmd-locked-layer-001',
                paragraphId: 'manual-test-target',
                baseHash: computeParagraphHash(text),
                expectedHash: computeParagraphHash('Layer-protected legal copy.'),
                hunks: extractDiffHunks(text, 'Layer-protected legal copy.')
            });

            assert.equal(result.status, 'FAILED');
            assert.match(result.message, /잠겨/);
            assert.equal(paragraph.contents, text);
            assert.equal(env.doScriptHistory.length, 0);
        });

        it('finds a moved paragraph by its unique baseHash and uses a numeric story id lookup', () => {
            const targetText = 'The original paragraph must still be found.';
            const replacementText = 'The original paragraph was found after insertion.';
            const insertedParagraph = env.createParagraph('A new paragraph was inserted before it.', '700');
            const targetParagraph = env.createParagraph(targetText, '700');
            const itemByIDArguments: unknown[] = [];

            (env.activeDocument as any).stories = {
                itemByID: (storyId: unknown) => {
                    itemByIDArguments.push(storyId);
                    return storyId === 700 ? { paragraphs: [insertedParagraph, targetParagraph] } : null;
                }
            };

            const sandbox = loadExtendScript(replacerScriptPath, { app: env.getApp() });
            const replacer = new sandbox.SmartLinterAtomicReplacer({ appInstance: env.getApp() });
            const result = replacer.execute({
                commandId: 'cmd-moved-paragraph-001',
                paragraphId: 'indesign-para-700-0',
                baseHash: computeParagraphHash(targetText),
                expectedHash: computeParagraphHash(replacementText),
                hunks: extractDiffHunks(targetText, replacementText)
            });

            assert.equal(result.status, 'SUCCESS');
            assert.deepEqual(itemByIDArguments, [700]);
            assert.equal(insertedParagraph.contents, 'A new paragraph was inserted before it.');
            assert.equal(targetParagraph.contents, replacementText);
        });

        it('fails safely when the original paragraph was deleted from its Story', () => {
            const deletedText = 'This paragraph was deleted.';
            const untouchedParagraph = env.createParagraph('A remaining paragraph must not change.', '701');
            const otherParagraph = env.createParagraph('Another remaining paragraph must not change.', '701');
            (env.activeDocument as any).stories = {
                itemByID: (storyId: unknown) => storyId === 701
                    ? { paragraphs: [untouchedParagraph, otherParagraph] }
                    : null
            };

            const sandbox = loadExtendScript(replacerScriptPath, { app: env.getApp() });
            const replacer = new sandbox.SmartLinterAtomicReplacer({ appInstance: env.getApp() });
            const result = replacer.execute({
                commandId: 'cmd-deleted-paragraph-002',
                paragraphId: 'indesign-para-701-0',
                baseHash: computeParagraphHash(deletedText),
                expectedHash: computeParagraphHash('This paragraph would change.'),
                hunks: [{ start: 0, end: 4, oldText: 'This', newText: 'That' }]
            });

            assert.equal(result.status, 'FAILED');
            assert.equal(untouchedParagraph.contents, 'A remaining paragraph must not change.');
            assert.equal(otherParagraph.contents, 'Another remaining paragraph must not change.');
        });

        it('fails safely when multiple Story paragraphs match the baseHash', () => {
            const duplicateText = 'Duplicate paragraph text.';
            const currentIndexParagraph = env.createParagraph('The old index now identifies another paragraph.', '702');
            const firstDuplicate = env.createParagraph(duplicateText, '702');
            const secondDuplicate = env.createParagraph(duplicateText, '702');
            (env.activeDocument as any).stories = {
                itemByID: (storyId: unknown) => storyId === 702
                    ? { paragraphs: [currentIndexParagraph, firstDuplicate, secondDuplicate] }
                    : null
            };

            const sandbox = loadExtendScript(replacerScriptPath, { app: env.getApp() });
            const replacer = new sandbox.SmartLinterAtomicReplacer({ appInstance: env.getApp() });
            const result = replacer.execute({
                commandId: 'cmd-ambiguous-paragraph-003',
                paragraphId: 'indesign-para-702-0',
                baseHash: computeParagraphHash(duplicateText),
                expectedHash: computeParagraphHash('Changed duplicate paragraph text.'),
                hunks: [{ start: 0, end: 9, oldText: 'Duplicate', newText: 'Changed' }]
            });

            assert.equal(result.status, 'FAILED');
            assert.equal(currentIndexParagraph.contents, 'The old index now identifies another paragraph.');
            assert.equal(firstDuplicate.contents, duplicateText);
            assert.equal(secondDuplicate.contents, duplicateText);
        });
    });

    // =========================================================================
    // 2. Acceptance Criterion (2): Multi-Hunk Reverse-Order Replacement (SUCCESS)
    // =========================================================================
    describe('Criterion (2): Multi-Hunk Reverse-Order Replacement in app.doScript (SUCCESS)', () => {
        let env: MockInDesignEnvironment;

        beforeEach(() => {
            env = new MockInDesignEnvironment(
                'The quick brown fox jumps over the lazy dog in the sunny park.',
                'Magazine_Editorial.indd'
            );
        });

        it('should execute 3 expanding hunks in reverse order inside doScript with 0 drift errors', () => {
            const initialText = 'The quick brown fox jumps over the lazy dog in the sunny park.';
            const targetText = 'The quick dark reddish-brown fox jumps over the extremely sleepy dog in the bright park.';

            const hunks = extractDiffHunks(initialText, targetText);
            assert.equal(hunks.length, 3);

            const baseHash = computeParagraphHash(initialText);
            const expectedHash = computeParagraphHash(targetText);

            const sandbox = loadExtendScript(replacerScriptPath, { app: env.getApp() });
            const replacer = new sandbox.SmartLinterAtomicReplacer({
                appInstance: env.getApp()
            });

            const command: ReplacementCommand = {
                commandId: 'cmd-indesign-multi-002',
                paragraphId: 'indesign-para-2',
                baseHash,
                expectedHash,
                hunks
            };

            const result: ReplacementResult = replacer.execute(command);

            assert.equal(isReplacementResult(result), true);
            assert.equal(result.commandId, 'cmd-indesign-multi-002');
            assert.equal(result.status, 'SUCCESS');
            assert.equal(result.currentHash, expectedHash);

            // Verify final InDesign paragraph contents
            const selectedPara = env.getSelectedParagraph();
            assert.ok(selectedPara);
            assert.equal(selectedPara!.contents, targetText);

            // Verify doScript was called with UndoModes.ENTIRE_SCRIPT
            assert.ok(env.doScriptHistory.length >= 1);
            const lastDoScript = env.doScriptHistory[env.doScriptHistory.length - 1];
            assert.equal(lastDoScript.undoMode, MockUndoModes.ENTIRE_SCRIPT);
            assert.equal(lastDoScript.success, true);
            assert.equal(lastDoScript.rolledBack, false);
        });

        it('should normalize plural Characters.contents arrays before validating and write through Text.contents', () => {
            const initialText = 'Replace the old phrase.';
            const targetText = 'Replace the new phrase.';
            const env = new MockInDesignEnvironment(initialText);
            const paragraph = env.getSelectedParagraph()!;
            const range = paragraph.characters!.itemByRange(12, 14);

            // InDesign ExtendScript returns an array from a plural Characters specifier.
            assert.deepEqual(range.contents, ['old']);

            const sandbox = loadExtendScript(replacerScriptPath, { app: env.getApp() });
            const replacer = new sandbox.SmartLinterAtomicReplacer({ appInstance: env.getApp() });
            const result = replacer.execute({
                commandId: 'cmd-plural-contents-002a',
                paragraphId: 'indesign-para-2a',
                baseHash: computeParagraphHash(initialText),
                expectedHash: computeParagraphHash(targetText),
                hunks: [{ start: 12, end: 15, oldText: 'old', newText: 'new' }]
            });

            assert.equal(result.status, 'SUCCESS');
            assert.equal(paragraph.contents, targetText);
        });

        it('should handle pure insertions and deletions in InDesign paragraph', () => {
            const initialText = 'Start middle finish.';
            const targetText = 'Start inserted middle finish.'; // pure insertion
            env.setSelectionText(initialText);

            const hunks = extractDiffHunks(initialText, targetText);
            const baseHash = computeParagraphHash(initialText);
            const expectedHash = computeParagraphHash(targetText);

            const sandbox = loadExtendScript(replacerScriptPath, { app: env.getApp() });
            const replacer = new sandbox.SmartLinterAtomicReplacer({ appInstance: env.getApp() });

            const command: ReplacementCommand = {
                commandId: 'cmd-insert-003',
                paragraphId: 'indesign-para-3',
                baseHash,
                expectedHash,
                hunks
            };

            const result = replacer.execute(command);
            assert.equal(result.status, 'SUCCESS');
            assert.equal(env.getSelectedParagraph()?.contents, targetText);
        });
    });

    // =========================================================================
    // 3. Acceptance Criterion (3): UndoModes.ENTIRE_SCRIPT Atomic Rollback (ROLLED_BACK)
    // =========================================================================
    describe('Criterion (3): Exception Handling & UndoModes.ENTIRE_SCRIPT Atomic Rollback (ROLLED_BACK)', () => {
        let env: MockInDesignEnvironment;

        beforeEach(() => {
            env = new MockInDesignEnvironment(
                'The quick brown fox jumps over the lazy dog in the sunny park.',
                'Magazine_Editorial.indd'
            );
        });

        it('should perform 100% automatic atomic rollback on exception during replacement', () => {
            const initialText = 'The quick brown fox jumps over the lazy dog in the sunny park.';
            const targetText = 'The quick dark reddish-brown fox jumps over the extremely sleepy dog in the bright park.';

            const hunks = extractDiffHunks(initialText, targetText);
            const baseHash = computeParagraphHash(initialText);
            const expectedHash = computeParagraphHash(targetText);

            const sandbox = loadExtendScript(replacerScriptPath, { app: env.getApp() });
            const replacer = new sandbox.SmartLinterAtomicReplacer({
                appInstance: env.getApp()
            });

            const command: ReplacementCommand = {
                commandId: 'cmd-indesign-rollback-004',
                paragraphId: 'indesign-para-4',
                baseHash,
                expectedHash,
                hunks
            };

            // Inject simulated error at reverse hunk index #2 (the first hunk 'brown' in reverse execution order)
            const result: ReplacementResult = replacer.execute(command, {
                simulateErrorAtHunk: 2
            });

            assert.equal(isReplacementResult(result), true);
            assert.equal(result.commandId, 'cmd-indesign-rollback-004');
            assert.equal(result.status, 'ROLLED_BACK');
            assert.equal(result.currentHash, baseHash);
            assert.ok(result.message && result.message.includes('InDesign native UndoModes.ENTIRE_SCRIPT'));

            // Document must be restored 100% to initial state by doScript atomic undo
            const selectedPara = env.getSelectedParagraph();
            assert.ok(selectedPara);
            assert.equal(selectedPara!.contents, initialText);

            // Verify doScript record
            const lastDoScript = env.doScriptHistory[env.doScriptHistory.length - 1];
            assert.equal(lastDoScript.success, false);
            assert.equal(lastDoScript.rolledBack, true);
        });
    });

    // =========================================================================
    // 4. Acceptance Criterion (4): Style & Hyperlink Preservation (0 Damages)
    // =========================================================================
    describe('Criterion (4): Paragraph Style, Character Style & Hyperlink Preservation', () => {
        it('should preserve applied Paragraph Style, Character Styles, and Hyperlinks without damage', () => {
            const initialText = 'According to SmartLinter specs the native format must be preserved perfectly.';
            const targetText = 'According to SmartLinter specifications the native format must be maintained perfectly.';

            const env = new MockInDesignEnvironment();
            const para = env.setSelectionText(
                initialText,
                'Catalog_2026.indd',
                'story-999',
                {
                    paragraphStyle: 'Headline_Level_2',
                    characterRuns: [
                        { start: 0, end: 13, characterStyle: '[None]' },
                        { start: 13, end: 30, characterStyle: 'CodeSpan' },
                        { start: 30, end: initialText.length, characterStyle: 'ItalicEmphasis' }
                    ],
                    hyperlinks: [
                        { sourceText: 'SmartLinter specs', destinationURL: 'https://smartlinter.dev' }
                    ]
                }
            );

            assert.equal(para.appliedParagraphStyle?.name, 'Headline_Level_2');

            const hunks = extractDiffHunks(initialText, targetText);
            const baseHash = computeParagraphHash(initialText);
            const expectedHash = computeParagraphHash(targetText);

            const sandbox = loadExtendScript(replacerScriptPath, { app: env.getApp() });
            const replacer = new sandbox.SmartLinterAtomicReplacer({
                appInstance: env.getApp()
            });

            const command: ReplacementCommand = {
                commandId: 'cmd-styles-005',
                paragraphId: 'indesign-para-5',
                baseHash,
                expectedHash,
                hunks
            };

            const result = replacer.execute(command);
            assert.equal(result.status, 'SUCCESS');
            assert.equal(para.contents, targetText);

            // Paragraph Style must remain intact
            assert.equal(para.appliedParagraphStyle?.name, 'Headline_Level_2');

            // Hyperlinks must remain intact
            assert.equal(para.hyperlinks?.length, 1);
            assert.equal(para.hyperlinks![0].destinationURL, 'https://smartlinter.dev');
        });

        it('should preserve inline footnote tags and hyperlink markdown elements across multi-hunk replacements', () => {
            const markdownSource =
                'According to [SmartLinter specs](https://smartlinter.dev) the native format[^1] must be preserved perfectly.';

            const originalParagraph = SpecialElementsParagraph.fromMarkdown(markdownSource);
            const initialPlainText = originalParagraph.getPlainText();

            const targetMarkdown =
                'According to [SmartLinter specifications](https://smartlinter.dev) the native format[^1] must be maintained perfectly.';
            const targetParagraph = SpecialElementsParagraph.fromMarkdown(targetMarkdown);
            const targetPlainText = targetParagraph.getPlainText();

            const hunks = extractDiffHunks(initialPlainText, targetPlainText);
            assert.equal(hunks.length, 2);

            const env = new MockInDesignEnvironment(initialPlainText);
            const sandbox = loadExtendScript(replacerScriptPath, { app: env.getApp() });
            const replacer = new sandbox.SmartLinterAtomicReplacer({ appInstance: env.getApp() });

            const command: ReplacementCommand = {
                commandId: 'cmd-rich-indesign-006',
                paragraphId: 'indesign-para-6',
                baseHash: computeParagraphHash(initialPlainText),
                expectedHash: computeParagraphHash(targetPlainText),
                hunks
            };

            const result = replacer.execute(command);
            assert.equal(result.status, 'SUCCESS');
            assert.equal(env.getSelectedParagraph()?.contents, targetPlainText);

            // Verify with SpecialElementsParagraph
            const richClone = originalParagraph.clone();
            const specialResult = richClone.applyHunks(hunks, true);
            assert.equal(specialResult.isSuccess, true);
            assert.equal(richClone.verifySpecialElementsPreserved(originalParagraph), true);
        });
    });

    // =========================================================================
    // 5. Acceptance Criterion (5): Bridge Server Dispatch & Daemon Integration
    // =========================================================================
    describe('Criterion (5): Bridge Socket Result Dispatch & SmartLinterDaemon Integration', () => {
        it('should transmit ReplacementResult back to bridge socket after replacement', () => {
            const initialText = 'Paragraph for bridge dispatch test in InDesign.';
            const targetText = 'Paragraph for bridge dispatch verified in InDesign.';
            const hunks = extractDiffHunks(initialText, targetText);

            const env = new MockInDesignEnvironment(initialText);
            const dispatchedResults: ReplacementResult[] = [];

            const mockBridgeSocket = {
                status: 'CONNECTED',
                sendReplacementResult: (res: ReplacementResult) => {
                    dispatchedResults.push(res);
                    return true;
                }
            };

            const sandbox = loadExtendScript(replacerScriptPath, { app: env.getApp() });
            const replacer = new sandbox.SmartLinterAtomicReplacer({
                appInstance: env.getApp(),
                bridgeSocket: mockBridgeSocket
            });

            const command: ReplacementCommand = {
                commandId: 'cmd-bridge-dispatch-007',
                paragraphId: 'indesign-para-7',
                baseHash: computeParagraphHash(initialText),
                expectedHash: computeParagraphHash(targetText),
                hunks
            };

            const result = replacer.execute(command);
            assert.equal(result.status, 'SUCCESS');
            assert.equal(dispatchedResults.length, 1);
            assert.deepEqual(dispatchedResults[0], result);
        });

        it('SmartLinterDaemon should execute atomic replacements and route results seamlessly', () => {
            const initialText = 'SmartLinterDaemon integrated replacement paragraph.';
            const targetText = 'SmartLinterDaemon integrated replacement verified.';
            const hunks = extractDiffHunks(initialText, targetText);

            const env = new MockInDesignEnvironment(initialText);
            const dispatchedResults: ReplacementResult[] = [];

            const mockBridgeSocket = {
                status: 'CONNECTED',
                handshake: () => true,
                disconnect: () => {},
                sendReplacementResult: (res: ReplacementResult) => {
                    dispatchedResults.push(res);
                    return true;
                }
            };

            const sandbox = loadExtendScript(daemonScriptPath, { app: env.getApp() });
            const daemon = new sandbox.SmartLinterDaemon({
                appInstance: env.getApp(),
                bridgeSocket: mockBridgeSocket
            });

            daemon.start();

            const command: ReplacementCommand = {
                commandId: 'cmd-daemon-008',
                paragraphId: 'indesign-para-8',
                baseHash: computeParagraphHash(initialText),
                expectedHash: computeParagraphHash(targetText),
                hunks
            };

            const result = daemon.executeReplacement(command);
            assert.equal(result.status, 'SUCCESS');
            assert.equal(env.getSelectedParagraph()?.contents, targetText);
            assert.equal(dispatchedResults.length, 1);
            assert.equal(dispatchedResults[0].commandId, 'cmd-daemon-008');

            daemon.stop();
        });
    });

    // =========================================================================
    // 6. ExtendScript Standalone JSX Test Runner
    // =========================================================================
    describe('ExtendScript Standalone JSX Test Runner (test_atomic_replacement.jsx)', () => {
        it('should execute test_atomic_replacement.jsx successfully with 100% pass rate', () => {
            assert.equal(fs.existsSync(testScriptPath), true, 'test_atomic_replacement.jsx must exist');
            const sandbox = loadExtendScript(testScriptPath);

            assert.ok(sandbox.module.exports.runTests, 'runTests function must be exported');
            const testResults = sandbox.module.exports.runTests();

            assert.ok(testResults.total >= 4, 'Must execute at least 4 test cases');
            assert.equal(testResults.failed, 0, 'Zero test failures allowed');
            assert.equal(testResults.passed, testResults.total, 'All test cases must pass');
        });
    });
});
