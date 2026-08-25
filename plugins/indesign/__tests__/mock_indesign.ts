/**
 * Mock InDesign ExtendScript & UXP Environment for Headless Unit/Integration Testing
 * 
 * Accurately simulates InDesign's:
 * - `app.doScript` with `UndoModes.ENTIRE_SCRIPT` atomic snapshot rollback
 * - `app.idleTasks` collection and IdleEvent lifecycle
 * - `app.documents` and `app.selection` (TextFrame, Story, Paragraph, Characters, Styles)
 * - Character Style and Paragraph Style preservation
 * - ExtendScript `Socket` class for raw HTTP/TCP communication
 * - Native InDesign DOM events (`afterSelectionChanged`, `afterAttributeChanged`)
 */

export interface MockCharacterStyle {
    name: string;
}

export interface MockParagraphStyle {
    name: string;
}

export interface MockHyperlink {
    sourceText: string;
    destinationURL: string;
}

export interface MockStyledRun {
    start: number;
    end: number;
    characterStyle: string;
}

export interface MockCharacterRange {
    contents: string[];
    appliedCharacterStyle?: MockCharacterStyle;
    texts: {
        everyItem: () => {
            getElements: () => Array<{
                contents: string;
            }>;
        };
    };
}

export interface MockParagraph {
    contents: string;
    parentStory?: { id: string };
    parentTextFrames?: Array<{ isValid?: boolean; locked?: boolean; itemLayer?: { locked?: boolean } }>;
    /** Matches InDesign Paragraph.index: the paragraph's text position in its parent story. */
    index?: number;
    appliedParagraphStyle?: MockParagraphStyle;
    characterRuns?: MockStyledRun[];
    hyperlinks?: MockHyperlink[];
    insertionPoints?: Array<{
        get contents(): string;
        set contents(val: string);
    }>;
    characters?: {
        itemByRange: (start: number, end: number) => MockCharacterRange;
    };
}

export interface MockTextFrame {
    paragraphs: MockParagraph[];
    texts?: Array<{ paragraphs: MockParagraph[] }>;
    parentStory?: { id: string };
}

export interface MockDocument {
    id: string;
    name: string;
}

export interface MockIdleTask {
    name: string;
    sleep: number;
    isValid: boolean;
    listeners: Map<string, Array<(event: any) => void>>;
    addEventListener: (eventType: string, handler: (event: any) => void) => void;
    removeEventListener: (eventType: string, handler: (event: any) => void) => void;
    remove: () => void;
}

export const MockUndoModes = {
    ENTIRE_SCRIPT: 'ENTIRE_SCRIPT',
    FAST_ENTIRE_SCRIPT: 'FAST_ENTIRE_SCRIPT',
    AUTO_UNDO: 'AUTO_UNDO',
    SCRIPT_REQUEST: 'SCRIPT_REQUEST'
};

export const MockScriptLanguage = {
    JAVASCRIPT: 'JAVASCRIPT'
};

export class MockSocket {
    public timeout = 3;
    public encoding = 'UTF-8';
    public eof = false;
    public isOpen = false;
    public hostPort = '';
    public writtenData = '';
    public responseQueue: string[] = [];
    public customHandler?: (requestStr: string) => string;

    public open(hostPort: string, encoding?: string): boolean {
        if (hostPort.includes('invalid') || hostPort.includes('fail')) {
            this.isOpen = false;
            return false;
        }
        this.hostPort = hostPort;
        if (encoding) this.encoding = encoding;
        this.isOpen = true;
        this.eof = false;
        this.writtenData = '';
        return true;
    }

    public write(data: string): boolean {
        if (!this.isOpen) return false;
        this.writtenData += data;
        return true;
    }

    public read(): string {
        if (!this.isOpen) return '';
        if (this.customHandler && this.writtenData) {
            const resp = this.customHandler(this.writtenData);
            this.eof = true;
            return resp;
        }
        if (this.responseQueue.length > 0) {
            const resp = this.responseQueue.shift()!;
            this.eof = true;
            return resp;
        }
        this.eof = true;
        return '';
    }

    public close(): void {
        this.isOpen = false;
        this.eof = true;
    }

    public queueHttpResponse(statusCode: number, bodyObj: any, statusText: string = 'OK'): void {
        const bodyStr = JSON.stringify(bodyObj);
        const raw = `HTTP/1.1 ${statusCode} ${statusText}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(bodyStr, 'utf8')}\r\nConnection: close\r\n\r\n${bodyStr}`;
        this.responseQueue.push(raw);
    }
}

export interface DoScriptCallRecord {
    script: any;
    language: any;
    args: any[];
    undoMode: any;
    undoName: string;
    success: boolean;
    error?: string;
    rolledBack: boolean;
}

export class MockInDesignEnvironment {
    public documents: MockDocument[] = [];
    public activeDocument: MockDocument | null = null;
    public selection: any[] = [];
    public idleTaskList: Map<string, MockIdleTask> = new Map();
    public appListeners: Map<string, Array<(event: any) => void>> = new Map();
    public doScriptHistory: DoScriptCallRecord[] = [];

    public socketInstances: MockSocket[] = [];
    public socketHandler?: (req: string) => string;

    constructor(initialText = 'Default InDesign editorial paragraph.', docName = 'Magazine_Spread.indd') {
        const doc: MockDocument = { id: 'doc-id-001', name: docName };
        this.documents = [doc];
        this.activeDocument = doc;
        this.setSelectionText(initialText, docName);
    }

    public createParagraph(
        text: string,
        storyId = 'story-100',
        options: {
            paragraphStyle?: string;
            characterRuns?: MockStyledRun[];
            hyperlinks?: MockHyperlink[];
        } = {}
    ): MockParagraph {
        const paraStyle: MockParagraphStyle = { name: options.paragraphStyle || 'BodyText' };
        let characterRuns: MockStyledRun[] = options.characterRuns
            ? JSON.parse(JSON.stringify(options.characterRuns))
            : [{ start: 0, end: text.length, characterStyle: '[None]' }];
        let hyperlinks: MockHyperlink[] = options.hyperlinks
            ? JSON.parse(JSON.stringify(options.hyperlinks))
            : [];

        const paragraph: MockParagraph = {
            contents: text,
            parentStory: { id: storyId },
            index: 0,
            appliedParagraphStyle: paraStyle,
            characterRuns: characterRuns,
            hyperlinks: hyperlinks
        };

        // InsertionPoints
        paragraph.insertionPoints = new Proxy([], {
            get(_target, prop) {
                const idx = typeof prop === 'string' ? parseInt(prop, 10) : NaN;
                if (!isNaN(idx)) {
                    return {
                        get contents() { return ''; },
                        set contents(val: string) {
                            const current = paragraph.contents;
                            const clamped = Math.max(0, Math.min(idx, current.length));
                            paragraph.contents = current.substring(0, clamped) + val + current.substring(clamped);
                        }
                    };
                }
                if (prop === 'length') {
                    return paragraph.contents.length + 1;
                }
                return (_target as any)[prop];
            }
        });

        // Characters & itemByRange
        paragraph.characters = {
            itemByRange: (start: number, end: number) => {
                // Find predominant character style in range
                let foundStyle = '[None]';
                if (paragraph.characterRuns) {
                    for (const run of paragraph.characterRuns) {
                        if (start >= run.start && start < run.end) {
                            foundStyle = run.characterStyle;
                            break;
                        }
                    }
                }

                return {
                    get contents() {
                        // ExtendScript returns an array when `.contents` is read
                        // from the plural Characters specifier returned by itemByRange.
                        return [paragraph.contents.substring(start, end + 1)];
                    },
                    set contents(val: string) {
                        const before = paragraph.contents.substring(0, start);
                        const after = paragraph.contents.substring(end + 1);
                        paragraph.contents = before + val + after;

                        // Update characterRuns offsets
                        if (paragraph.characterRuns) {
                            const oldLen = end - start + 1;
                            const diff = val.length - oldLen;
                            for (const run of paragraph.characterRuns) {
                                if (run.start > end) {
                                    run.start += diff;
                                    run.end += diff;
                                } else if (run.end >= end) {
                                    run.end += diff;
                                }
                            }
                        }
                    },
                    get appliedCharacterStyle() {
                        return { name: foundStyle };
                    },
                    texts: {
                        everyItem: () => ({
                            // Resolving the singular Text object mirrors the documented
                            // Text.contents String read/write API used by the replacer.
                            getElements: () => [{
                                get contents() {
                                    return paragraph.contents.substring(start, end + 1);
                                },
                                set contents(val: string) {
                                    const before = paragraph.contents.substring(0, start);
                                    const after = paragraph.contents.substring(end + 1);
                                    paragraph.contents = before + val + after;

                                    if (paragraph.characterRuns) {
                                        const oldLen = end - start + 1;
                                        const diff = val.length - oldLen;
                                        for (const run of paragraph.characterRuns) {
                                            if (run.start > end) {
                                                run.start += diff;
                                                run.end += diff;
                                            } else if (run.end >= end) {
                                                run.end += diff;
                                            }
                                        }
                                    }
                                }
                            }]
                        })
                    }
                };
            }
        };

        return paragraph;
    }

    public setSelectionText(
        text: string,
        docName?: string,
        storyId = 'story-100',
        options: {
            paragraphStyle?: string;
            characterRuns?: MockStyledRun[];
            hyperlinks?: MockHyperlink[];
        } = {}
    ): MockParagraph {
        if (docName && this.activeDocument) {
            this.activeDocument.name = docName;
        }

        const currentParagraph = this.getSelectedParagraph();
        // Editing an existing paragraph mutates the same InDesign Paragraph object;
        // it does not create a new paragraph or change Paragraph.index.
        if (currentParagraph && currentParagraph.parentStory?.id === storyId) {
            currentParagraph.contents = text;
            if (options.paragraphStyle) currentParagraph.appliedParagraphStyle = { name: options.paragraphStyle };
            if (options.characterRuns) currentParagraph.characterRuns = JSON.parse(JSON.stringify(options.characterRuns));
            if (options.hyperlinks) currentParagraph.hyperlinks = JSON.parse(JSON.stringify(options.hyperlinks));
            return currentParagraph;
        }

        const paragraph = this.createParagraph(text, storyId, options);
        const frame: MockTextFrame = {
            paragraphs: [paragraph],
            texts: [{ paragraphs: [paragraph] }],
            parentStory: { id: storyId }
        };

        this.selection = [frame];
        return paragraph;
    }

    public getSelectedParagraph(): MockParagraph | null {
        if (this.selection.length > 0) {
            const item = this.selection[0];
            if (item.paragraphs && item.paragraphs.length > 0) {
                return item.paragraphs[0];
            }
        }
        return null;
    }

    public createSocketFactory(): () => MockSocket {
        return () => {
            const socket = new MockSocket();
            if (this.socketHandler) {
                socket.customHandler = this.socketHandler;
            }
            this.socketInstances.push(socket);
            return socket;
        };
    }

    public takeStateSnapshot(): Array<{ target: MockParagraph; contents: string; runs?: any[]; hyperlinks?: any[] }> {
        const snapshot: Array<{ target: MockParagraph; contents: string; runs?: any[]; hyperlinks?: any[] }> = [];
        for (const item of this.selection) {
            if (item && item.paragraphs) {
                for (const p of item.paragraphs) {
                    snapshot.push({
                        target: p,
                        contents: p.contents,
                        runs: p.characterRuns ? JSON.parse(JSON.stringify(p.characterRuns)) : undefined,
                        hyperlinks: p.hyperlinks ? JSON.parse(JSON.stringify(p.hyperlinks)) : undefined
                    });
                }
            }
        }
        return snapshot;
    }

    public restoreStateSnapshot(snapshot: Array<{ target: MockParagraph; contents: string; runs?: any[]; hyperlinks?: any[] }>): void {
        for (const entry of snapshot) {
            entry.target.contents = entry.contents;
            if (entry.runs) {
                entry.target.characterRuns = JSON.parse(JSON.stringify(entry.runs));
            }
            if (entry.hyperlinks) {
                entry.target.hyperlinks = JSON.parse(JSON.stringify(entry.hyperlinks));
            }
        }
    }

    public getApp(): any {
        const self = this;
        return {
            get documents() { return self.documents; },
            get activeDocument() { return self.activeDocument; },
            get selection() { return self.selection; },

            doScript(
                callback: () => any,
                scriptLanguage = MockScriptLanguage.JAVASCRIPT,
                args: any[] = [],
                undoMode = MockUndoModes.ENTIRE_SCRIPT,
                undoName = 'SmartLinter Multi-Hunk Replace'
            ): any {
                const snapshot = self.takeStateSnapshot();
                const isAtomic = (undoMode === MockUndoModes.ENTIRE_SCRIPT ||
                                  undoMode === MockUndoModes.FAST_ENTIRE_SCRIPT ||
                                  undoMode === 'ENTIRE_SCRIPT' ||
                                  undoMode === 'FAST_ENTIRE_SCRIPT');

                try {
                    let result: any;
                    if (typeof callback === 'function') {
                        result = callback.apply(null, args);
                    }
                    self.doScriptHistory.push({
                        script: callback,
                        language: scriptLanguage,
                        args,
                        undoMode,
                        undoName,
                        success: true,
                        rolledBack: false
                    });
                    return result;
                } catch (err: any) {
                    if (isAtomic) {
                        self.restoreStateSnapshot(snapshot);
                    }
                    self.doScriptHistory.push({
                        script: callback,
                        language: scriptLanguage,
                        args,
                        undoMode,
                        undoName,
                        success: false,
                        error: err.message,
                        rolledBack: isAtomic
                    });
                    // Native InDesign doScript re-throws the error to the outer caller
                    throw err;
                }
            },

            idleTasks: {
                itemByName(name: string): MockIdleTask {
                    const task = self.idleTaskList.get(name);
                    if (task && task.isValid) {
                        return task;
                    }
                    return {
                        name,
                        sleep: 1000,
                        isValid: false,
                        listeners: new Map(),
                        addEventListener: () => {},
                        removeEventListener: () => {},
                        remove: () => {}
                    };
                },
                add(options: { name: string; sleep: number }): MockIdleTask {
                    const task: MockIdleTask = {
                        name: options.name,
                        sleep: options.sleep,
                        isValid: true,
                        listeners: new Map(),
                        addEventListener(eventType: string, handler: (e: any) => void) {
                            if (!this.listeners.has(eventType)) {
                                this.listeners.set(eventType, []);
                            }
                            this.listeners.get(eventType)!.push(handler);
                        },
                        removeEventListener(eventType: string, handler: (e: any) => void) {
                            const arr = this.listeners.get(eventType);
                            if (arr) {
                                const idx = arr.indexOf(handler);
                                if (idx !== -1) arr.splice(idx, 1);
                            }
                        },
                        remove() {
                            this.isValid = false;
                            this.listeners.clear();
                            self.idleTaskList.delete(this.name);
                        }
                    };
                    self.idleTaskList.set(options.name, task);
                    return task;
                }
            },

            addEventListener(eventName: string, handler: (event: any) => void) {
                if (!self.appListeners.has(eventName)) {
                    self.appListeners.set(eventName, []);
                }
                self.appListeners.get(eventName)!.push(handler);
            },

            removeEventListener(eventName: string, handler: (event: any) => void) {
                const arr = self.appListeners.get(eventName);
                if (arr) {
                    const idx = arr.indexOf(handler);
                    if (idx !== -1) arr.splice(idx, 1);
                }
            }
        };
    }

    public triggerIdleTick(taskName = 'smartlinter_persistent_monitor', eventObj?: any): any {
        const task = this.idleTaskList.get(taskName);
        const evt = eventObj || { name: 'onIdle', time: Date.now(), idleTime: 0 };
        if (task && task.isValid) {
            const handlers = task.listeners.get('onIdle') || task.listeners.get('ON_IDLE') || [];
            for (const handler of handlers) {
                handler(evt);
            }
        }
        return evt;
    }

    public triggerSelectionChange(newText?: string): void {
        if (newText !== undefined) {
            this.setSelectionText(newText);
        }
        const handlers = this.appListeners.get('afterSelectionChanged') || [];
        for (const handler of handlers) {
            handler({ name: 'afterSelectionChanged', time: Date.now() });
        }
    }

    public triggerAttributeChange(newText?: string): void {
        if (newText !== undefined) {
            this.setSelectionText(newText);
        }
        const handlers = this.appListeners.get('afterAttributeChanged') || [];
        for (const handler of handlers) {
            handler({ name: 'afterAttributeChanged', time: Date.now() });
        }
    }

    public triggerActivate(): void {
        const handlers = this.appListeners.get('afterActivate') || [];
        for (const handler of handlers) {
            handler({ name: 'afterActivate', time: Date.now() });
        }
    }
}
