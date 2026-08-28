/**
 * SmartLinter MS Word Replacement Executor
 *
 * Implements:
 * 1. Stale paragraph rejection via SHA-256 baseHash verification (STALE_REJECTED).
 * 2. Multi-Hunk reverse-order text replacement (high offset -> low offset) using Word Range API.
 * 3. Real-time transaction journaling via CompensatingJournal.
 * 4. Exception recovery with Pre-rollback Hash Check:
 *    - Intact document -> 100% compensating rollback to baseline (ROLLED_BACK).
 *    - External edit/typing detected -> Safe abort without forced rollback (ROLLBACK_ABORTED).
 * 5. Final hash verification against expectedHash (SUCCESS).
 */

import {
    type ReplacementCommand,
    type ReplacementResult,
    type TextHunk,
    isReplacementCommand,
} from '../../../shared/protocol/types.ts';
import { computeParagraphHash } from '../../../shared/engine/hash_util.ts';
import { sortHunksReverse, validateHunks } from '../../../shared/engine/diff_engine.ts';
import { CompensatingJournal } from './compensating_journal.ts';
import { HashVerifier } from './hash_verifier.ts';
import { WordBridgeClient } from './bridge_client.ts';

/**
 * Pluggable document/paragraph adapter interface for Word Range manipulation.
 * Enables execution in both native Office.js environment and mock/test harnesses.
 */
export interface WordParagraphAdapter {
    /** Reads the current paragraph raw text */
    getText: () => Promise<string> | string;
    /**
     * Replaces a specific character range within the paragraph.
     * @param startOffset 0-based character start offset
     * @param endOffset 0-based character end offset (exclusive)
     * @param oldText Expected current text slice in the range
     * @param newText Replacement text to insert
     */
    applyHunk: (
        startOffset: number,
        endOffset: number,
        oldText: string,
        newText: string
    ) => Promise<void> | void;
}

/**
 * Options for executing a replacement transaction.
 */
export interface ReplacementExecutionOptions {
    /** Custom adapter for document/paragraph manipulation */
    adapter?: WordParagraphAdapter;
    /** Custom Word.run runner */
    wordRunner?: (callback: (context: any) => Promise<any>) => Promise<any>;
    /** Connected Bridge client to automatically dispatch REPLACEMENT_RESULT */
    bridgeClient?: WordBridgeClient;
    /** Simulated error injection at specific hunk index (0-based in reverse execution order) */
    simulateErrorAtHunk?: number;
    /** Simulated external user modification injection triggered right before pre-rollback check */
    simulateExternalEditBeforeRollback?: string;
}

/**
 * Step-by-step diagnostic trace entry.
 */
export interface ExecutionStepTrace {
    step: number;
    hunkIndex: number;
    action: 'APPLY' | 'ROLLBACK' | 'PRE_ROLLBACK_CHECK' | 'ABORT';
    status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
    detail: string;
    textAfterStep: string;
}

export class WordReplacementExecutor {
    private readonly defaultWordRunner?: (callback: (context: any) => Promise<any>) => Promise<any>;
    private readonly defaultBridgeClient?: WordBridgeClient;

    constructor(config: {
        wordRunner?: (callback: (context: any) => Promise<any>) => Promise<any>;
        bridgeClient?: WordBridgeClient;
    } = {}) {
        this.defaultWordRunner = config.wordRunner;
        this.defaultBridgeClient = config.bridgeClient;
    }

    /**
     * Executes a ReplacementCommand on the target Word paragraph with full Stale detection,
     * reverse-order multi-hunk replacement, real-time journaling, and Pre-rollback Hash Check defense.
     */
    public async execute(
        command: ReplacementCommand,
        options: ReplacementExecutionOptions = {}
    ): Promise<ReplacementResult> {
        if (!isReplacementCommand(command)) {
            const errorResult: ReplacementResult = {
                commandId: command ? (command as any).commandId || 'unknown' : 'unknown',
                status: 'FAILED',
                currentHash: '',
                message: 'Invalid ReplacementCommand payload structure',
            };
            await this.dispatchResultIfNeeded(errorResult, options);
            return errorResult;
        }

        let adapter: WordParagraphAdapter;
        try {
            adapter = options.adapter || (await this.createDefaultAdapter(command, options));
        } catch (err) {
            const result: ReplacementResult = {
                commandId: command.commandId,
                status: 'FAILED',
                currentHash: '',
                message: `Failed to resolve target paragraph from Word: ${(err as Error).message}`,
            };
            await this.dispatchResultIfNeeded(result, options);
            return result;
        }

        // =========================================================================
        // Step 1: Read Current Paragraph & Perform Stale Base Hash Check
        // =========================================================================
        let currentText: string;
        try {
            currentText = await adapter.getText();
        } catch (err) {
            const result: ReplacementResult = {
                commandId: command.commandId,
                status: 'FAILED',
                currentHash: '',
                message: `Failed to read target paragraph from Word: ${(err as Error).message}`,
            };
            await this.dispatchResultIfNeeded(result, options);
            return result;
        }

        const currentHash = computeParagraphHash(currentText);
        const isBaseMatch = HashVerifier.verifyBaseHash(currentText, command.baseHash);

        if (!isBaseMatch) {
            const staleResult: ReplacementResult = {
                commandId: command.commandId,
                status: 'STALE_REJECTED',
                currentHash,
                message: `Paragraph hash mismatch: document was modified (expected base: ${command.baseHash.slice(0, 12)}..., current: ${currentHash.slice(0, 12)}...)`,
            };
            await this.dispatchResultIfNeeded(staleResult, options);
            return staleResult;
        }

        // =========================================================================
        // Step 2: Validate Hunks against Current Text
        // =========================================================================
        const validation = validateHunks(currentText, command.hunks);
        if (!validation.valid) {
            const failResult: ReplacementResult = {
                commandId: command.commandId,
                status: 'FAILED',
                currentHash,
                message: `Hunk validation failed: ${validation.errors.join('; ')}`,
            };
            await this.dispatchResultIfNeeded(failResult, options);
            return failResult;
        }

        // =========================================================================
        // Step 3: Sort Hunks in Reverse Order (High Offset -> Low Offset)
        // =========================================================================
        const sortedHunks = sortHunksReverse(command.hunks);
        const journal = new CompensatingJournal(currentText, currentHash);
        let liveText = currentText;

        // Map sorted hunks with their original indices
        const indexedHunks = sortedHunks.map((hunk) => {
            const originalIndex = command.hunks.findIndex(
                (orig) => orig.start === hunk.start && orig.end === hunk.end && orig.oldText === hunk.oldText
            );
            return {
                hunk,
                originalIndex: originalIndex >= 0 ? originalIndex : 0,
            };
        });

        // =========================================================================
        // Step 4: Execute Multi-Hunk Replacement with Real-Time Journaling
        // =========================================================================
        try {
            for (let stepIndex = 0; stepIndex < indexedHunks.length; stepIndex++) {
                const { hunk, originalIndex } = indexedHunks[stepIndex];

                // Simulated error injection for testing / verification
                if (options.simulateErrorAtHunk === stepIndex) {
                    throw new Error(
                        `Simulated Word runtime exception at step #${stepIndex} (${hunk.oldText} -> ${hunk.newText})`
                    );
                }

                // Apply hunk via adapter
                await adapter.applyHunk(hunk.start, hunk.end, hunk.oldText, hunk.newText);

                // Update live text model
                liveText = liveText.substring(0, hunk.start) + hunk.newText + liveText.substring(hunk.end);
                const stepHash = computeParagraphHash(liveText);

                // Record step into compensating journal in real-time
                journal.record({
                    stepIndex,
                    hunkIndex: originalIndex,
                    startOffset: hunk.start,
                    endOffset: hunk.start + hunk.newText.length,
                    originalStartOffset: hunk.start,
                    originalEndOffset: hunk.end,
                    originalText: hunk.oldText,
                    newText: hunk.newText,
                    intermediateText: liveText,
                    intermediateHash: stepHash,
                });
            }

            // =========================================================================
            // Step 5: Verify Final Text Hash
            // =========================================================================
            const postApplyText = await adapter.getText();
            const postApplyHash = computeParagraphHash(postApplyText);

            const successResult: ReplacementResult = {
                commandId: command.commandId,
                status: HashVerifier.verifyExpectedHash(postApplyText, command.expectedHash) ? 'SUCCESS' : 'FAILED',
                currentHash: postApplyHash,
                message: HashVerifier.verifyExpectedHash(postApplyText, command.expectedHash)
                    ? `Successfully applied ${sortedHunks.length} diff hunks in reverse order`
                    : `Replacement completed but final paragraph hash did not match expectedHash`,
            };

            await this.dispatchResultIfNeeded(successResult, options);
            return successResult;
        } catch (execError) {
            // =========================================================================
            // Step 6: Exception Handling & Pre-Rollback Hash Check Defense
            // =========================================================================
            return await this.handleRollbackFlow(
                command,
                adapter,
                journal,
                options,
                (execError as Error).message
            );
        }
    }

    /**
     * Executes the Pre-rollback Hash Check and performs either safe 100% rollback (ROLLED_BACK)
     * or safe abort (ROLLBACK_ABORTED) if user modifications are detected.
     */
    private async handleRollbackFlow(
        command: ReplacementCommand,
        adapter: WordParagraphAdapter,
        journal: CompensatingJournal,
        options: ReplacementExecutionOptions,
        originalErrorMessage: string
    ): Promise<ReplacementResult> {
        // If no steps were applied yet before error, document is still at base snapshot
        if (journal.size() === 0) {
            const currentText = await adapter.getText();
            const currentHash = computeParagraphHash(currentText);
            const result: ReplacementResult = {
                commandId: command.commandId,
                status: 'FAILED',
                currentHash,
                message: `Replacement failed prior to first hunk application: ${originalErrorMessage}`,
            };
            await this.dispatchResultIfNeeded(result, options);
            return result;
        }

        // Simulate external edit before rollback if requested in test options
        if (typeof options.simulateExternalEditBeforeRollback === 'string') {
            const current = await adapter.getText();
            await adapter.applyHunk(0, 0, '', options.simulateExternalEditBeforeRollback);
        }

        // Read current text state in document after exception
        let textBeforeRollback: string;
        try {
            textBeforeRollback = await adapter.getText();
        } catch {
            textBeforeRollback = '';
        }

        const expectedIntermediateHash = journal.getLatestIntermediateHash() || command.baseHash;

        // Perform Pre-rollback Hash Check (1회 수행)
        const integrity = HashVerifier.checkPreRollbackIntegrity(
            textBeforeRollback,
            expectedIntermediateHash
        );

        // Case B: External interference / user typing detected -> Abort rollback safely
        if (!integrity.isIntact) {
            const abortedResult: ReplacementResult = {
                commandId: command.commandId,
                status: 'ROLLBACK_ABORTED',
                currentHash: integrity.actualHash,
                message: `User editing or undo detected prior to rollback. Automatic rollback safely skipped to avoid silent data corruption. (Reason: ${originalErrorMessage})`,
            };
            await this.dispatchResultIfNeeded(abortedResult, options);
            return abortedResult;
        }

        // Case A: No external interference -> Execute 100% compensating rollback (reverse journal)
        const rollbackActions = journal.getRollbackActions();
        let rollbackFailed = false;
        let rollbackErrorMessage = '';

        try {
            for (const action of rollbackActions) {
                await adapter.applyHunk(
                    action.rollbackStartOffset,
                    action.rollbackEndOffset,
                    action.targetTextToRevert,
                    action.revertToOriginalText
                );
            }
        } catch (rbErr) {
            rollbackFailed = true;
            rollbackErrorMessage = (rbErr as Error).message;
        }

        // Verify restoration against initial snapshot
        const textAfterRollback = await adapter.getText();
        const hashAfterRollback = computeParagraphHash(textAfterRollback);
        const isFullyRestored =
            !rollbackFailed &&
            textAfterRollback === journal.getInitialSnapshot() &&
            hashAfterRollback === journal.getInitialHash();

        if (isFullyRestored) {
            const rolledBackResult: ReplacementResult = {
                commandId: command.commandId,
                status: 'ROLLED_BACK',
                currentHash: hashAfterRollback,
                message: `Replacement error encountered (${originalErrorMessage}). 100% original paragraph state restored via compensating transaction.`,
            };
            await this.dispatchResultIfNeeded(rolledBackResult, options);
            return rolledBackResult;
        } else {
            const failResult: ReplacementResult = {
                commandId: command.commandId,
                status: 'FAILED',
                currentHash: hashAfterRollback,
                message: `Compensating rollback failed to restore exact original state. ${rollbackErrorMessage}`.trim(),
            };
            await this.dispatchResultIfNeeded(failResult, options);
            return failResult;
        }
    }

    /**
     * Creates a default WordParagraphAdapter targeting the command's paragraph,
     * never the user's current selection. The content-derived paragraphId changes
     * after the first hunk, so the first lookup records its index for the rest of
     * this one transaction.
     */
    private async createDefaultAdapter(
        command: ReplacementCommand,
        options: ReplacementExecutionOptions
    ): Promise<WordParagraphAdapter> {
        const runner =
            options.wordRunner ||
            this.defaultWordRunner ||
            ((callback) => {
                if (typeof (globalThis as any).Word !== 'undefined' && (globalThis as any).Word.run) {
                    return (globalThis as any).Word.run(callback);
                }
                return Promise.reject(new Error('Word Office.js API is not available'));
            });

        let targetIndex: number | null = null;

        const resolveTargetParagraph = async (context: any): Promise<any> => {
            const paragraphs = context.document.body?.paragraphs;
            if (!paragraphs) throw new Error('Word document body paragraphs are unavailable');
            paragraphs.load('text');
            await context.sync();

            if (targetIndex !== null) {
                const paragraph = paragraphs.items?.[targetIndex];
                if (!paragraph) throw new Error('Target paragraph no longer exists');
                return paragraph;
            }

            const candidates = (paragraphs.items || [])
                .map((paragraph: any, index: number) => ({
                    paragraph,
                    index,
                    text: paragraph.text || '',
                }))
                .filter((candidate: { text: string }) =>
                    `word-para-${computeParagraphHash(candidate.text).slice(0, 12)}` === command.paragraphId
                    && computeParagraphHash(candidate.text) === command.baseHash
                );
            if (candidates.length === 0) throw new Error(`Paragraph '${command.paragraphId}' was not found with its base hash`);
            if (candidates.length > 1) throw new Error(`Paragraph '${command.paragraphId}' is ambiguous (${candidates.length} matches)`);
            targetIndex = candidates[0].index;
            return candidates[0].paragraph;
        };

        return {
            getText: async () => {
                let text = '';
                await runner(async (context: any) => {
                    const paragraph = await resolveTargetParagraph(context);
                    text = paragraph.text || '';
                });
                return text;
            },
            applyHunk: async (
                startOffset: number,
                endOffset: number,
                oldText: string,
                newText: string
            ) => {
                await runner(async (context: any) => {
                    const paragraph = await resolveTargetParagraph(context);
                    const currentPText = paragraph.text || '';
                    const actualSlice = currentPText.substring(startOffset, endOffset);
                    if (actualSlice !== oldText) {
                        throw new Error(
                            `Range mismatch: expected ${JSON.stringify(oldText)} at [${startOffset}:${endOffset}], found ${JSON.stringify(actualSlice)}`
                        );
                    }
                    const contentRange = paragraph.getRange?.('Content');
                    if (contentRange && typeof contentRange.getSubstring === 'function') {
                        const targetRange = contentRange.getSubstring(startOffset, endOffset - startOffset);
                        targetRange.insertText(newText, 'Replace');
                    } else {
                        // Range.getSubstring is unavailable in some Word hosts. Paragraph.text is
                        // read-only, so replace the paragraph/range rather than assigning to it.
                        // This retains correct text transaction semantics, but can replace inline
                        // formatting within this paragraph.
                        const replacementText = currentPText.substring(0, startOffset) + newText + currentPText.substring(endOffset);
                        if (typeof paragraph.insertText === 'function') {
                            paragraph.insertText(replacementText, 'Replace');
                        } else if (contentRange && typeof contentRange.insertText === 'function') {
                            contentRange.insertText(replacementText, 'Replace');
                        } else {
                            throw new Error('Word Paragraph does not support insertText');
                        }
                    }
                    await context.sync();
                });
            },
        };
    }

    private async dispatchResultIfNeeded(
        result: ReplacementResult,
        options: ReplacementExecutionOptions
    ): Promise<void> {
        const bridgeClient = options.bridgeClient || this.defaultBridgeClient;
        if (bridgeClient && typeof (bridgeClient as any).sendReplacementResult === 'function') {
            try {
                await (bridgeClient as any).sendReplacementResult(result);
            } catch {
                // Ignore dispatch errors
            }
        }
    }
}
