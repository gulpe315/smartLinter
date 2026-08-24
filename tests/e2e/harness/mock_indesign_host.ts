/**
 * SmartLinter Headless Adobe InDesign Host Harness
 *
 * Implements a full headless simulation of InDesign ExtendScript and UXP environment:
 * - `app.doScript` with `UndoModes.ENTIRE_SCRIPT` atomic snapshot rollback
 * - `#targetengine` persistent daemon and `app.idleTasks` background idle loop
 * - DOM structures (Document, TextFrame, Story, Paragraph, Characters with styles)
 * - Character Style, Paragraph Style, and Hyperlink preservation verification
 * - UXP Panel closed/opened lifecycle with continued background monitoring
 * - Fault injection and atomic rollback verification
 */

import { computeParagraphHash } from '../../../shared/engine/hash_util.ts';
import { type ParagraphPayload } from '../../../shared/protocol/types.ts';
import {
    MockInDesignEnvironment,
    MockParagraph,
    MockStyledRun,
    MockHyperlink,
    MockUndoModes,
} from '../../../plugins/indesign/__tests__/mock_indesign.ts';

export interface MockInDesignHostOptions {
    initialText?: string;
    docName?: string;
    storyId?: string;
    paragraphStyle?: string;
    characterRuns?: MockStyledRun[];
    hyperlinks?: MockHyperlink[];
}

export class MockInDesignHost {
    public env: MockInDesignEnvironment;
    public isPanelOpen = false;
    public executionLog: Array<{ action: string; timestamp: number; detail?: any }> = [];

    constructor(options: MockInDesignHostOptions = {}) {
        const text = options.initialText || 'Default InDesign editorial paragraph.';
        const docName = options.docName || 'Magazine_Spread.indd';
        this.env = new MockInDesignEnvironment(text, docName);

        if (options.characterRuns || options.hyperlinks || options.paragraphStyle) {
            this.env.setSelectionText(text, docName, options.storyId || 'story-100', {
                paragraphStyle: options.paragraphStyle,
                characterRuns: options.characterRuns,
                hyperlinks: options.hyperlinks,
            });
        }
    }

    public getParagraph(): MockParagraph | null {
        return this.env.getSelectedParagraph();
    }

    public getParagraphText(): string {
        const p = this.getParagraph();
        return p ? p.contents || '' : '';
    }

    public getParagraphHash(): string {
        return computeParagraphHash(this.getParagraphText());
    }

    public setParagraphText(
        newText: string,
        options: {
            characterRuns?: MockStyledRun[];
            hyperlinks?: MockHyperlink[];
            paragraphStyle?: string;
        } = {}
    ): MockParagraph {
        const p = this.env.setSelectionText(
            newText,
            this.env.activeDocument?.name,
            'story-100',
            options
        );
        this.log('SET_TEXT', { text: newText });
        return p;
    }

    /** Simulates user editing directly in InDesign editor */
    public simulateUserEdit(newText: string): void {
        this.setParagraphText(newText);
        this.env.triggerSelectionChange(newText);
    }

    /** Simulates opening the UXP panel */
    public openPanel(): void {
        this.isPanelOpen = true;
        this.log('PANEL_OPEN');
    }

    /** Simulates closing the UXP panel (background mode) */
    public closePanel(): void {
        this.isPanelOpen = false;
        this.log('PANEL_CLOSE');
    }

    /** Triggers N cycles of the InDesign app.idleTasks monitor loop */
    public async runIdleCycles(
        count: number,
        taskName = 'smartlinter_persistent_monitor',
        stepDelayMs = 5
    ): Promise<number> {
        let executed = 0;
        for (let i = 0; i < count; i++) {
            this.env.triggerIdleTick(taskName);
            executed++;
            this.log('IDLE_TICK', { cycle: i + 1, taskName, isPanelOpen: this.isPanelOpen });
            if (stepDelayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, stepDelayMs));
            }
        }
        return executed;
    }

    /** Creates an adapter for InDesign atomic replacement */
    public createAdapter() {
        const self = this;
        return {
            getText: () => {
                return self.getParagraphText();
            },
            applyHunk: (start: number, end: number, oldText: string, newText: string) => {
                const p = self.getParagraph();
                if (!p) {
                    throw new Error('No active InDesign paragraph available');
                }

                if (start === end) {
                    // Insertion
                    if (p.insertionPoints && p.insertionPoints.length > start) {
                        p.insertionPoints[start].contents = newText;
                        return;
                    }
                }

                if (p.characters && p.characters.itemByRange) {
                    const range = p.characters.itemByRange(start, end - 1);
                    if (range.contents !== oldText) {
                        throw new Error(
                            `InDesign DOM Range Mismatch: expected ${JSON.stringify(oldText)} at [${start}:${end}], found ${JSON.stringify(range.contents)}`
                        );
                    }
                    range.contents = newText;
                    self.log('APPLY_HUNK', { start, end, oldText, newText, textAfter: p.contents });
                    return;
                }

                // Plain string fallback
                const current = p.contents || '';
                const slice = current.substring(start, end);
                if (slice !== oldText) {
                    throw new Error(
                        `InDesign DOM Text Mismatch: expected ${JSON.stringify(oldText)}, found ${JSON.stringify(slice)}`
                    );
                }
                p.contents = current.substring(0, start) + newText + current.substring(end);
                self.log('APPLY_HUNK', { start, end, oldText, newText, textAfter: p.contents });
            },
        };
    }

    /** Creates a ParagraphPayload for current InDesign selection */
    public createParagraphPayload(paragraphId?: string): ParagraphPayload {
        const text = this.getParagraphText();
        const hash = this.getParagraphHash();
        const docName = this.env.activeDocument?.name || 'InDesign_Story.indd';
        return {
            paragraphId: paragraphId || `indesign-para-${hash.slice(0, 12)}`,
            text,
            hash,
            source: docName,
            timestamp: Date.now(),
            editorType: 'InDesign',
        };
    }

    public getApp(): any {
        return this.env.getApp();
    }

    private log(action: string, detail?: any): void {
        this.executionLog.push({
            action,
            timestamp: Date.now(),
            detail,
        });
    }
}
