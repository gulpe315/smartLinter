/**
 * InDesign UXP & ExtendScript Lifecycle Simulator
 * Compares UXP Panel (Shown vs Hidden vs Closed) and ExtendScript (#targetengine / IdleTask)
 */

class InDesignUxpSimulator {
    constructor() {
        this.lifecycleState = "UNINITIALIZED"; // UNINITIALIZED -> CREATED -> SHOWN -> HIDDEN -> DESTROYED
        this.listeners = new Map();
        this.timerTicks = 0;
        this.eventsReceived = [];
        this.isDestroyed = false;
        this.logHistory = [];
    }

    log(msg) {
        const entry = {
            timestamp: new Date().toISOString(),
            state: this.lifecycleState,
            message: msg
        };
        this.logHistory.push(entry);
    }

    // UXP Hook: create()
    create() {
        this.lifecycleState = "CREATED";
        this.isDestroyed = false;
        this.log("UXP panel create() hook called. Panel mounted.");
    }

    // UXP Hook: show()
    show() {
        if (this.isDestroyed) throw new Error("Cannot show: Panel has been destroyed.");
        this.lifecycleState = "SHOWN";
        this.log("UXP panel show() hook called. Panel is VISIBLE.");
    }

    // UXP Hook: hide()
    hide() {
        if (this.isDestroyed) throw new Error("Cannot hide: Panel has been destroyed.");
        this.lifecycleState = "HIDDEN";
        this.log("UXP panel hide() hook called. Panel is HIDDEN (docked behind tab/collapsed). V8 Context ALIVE.");
    }

    // UXP Hook: destroy() (Triggered when user closes panel with X button)
    destroy() {
        this.lifecycleState = "DESTROYED";
        this.isDestroyed = true;
        this.listeners.clear();
        this.log("UXP panel destroy() hook called. Panel CLOSED. V8 Execution context TEARDOWN.");
    }

    addEventListener(eventName, handler) {
        if (this.isDestroyed) return;
        if (!this.listeners.has(eventName)) {
            this.listeners.set(eventName, []);
        }
        this.listeners.get(eventName).push(handler);
    }

    triggerInDesignEvent(eventName, eventData) {
        if (this.isDestroyed) {
            this.log(`[DROPPED] InDesign event '${eventName}' dropped because UXP panel is DESTROYED`);
            return false;
        }
        const handlers = this.listeners.get(eventName) || [];
        handlers.forEach(h => h(eventData));
        this.eventsReceived.push({
            event: eventName,
            data: eventData,
            stateWhenReceived: this.lifecycleState,
            timestamp: new Date().toISOString()
        });
        this.log(`[RECEIVED] InDesign event '${eventName}' received while UXP panel is '${this.lifecycleState}'`);
        return true;
    }

    tick() {
        if (this.isDestroyed) {
            return false;
        }
        this.timerTicks++;
        return true;
    }

    // Run multi-phase lifecycle test
    async runLifecycleScenario() {
        this.create();
        this.show();

        let ticksInShown = 0;
        let ticksInHidden = 0;
        let ticksAfterDestroyed = 0;

        let eventsInShown = 0;
        let eventsInHidden = 0;
        let eventsDroppedAfterDestroyed = 0;

        this.addEventListener("afterSelectionChanged", (e) => {
            if (this.lifecycleState === "SHOWN") eventsInShown++;
            else if (this.lifecycleState === "HIDDEN") eventsInHidden++;
        });

        // Phase 1: Shown (100 ticks)
        for (let i = 0; i < 100; i++) {
            if (this.tick()) ticksInShown++;
            if (i % 25 === 0) this.triggerInDesignEvent("afterSelectionChanged", { tick: i });
        }

        // Phase 2: Hidden (docked behind another tab) (400 ticks)
        this.hide();
        for (let i = 0; i < 400; i++) {
            if (this.tick()) ticksInHidden++;
            if (i % 25 === 0) this.triggerInDesignEvent("afterSelectionChanged", { tick: i + 100 });
        }

        // Phase 3: Closed / Destroyed (user closes panel tab) (100 ticks)
        this.destroy();
        for (let i = 0; i < 100; i++) {
            if (this.tick()) ticksAfterDestroyed++;
            if (i % 25 === 0) {
                const delivered = this.triggerInDesignEvent("afterSelectionChanged", { tick: i + 500 });
                if (!delivered) eventsDroppedAfterDestroyed++;
            }
        }

        return {
            phase1_Shown: { ticks: ticksInShown, eventsReceived: eventsInShown, active: true },
            phase2_Hidden: { ticks: ticksInHidden, eventsReceived: eventsInHidden, active: true },
            phase3_Closed: { ticks: ticksAfterDestroyed, eventsDropped: eventsDroppedAfterDestroyed, active: false },
            isDestroyed: this.isDestroyed,
            totalTicks: this.timerTicks,
            totalEventsReceived: this.eventsReceived.length
        };
    }
}

class ExtendScriptPersistentEngineSimulator {
    constructor() {
        this.engineName = "smartlinter_persistent_engine";
        this.isActive = false;
        this.idleTicks = 0;
        this.eventsReceived = [];
    }

    start() {
        this.isActive = true;
    }

    tickIdle() {
        if (!this.isActive) return false;
        this.idleTicks++;
        return true;
    }

    triggerEvent(eventName, data) {
        if (!this.isActive) return false;
        this.eventsReceived.push({ event: eventName, data, timestamp: new Date().toISOString() });
        return true;
    }

    stop() {
        this.isActive = false;
    }
}

module.exports = {
    InDesignUxpSimulator,
    ExtendScriptPersistentEngineSimulator
};
