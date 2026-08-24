/**
 * Word Shared Runtime (Office.js) Lifecycle & Event Loop Simulator
 * Simulates long-lived background runtime behavior when Task Pane is Visible vs Hidden.
 */

class WordSharedRuntimeSimulator {
    constructor(options = {}) {
        this.runtimeType = options.runtimeType || "SHARED"; // "SHARED" (lifetime: long) or "STANDARD" (isolated)
        this.visibility = "UNINITIALIZED"; // "Visible", "Hidden", "Terminated"
        this.stateHistory = [];
        this.eventsReceived = [];
        this.timerTicks = 0;
        this.registeredListeners = new Map();
        this.isTerminated = false;
        this.logCallback = options.onLog || null;
    }

    log(msg) {
        const entry = {
            timestamp: new Date().toISOString(),
            visibility: this.visibility,
            runtime: this.runtimeType,
            message: msg
        };
        this.stateHistory.push(entry);
        if (this.logCallback) this.logCallback(entry);
    }

    // 1. Lifecycle: Initialize Add-in
    initialize() {
        this.visibility = "Visible";
        this.isTerminated = false;
        this.log("Add-in initialized in Word (Default visibility: Visible)");
    }

    // 2. Register Document Event Listener
    addEventListener(eventName, handler) {
        if (this.isTerminated) {
            throw new Error("Cannot register listener: Runtime is terminated");
        }
        if (!this.registeredListeners.has(eventName)) {
            this.registeredListeners.set(eventName, []);
        }
        this.registeredListeners.get(eventName).push(handler);
        this.log(`Registered event listener for: ${eventName}`);
    }

    // 3. API: Office.addin.hide()
    async hideTaskPane() {
        if (this.runtimeType === "SHARED") {
            this.visibility = "Hidden";
            this.log("Office.addin.hide() executed -> Visibility changed to 'Hidden' (Shared runtime stays ALIVE)");
            this._notifyVisibilityChange("Hidden");
        } else {
            // Standard runtime: Hiding or closing kills the Webview
            this.visibility = "Terminated";
            this.isTerminated = true;
            this.registeredListeners.clear();
            this.log("Standard runtime: Task pane closed -> Webview process KILLED");
        }
    }

    // 4. API: Office.addin.showAsTaskpane()
    async showAsTaskpane() {
        if (this.isTerminated) {
            this.log("Cannot show taskpane: Standard runtime is terminated and must be reloaded from scratch");
            return false;
        }
        this.visibility = "Visible";
        this.log("Office.addin.showAsTaskpane() executed -> Visibility restored to 'Visible'");
        this._notifyVisibilityChange("Visible");
        return true;
    }

    _notifyVisibilityChange(newVisibility) {
        const handlers = this.registeredListeners.get("onVisibilityModeChanged") || [];
        handlers.forEach(h => h({ visibilityMode: newVisibility }));
    }

    // 5. Trigger Document Change Event (from Word core)
    triggerWordDocumentEvent(eventName, eventData) {
        if (this.isTerminated) {
            this.log(`[DROPPED] Document event '${eventName}' dropped because runtime is TERMINATED`);
            return false;
        }
        const handlers = this.registeredListeners.get(eventName) || [];
        handlers.forEach(h => h(eventData));
        this.eventsReceived.push({
            event: eventName,
            data: eventData,
            visibilityWhenReceived: this.visibility,
            timestamp: new Date().toISOString()
        });
        this.log(`[RECEIVED] Word event '${eventName}' handled while UI is '${this.visibility}'`);
        return true;
    }

    // 6. Simulate Background Heartbeat / Event Loop Tick
    tick() {
        if (this.isTerminated) {
            return false;
        }
        this.timerTicks++;
        return true;
    }

    // 7. Run 10-Minute (600s) Lifecycle Simulation
    async runTenMinuteSimulation(options = {}) {
        const totalDurationSeconds = options.durationSeconds || 600; // 10 minutes = 600s
        const hideAtSecond = options.hideAtSecond || 10; // Hide at 10s
        const showAtSecond = options.showAtSecond || 550; // Restore at 550s
        const editIntervalSeconds = options.editIntervalSeconds || 30; // Doc edit every 30s

        this.initialize();
        
        let docEventsSent = 0;
        let docEventsSuccessfullyHandled = 0;
        let ticksWhileHidden = 0;
        let ticksWhileVisible = 0;

        this.addEventListener("onSelectionChanged", (e) => {
            docEventsSuccessfullyHandled++;
        });

        for (let sec = 1; sec <= totalDurationSeconds; sec++) {
            if (sec === hideAtSecond) {
                await this.hideTaskPane();
            } else if (sec === showAtSecond) {
                await this.showAsTaskpane();
            }

            // Timer tick
            const ticked = this.tick();
            if (ticked) {
                if (this.visibility === "Hidden") ticksWhileHidden++;
                else if (this.visibility === "Visible") ticksWhileVisible++;
            }

            // Word document event every N seconds
            if (sec % editIntervalSeconds === 0) {
                docEventsSent++;
                const delivered = this.triggerWordDocumentEvent("onSelectionChanged", {
                    second: sec,
                    paragraphIndex: Math.floor(sec / editIntervalSeconds),
                    textHash: `hash_${sec}`
                });
            }
        }

        const metrics = {
            runtimeType: this.runtimeType,
            totalSimulatedSeconds: totalDurationSeconds,
            hiddenDurationSeconds: showAtSecond - hideAtSecond,
            totalTicks: this.timerTicks,
            ticksWhileHidden,
            ticksWhileVisible,
            docEventsSent,
            docEventsSuccessfullyHandled,
            eventLossRate: ((docEventsSent - docEventsSuccessfullyHandled) / docEventsSent) * 100,
            isAliveAtEnd: !this.isTerminated,
            finalVisibility: this.visibility
        };

        return metrics;
    }
}

module.exports = { WordSharedRuntimeSimulator };
