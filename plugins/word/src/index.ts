/**
 * SmartLinter MS Word Plugin (Shared Runtime Bridge & Idle Monitor)
 *
 * Main entry point for MS Word Office.js Add-in.
 */

import { WordRuntimeManager, type RuntimeManagerConfig } from './runtime_manager.ts';
import { WordBridgeClient, type BridgeClientConfig } from './bridge_client.ts';
import { WordDocumentListener, type DocumentListenerConfig } from './document_listener.ts';

export * from './runtime_manager.ts';
export * from './bridge_client.ts';
export * from './document_listener.ts';
export * from './compensating_journal.ts';
export * from './hash_verifier.ts';
export * from './replacement_executor.ts';
export * from './snapshot_provider.ts';

export interface WordAddinOptions {
    runtimeConfig?: RuntimeManagerConfig;
    bridgeConfig?: BridgeClientConfig;
    listenerConfig?: Partial<DocumentListenerConfig>;
    autoStart?: boolean;
}

export interface WordAddinInstance {
    runtimeManager: WordRuntimeManager;
    bridgeClient: WordBridgeClient;
    documentListener: WordDocumentListener;
}

let activeAddinInstance: WordAddinInstance | null = null;

/**
 * Bootstraps the SmartLinter Word Add-in with Shared Runtime.
 */
export async function initializeWordAddin(options: WordAddinOptions = {}): Promise<WordAddinInstance> {
    if (activeAddinInstance) {
        return activeAddinInstance;
    }

    const runtimeManager = new WordRuntimeManager({
        bridgeConfig: options.bridgeConfig,
        listenerConfig: options.listenerConfig,
        ...options.runtimeConfig,
    });

    await runtimeManager.initialize();

    const bridgeClient = runtimeManager.getBridgeClient()!;
    const documentListener = runtimeManager.getDocumentListener()!;

    activeAddinInstance = {
        runtimeManager,
        bridgeClient,
        documentListener,
    };

    return activeAddinInstance;
}

/**
 * Returns the currently running add-in instance.
 */
export function getActiveAddinInstance(): WordAddinInstance | null {
    return activeAddinInstance;
}

/**
 * Office Ribbon Function file handler for `btnToggleHide` command declared in `manifest.xml`.
 */
export async function btnToggleHide(event?: { completed?: () => void }): Promise<void> {
    try {
        if (activeAddinInstance) {
            const currentVis = activeAddinInstance.runtimeManager.getVisibility();
            if (currentVis === 'Visible') {
                await activeAddinInstance.runtimeManager.hideTaskPane();
            } else {
                await activeAddinInstance.runtimeManager.showTaskPane();
            }
        } else if (typeof (globalThis as any).Office !== 'undefined' && (globalThis as any).Office.addin) {
            const office = (globalThis as any).Office;
            await office.addin.hide();
        }
    } catch {
        // Error isolated
    } finally {
        if (event && typeof event.completed === 'function') {
            event.completed();
        }
    }
}

// Auto-register global function for Office Ribbon execution
if (typeof (globalThis as any) !== 'undefined') {
    (globalThis as any).btnToggleHide = btnToggleHide;
    (globalThis as any).initializeWordAddin = initializeWordAddin;
}
