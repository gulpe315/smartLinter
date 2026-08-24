/**
 * SmartLinter Headless MS Word Host Harness
 *
 * Implements a full headless simulation of Office.js and MS Word Web Add-in runtime:
 * - Shared Runtime lifecycle: `Office.addin.hide()`, `showAsTaskpane()`, `visibilityMode`
 * - Selection change event dispatching (`context.document.onSelectionChanged`)
 * - Document & paragraph manipulation (`getText`, `applyHunk`) with offset validation
 * - Seamless integration with WordReplacementExecutor, WordDocumentListener, and CompensatingJournal
 * - Fault injection (exceptions at specific hunks, mid-transaction external editing)
 */

import { computeParagraphHash } from '../../../shared/engine/hash_util.ts';
import { type WordParagraphAdapter } from '../../../plugins/word/src/replacement_executor.ts';
import { type ParagraphPayload } from '../../../shared/protocol/types.ts';

export interface MockWordDocState {
    text: string;
    title: string;
    selectionStart?: number;
    selectionEnd?: number;
}

export class MockWordHostContext {
    public document: {
        properties: {
            title: string;
            load: (prop: string) => void;
        };
        onSelectionChanged: {
            handlers: Array<(event?: any) => void>;
            add: (fn: (event?: any) => void) => void;
            remove: (fn: (event?: any) => void) => void;
        };
        getSelection: () => {
            paragraphs: {
                items: Array<{ text: string }>;
                load: (prop: string) => void;
                getFirst: () => { text: string };
            };
        };
    };

    private syncCount = 0;
    private host: MockWordHost;

    constructor(host: MockWordHost) {
        this.host = host;
        const handlers: Array<(event?: any) => void> = [];

        this.document = {
            properties: {
                title: host.docState.title,
                load: (_prop: string) => {},
            },
            onSelectionChanged: {
                handlers,
                add: (fn) => {
                    handlers.push(fn);
                },
                remove: (fn) => {
                    const idx = handlers.indexOf(fn);
                    if (idx >= 0) handlers.splice(idx, 1);
                },
            },
            getSelection: () => {
                return {
                    paragraphs: {
                        items: [{ text: this.host.docState.text }],
                        load: (_prop: string) => {},
                        getFirst: () => ({ text: this.host.docState.text }),
                    },
                };
            },
        };
    }

    public async sync(): Promise<void> {
        this.syncCount++;
        this.document.properties.title = this.host.docState.title;
    }

    public getSyncCount(): number {
        return this.syncCount;
    }
}

export class MockOfficeHost {
    public HostType = { Word: 'Word', Excel: 'Excel', PowerPoint: 'PowerPoint' };
    public StartupBehavior = { load: 'Load', none: 'None' };

    public addin: {
        startupBehavior: string;
        visibilityMode: 'Visible' | 'Hidden';
        hideCallCount: number;
        showCallCount: number;
        visibilityHandlers: Array<(args: { visibilityMode: string }) => void>;
        setStartupBehavior: (behavior: string) => Promise<void>;
        hide: () => Promise<void>;
        showAsTaskpane: () => Promise<void>;
        onVisibilityModeChanged: (handler: (args: { visibilityMode: string }) => void) => void;
    };

    private onReadyCallbacks: Array<(info: { host: string; platform: string }) => void> = [];

    constructor() {
        const self = this;
        this.addin = {
            startupBehavior: 'None',
            visibilityMode: 'Visible',
            hideCallCount: 0,
            showCallCount: 0,
            visibilityHandlers: [],
            setStartupBehavior: async (behavior: string) => {
                self.addin.startupBehavior = behavior;
            },
            hide: async () => {
                self.addin.hideCallCount++;
                self.addin.visibilityMode = 'Hidden';
                self.notifyVisibilityModeChanged('Hidden');
            },
            showAsTaskpane: async () => {
                self.addin.showCallCount++;
                self.addin.visibilityMode = 'Visible';
                self.notifyVisibilityModeChanged('Visible');
            },
            onVisibilityModeChanged: (handler: (args: { visibilityMode: string }) => void) => {
                self.addin.visibilityHandlers.push(handler);
            },
        };
    }

    public onReady(callback: (info: { host: string; platform: string }) => void): void {
        this.onReadyCallbacks.push(callback);
        setTimeout(() => {
            callback({ host: 'Word', platform: 'PC' });
        }, 0);
    }

    public notifyVisibilityModeChanged(mode: 'Visible' | 'Hidden'): void {
        for (const handler of this.addin.visibilityHandlers) {
            try {
                handler({ visibilityMode: mode });
            } catch (err) {
                console.error('Error in visibility handler:', err);
            }
        }
    }
}

export class MockWordHost {
    public docState: MockWordDocState;
    public activeContext: MockWordHostContext;
    public office: MockOfficeHost;

    public get addin() {
        return this.office.addin;
    }

    public executionLog: Array<{ action: string; timestamp: number; detail?: any }> = [];

    constructor(initialText = 'Default Word paragraph text.', initialTitle = 'Document1.docx') {
        this.docState = { text: initialText, title: initialTitle };
        this.activeContext = new MockWordHostContext(this);
        this.office = new MockOfficeHost();
    }

    public getParagraphText(): string {
        return this.docState.text;
    }

    public getParagraphHash(): string {
        return computeParagraphHash(this.docState.text);
    }

    public setParagraphText(newText: string, newTitle?: string): void {
        this.docState.text = newText;
        if (newTitle) {
            this.docState.title = newTitle;
        }
        this.log('SET_TEXT', { text: newText });
    }

    /** Simulates user typing or editing directly inside Word editor */
    public simulateUserEdit(newText: string): void {
        this.setParagraphText(newText);
        this.triggerSelectionChanged({ source: 'user_typing' });
    }

    public triggerSelectionChanged(eventData: any = { source: 'selection_changed' }): void {
        const handlers = [...this.activeContext.document.onSelectionChanged.handlers];
        for (const handler of handlers) {
            try {
                handler(eventData);
            } catch (err) {
                console.error('Error in onSelectionChanged handler:', err);
            }
        }
    }

    public notifyVisibilityModeChanged(mode: 'Visible' | 'Hidden'): void {
        this.office.notifyVisibilityModeChanged(mode);
    }

    /** Creates a WordParagraphAdapter for WordReplacementExecutor */
    public createAdapter(): WordParagraphAdapter {
        return {
            getText: async () => {
                return this.docState.text;
            },
            applyHunk: async (startOffset: number, endOffset: number, oldText: string, newText: string) => {
                const current = this.docState.text;
                const actualSlice = current.substring(startOffset, endOffset);
                if (actualSlice !== oldText) {
                    throw new Error(
                        `Word DOM Hunk Mismatch: expected ${JSON.stringify(oldText)} at [${startOffset}:${endOffset}], found ${JSON.stringify(actualSlice)}`
                    );
                }
                const updated = current.substring(0, startOffset) + newText + current.substring(endOffset);
                this.docState.text = updated;
                this.log('APPLY_HUNK', { startOffset, endOffset, oldText, newText, textAfter: updated });
            },
        };
    }

    /** Creates a Word.run runner for document listeners */
    public createWordRunner(): (callback: (context: any) => Promise<any>) => Promise<any> {
        return async (callback: (context: any) => Promise<any>) => {
            return await callback(this.activeContext);
        };
    }

    /** Creates standard ParagraphPayload for current document state */
    public createParagraphPayload(paragraphId?: string): ParagraphPayload {
        const text = this.getParagraphText();
        const hash = this.getParagraphHash();
        return {
            paragraphId: paragraphId || `word-para-${hash.slice(0, 12)}`,
            text,
            hash,
            source: this.docState.title,
            timestamp: Date.now(),
            editorType: 'Word',
        };
    }

    private log(action: string, detail?: any): void {
        this.executionLog.push({
            action,
            timestamp: Date.now(),
            detail,
        });
    }
}
