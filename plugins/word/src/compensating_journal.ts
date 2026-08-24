/**
 * SmartLinter MS Word Compensating Transaction Journal
 *
 * Records multi-hunk replacement steps in real-time and generates reverse-ordered
 * compensating rollback actions for reliable atomic-like recovery.
 */

export interface JournalEntry {
    /** 0-based execution step sequence */
    stepIndex: number;
    /** Index of the hunk in the original command array */
    hunkIndex: number;
    /** Start character offset in the paragraph at the time of replacement */
    startOffset: number;
    /** End character offset in the paragraph after replacement (startOffset + newText.length) */
    endOffset: number;
    /** Original start character offset before replacement */
    originalStartOffset: number;
    /** Original end character offset before replacement */
    originalEndOffset: number;
    /** Original text that was replaced (target for restoration) */
    originalText: string;
    /** New text that replaced the original text */
    newText: string;
    /** Full paragraph text snapshot immediately after this step */
    intermediateText: string;
    /** SHA-256 hash of the paragraph text immediately after this step */
    intermediateHash: string;
    /** Millisecond Unix epoch timestamp when step occurred */
    timestamp: number;
}

export interface RollbackAction {
    /** Associated execution step index */
    stepIndex: number;
    /** Associated original hunk index */
    hunkIndex: number;
    /** Current start offset of the replacement text to revert */
    rollbackStartOffset: number;
    /** Current end offset of the replacement text to revert */
    rollbackEndOffset: number;
    /** Text currently present that must be replaced back (newText) */
    targetTextToRevert: string;
    /** Original baseline text to be restored (originalText) */
    revertToOriginalText: string;
}

export class CompensatingJournal {
    private readonly initialSnapshot: string;
    private readonly initialHash: string;
    private readonly entries: JournalEntry[] = [];

    constructor(initialSnapshot: string, initialHash: string) {
        this.initialSnapshot = initialSnapshot;
        this.initialHash = initialHash;
    }

    /**
     * Records a successful replacement step into the journal in real-time.
     */
    public record(entry: Omit<JournalEntry, 'timestamp'>): void {
        this.entries.push({
            ...entry,
            timestamp: Date.now(),
        });
    }

    /**
     * Returns a shallow copy of all recorded journal entries in chronological order.
     */
    public getEntries(): JournalEntry[] {
        return [...this.entries];
    }

    /**
     * Returns rollback actions ordered in reverse chronological order (LIFO).
     * Playing these actions in order sequentially reverts all applied hunks.
     */
    public getRollbackActions(): RollbackAction[] {
        return [...this.entries].reverse().map((entry) => ({
            stepIndex: entry.stepIndex,
            hunkIndex: entry.hunkIndex,
            rollbackStartOffset: entry.startOffset,
            rollbackEndOffset: entry.endOffset,
            targetTextToRevert: entry.newText,
            revertToOriginalText: entry.originalText,
        }));
    }

    /**
     * Returns the intermediate paragraph hash from the most recently completed step,
     * or null if no steps have been recorded yet.
     */
    public getLatestIntermediateHash(): string | null {
        if (this.entries.length === 0) {
            return null;
        }
        return this.entries[this.entries.length - 1].intermediateHash;
    }

    /**
     * Returns the intermediate paragraph text from the most recently completed step,
     * or null if no steps have been recorded yet.
     */
    public getLatestIntermediateText(): string | null {
        if (this.entries.length === 0) {
            return null;
        }
        return this.entries[this.entries.length - 1].intermediateText;
    }

    /**
     * Returns the initial baseline paragraph text snapshot prior to any replacements.
     */
    public getInitialSnapshot(): string {
        return this.initialSnapshot;
    }

    /**
     * Returns the initial baseline SHA-256 hash prior to any replacements.
     */
    public getInitialHash(): string {
        return this.initialHash;
    }

    /**
     * Returns the number of recorded replacement steps.
     */
    public size(): number {
        return this.entries.length;
    }

    /**
     * Clears all journal entries.
     */
    public clear(): void {
        this.entries.length = 0;
    }
}
