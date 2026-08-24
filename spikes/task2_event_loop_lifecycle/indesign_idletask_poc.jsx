/**
 * SmartLinter InDesign Background Daemon (ExtendScript PoC)
 * Uses #targetengine for persistent global runtime and app.idleTasks for background event loop.
 */

#targetengine "smartlinter_persistent_engine"

(function() {
    var ENGINE_ID = "SmartLinter_Engine_v1";
    var BRIDGE_URL = "http://127.0.0.1:49152/telemetry";
    var tickCount = 0;
    var eventCount = 0;
    
    // 1. Remove existing idle task if reloading
    try {
        var existingTask = app.idleTasks.itemByName(ENGINE_ID);
        if (existingTask.isValid) {
            existingTask.remove();
        }
    } catch(e) {}

    // 2. Setup IdleTask (runs during InDesign idle cycles every 1000ms)
    var idleTask = app.idleTasks.add({
        name: ENGINE_ID,
        sleep: 1000 // sleep interval in milliseconds
    });

    idleTask.addEventListener(IdleEvent.ON_IDLE, function(event) {
        tickCount++;
        
        // Log every 10 ticks
        if (tickCount % 10 === 0) {
            $.writeln("[SmartLinter ExtendScript] IdleTask tick #" + tickCount + " (app.idleTasks active)");
        }
    });

    // 3. Register Native InDesign Event Listeners
    app.addEventListener(Event.AFTER_SELECTION_CHANGED, function(event) {
        eventCount++;
        $.writeln("[SmartLinter ExtendScript] AFTER_SELECTION_CHANGED fired (#" + eventCount + ")");
    });

    $.writeln("[SmartLinter] Persistent background engine loaded in targetengine: smartlinter_persistent_engine");
})();
