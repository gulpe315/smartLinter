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
}

export class MockWordContext {
    public document: {
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

    constructor(docState: MockDocumentState) {
        this.docState = docState;
        this.document = {
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

    constructor(initialText = 'This is a sample paragraph in Word.', initialTitle = 'TestDocument.docx') {
        this.office = new MockOfficeHost();
        this.docState = { text: initialText, title: initialTitle };
        this.activeContext = new MockWordContext(this.docState);
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
