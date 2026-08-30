/**
 * Mock Office.js and Word API Environment for CI and Unit/Integration Testing
 *
 * Implements realistic mock objects for Office.addin (Shared Runtime, hide/show, visibilityMode),
 * Office.onReady, Word.run, and Office Common API DocumentSelectionChanged events.
 * See https://learn.microsoft.com/en-us/javascript/api/office/office.documentselectionchangedeventargs
 */

export interface MockDocumentState {
    text: string;
    title: string;
    saved?: boolean;
}

export class MockWordContext {
    public document: {
        saved: boolean;
        body: { paragraphs: { items: any[]; load: (prop: string) => void } };
        properties: {
            title: string;
            load: (prop: string) => void;
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
    private docState: MockDocumentState;
    public operations: any[] = [];

    constructor(docState: MockDocumentState) {
        this.docState = docState;
        this.document = {
            saved: docState.saved !== false,
            body: {
                paragraphs: {
                    items: [this.createParagraph(docState)],
                    load: (_prop: string) => {},
                },
            },
            properties: {
                title: docState.title,
                load: (_prop: string) => {},
            },
            getSelection: () => {
                return {
                    paragraphs: {
                        items: [{ text: this.docState.text }],
                        load: (_prop: string) => {},
                        getFirst: () => ({ text: this.docState.text }),
                    },
                };
            },
        };
    }

    private createParagraph(state: MockDocumentState): any {
        const makeRange = (start: number, length: number): any => ({
            font: new Proxy({}, { set: (_target, property, value) => { if (property === 'underline' && typeof value === 'boolean') throw new Error('underline must be an enum value'); this.operations.push({ type: 'format', start, length, property, value }); return true; } }),
            insertText: (value: string, location: string) => {
                if (location === 'Replace') { state.text = state.text.slice(0, start) + value + state.text.slice(start + length); }
                else if (location === 'End') { state.text = state.text.slice(0, start + length) + value + state.text.slice(start + length); }
                else throw new Error(`Unsupported insert location: ${location}`);
                paragraph.text = state.text; const result = makeRange(start, value.length); this.operations.push({ type: 'insert', start, length, value, location }); return result;
            },
            getSubstring: (offset: number, substringLength: number) => makeRange(start + offset, substringLength),
        });
        const paragraph: any = { text: state.text, load: (_prop: string) => {}, getRange: () => makeRange(0, state.text.length) };
        return paragraph;
    }

    public async sync(): Promise<void> {
        this.syncCount++;
        // Sync document state
        this.document.properties.title = this.docState.title;
    }

    public getSyncCount(): number {
        return this.syncCount;
    }
}

export class MockOfficeHost {
    public HostType = { Word: 'Word', Excel: 'Excel', PowerPoint: 'PowerPoint' };
    public StartupBehavior = { load: 'Load', none: 'None' };
    /** Office Common API 1.1 DocumentSelectionChanged contract used by production. */
    public EventType = { DocumentSelectionChanged: 'documentSelectionChanged' };
    public AsyncResultStatus = { Succeeded: 'succeeded', Failed: 'failed' };
    public context = {
        document: {
            handlers: [] as Array<(event?: any) => void>,
            addHandlerAsync: (eventType: string, handler: (event?: any) => void, callback?: (result: any) => void) => {
                if (eventType !== this.EventType.DocumentSelectionChanged) {
                    callback?.({ status: this.AsyncResultStatus.Failed, error: { message: 'Unsupported event type' } });
                    return;
                }
                this.context.document.handlers.push(handler);
                callback?.({ status: this.AsyncResultStatus.Succeeded });
            },
            removeHandlerAsync: (eventType: string, options: { handler: (event?: any) => void }, callback?: (result: any) => void) => {
                const index = this.context.document.handlers.indexOf(options.handler);
                if (eventType === this.EventType.DocumentSelectionChanged && index >= 0) {
                    this.context.document.handlers.splice(index, 1);
                    callback?.({ status: this.AsyncResultStatus.Succeeded });
                    return;
                }
                callback?.({ status: this.AsyncResultStatus.Failed, error: { message: 'Handler not found' } });
            },
        },
        requirements: { isSetSupported: (_name: string, _version: string) => true },
    };

    public addin = {
        startupBehavior: 'None',
        visibilityMode: 'Visible',
        hideCallCount: 0,
        showCallCount: 0,
        visibilityHandlers: [] as Array<(args: { visibilityMode: string }) => void>,

        setStartupBehavior: async (behavior: string) => {
            this.addin.startupBehavior = behavior;
        },

        hide: async () => {
            this.addin.hideCallCount++;
            this.addin.visibilityMode = 'Hidden';
            this.notifyVisibilityModeChanged('Hidden');
        },

        showAsTaskpane: async () => {
            this.addin.showCallCount++;
            this.addin.visibilityMode = 'Visible';
            this.notifyVisibilityModeChanged('Visible');
        },

        onVisibilityModeChanged: (handler: (args: { visibilityMode: string }) => void) => {
            this.addin.visibilityHandlers.push(handler);
        },
    };

    private onReadyCallbacks: Array<(info: { host: string; platform: string }) => void> = [];

    public onReady(callback: (info: { host: string; platform: string }) => void): void {
        this.onReadyCallbacks.push(callback);
        // Automatically trigger ready asynchronously
        setTimeout(() => {
            callback({ host: 'Word', platform: 'PC' });
        }, 1);
    }

    public notifyVisibilityModeChanged(mode: string): void {
        for (const handler of this.addin.visibilityHandlers) {
            handler({ visibilityMode: mode });
        }
    }
}

export class MockWordEnvironment {
    public office: MockOfficeHost;
    public docState: MockDocumentState;
    public activeContext: MockWordContext;
    public createdContext?: MockWordContext;
    public openCallCount = 0;

    constructor(initialText = 'This is a sample paragraph in Word.', initialTitle = 'TestDocument.docx') {
        this.office = new MockOfficeHost();
        this.docState = { text: initialText, title: initialTitle };
        this.activeContext = new MockWordContext(this.docState);
        (this.office.context.document as any).getFileAsync = (_type: string, _options: any, callback: (result: any) => void) => {
            if (typeof _options === 'function') callback = _options;
            const bytes = Array.from(new TextEncoder().encode('mock-docx'));
            callback({ status: this.office.AsyncResultStatus.Succeeded, value: { sliceCount: 1, getSliceAsync: (_index: number, done: (result: any) => void) => done({ status: this.office.AsyncResultStatus.Succeeded, value: { index: 0, data: bytes } }), closeAsync: (done?: () => void) => done?.() } });
        };
        (this.activeContext as any).application = { createDocument: (_base64: string) => {
            const copy = new MockWordContext({ ...this.docState }); this.createdContext = copy;
            const created: any = copy.document;
            created.openCallCount = 0;
            created.open = () => { created.openCallCount++; this.openCallCount++; };
            return created;
        } };
    }

    public setParagraphText(newText: string, newTitle?: string): void {
        this.docState.text = newText;
        if (newTitle) {
            this.docState.title = newTitle;
        }
    }

    public triggerSelectionChanged(): void {
        for (const handler of this.office.context.document.handlers) {
            handler({ source: 'user_typing' });
        }
    }

    public createWordRunner(): (callback: (context: any) => Promise<any>) => Promise<any> {
        return async (callback: (context: any) => Promise<any>) => {
            return await callback(this.activeContext);
        };
    }
}
