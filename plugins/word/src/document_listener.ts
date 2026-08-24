/**
 * SmartLinter MS Word Document Listener & Idle Debounce Monitor
 *
 * Subscribes to Word `context.document.onSelectionChanged` events, applies a 1.5-second
 * idle debounce timer, extracts cursor-active paragraph text, computes deterministic SHA-256
 * hashes via `computeParagraphHash`, and emits `ParagraphPayload` telemetry.
 */

import { type ParagraphPayload } from '../../../shared/protocol/types.ts';
import { computeParagraphHash } from '../../../shared/engine/hash_util.ts';
import { WordBridgeClient } from './bridge_client.ts';

export interface DocumentListenerConfig {
    /** Bridge client instance used for sending telemetry */
    bridgeClient: WordBridgeClient;
    /** Idle debounce duration in milliseconds (default: 1500ms = 1.5 seconds) */
    idleDebounceMs?: number;
    /** Document title or source identifier (optional fallback) */
    documentSource?: string;
    /** Target language code or context (optional) */
    targetLanguage?: string;
    /** Custom Word.run runner for dependency injection / testing */
    wordRunner?: (callback: (context: any) => Promise<any>) => Promise<any>;
}

export type ParagraphCapturedHandler = (payload: ParagraphPayload) => void | Promise<void>;

export class WordDocumentListener {
    private readonly bridgeClient: WordBridgeClient;
    private readonly idleDebounceMs: number;
    private readonly documentSource: string;
    private readonly targetLanguage?: string;
    private readonly wordRunner: (callback: (context: any) => Promise<any>) => Promise<any>;

    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private isRunning = false;
    private lastSentParagraphId: string | null = null;
    private lastSentHash: string | null = null;
    private lastSentPayload: ParagraphPayload | null = null;
    private eventRegistrationHandler: any = null;

    private readonly capturedHandlers: Set<ParagraphCapturedHandler> = new Set();

    constructor(config: DocumentListenerConfig) {
        this.bridgeClient = config.bridgeClient;
        this.idleDebounceMs = config.idleDebounceMs ?? 1500;
        this.documentSource = config.documentSource || 'ActiveWordDocument.docx';
        this.targetLanguage = config.targetLanguage;
        this.wordRunner =
            config.wordRunner ||
            ((callback) => {
                if (typeof (globalThis as any).Word !== 'undefined' && (globalThis as any).Word.run) {
                    return (globalThis as any).Word.run(callback);
                }
                return Promise.reject(new Error('Word.js API is not available in current environment'));
            });
    }

    /** Returns whether the listener is actively listening */
    public isActive(): boolean {
        return this.isRunning;
    }

    /** Returns whether an idle debounce timer is currently ticking */
    public isDebouncePending(): boolean {
        return this.debounceTimer !== null;
    }

    /** Subscribes to paragraph capture events */
    public onParagraphCaptured(handler: ParagraphCapturedHandler): () => void {
        this.capturedHandlers.add(handler);
        return () => this.capturedHandlers.delete(handler);
    }

    /** Starts listening to Word selection changes */
    public async start(): Promise<boolean> {
        if (this.isRunning) {
            return true;
        }

        try {
            await this.wordRunner(async (context: any) => {
                const doc = context.document;
                if (doc && doc.onSelectionChanged) {
                    this.eventRegistrationHandler = () => {
                        this.handleSelectionChanged();
                    };
                    doc.onSelectionChanged.add(this.eventRegistrationHandler);
                    await context.sync();
                }
            });

            this.isRunning = true;
            return true;
        } catch (err) {
            // In standalone test or non-Office environment, running flag can still be enabled
            this.isRunning = true;
            return false;
        }
    }

    /** Stops listening and clears any pending debounce timers */
    public async stop(): Promise<void> {
        this.isRunning = false;
        this.cancelDebounce();

        if (this.eventRegistrationHandler) {
            try {
                await this.wordRunner(async (context: any) => {
                    const doc = context.document;
                    if (doc && doc.onSelectionChanged && doc.onSelectionChanged.remove) {
                        doc.onSelectionChanged.remove(this.eventRegistrationHandler);
                        await context.sync();
                    }
                });
            } catch {
                // Ignore removal errors on teardown
            }
            this.eventRegistrationHandler = null;
        }
    }

    /**
     * Called whenever `Word.document.onSelectionChanged` fires.
     * Resets the 1.5s idle debounce timer.
     */
    public handleSelectionChanged(): void {
        if (!this.isRunning) {
            return;
        }

        this.cancelDebounce();

        this.debounceTimer = setTimeout(async () => {
            this.debounceTimer = null;
            await this.captureAndDispatchActiveParagraph();
        }, this.idleDebounceMs);
    }

    /** Cancels any active debounce timer */
    public cancelDebounce(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
    }

    /** Immediately flushes the pending debounce timer and captures paragraph */
    public async flushDebounce(): Promise<ParagraphPayload | null> {
        this.cancelDebounce();
        return this.captureAndDispatchActiveParagraph();
    }

    /**
     * Directly extracts the cursor-active paragraph, computes its hash, and dispatches to bridge.
     */
    public async captureAndDispatchActiveParagraph(): Promise<ParagraphPayload | null> {
        try {
            const extracted = await this.extractActiveParagraph();
            if (!extracted) {
                return null;
            }

            const { text, paragraphId, source } = extracted;
            const hash = computeParagraphHash(text);

            // Skip redundant transmission if identical paragraph and content hash
            if (this.lastSentParagraphId === paragraphId && this.lastSentHash === hash) {
                return this.lastSentPayload;
            }

            const payload: ParagraphPayload = {
                paragraphId,
                text,
                hash,
                source,
                target: this.targetLanguage,
                timestamp: Date.now(),
                editorType: 'Word',
            };

            this.lastSentParagraphId = paragraphId;
            this.lastSentHash = hash;
            this.lastSentPayload = payload;

            // Send to Bridge Server
            await this.bridgeClient.sendParagraphPayload(payload);

            // Notify local subscribers
            for (const handler of this.capturedHandlers) {
                try {
                    await handler(payload);
                } catch {
                    // Handler error isolated
                }
            }

            return payload;
        } catch (err) {
            return null;
        }
    }

    /**
     * Extracts raw text, paragraphId, and document source from current Word selection.
     */
    public async extractActiveParagraph(): Promise<{ text: string; paragraphId: string; source: string } | null> {
        let extractedText = '';
        let sourceName = this.documentSource;
        let pId = '';

        await this.wordRunner(async (context: any) => {
            const selection = context.document.getSelection();
            const paragraphs = selection.paragraphs;
            paragraphs.load('text');

            // Optionally load document title if available
            if (context.document.properties) {
                context.document.properties.load('title');
            }

            await context.sync();

            if (paragraphs.items && paragraphs.items.length > 0) {
                const firstPara = paragraphs.items[0];
                extractedText = firstPara.text || '';
            } else if (paragraphs.getFirst) {
                const firstPara = paragraphs.getFirst();
                extractedText = firstPara ? firstPara.text || '' : '';
            }

            if (context.document.properties && context.document.properties.title) {
                sourceName = context.document.properties.title;
            }

            // Derive stable paragraph identifier
            const normalizedTextSample = extractedText.trim().slice(0, 32);
            const contentHash = computeParagraphHash(extractedText).slice(0, 12);
            pId = `word-para-${contentHash}`;
        });

        return {
            text: extractedText,
            paragraphId: pId || `word-para-${Date.now()}`,
            source: sourceName,
        };
    }

    /** Returns the last successfully sent payload */
    public getLastSentPayload(): ParagraphPayload | null {
        return this.lastSentPayload;
    }
}
