import { initializeWordAddin, type WordAddinInstance } from './index.ts';
import type { BridgeConnectionStatus } from './bridge_client.ts';

declare const Office: any;
declare const Word: any;

const app = document.querySelector<HTMLElement>('#app');

if (!app) {
    throw new Error('Taskpane root element is missing.');
}

app.innerHTML = `
  <section style="font-family: system-ui, sans-serif; padding: 16px; color: #1f2937">
    <h1 style="font-size: 18px; margin: 0 0 16px">SmartLinter Bridge</h1>
    <p style="margin: 0 0 8px"><strong>Connection:</strong> <span id="bridge-status">Starting…</span></p>
    <p id="session-row" style="display: none; margin: 0 0 8px"><strong>Session ID:</strong> <span id="session-id"></span></p>
    <p id="document-row" style="display: none; margin: 0"><strong>Document:</strong> <span id="document-name"></span></p>
    <p id="dashboard-guide" style="margin: 16px 0 0">Open the SmartLinter dashboard to review QA cards.</p>
  </section>`;

const statusElement = document.querySelector<HTMLElement>('#bridge-status')!;
const sessionRow = document.querySelector<HTMLElement>('#session-row')!;
const sessionElement = document.querySelector<HTMLElement>('#session-id')!;
const documentRow = document.querySelector<HTMLElement>('#document-row')!;
const documentElement = document.querySelector<HTMLElement>('#document-name')!;

function renderStatus(status: BridgeConnectionStatus, message?: string): void {
    const connected = status === 'CONNECTED';
    statusElement.textContent = message ? `${status} — ${message}` : status;
    statusElement.style.color = connected ? '#15803d' : '#b91c1c';
}

function renderSession(instance: WordAddinInstance): void {
    const sessionId = instance.bridgeClient.getSessionToken();
    sessionRow.style.display = sessionId ? 'block' : 'none';
    sessionElement.textContent = sessionId ?? '';
}

async function renderDocumentName(): Promise<void> {
    try {
        await Word.run(async (context: any) => {
            const properties = context.document.properties;
            properties.load('title');
            await context.sync();
            if (properties.title) {
                documentRow.style.display = 'block';
                documentElement.textContent = properties.title;
            }
        });
    } catch {
        // Word APIs are unavailable when this page is opened directly in a browser.
    }
}

Office.onReady(async () => {
    try {
        const instance = await initializeWordAddin();
        renderStatus(instance.bridgeClient.getStatus());
        renderSession(instance);
        instance.bridgeClient.onStatusChange((status, message) => {
            renderStatus(status, message);
            renderSession(instance);
        });
        await renderDocumentName();
        console.info('SmartLinter Word taskpane initialization attempted.');
    } catch (error) {
        renderStatus('ERROR', error instanceof Error ? error.message : 'Initialization failed');
        console.error('SmartLinter Word taskpane initialization failed.', error);
    }
});
