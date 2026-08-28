/**
 * Unit & Integration Test Suite for Task 8: MS Word Plugin
 * (Lossless Reverse Replacement, Transaction Journaling, Pre-rollback Hash Check & Compensating Rollback)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    WordReplacementExecutor,
    type WordParagraphAdapter,
} from '../src/replacement_executor.ts';
import { CompensatingJournal } from '../src/compensating_journal.ts';
import { HashVerifier } from '../src/hash_verifier.ts';
import { WordBridgeClient } from '../src/bridge_client.ts';

import { computeParagraphHash, verifyParagraphHash } from '../../../shared/engine/hash_util.ts';
import { extractDiffHunks, sortHunksReverse } from '../../../shared/engine/diff_engine.ts';
import { SpecialElementsParagraph } from '../../../shared/engine/special_elements.ts';
import {
    type ReplacementCommand,
    type ReplacementResult,
    type TextHunk,
    isReplacementResult,
} from '../../../shared/protocol/types.ts';

/**
 * In-memory Mock Word Paragraph Adapter simulating Word DOM / Range behavior.
 */
class MockWordParagraphAdapter implements WordParagraphAdapter {
    public text: string;
    public applyCalls: Array<{ start: number; end: number; oldText: string; newText: string }> = [];

    constructor(initialText: string) {
        this.text = initialText;
    }

    public async getText(): Promise<string> {
        return this.text;
    }

    public async applyHunk(
        startOffset: number,
        endOffset: number,
        oldText: string,
        newText: string
    ): Promise<void> {
        const slice = this.text.substring(startOffset, endOffset);
        if (slice !== oldText) {
            throw new Error(
                `Word Range mismatch: expected ${JSON.stringify(oldText)} at [${startOffset}:${endOffset}], found ${JSON.stringify(slice)}`
            );
        }
        this.applyCalls.push({ start: startOffset, end: endOffset, oldText, newText });
        this.text = this.text.substring(0, startOffset) + newText + this.text.substring(endOffset);
    }
}

/**
 * Mock Word Rich Adapter wrapping SpecialElementsParagraph to verify formatting run preservation.
 */
class MockWordRichAdapter implements WordParagraphAdapter {
    public richDoc: SpecialElementsParagraph;

    constructor(markdown: string) {
        this.richDoc = SpecialElementsParagraph.fromMarkdown(markdown);
    }

    public async getText(): Promise<string> {
        return this.richDoc.getPlainText();
    }

    public async applyHunk(
        startOffset: number,
        endOffset: number,
        oldText: string,
        newText: string
    ): Promise<void> {
        const hunk: TextHunk = { start: startOffset, end: endOffset, oldText, newText };
        const res = this.richDoc.applyHunks([hunk], false);
        if (res.driftErrors > 0) {
            throw new Error(`Rich run mismatch during hunk application: ${JSON.stringify(res.logs)}`);
        }
    }
}

describe('Task 8: MS Word Lossless Reverse Replacement & Compensating Transaction Rollback', () => {
    // =========================================================================
    // 1. CompensatingJournal & HashVerifier Unit Tests
    // =========================================================================
    describe('CompensatingJournal & HashVerifier Units', () => {
        it('CompensatingJournal should record steps and yield reverse LIFO rollback actions', () => {
            const initialText = 'The quick brown fox jumps over the lazy dog in the sunny park.';
            const initialHash = computeParagraphHash(initialText);
            const journal = new CompensatingJournal(initialText, initialHash);

            assert.equal(journal.size(), 0);
            assert.equal(journal.getInitialSnapshot(), initialText);
            assert.equal(journal.getInitialHash(), initialHash);
            assert.equal(journal.getLatestIntermediateHash(), null);

            // Record Step 1
            journal.record({
                stepIndex: 0,
                hunkIndex: 2,
                startOffset: 51,
                endOffset: 57,
                originalStartOffset: 51,
                originalEndOffset: 56,
                originalText: 'sunny',
                newText: 'bright',
                intermediateText: 'The quick brown fox jumps over the lazy dog in the bright park.',
                intermediateHash: computeParagraphHash(
                    'The quick brown fox jumps over the lazy dog in the bright park.'
                ),
            });

            // Record Step 2
            journal.record({
                stepIndex: 1,
                hunkIndex: 1,
                startOffset: 35,
                endOffset: 51,
                originalStartOffset: 35,
                originalEndOffset: 39,
                originalText: 'lazy',
                newText: 'extremely sleepy',
                intermediateText:
                    'The quick brown fox jumps over the extremely sleepy dog in the bright park.',
                intermediateHash: computeParagraphHash(
                    'The quick brown fox jumps over the extremely sleepy dog in the bright park.'
                ),
            });

            assert.equal(journal.size(), 2);
            assert.ok(journal.getLatestIntermediateHash());

            // Check rollback actions (should be LIFO reverse order: Step 1 then Step 0)
            const rollbackActions = journal.getRollbackActions();
            assert.equal(rollbackActions.length, 2);
            assert.equal(rollbackActions[0].stepIndex, 1);
            assert.equal(rollbackActions[0].targetTextToRevert, 'extremely sleepy');
            assert.equal(rollbackActions[0].revertToOriginalText, 'lazy');

            assert.equal(rollbackActions[1].stepIndex, 0);
            assert.equal(rollbackActions[1].targetTextToRevert, 'bright');
            assert.equal(rollbackActions[1].revertToOriginalText, 'sunny');
        });

        it('HashVerifier should verify baseHash, expectedHash, and preRollback integrity', () => {
            const textA = 'Sample paragraph text.';
            const hashA = computeParagraphHash(textA);
            const textB = 'Modified paragraph text.';
            const hashB = computeParagraphHash(textB);

            assert.equal(HashVerifier.verifyBaseHash(textA, hashA), true);
            assert.equal(HashVerifier.verifyBaseHash(textB, hashA), false);

            assert.equal(HashVerifier.verifyExpectedHash(textA, hashA), true);
            assert.equal(HashVerifier.verifyExpectedHash(textB, hashA), false);

            // Pre-rollback check with matching hash
            const intactCheck = HashVerifier.checkPreRollbackIntegrity(textA, hashA);
            assert.equal(intactCheck.isIntact, true);
            assert.equal(intactCheck.actualHash, hashA);

            // Pre-rollback check with corrupted/modified hash
            const corruptedCheck = HashVerifier.checkPreRollbackIntegrity(textB, hashA);
            assert.equal(corruptedCheck.isIntact, false);
            assert.equal(corruptedCheck.actualHash, hashB);
            assert.ok(corruptedCheck.reason.includes('External edit detected'));
        });
    });

    // =========================================================================
    // 2. Acceptance Criterion (1): Stale Paragraph Rejection (STALE_REJECTED)
    // =========================================================================
    describe('Criterion (1): Stale Hash Verification & Immediate Rejection (STALE_REJECTED)', () => {
        it('should reject replacement when current Word paragraph hash does not match command baseHash', async () => {
            const originalDocText = 'Original paragraph in Word that was recently typed.';
            const outdatedBaseText = 'Old paragraph text before user edit.';
            const staleBaseHash = computeParagraphHash(outdatedBaseText);

            const adapter = new MockWordParagraphAdapter(originalDocText);
            const executor = new WordReplacementExecutor();

            const command: ReplacementCommand = {
                commandId: 'cmd-stale-001',
                paragraphId: 'word-p-1',
                baseHash: staleBaseHash,
                expectedHash: computeParagraphHash('Some target text'),
                hunks: [
                    {
                        start: 0,
                        end: 3,
                        oldText: 'Old',
                        newText: 'New',
                    },
                ],
            };

            const result = await executor.execute(command, { adapter });

            assert.equal(isReplacementResult(result), true);
            assert.equal(result.commandId, 'cmd-stale-001');
            assert.equal(result.status, 'STALE_REJECTED');
            assert.equal(result.currentHash, computeParagraphHash(originalDocText));
            assert.ok(result.message && result.message.includes('Paragraph hash mismatch'));

            // Document text must remain 100% untouched
            assert.equal(await adapter.getText(), originalDocText);
            assert.equal(adapter.applyCalls.length, 0);
        });
    });

    // =========================================================================
    // 3. Acceptance Criterion (2): Multi-Hunk Reverse Replacement (SUCCESS)
    // =========================================================================
    describe('Criterion (2): Multi-Hunk Reverse-Order Replacement (SUCCESS)', () => {
        it('should execute 3 expanding hunks in reverse order with 0 drift errors', async () => {
            const initialText = 'The quick brown fox jumps over the lazy dog in the sunny park.';
            const targetText =
                'The quick dark reddish-brown fox jumps over the extremely sleepy dog in the bright park.';

            const hunks = extractDiffHunks(initialText, targetText);
            assert.equal(hunks.length, 3);

            const baseHash = computeParagraphHash(initialText);
            const expectedHash = computeParagraphHash(targetText);

            const adapter = new MockWordParagraphAdapter(initialText);
            const executor = new WordReplacementExecutor();

            const command: ReplacementCommand = {
                commandId: 'cmd-multi-002',
                paragraphId: 'word-p-2',
                baseHash,
                expectedHash,
                hunks,
            };

            const result = await executor.execute(command, { adapter });

            assert.equal(result.status, 'SUCCESS');
            assert.equal(result.commandId, 'cmd-multi-002');
            assert.equal(result.currentHash, expectedHash);

            const finalText = await adapter.getText();
            assert.equal(finalText, targetText);

            // Verify reverse order execution sequence (high offset -> low offset)
            assert.equal(adapter.applyCalls.length, 3);
            assert.equal(adapter.applyCalls[0].oldText, 'sunny'); // offset 51
            assert.equal(adapter.applyCalls[1].oldText, 'lazy'); // offset 35
            assert.equal(adapter.applyCalls[2].oldText, 'brown'); // offset 10
        });
    });

    // =========================================================================
    // 4. Acceptance Criterion (3) & (4): Compensating Transaction Rollback (ROLLED_BACK)
    // =========================================================================
    describe('Criterion (3) & (4): Error Recovery & 100% Compensating Rollback (ROLLED_BACK)', () => {
        it('should restore 100% original paragraph state via reverse journal when error occurs at Hunk #2', async () => {
            const initialText = 'The quick brown fox jumps over the lazy dog in the sunny park.';
            const targetText =
                'The quick dark reddish-brown fox jumps over the extremely sleepy dog in the bright park.';

            const hunks = extractDiffHunks(initialText, targetText);
            const baseHash = computeParagraphHash(initialText);
            const expectedHash = computeParagraphHash(targetText);

            const adapter = new MockWordParagraphAdapter(initialText);
            const executor = new WordReplacementExecutor();

            const command: ReplacementCommand = {
                commandId: 'cmd-rollback-003',
                paragraphId: 'word-p-3',
                baseHash,
                expectedHash,
                hunks,
            };

            // In reverse order:
            // step 0: 'sunny' -> 'bright' (applied)
            // step 1: 'lazy' -> 'extremely sleepy' (applied)
            // step 2: 'brown' -> 'dark reddish-brown' (simulated error injected)
            const result = await executor.execute(command, {
                adapter,
                simulateErrorAtHunk: 2,
            });

            assert.equal(result.status, 'ROLLED_BACK');
            assert.equal(result.commandId, 'cmd-rollback-003');
            assert.equal(result.currentHash, baseHash);
            assert.ok(result.message && result.message.includes('100% original paragraph state restored'));

            // Document must be restored 100% to initial snapshot
            const restoredText = await adapter.getText();
            assert.equal(restoredText, initialText);
            assert.equal(computeParagraphHash(restoredText), baseHash);

            // Total apply calls: 2 forward replacements + 2 compensating reverse replacements = 4
            assert.equal(adapter.applyCalls.length, 4);
            // Reverse compensation sequence: revert 'extremely sleepy' -> 'lazy', then 'bright' -> 'sunny'
            assert.equal(adapter.applyCalls[2].oldText, 'extremely sleepy');
            assert.equal(adapter.applyCalls[2].newText, 'lazy');
            assert.equal(adapter.applyCalls[3].oldText, 'bright');
            assert.equal(adapter.applyCalls[3].newText, 'sunny');
        });
    });

    // =========================================================================
    // 5. Acceptance Criterion (4): Pre-rollback External Edit Collision (ROLLBACK_ABORTED)
    // =========================================================================
    // =========================================================================
    // 5. Acceptance Criterion (4): Pre-rollback External Edit Collision (ROLLBACK_ABORTED)
    // =========================================================================
    describe('Criterion (4): Pre-rollback Hash Check & External Edit Guard (ROLLBACK_ABORTED)', () => {
        it('should safely ABORT rollback when user typing modifies paragraph before rollback execution', async () => {
            const initialText = 'Alpha beta gamma delta epsilon.';
            const targetText = 'FIRST_ITEM beta THIRD_ITEM delta FIFTH_ITEM.';
            const hunks = extractDiffHunks(initialText, targetText);

            const baseHash = computeParagraphHash(initialText);
            const expectedHash = computeParagraphHash(targetText);

            const adapter = new MockWordParagraphAdapter(initialText);
            const executor = new WordReplacementExecutor();

            const command: ReplacementCommand = {
                commandId: 'cmd-collision-004',
                paragraphId: 'word-p-4',
                baseHash,
                expectedHash,
                hunks,
            };

            // Error injected at step 2 (the 3rd hunk in reverse order).
            // Right before pre-rollback check, simulate user typing 'USER_TYPED_PREFIX ' at start.
            const result = await executor.execute(command, {
                adapter,
                simulateErrorAtHunk: 2,
                simulateExternalEditBeforeRollback: 'USER_TYPED_PREFIX ',
            });

            // Pre-rollback Hash Check must detect user edit and safely ABORT rollback
            assert.equal(result.status, 'ROLLBACK_ABORTED');
            assert.equal(result.commandId, 'cmd-collision-004');
            assert.ok(result.message && result.message.includes('User editing or undo detected'));

            const currentDocText = await adapter.getText();
            // Document text must contain user typing and must NOT be blindly corrupted
            assert.ok(currentDocText.startsWith('USER_TYPED_PREFIX '));
            assert.equal(result.currentHash, computeParagraphHash(currentDocText));
        });
    });

    // =========================================================================
    // 6. Acceptance Criterion (5): Inline Footnotes & Links Formatting Run Preservation
    // =========================================================================
    describe('Criterion (5): Inline Footnotes & Hyperlinks Preservation', () => {
        it('should preserve inline footnote tags [^1] and hyperlink URLs [text](url) across multi-hunk replacements', async () => {
            const markdownSource =
                'According to [SmartLinter specs](https://smartlinter.dev) the native format[^1] must be preserved perfectly.';

            const originalParagraph = SpecialElementsParagraph.fromMarkdown(markdownSource);
            const initialPlainText = originalParagraph.getPlainText();

            // Replacement hunks:
            // 1. specs -> specifications (inside hyperlink)
            // 2. preserved -> maintained (after footnote)
            const hunks = extractDiffHunks(
                initialPlainText,
                'According to SmartLinter specifications the native format[^1] must be maintained perfectly.'
            );

            assert.equal(hunks.length, 2);

            const adapter = new MockWordRichAdapter(markdownSource);
            const executor = new WordReplacementExecutor();

            const command: ReplacementCommand = {
                commandId: 'cmd-rich-005',
                paragraphId: 'word-p-5',
                baseHash: computeParagraphHash(initialPlainText),
                expectedHash: computeParagraphHash(
                    'According to SmartLinter specifications the native format[^1] must be maintained perfectly.'
                ),
                hunks,
            };

            const result = await executor.execute(command, { adapter });

            assert.equal(result.status, 'SUCCESS');

            // Verify that all footnotes and hyperlinks are 100% intact
            const finalRich = adapter.richDoc;
            assert.equal(finalRich.verifySpecialElementsPreserved(originalParagraph), true);

            const tags = finalRich.extractSpecialTags();
            assert.equal(tags.footnotes.length, 1);
            assert.equal(tags.footnotes[0].footnoteId, 1);
            assert.equal(tags.hyperlinks.length, 1);
            assert.equal(tags.hyperlinks[0].url, 'https://smartlinter.dev');
            assert.equal(tags.hyperlinks[0].text, 'SmartLinter specifications');
        });
    });

    // =========================================================================
    // 7. Bridge Client Dispatch & Office.js Simulation Integration
    // =========================================================================
    describe('Bridge Client Dispatch & Office.js Simulation Integration', () => {
        it('targets the command paragraph by paragraphId and baseHash, not the current selection', async () => {
            const targetText = 'Target paragraph with typo.';
            const selectedText = 'Unrelated selected paragraph.';
            const paragraphs = [selectedText, targetText];
            const makeParagraph = (index: number) => ({
                get text() { return paragraphs[index]; },
                getRange: (location: string) => {
                    assert.equal(location, 'Content');
                    return {
                        // Deliberately omit getSubstring to exercise the compatibility path.
                        insertText: (value: string, insertLocation: string) => {
                            assert.equal(insertLocation, 'Replace');
                            paragraphs[index] = value;
                        },
                    };
                },
            });
            const context = {
                document: {
                    // Deliberately points at the wrong paragraph: the default adapter must not use it.
                    getSelection: () => ({ paragraphs: { items: [makeParagraph(0)] } }),
                    body: { paragraphs: { items: [makeParagraph(0), makeParagraph(1)], load: () => {} } },
                },
                sync: async () => {},
            };
            const originalWord = (globalThis as any).Word;
            (globalThis as any).Word = { run: async (callback: (ctx: any) => Promise<any>) => callback(context) };
            try {
                const replacement = 'Target paragraph without typo.';
                const command: ReplacementCommand = {
                    commandId: 'cmd-targeted-default-adapter',
                    paragraphId: `word-para-${computeParagraphHash(targetText).slice(0, 12)}`,
                    baseHash: computeParagraphHash(targetText),
                    expectedHash: computeParagraphHash(replacement),
                    hunks: extractDiffHunks(targetText, replacement),
                };

                const result = await new WordReplacementExecutor().execute(command);
                assert.equal(result.status, 'SUCCESS');
                assert.equal(paragraphs[0], selectedText);
                assert.equal(paragraphs[1], replacement);
            } finally {
                (globalThis as any).Word = originalWord;
            }
        });

        it('should dispatch ReplacementResult to connected WordBridgeClient', async () => {
            const initialText = 'Clean sentence for bridge dispatch test.';
            const targetText = 'Clean sentence for bridge dispatch verified.';
            const hunks = extractDiffHunks(initialText, targetText);

            const dispatchedResults: ReplacementResult[] = [];
            const mockBridgeClient = new WordBridgeClient({ enableWebSocket: false });
            mockBridgeClient.sendReplacementResult = async (res: ReplacementResult) => {
                dispatchedResults.push(res);
                return true;
            };

            const adapter = new MockWordParagraphAdapter(initialText);
            const executor = new WordReplacementExecutor({ bridgeClient: mockBridgeClient });

            const command: ReplacementCommand = {
                commandId: 'cmd-bridge-006',
                paragraphId: 'word-p-6',
                baseHash: computeParagraphHash(initialText),
                expectedHash: computeParagraphHash(targetText),
                hunks,
            };

            const result = await executor.execute(command, { adapter });

            assert.equal(result.status, 'SUCCESS');
            assert.equal(dispatchedResults.length, 1);
            assert.deepEqual(dispatchedResults[0], result);
        });
    });
});
