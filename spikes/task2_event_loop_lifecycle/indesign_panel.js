/**
 * SmartLinter InDesign UXP Bridge (Panel Lifecycle & Event Loop)
 * Observes behavior in Shown, Hidden, and Destroyed (Closed) lifecycle states.
 */

let uxpLifecycleState = "UNINITIALIZED"; // UNINITIALIZED | CREATED | SHOWN | HIDDEN | DESTROYED
let heartbeatTimerId = null;
let heartbeatTick = 0;
let eventTriggerCount = 0;
const uxpLogs = [];
const BRIDGE_SERVER_URL = "http://127.0.0.1:49152";

function uxpLog(msg) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] [UXP:${uxpLifecycleState}] ${msg}`;
    uxpLogs.push(entry);
    if (uxpLogs.length > 500) uxpLogs.shift();

    const logBox = typeof document !== "undefined" ? document.getElementById("logBox") : null;
    if (logBox) {
        logBox.textContent += entry + "\n";
        logBox.scrollTop = logBox.scrollHeight;
    }
    console.log(entry);
}

function updateUIState(state) {
    uxpLifecycleState = state;
    if (typeof document === "undefined") return;
    const pill = document.getElementById("lifecycleStatus");
    if (pill) {
        pill.textContent = `State: ${state}`;
        pill.className = "status-pill " + (
            state === "SHOWN" ? "pill-shown" :
            state === "HIDDEN" ? "pill-hidden" : "pill-closed"
        );
    }
}

// 1. Safe UXP Entrypoint Registration
try {
    const uxp = require("uxp");
    if (uxp && uxp.entrypoints) {
        uxp.entrypoints.setup({
            panels: {
                smartlinterPanel: {
                    create(panel) {
                        updateUIState("CREATED");
                        uxpLog("UXP Panel create() called. Initializing DOM and background services.");
                        initBackgroundServices();
                    },
                    show(panel) {
                        updateUIState("SHOWN");
                        uxpLog("UXP Panel show() called. Panel is now VISIBLE to the user.");
                    },
                    hide(panel) {
                        updateUIState("HIDDEN");
                        uxpLog("UXP Panel hide() called. Panel is now HIDDEN (tab backgrounded/collapsed).");
                        // Note: Background timer & listeners continue unless stopped!
                    },
                    destroy() {
                        updateUIState("DESTROYED");
                        uxpLog("UXP Panel destroy() called. Panel is CLOSED by user. Cleaning up.");
                        if (heartbeatTimerId) {
                            clearInterval(heartbeatTimerId);
                            heartbeatTimerId = null;
                        }
                    }
                }
            }
        });
    }
} catch (e) {
    // In test / simulation environment where 'uxp' module is not present
}

// 2. Background Polling & InDesign DOM Event Listeners
function initBackgroundServices() {
    // A. Start heartbeat polling timer (1000ms)
    if (!heartbeatTimerId) {
        uxpLog("Starting UXP background polling timer (1000ms)...");
        heartbeatTimerId = setInterval(() => {
            heartbeatTick++;
            if (heartbeatTick % 10 === 0 || heartbeatTick <= 3) {
                uxpLog(`Background poll tick #${heartbeatTick} (Active, state=${uxpLifecycleState})`);
            }
            sendUxpTelemetry("heartbeat", { heartbeatTick, state: uxpLifecycleState });
        }, 1000);
    }

    // B. Register InDesign native events
    try {
        const indesign = require("indesign");
        if (indesign && indesign.app) {
            const app = indesign.app;
            app.addEventListener("afterSelectionChanged", onSelectionChanged);
            app.addEventListener("afterAttributeChanged", onDocAttributeChanged);
            uxpLog("Attached native InDesign event listeners (afterSelectionChanged, afterAttributeChanged).");
        }
    } catch (err) {
        uxpLog(`Note: Native InDesign app listener registration: ${err.message}`);
    }

    // C. Setup manual test buttons in panel DOM
    if (typeof document !== "undefined") {
        const btnSimulate = document.getElementById("btnSimulateDocChange");
        if (btnSimulate) {
            btnSimulate.addEventListener("click", () => {
                onSelectionChanged({ source: "manual_simulation" });
            });
        }
        const btnClear = document.getElementById("btnClearLog");
        if (btnClear) {
            btnClear.addEventListener("click", () => {
                const logBox = document.getElementById("logBox");
                if (logBox) logBox.textContent = "";
                uxpLogs.length = 0;
            });
        }
    }
}

function onSelectionChanged(event) {
    eventTriggerCount++;
    uxpLog(`[InDesign Event #${eventTriggerCount}] afterSelectionChanged fired while state=${uxpLifecycleState}.`);
    sendUxpTelemetry("selection_changed", { eventTriggerCount, state: uxpLifecycleState });
}

function onDocAttributeChanged(event) {
    eventTriggerCount++;
    uxpLog(`[InDesign Event #${eventTriggerCount}] afterAttributeChanged fired while state=${uxpLifecycleState}.`);
    sendUxpTelemetry("attribute_changed", { eventTriggerCount, state: uxpLifecycleState });
}

async function sendUxpTelemetry(type, payload) {
    try {
        if (typeof fetch !== "undefined") {
            await fetch(`${BRIDGE_SERVER_URL}/telemetry`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    source: "InDesignUXP",
                    type,
                    payload,
                    timestamp: new Date().toISOString()
                }),
                signal: AbortSignal.timeout(500)
            });
        }
    } catch (e) {
        // Ignored in offline spike testing
    }
}

// Export for simulation / tests
if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        uxpLog,
        uxpLogs,
        updateUIState,
        initBackgroundServices,
        onSelectionChanged,
        onDocAttributeChanged,
        getHeartbeatTick: () => heartbeatTick,
        getEventTriggerCount: () => eventTriggerCount,
        getUxpLifecycleState: () => uxpLifecycleState,
        stopTimer: () => { if (heartbeatTimerId) clearInterval(heartbeatTimerId); }
    };
}
