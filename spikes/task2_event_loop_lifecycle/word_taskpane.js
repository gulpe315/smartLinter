/**
 * SmartLinter Word Bridge (Office.js Shared Runtime)
 * Handles Task Pane hiding, background event loops, and telemetry heartbeat.
 */

let heartbeatCount = 0;
let eventCount = 0;
let currentVisibility = "Visible";
const logBuffer = [];
const BRIDGE_SERVER_URL = "http://127.0.0.1:49152";

function log(msg) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] [${currentVisibility}] ${msg}`;
    logBuffer.push(entry);
    if (logBuffer.length > 500) logBuffer.shift();

    const logArea = document.getElementById("logArea");
    if (logArea) {
        logArea.textContent += entry + "\n";
        logArea.scrollTop = logArea.scrollHeight;
    }
    console.log(entry);
}

// 1. Initialize Office.js and configure Shared Runtime lifecycle
Office.onReady(async (info) => {
    if (info.host === Office.HostType.Word) {
        log("Office.js initialized for Word in Shared Runtime context.");

        // Set startup behavior so add-in loads automatically with document
        try {
            await Office.addin.setStartupBehavior(Office.StartupBehavior.load);
            log("StartupBehavior set to Office.StartupBehavior.load (Auto-start enabled).");
        } catch (err) {
            log(`Warning: Failed to set startup behavior: ${err.message}`);
        }

        // Register visibility mode change handler
        Office.addin.onVisibilityModeChanged((args) => {
            currentVisibility = args.visibilityMode; // "Visible" | "Hidden"
            log(`Visibility Mode Changed -> ${currentVisibility}`);
            const badge = document.getElementById("visibilityBadge");
            if (badge) {
                badge.textContent = `Visibility: ${currentVisibility}`;
                badge.className = currentVisibility === "Visible" ? "badge badge-active" : "badge badge-hidden";
            }
        });

        // Register Word Document Event Listeners
        registerWordDocumentListeners();

        // Start continuous background heartbeat timer (1-second tick)
        startBackgroundHeartbeat();

        // Attach UI event handlers
        setupUI();
    }
});

function setupUI() {
    const btnHide = document.getElementById("btnHide");
    if (btnHide) {
        btnHide.addEventListener("click", () => {
            log("User clicked 'Hide Task Pane'. Calling Office.addin.hide()...");
            Office.addin.hide().catch((err) => log(`hide() error: ${err.message}`));
        });
    }

    const btnSimulate = document.getElementById("btnSimulateEvent");
    if (btnSimulate) {
        btnSimulate.addEventListener("click", () => {
            onDocumentChanged({ source: "manual_simulation", detail: "Paragraph edited" });
        });
    }

    const btnClear = document.getElementById("btnClearLog");
    if (btnClear) {
        btnClear.addEventListener("click", () => {
            const logArea = document.getElementById("logArea");
            if (logArea) logArea.textContent = "";
            logBuffer.length = 0;
        });
    }
}

// 2. Document Selection and Content Change Listener
async function registerWordDocumentListeners() {
    try {
        await Word.run(async (context) => {
            const doc = context.document;
            doc.onSelectionChanged.add((event) => {
                eventCount++;
                log(`[Event #${eventCount}] Document SelectionChanged fired while ${currentVisibility}.`);
                notifyBridgeServer("selection_changed", { eventCount, visibility: currentVisibility });
            });
            await context.sync();
            log("Word.document.onSelectionChanged event listener registered successfully.");
        });
    } catch (err) {
        log(`Failed to register Word event listener: ${err.message}`);
    }
}

function onDocumentChanged(detail) {
    eventCount++;
    log(`[Event #${eventCount}] Document Changed (${JSON.stringify(detail)}) while ${currentVisibility}.`);
    notifyBridgeServer("document_changed", { eventCount, detail, visibility: currentVisibility });
}

// 3. Background Heartbeat & Event Loop Maintainer
function startBackgroundHeartbeat() {
    log("Starting background heartbeat interval (1000ms)...");
    setInterval(async () => {
        heartbeatCount++;
        const now = Date.now();
        
        // Log every 10 seconds or when visibility changes to keep log readable
        if (heartbeatCount % 10 === 0 || heartbeatCount <= 3) {
            log(`Heartbeat tick #${heartbeatCount} (Active, ${currentVisibility})`);
        }

        // Send telemetry payload to local bridge server if active
        if (heartbeatCount % 5 === 0) {
            notifyBridgeServer("heartbeat", {
                heartbeatCount,
                eventCount,
                visibility: currentVisibility,
                timestamp: now
            });
        }
    }, 1000);
}

// 4. Local Bridge Server communication
async function notifyBridgeServer(type, payload) {
    try {
        if (typeof fetch !== "undefined") {
            await fetch(`${BRIDGE_SERVER_URL}/telemetry`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    source: "WordOfficeJS",
                    type,
                    payload,
                    timestamp: new Date().toISOString()
                }),
                // Short timeout to avoid hanging when bridge server is not listening
                signal: AbortSignal.timeout(500)
            });
        }
    } catch (err) {
        // Network errors are normal if local bridge server is not running during standalone test
    }
}

// 5. Function file handler for Ribbon command button
function btnToggleHide(event) {
    log("Ribbon button 'btnToggleHide' invoked.");
    if (currentVisibility === "Visible") {
        Office.addin.hide().catch(e => console.error(e));
    } else {
        Office.addin.showAsTaskpane().catch(e => console.error(e));
    }
    if (event && event.completed) {
        event.completed();
    }
}

// Export for Node / test environments
if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        log,
        logBuffer,
        startBackgroundHeartbeat,
        registerWordDocumentListeners,
        btnToggleHide,
        getHeartbeatCount: () => heartbeatCount,
        getEventCount: () => eventCount,
        getVisibility: () => currentVisibility,
        setVisibility: (v) => { currentVisibility = v; }
    };
}
