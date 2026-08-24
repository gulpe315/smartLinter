/**
 * Mock InDesign ExtendScript & UXP Environment for Headless Unit/Integration Testing
 * 
 * Accurately simulates InDesign's:
 * - `app.idleTasks` collection and IdleEvent lifecycle
 * - `app.documents` and `app.selection` (TextFrame, Story, Paragraph)
 * - ExtendScript `Socket` class for raw HTTP/TCP communication
 * - Native InDesign DOM events (`afterSelectionChanged`, `afterAttributeChanged`)
 */

export interface MockParagraph {
    contents: string;
    parentStory?: { id: string };
    characters?: {
        itemByRange: (start: number, end: number) => { contents: string };
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

export class MockInDesignEnvironment {
    public documents: MockDocument[] = [];
    public activeDocument: MockDocument | null = null;
    public selection: any[] = [];
    public idleTaskList: Map<string, MockIdleTask> = new Map();
    public appListeners: Map<string, Array<(event: any) => void>> = new Map();

    public socketInstances: MockSocket[] = [];
    public socketHandler?: (req: string) => string;

    constructor(initialText = 'Default InDesign editorial paragraph.', docName = 'Magazine_Spread.indd') {
        const doc: MockDocument = { id: 'doc-id-001', name: docName };
        this.documents = [doc];
        this.activeDocument = doc;
        this.setSelectionText(initialText, docName);
    }

    public setSelectionText(text: string, docName?: string, storyId = 'story-100'): void {
        if (docName && this.activeDocument) {
            this.activeDocument.name = docName;
        }

        const paragraph: MockParagraph = {
            contents: text,
            parentStory: { id: storyId },
            characters: {
                itemByRange: (start: number, end: number) => {
                    const slice = text.substring(start, end + 1);
                    return {
                        get contents() { return slice; },
                        set contents(val: string) {
                            text = text.substring(0, start) + val + text.substring(end + 1);
                        }
                    };
                }
            }
        };

        const frame: MockTextFrame = {
            paragraphs: [paragraph],
            texts: [{ paragraphs: [paragraph] }],
            parentStory: { id: storyId }
        };

        this.selection = [frame];
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

    public getApp(): any {
        const self = this;
        return {
            get documents() { return self.documents; },
            get activeDocument() { return self.activeDocument; },
            get selection() { return self.selection; },

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

    public triggerIdleTick(taskName = 'smartlinter_persistent_monitor'): void {
        const task = this.idleTaskList.get(taskName);
        if (task && task.isValid) {
            const handlers = task.listeners.get('onIdle') || task.listeners.get('ON_IDLE') || [];
            for (const handler of handlers) {
                handler({ name: 'onIdle', time: Date.now() });
            }
        }
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
}
