/**
 * Mock Office.js and Word API Environment for CI and Unit/Integration Testing
 *
 * Implements realistic mock objects for Office.addin (Shared Runtime, hide/show, visibilityMode),
 * Office.onReady, Word.run, and Office Common API DocumentSelectionChanged events.
 * See https://learn.microsoft.com/en-us/javascript/api/office/office.documentselectionchangedeventargs
 */

export type WordBodyMode = 'with-table-in-body' | 'isolated-body';

export interface MockDocumentStructureBodyItem {
    type: 'body';
    text: string;
    ooxml?: string;
}

export interface MockDocumentStructureTableItem {
    type: 'table';
    rows: (string | string[])[][];
}

export type MockDocumentStructureItem = MockDocumentStructureBodyItem | MockDocumentStructureTableItem;

export interface MockDocumentState {
    text: string;
    title: string;
    saved?: boolean;
    bodyMode?: WordBodyMode;
    structure?: MockDocumentStructureItem[];
}

export class MockWordParagraph {
    public text: string;
    public operations: any[];
    public ooxml?: string;

    constructor(text = '', operations: any[] = [], ooxml?: string) {
        this.text = text;
        this.operations = operations;
        this.ooxml = ooxml;
    }

    public load(_prop?: string): void {}

    public getRange(_location?: string): any {
        const makeRange = (start: number, length: number): any => ({
            font: new Proxy({}, {
                set: (_target, property, value) => {
                    if (property === 'underline' && typeof value === 'boolean') {
                        throw new Error('underline must be an enum value');
                    }
                    this.operations.push({ type: 'format', start, length, property, value });
                    return true;
                },
            }),
            insertText: (value: string, location: string) => {
                if (location === 'Replace') {
                    this.text = this.text.slice(0, start) + value + this.text.slice(start + length);
                } else if (location === 'End') {
                    this.text = this.text.slice(0, start + length) + value + this.text.slice(start + length);
                } else {
                    throw new Error(`Unsupported insert location: ${location}`);
                }
                const result = makeRange(start, value.length);
                this.operations.push({ type: 'insert', start, length, value, location });
                return result;
            },
            getSubstring: (offset: number, substringLength: number) => makeRange(start + offset, substringLength),
        });
        return makeRange(0, this.text.length);
    }

    public getOoxml?(): { value: string } {
        if (this.ooxml) return { value: this.ooxml };
        return { value: `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:r><w:t>${this.text}</w:t></w:r></w:p>` };
    }

    public clone(newOperations: any[] = []): MockWordParagraph {
        return new MockWordParagraph(this.text, newOperations, this.ooxml);
    }
}

export class MockWordTableCell {
    public rowIndex: number;
    public cellIndex: number;
    public body: {
        paragraphs: {
            items: MockWordParagraph[];
            load: (prop?: string) => void;
        };
    };
    public paragraphs: {
        items: MockWordParagraph[];
        load: (prop?: string) => void;
    };

    constructor(rowIndex: number, cellIndex: number, paragraphs: MockWordParagraph[]) {
        this.rowIndex = rowIndex;
        this.cellIndex = cellIndex;
        const paraCollection = {
            items: paragraphs,
            load: (_prop?: string) => {},
        };
        this.body = { paragraphs: paraCollection };
        this.paragraphs = paraCollection;
    }

    public load(_prop?: string): void {}
}

export class MockWordTableRow {
    public rowIndex: number;
    public cells: {
        items: MockWordTableCell[];
        load: (prop?: string) => void;
    };

    constructor(rowIndex: number, cells: MockWordTableCell[]) {
        this.rowIndex = rowIndex;
        this.cells = {
            items: cells,
            load: (_prop?: string) => {},
        };
    }

    public load(_prop?: string): void {}
}

export class MockWordTable {
    public tableIndex: number;
    public rows: {
        items: MockWordTableRow[];
        load: (prop?: string) => void;
    };

    constructor(tableIndex: number, rows: MockWordTableRow[]) {
        this.tableIndex = tableIndex;
        this.rows = {
            items: rows,
            load: (_prop?: string) => {},
        };
    }

    public load(_prop?: string): void {}
}

export class MockWordContext {
    public document: {
        saved: boolean;
        body: {
            paragraphs: { items: MockWordParagraph[]; load: (prop: string) => void };
            tables: { items: MockWordTable[]; load: (prop: string) => void };
        };
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
        openCallCount?: number;
        open?: () => void;
        close?: () => void;
    };

    private syncCount = 0;
    public docState: MockDocumentState;
    public operations: any[] = [];
    public bodyMode: WordBodyMode;

    constructor(docState: MockDocumentState) {
        this.docState = docState;
        this.bodyMode = docState.bodyMode || 'isolated-body';
        const { bodyParagraphs, tables } = this.buildHierarchy(docState);

        this.document = {
            saved: docState.saved !== false,
            body: {
                paragraphs: {
                    items: bodyParagraphs,
                    load: (_prop: string) => {},
                },
                tables: {
                    items: tables,
                    load: (_prop: string) => {},
                },
            },
            properties: {
                title: docState.title,
                load: (_prop: string) => {},
            },
            getSelection: () => {
                const firstPara = this.document.body.paragraphs.items[0];
                const currentText = firstPara ? firstPara.text : this.docState.text;
                return {
                    paragraphs: {
                        items: [{ text: currentText }],
                        load: (_prop: string) => {},
                        getFirst: () => ({ text: currentText }),
                    },
                };
            },
        };
    }

    private buildHierarchy(state: MockDocumentState): { bodyParagraphs: MockWordParagraph[]; tables: MockWordTable[] } {
        const bodyParagraphs: MockWordParagraph[] = [];
        const tables: MockWordTable[] = [];

        if (state.structure && state.structure.length > 0) {
            let tableIndexCounter = 0;
            for (const item of state.structure) {
                if (item.type === 'body') {
                    const p = new MockWordParagraph(item.text, this.operations, item.ooxml);
                    bodyParagraphs.push(p);
                } else if (item.type === 'table') {
                    const tableRows: MockWordTableRow[] = [];
                    for (let rIdx = 0; rIdx < item.rows.length; rIdx++) {
                        const rowData = item.rows[rIdx];
                        const cells: MockWordTableCell[] = [];
                        for (let cIdx = 0; cIdx < rowData.length; cIdx++) {
                            const cellData = rowData[cIdx];
                            const paraTexts = Array.isArray(cellData) ? cellData : [cellData];
                            const cellParas: MockWordParagraph[] = paraTexts.map(
                                (text) => new MockWordParagraph(text, this.operations)
                            );
                            const cell = new MockWordTableCell(rIdx, cIdx, cellParas);
                            cells.push(cell);
                            if (this.bodyMode === 'with-table-in-body') {
                                for (const cp of cellParas) {
                                    bodyParagraphs.push(cp);
                                }
                            }
                        }
                        tableRows.push(new MockWordTableRow(rIdx, cells));
                    }
                    const table = new MockWordTable(tableIndexCounter++, tableRows);
                    tables.push(table);
                }
            }
        } else {
            // Default single paragraph
            const p = new MockWordParagraph(state.text || '', this.operations);
            bodyParagraphs.push(p);
        }

        return { bodyParagraphs, tables };
    }

    public cloneContext(): MockWordContext {
        const clone = new MockWordContext({
            text: this.docState.text,
            title: this.docState.title,
            saved: this.docState.saved,
            bodyMode: this.bodyMode,
            structure: this.docState.structure,
        });

        // Deep copy paragraph contents so edits in clone do not affect original
        const paraMap = new Map<MockWordParagraph, MockWordParagraph>();

        // Clone tables
        const clonedTables: MockWordTable[] = [];
        for (const origTable of this.document.body.tables.items) {
            const clonedRows: MockWordTableRow[] = [];
            for (const origRow of origTable.rows.items) {
                const clonedCells: MockWordTableCell[] = [];
                for (const origCell of origRow.cells.items) {
                    const cellParas = (origCell.body?.paragraphs?.items || origCell.paragraphs?.items || []);
                    const clonedCellParas: MockWordParagraph[] = [];
                    for (const origP of cellParas) {
                        const clonedP = origP.clone(clone.operations);
                        paraMap.set(origP, clonedP);
                        clonedCellParas.push(clonedP);
                    }
                    clonedCells.push(new MockWordTableCell(origCell.rowIndex, origCell.cellIndex, clonedCellParas));
                }
                clonedRows.push(new MockWordTableRow(origRow.rowIndex, clonedCells));
            }
            clonedTables.push(new MockWordTable(origTable.tableIndex, clonedRows));
        }

        // Clone body paragraphs
        const clonedBodyParagraphs: MockWordParagraph[] = [];
        for (const origP of this.document.body.paragraphs.items) {
            if (paraMap.has(origP)) {
                // Shared reference from table cell in with-table-in-body mode
                clonedBodyParagraphs.push(paraMap.get(origP)!);
            } else {
                const clonedP = origP.clone(clone.operations);
                paraMap.set(origP, clonedP);
                clonedBodyParagraphs.push(clonedP);
            }
        }

        clone.document.body.paragraphs.items = clonedBodyParagraphs;
        clone.document.body.tables.items = clonedTables;
        return clone;
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
    public FileType = { Compressed: 'compressed', Text: 'text', Pdf: 'pdf' };
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

export interface MockWordEnvironmentOptions {
    bodyMode?: WordBodyMode;
    structure?: MockDocumentStructureItem[];
    saved?: boolean;
}

export class MockWordEnvironment {
    public office: MockOfficeHost;
    public docState: MockDocumentState;
    public activeContext: MockWordContext;
    public createdContext?: MockWordContext;
    public openCallCount = 0;

    constructor(
        initialText = 'This is a sample paragraph in Word.',
        initialTitle = 'TestDocument.docx',
        options?: MockWordEnvironmentOptions
    ) {
        this.office = new MockOfficeHost();
        this.docState = {
            text: initialText,
            title: initialTitle,
            saved: options?.saved,
            bodyMode: options?.bodyMode || 'isolated-body',
            structure: options?.structure,
        };
        this.activeContext = new MockWordContext(this.docState);
        (this.office.context.document as any).getFileAsync = (_type: string, _options: any, callback: (result: any) => void) => {
            if (typeof _options === 'function') callback = _options;
            const bytes = Array.from(new TextEncoder().encode('mock-docx'));
            callback({
                status: this.office.AsyncResultStatus.Succeeded,
                value: {
                    sliceCount: 1,
                    getSliceAsync: (_index: number, done: (result: any) => void) =>
                        done({ status: this.office.AsyncResultStatus.Succeeded, value: { index: 0, data: bytes } }),
                    closeAsync: (done?: () => void) => done?.(),
                },
            });
        };
        (this.activeContext as any).application = {
            createDocument: (_base64: string) => {
                const copy = this.activeContext.cloneContext();
                this.createdContext = copy;
                const created: any = copy.document;
                created.openCallCount = 0;
                created.open = () => {
                    created.openCallCount++;
                    this.openCallCount++;
                };
                created.close = () => {};
                return created;
            },
        };
    }

    public setParagraphText(newText: string, newTitle?: string): void {
        this.docState.text = newText;
        if (this.activeContext.document.body.paragraphs.items[0]) {
            this.activeContext.document.body.paragraphs.items[0].text = newText;
        }
        if (newTitle) {
            this.docState.title = newTitle;
            this.activeContext.document.properties.title = newTitle;
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

    public createTable(rowCellTexts: (string | string[])[][], tableIndex?: number): MockWordTable {
        const tIdx = tableIndex ?? this.activeContext.document.body.tables.items.length;
        const rows: MockWordTableRow[] = [];
        for (let rIdx = 0; rIdx < rowCellTexts.length; rIdx++) {
            const rowData = rowCellTexts[rIdx];
            const cells: MockWordTableCell[] = [];
            for (let cIdx = 0; cIdx < rowData.length; cIdx++) {
                const cellData = rowData[cIdx];
                const paraTexts = Array.isArray(cellData) ? cellData : [cellData];
                const cellParas = paraTexts.map((text) => new MockWordParagraph(text, this.activeContext.operations));
                const cell = new MockWordTableCell(rIdx, cIdx, cellParas);
                cells.push(cell);
                if (this.activeContext.bodyMode === 'with-table-in-body') {
                    for (const cp of cellParas) {
                        this.activeContext.document.body.paragraphs.items.push(cp);
                    }
                }
            }
            rows.push(new MockWordTableRow(rIdx, cells));
        }
        const table = new MockWordTable(tIdx, rows);
        this.activeContext.document.body.tables.items.push(table);
        return table;
    }
}

export class WordMockWithTableInBody extends MockWordEnvironment {
    constructor(structure?: MockDocumentStructureItem[], title = 'TestDocument.docx') {
        super('', title, { bodyMode: 'with-table-in-body', structure });
    }
}

export class WordMockIsolatedBody extends MockWordEnvironment {
    constructor(structure?: MockDocumentStructureItem[], title = 'TestDocument.docx') {
        super('', title, { bodyMode: 'isolated-body', structure });
    }
}
