/**
 * SmartLinter InDesign UXP Configuration & Status Panel Controller
 * 
 * Provides UI controls for configuring Bridge Server connection settings,
 * viewing live daemon telemetry, and triggering immediate paragraph rescans.
 * 
 * NOTE: The background event loop and monitoring daemon reside permanently in ExtendScript
 * `#targetengine "smartlinter_persistent_engine"` and continue running even when this UXP panel is CLOSED.
 */

let uxpLifecycleState = 'UNINITIALIZED'; // UNINITIALIZED | CREATED | SHOWN | HIDDEN | DESTROYED
let uiRefreshTimer = null;
let lastKnownStatus = null;
const panelLogs = [];

/**
 * Appends a log line to panel console and DOM log box
 */
function log(msg) {
    const timestamp = new Date().toISOString().substring(11, 19);
    const entry = `[${timestamp}] [UXP:${uxpLifecycleState}] ${msg}`;
    panelLogs.push(entry);
    if (panelLogs.length > 200) {
        panelLogs.shift();
    }

    if (typeof document !== 'undefined') {
        const logBox = document.getElementById('logBox');
        if (logBox) {
            logBox.textContent += entry + '\n';
            logBox.scrollTop = logBox.scrollHeight;
        }
    }
    console.log(entry);
}

/**
 * Updates the UI status badges and indicators
 */
function updateBridgeStatusUI(status, details) {
    if (typeof document === 'undefined') return;

    const pill = document.getElementById('bridgeStatusPill');
    if (pill) {
        pill.textContent = status;
        pill.className = 'status-pill ' + (
            status === 'CONNECTED' ? 'pill-connected' :
            status === 'CONNECTING' ? 'pill-connecting' : 'pill-disconnected'
        );
    }

    if (details) {
        if (details.tickCount !== undefined) {
            const tickEl = document.getElementById('statTickCount');
            if (tickEl) tickEl.textContent = String(details.tickCount);
        }
        if (details.activeDoc) {
            const docEl = document.getElementById('statActiveDoc');
            if (docEl) docEl.textContent = details.activeDoc;
        }
        if (details.lastHash) {
            const hashEl = document.getElementById('lastHash');
            if (hashEl) hashEl.textContent = 'Hash: ' + details.lastHash.substring(0, 10) + '...';
        }
    }
}

/**
 * Safe InDesign ExtendScript execution helper from UXP
 */
async function executeExtendScript(scriptCode) {
    try {
        const indesign = typeof require !== 'undefined' ? require('indesign') : null;
        if (indesign && indesign.app && indesign.app.doScript) {
            return indesign.app.doScript(scriptCode, 1246973031 /* ScriptLanguage.JAVASCRIPT */);
        }
    } catch (e) {
        log('ExtendScript execution error: ' + (e && e.message ? e.message : String(e)));
    }
    return null;
}

/**
 * Connect / Reconnect to Bridge Server
 */
async function handleConnectBridge() {
    const hostEl = typeof document !== 'undefined' ? document.getElementById('serverHost') : null;
    const portEl = typeof document !== 'undefined' ? document.getElementById('serverPort') : null;
    const tokenEl = typeof document !== 'undefined' ? document.getElementById('secretToken') : null;

    const host = hostEl ? hostEl.value : '127.0.0.1';
    const port = portEl ? parseInt(portEl.value, 10) : 49152;
    const token = tokenEl ? tokenEl.value : '';

    log(`Attempting connection to Bridge Server at ${host}:${port}...`);
    updateBridgeStatusUI('CONNECTING');

    // Direct REST test from UXP or trigger ExtendScript daemon
    try {
        const res = await fetch(`http://${host}:${port}/auth/handshake`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token,
                editorType: 'InDesign',
                version: '0.1.0',
                clientNonce: 'uxp-' + Date.now()
            }),
            signal: AbortSignal.timeout(3000)
        });

        if (res.ok) {
            const data = await res.json();
            if (data.success) {
                updateBridgeStatusUI('CONNECTED');
                log('Bridge Server connection verified successfully!');
                return true;
            }
        }
        updateBridgeStatusUI('DISCONNECTED');
        log('Bridge Server rejected handshake: ' + (res.statusText || 'Unauthorized'));
        return false;
    } catch (err) {
        updateBridgeStatusUI('DISCONNECTED');
        log('Connection error: ' + (err && err.message ? err.message : String(err)));
        return false;
    }
}

/**
 * Triggers ExtendScript daemon to rescan current paragraph
 */
async function handleRescanActiveParagraph() {
    log('Triggering active paragraph rescan...');
    const script = `
        if ($.global.SmartLinterDaemonInstance && $.global.SmartLinterDaemonInstance.textObserver) {
            var payload = $.global.SmartLinterDaemonInstance.textObserver.captureActiveParagraph(app, $.global.SmartLinterDaemonInstance.bridgeSocket);
            payload ? JSON.stringify(payload) : "null";
        } else {
            "NO_DAEMON";
        }
    `;
    const result = await executeExtendScript(script);
    if (result && result !== 'NO_DAEMON' && result !== 'null') {
        try {
            const p = JSON.parse(result);
            log(`Extracted paragraph: ${p.paragraphId} (hash: ${p.hash.substring(0, 8)}...)`);
            updateBridgeStatusUI('CONNECTED', { lastHash: p.hash });
        } catch (e) {}
    } else {
        log('Rescan completed (no active paragraph or unchanged content)');
    }
}

/**
 * Restarts the persistent ExtendScript daemon
 */
async function handleRestartDaemon() {
    log('Restarting persistent background daemon...');
    const script = `
        if ($.global.SmartLinterDaemonInstance) {
            $.global.SmartLinterDaemonInstance.stop();
            $.global.SmartLinterDaemonInstance.start();
            "RESTARTED";
        } else {
            "NOT_INITIALIZED";
        }
    `;
    const res = await executeExtendScript(script);
    log('Daemon restart result: ' + (res || 'Done'));
}

/**
 * Initializes DOM event listeners and controls
 */
function initPanelUI() {
    if (typeof document === 'undefined') return;

    const btnConnect = document.getElementById('btnConnect');
    if (btnConnect) btnConnect.addEventListener('click', handleConnectBridge);

    const btnRescan = document.getElementById('btnRescan');
    if (btnRescan) btnRescan.addEventListener('click', handleRescanActiveParagraph);

    const btnRestart = document.getElementById('btnRestartDaemon');
    if (btnRestart) btnRestart.addEventListener('click', handleRestartDaemon);

    const btnClearLog = document.getElementById('btnClearLog');
    if (btnClearLog) {
        btnClearLog.addEventListener('click', () => {
            const logBox = document.getElementById('logBox');
            if (logBox) logBox.textContent = '';
            panelLogs.length = 0;
        });
    }

    log('SmartLinter UXP settings panel initialized.');
}

/**
 * Starts periodic status refresh while panel is visible
 */
function startUIPolling() {
    stopUIPolling();
    uiRefreshTimer = setInterval(async () => {
        if (uxpLifecycleState !== 'SHOWN') return;

        // Query ExtendScript daemon status if available
        const script = `
            if ($.global.SmartLinterDaemonInstance) {
                JSON.stringify($.global.SmartLinterDaemonInstance.getStatus());
            } else {
                "{}";
            }
        `;
        const res = await executeExtendScript(script);
        if (res && res !== '{}') {
            try {
                const status = JSON.parse(res);
                lastKnownStatus = status;
                updateBridgeStatusUI(status.bridgeStatus, {
                    tickCount: status.tickCount,
                    lastHash: status.lastSentPayload ? status.lastSentPayload.hash : null
                });
            } catch (e) {}
        }
    }, 2000);
}

function stopUIPolling() {
    if (uiRefreshTimer) {
        clearInterval(uiRefreshTimer);
        uiRefreshTimer = null;
    }
}

function getLifecycleState() {
    return uxpLifecycleState;
}

function setLifecycleState(state) {
    uxpLifecycleState = state;
}

// Register UXP Entrypoints Lifecycle
try {
    const uxp = typeof require !== 'undefined' ? require('uxp') : null;
    if (uxp && uxp.entrypoints) {
        uxp.entrypoints.setup({
            panels: {
                smartlinterPanel: {
                    create(panel) {
                        uxpLifecycleState = 'CREATED';
                        initPanelUI();
                        log('UXP panel create() hook invoked.');
                    },
                    show(panel) {
                        uxpLifecycleState = 'SHOWN';
                        startUIPolling();
                        log('UXP panel show() hook invoked (Visible).');
                    },
                    hide(panel) {
                        uxpLifecycleState = 'HIDDEN';
                        stopUIPolling();
                        log('UXP panel hide() hook invoked (Hidden behind tab - ExtendScript daemon remains active).');
                    },
                    destroy() {
                        uxpLifecycleState = 'DESTROYED';
                        stopUIPolling();
                        log('UXP panel destroy() hook invoked (Panel Closed). ExtendScript #targetengine daemon continues 100% in background.');
                    }
                }
            }
        });
    }
} catch (err) {
    // In headless test / Node environment
}

// Support both ES Module export (for Node.js test runner) and global attachment
if (typeof window !== 'undefined') {
    window.SmartLinterUXP = {
        log,
        panelLogs,
        initPanelUI,
        startUIPolling,
        stopUIPolling,
        handleConnectBridge,
        handleRescanActiveParagraph,
        handleRestartDaemon,
        getLifecycleState,
        setLifecycleState
    };
}

export {
    log,
    panelLogs,
    initPanelUI,
    startUIPolling,
    stopUIPolling,
    handleConnectBridge,
    handleRescanActiveParagraph,
    handleRestartDaemon,
    getLifecycleState,
    setLifecycleState
};
