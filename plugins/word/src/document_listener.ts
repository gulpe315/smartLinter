/**
 * SmartLinter MS Word Document Listener & Idle Debounce Monitor
 *
 * Subscribes to the Office Common API `DocumentSelectionChanged` event, applies a 1.5-second
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
    /** Office Common API host for event registration (injected by tests/runtime). */
    officeHost?: any;
    /** Receives the latest title read during active paragraph extraction. */
    onDocumentTitleUpdated?: (title: string) => void;
}

export type ParagraphCapturedHandler = (payload: ParagraphPayload) => void | Promise<void>;

export class WordDocumentListener {
    private readonly bridgeClient: WordBridgeClient;
    private readonly idleDebounceMs: number;
    private readonly documentSource: string;
    private readonly targetLanguage?: string;
    private readonly wordRunner: (callback: (context: any) => Promise<any>) => Promise<any>;
    private readonly officeHost: any;
    private readonly onDocumentTitleUpdated?: (title: string) => void;

    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private isRunning = false;
    private lastSentParagraphId: string | null = null;
    private lastSentHash: string | null = null;
    private lastSentPayload: ParagraphPayload | null = null;
    private eventRegistrationHandler: any = null;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;
    private retryAttempt = 0;
    private pendingRetryPayload: ParagraphPayload | null = null;

    private readonly capturedHandlers: Set<ParagraphCapturedHandler> = new Set();

    constructor(config: DocumentListenerConfig) {
        this.bridgeClient = config.bridgeClient;
        this.idleDebounceMs = config.idleDebounceMs ?? 1500;
        this.documentSource = config.documentSource || 'ActiveWordDocument.docx';
        this.targetLanguage = config.targetLanguage;
        this.officeHost = config.officeHost || (typeof (globalThis as any).Office !== 'undefined' ? (globalThis as any).Office : null);
        this.onDocumentTitleUpdated = config.onDocumentTitleUpdated;
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

        const office = this.officeHost;
        if (!office?.context?.document?.addHandlerAsync || !office?.EventType?.DocumentSelectionChanged) {
            console.warn('[WordDocumentListener] Office Common API is unavailable; listener was not registered.');
            return false;
        }

        return new Promise<boolean>((resolve) => {
            this.eventRegistrationHandler = () => this.triggerDebouncedCapture();
            office.context.document.addHandlerAsync(
                office.EventType.DocumentSelectionChanged,
                this.eventRegistrationHandler,
                async (result: any) => {
                    const succeeded = result?.status === office.AsyncResultStatus?.Succeeded || result?.status === 'succeeded';
                    if (!succeeded) {
                        console.error('[WordDocumentListener] Failed to register DocumentSelectionChanged:', result?.error);
                        this.eventRegistrationHandler = null;
                        this.isRunning = false;
                        resolve(false);
                        return;
                    }
                    this.isRunning = true;
                    await this.captureAndDispatchActiveParagraph();
                    resolve(true);
                }
            );
        });
    }

    /** Stops listening and clears any pending debounce timers */
    public async stop(): Promise<void> {
        this.isRunning = false;
        this.cancelDebounce();
        this.cancelRetry();

        if (this.eventRegistrationHandler) {
            const office = this.officeHost;
            if (office?.context?.document?.removeHandlerAsync && office?.EventType?.DocumentSelectionChanged) {
                await new Promise<void>((resolve) => {
                    office.context.document.removeHandlerAsync(
                        office.EventType.DocumentSelectionChanged,
                        { handler: this.eventRegistrationHandler },
                        (result: any) => {
                            const succeeded = result?.status === office.AsyncResultStatus?.Succeeded || result?.status === 'succeeded';
                            if (!succeeded) console.error('[WordDocumentListener] Failed to remove DocumentSelectionChanged:', result?.error);
                            resolve();
                        }
                    );
                });
            }
            this.eventRegistrationHandler = null;
        }
    }

    /**
     * Called whenever the Office Common API selection event fires.
     * Resets the 1.5s idle debounce timer.
     */
    public handleSelectionChanged(): void {
        this.triggerDebouncedCapture();
    }

    /** Schedules a capture after the idle period, replacing stale work and retries. */
    public triggerDebouncedCapture(): void {
        if (!this.isRunning) {
            return;
        }

        this.cancelDebounce();
        this.cancelRetry();

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

    private cancelRetry(): void {
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = null;
        this.retryAttempt = 0;
        this.pendingRetryPayload = null;
    }

    private scheduleRetry(payload: ParagraphPayload): void {
        this.pendingRetryPayload = payload;
        if (this.retryAttempt >= 3 || !this.isRunning) {
            return;
        }
        const delayMs = 1000 * (2 ** this.retryAttempt++);
        this.retryTimer = setTimeout(async () => {
            this.retryTimer = null;
            const retryPayload = this.pendingRetryPayload;
            if (!retryPayload || !this.isRunning) return;
            await this.dispatchPayload(retryPayload);
        }, delayMs);
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

            await this.dispatchPayload(payload);

            return payload;
        } catch (err) {
            console.error('[WordDocumentListener] Capture/dispatch error:', err);
            return null;
        }
    }

    private async dispatchPayload(payload: ParagraphPayload): Promise<boolean> {
        try {
            const sendSuccess = await this.bridgeClient.sendParagraphPayload(payload);
            if (!sendSuccess) {
                console.warn('[WordDocumentListener] Telemetry dispatch failed; dedup cache was not updated.');
                this.scheduleRetry(payload);
                return false;
            }
            this.lastSentParagraphId = payload.paragraphId;
            this.lastSentHash = payload.hash;
            this.lastSentPayload = payload;
            this.retryAttempt = 0;
            this.pendingRetryPayload = null;
            for (const handler of this.capturedHandlers) {
                try {
                    await handler(payload);
                } catch (err) {
                    console.error('[WordDocumentListener] Paragraph captured handler failed:', err);
                }
            }
            return true;
        } catch (err) {
            console.error('[WordDocumentListener] Telemetry dispatch error:', err);
            this.scheduleRetry(payload);
            return false;
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
                this.onDocumentTitleUpdated?.(sourceName);
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
