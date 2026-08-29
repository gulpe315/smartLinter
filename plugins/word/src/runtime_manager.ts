/**
 * SmartLinter MS Word Shared Runtime Manager
 *
 * Manages Office.js Shared Runtime lifecycle (lifetime: "long"), configures auto-start behavior
 * on document open, immediately executes `Office.addin.hide()` on startup to run 100% in background,
 * tracks Task Pane visibility modes, and orchestrates the bridge client & document listener.
 */

import { WordBridgeClient, type BridgeClientConfig } from './bridge_client.ts';
import { WordDocumentListener, type DocumentListenerConfig } from './document_listener.ts';
import { queryLiveParagraphSnapshots } from './snapshot_provider.ts';
import { enumerateAllDocumentParagraphs } from './document_scanner.ts';
import { locateWordParagraph } from './locate_provider.ts';
import { WordReplacementExecutor } from './replacement_executor.ts';
import { generateTranslatedWordDocument } from './document_generator.ts';

export type VisibilityMode = 'Visible' | 'Hidden' | 'Uninitialized';

export interface RuntimeManagerConfig {
    /** Configuration for the bridge client */
    bridgeConfig?: BridgeClientConfig;
    /** Configuration for the document listener */
    listenerConfig?: Partial<DocumentListenerConfig>;
    /** Whether to automatically hide Task Pane on startup (default: true) */
    autoHideOnStartup?: boolean;
    /** Whether to configure startupBehavior=load on startup (default: true) */
    autoSetStartupBehavior?: boolean;
    /** Custom Office host object for injection / testing */
    officeHost?: any;
}

export class WordRuntimeManager {
    private readonly bridgeConfig?: BridgeClientConfig;
    private readonly listenerConfig?: Partial<DocumentListenerConfig>;
    private readonly autoHideOnStartup: boolean;
    private readonly autoSetStartupBehavior: boolean;
    private readonly officeHost: any;

    private bridgeClient: WordBridgeClient | null = null;
    private documentListener: WordDocumentListener | null = null;
    private visibility: VisibilityMode = 'Uninitialized';
    private isInitialized = false;
    private isShuttingDown = false;
    private cachedDocumentTitle = 'ActiveWordDocument.docx';
    private snapshotRequestUnsubscribe: (() => void) | null = null;
    private enumerateDocumentRequestUnsubscribe: (() => void) | null = null;
    private generateTranslatedDocumentUnsubscribe: (() => void) | null = null;
    private locateRequestUnsubscribe: (() => void) | null = null;
    private commandUnsubscribe: (() => void) | null = null;

    private readonly visibilityChangeHandlers: Set<(mode: VisibilityMode) => void> = new Set();

    constructor(config: RuntimeManagerConfig = {}) {
        this.bridgeConfig = config.bridgeConfig;
        this.listenerConfig = config.listenerConfig;
        this.autoHideOnStartup = config.autoHideOnStartup !== false;
        this.autoSetStartupBehavior = config.autoSetStartupBehavior !== false;
        this.officeHost = config.officeHost || (typeof (globalThis as any).Office !== 'undefined' ? (globalThis as any).Office : null);
    }

    /** Returns the current visibility mode of the Task Pane */
    public getVisibility(): VisibilityMode {
        return this.visibility;
    }

    /** Returns whether the runtime has completed initialization */
    public isReady(): boolean {
        return this.isInitialized;
    }

    /** Returns the active bridge client */
    public getBridgeClient(): WordBridgeClient | null {
        return this.bridgeClient;
    }

    /** Returns the active document listener */
    public getDocumentListener(): WordDocumentListener | null {
        return this.documentListener;
    }

    /** Subscribes to visibility mode changes */
    public onVisibilityChange(handler: (mode: VisibilityMode) => void): () => void {
        this.visibilityChangeHandlers.add(handler);
        return () => this.visibilityChangeHandlers.delete(handler);
    }

    /**
     * Initializes Office.js Shared Runtime, applies auto-start settings,
     * immediately hides the Task Pane to run purely in the background,
     * and boots the bridge client and document listener.
     */
    public async initialize(): Promise<boolean> {
        if (this.isInitialized) {
            return true;
        }

        const office = this.officeHost;
        if (!office) {
            // Standalone or mock fallback without Office global
            this.visibility = 'Hidden';
            this.setupComponents();
            this.isInitialized = true;
            return true;
        }

        return new Promise((resolve) => {
            office.onReady(async (info: any) => {
                try {
                    const isWord = info && (info.host === 'Word' || info.host === office.HostType?.Word);

                    // 1. Set startup behavior so add-in loads automatically with document open
                    if (this.autoSetStartupBehavior && office.addin && office.addin.setStartupBehavior) {
                        try {
                            const startupMode = office.StartupBehavior ? office.StartupBehavior.load : 'Load';
                            await office.addin.setStartupBehavior(startupMode);
                        } catch {
                            // Non-fatal if setting startup behavior is not permitted
                        }
                    }

                    // 2. Register visibility change handler
                    if (office.addin && office.addin.onVisibilityModeChanged) {
                        office.addin.onVisibilityModeChanged((args: any) => {
                            const newMode: VisibilityMode = args && args.visibilityMode === 'Visible' ? 'Visible' : 'Hidden';
                            this.setVisibilityMode(newMode);
                        });
                    }

                    // 3. Immediately hide Task Pane for 100% background operation (Criterion 2)
                    if (this.autoHideOnStartup && office.addin && office.addin.hide) {
                        try {
                            await office.addin.hide();
                            this.setVisibilityMode('Hidden');
                        } catch {
                            this.setVisibilityMode('Hidden');
                        }
                    } else {
                        this.setVisibilityMode('Visible');
                    }

                    // 4. Setup Bridge Client and Document Listener
                    this.setupComponents();

                    // 5. Connect bridge & start listener
                    if (this.bridgeClient) {
                        this.bridgeClient.connect().catch(() => {});
                    }
                    if (this.documentListener) {
                        const listenerOk = await this.documentListener.start();
                        if (!listenerOk) console.warn('[WordRuntimeManager] DocumentListener failed to start properly.');
                    }

                    this.isInitialized = true;
                    resolve(true);
                } catch {
                    this.isInitialized = true;
                    resolve(false);
                }
            });
        });
    }

    /**
     * Explicitly hides the Task Pane via `Office.addin.hide()`.
     */
    public async hideTaskPane(): Promise<boolean> {
        const office = this.officeHost;
        if (office && office.addin && office.addin.hide) {
            try {
                await office.addin.hide();
                this.setVisibilityMode('Hidden');
                return true;
            } catch {
                return false;
            }
        }
        this.setVisibilityMode('Hidden');
        return true;
    }

    /**
     * Restores Task Pane visibility via `Office.addin.showAsTaskpane()`.
     */
    public async showTaskPane(): Promise<boolean> {
        const office = this.officeHost;
        if (office && office.addin && office.addin.showAsTaskpane) {
            try {
                await office.addin.showAsTaskpane();
                this.setVisibilityMode('Visible');
                return true;
            } catch {
                return false;
            }
        }
        this.setVisibilityMode('Visible');
        return true;
    }

    /**
     * Shuts down the runtime, disconnects bridge client, and stops document listener.
     */
    public async shutdown(): Promise<void> {
        this.isShuttingDown = true;

        if (this.documentListener) {
            await this.documentListener.stop();
            this.documentListener = null;
        }

        if (this.bridgeClient) {
            this.snapshotRequestUnsubscribe?.();
            this.snapshotRequestUnsubscribe = null;
            this.enumerateDocumentRequestUnsubscribe?.();
            this.enumerateDocumentRequestUnsubscribe = null;
            this.generateTranslatedDocumentUnsubscribe?.();
            this.generateTranslatedDocumentUnsubscribe = null;
            this.locateRequestUnsubscribe?.();
            this.locateRequestUnsubscribe = null;
            this.commandUnsubscribe?.();
            this.commandUnsubscribe = null;
            this.bridgeClient.disconnect();
            this.bridgeClient = null;
        }

        this.isInitialized = false;
        this.visibility = 'Uninitialized';
    }

    private setupComponents(): void {
        if (!this.bridgeClient) {
            this.bridgeClient = new WordBridgeClient({
                getDocumentName: () => this.cachedDocumentTitle,
                ...this.bridgeConfig,
            });
        }

        if (!this.documentListener && this.bridgeClient) {
            this.documentListener = new WordDocumentListener({
                bridgeClient: this.bridgeClient,
                officeHost: this.officeHost,
                onDocumentTitleUpdated: (title) => {
                    this.cachedDocumentTitle = title;
                },
                ...this.listenerConfig,
            });
        }

        if (this.bridgeClient && !this.snapshotRequestUnsubscribe) {
            this.snapshotRequestUnsubscribe = this.bridgeClient.onSnapshotRequest(async (request) => {
                const wordRunner = (globalThis as any).Word?.run;
                const response = wordRunner
                    ? await queryLiveParagraphSnapshots(request, wordRunner)
                    : {
                        requestId: request.requestId,
                        results: request.paragraphIds.map((paragraphId) => ({
                            paragraphId,
                            status: 'ERROR' as const,
                            message: 'Office.js Word.run is unavailable',
                        })),
                    };
                this.bridgeClient?.sendSnapshotResponse(response);
            });
        }

        if (this.bridgeClient && !this.enumerateDocumentRequestUnsubscribe) {
            this.enumerateDocumentRequestUnsubscribe = this.bridgeClient.onEnumerateDocumentRequest(async (request) => {
                const wordRunner = (globalThis as any).Word?.run;
                const response = wordRunner
                    ? await enumerateAllDocumentParagraphs(request, wordRunner)
                    : { requestId: request.requestId, sourceDocumentName: '', paragraphs: [] };
                this.bridgeClient?.sendEnumerateDocumentResponse(response);
            });
        }

        if (this.bridgeClient && !this.generateTranslatedDocumentUnsubscribe) {
            this.generateTranslatedDocumentUnsubscribe = this.bridgeClient.onGenerateTranslatedDocumentRequest(async (request) => {
                const response = await generateTranslatedWordDocument(request, (globalThis as any).Word?.run, this.officeHost || (globalThis as any).Office);
                this.bridgeClient?.sendGenerateTranslatedDocumentResponse(response);
            });
        }

        if (this.bridgeClient && !this.locateRequestUnsubscribe) {
            this.locateRequestUnsubscribe = this.bridgeClient.onLocateRequest(async (request) => {
                const wordRunner = (globalThis as any).Word?.run;
                const response = wordRunner
                    ? await locateWordParagraph(request, wordRunner)
                    : { requestId: request.requestId, status: 'SELECTION_FAILED' as const, message: 'Office.js Word.run is unavailable' };
                this.bridgeClient?.sendLocateResponse(response);
            });
        }

        if (this.bridgeClient && !this.commandUnsubscribe) {
            this.commandUnsubscribe = this.bridgeClient.onCommand(async (command) => {
                const wordRunner = (globalThis as any).Word?.run;
                if (!wordRunner) {
                    this.bridgeClient?.sendReplacementResult({
                        commandId: command.commandId,
                        status: 'FAILED',
                        currentHash: '',
                        message: 'Office.js Word.run is unavailable',
                    });
                    return;
                }
                const executor = new WordReplacementExecutor({
                    wordRunner,
                    bridgeClient: this.bridgeClient!,
                });
                try {
                    await executor.execute(command);
                } catch (error) {
                    this.bridgeClient?.sendReplacementResult({
                        commandId: command.commandId,
                        status: 'FAILED',
                        currentHash: '',
                        message: `Unexpected Word replacement error: ${(error as Error).message}`,
                    });
                }
            });
        }
    }

    private setVisibilityMode(mode: VisibilityMode): void {
        if (this.visibility !== mode) {
            this.visibility = mode;
            for (const handler of this.visibilityChangeHandlers) {
                try {
                    handler(mode);
                } catch {
                    // Handler error isolated
                }
            }
        }
    }
}
