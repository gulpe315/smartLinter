#targetengine "smartlinter_persistent_engine"

/**
 * SmartLinter InDesign Persistent Background Monitoring Daemon
 * 
 * Target Engine: #targetengine "smartlinter_persistent_engine"
 * 
 * Runs continuously in the background independent of UXP panel lifecycle.
 * - Manages `app.idleTasks` with 1000ms sleep interval for idle cycle polling.
 * - Subscribes to native InDesign selection and attribute change events.
 * - Connects to Tauri Bridge Server (127.0.0.1:49152) with pairing and heartbeats.
 * - Extracts and dispatches TextFrame/Story active paragraph text and SHA-256 hashes.
 */

#include "json2_polyfill.jsx"
#include "bridge_socket.jsx"
#include "text_observer.jsx"
#include "transaction_runner.jsx"
#include "atomic_replacer.jsx"

(function(global) {
    'use strict';

    var ENGINE_ID = 'smartlinter_persistent_monitor';

    /**
     * SmartLinterDaemon constructor
     * @param {Object} [config]
     */
    function SmartLinterDaemon(config) {
        config = config || {};
        this.engineId = config.engineId || ENGINE_ID;
        this.sleepMs = config.sleepMs || 1000;
        this.heartbeatIntervalMs = config.heartbeatIntervalMs || 5000;
        this.reconnectIntervalMs = config.reconnectIntervalMs || 3000;

        // Dependencies (BridgeSocket and TextObserver)
        var BridgeSocketClass = (typeof SmartLinterBridgeSocket !== 'undefined')
            ? SmartLinterBridgeSocket
            : (global.SmartLinterBridgeSocket || null);

        var TextObserverClass = (typeof SmartLinterTextObserver !== 'undefined')
            ? SmartLinterTextObserver
            : (global.SmartLinterTextObserver || null);

        if (config.bridgeSocket) {
            this.bridgeSocket = config.bridgeSocket;
        } else if (BridgeSocketClass) {
            this.bridgeSocket = new BridgeSocketClass({
                host: config.host || '127.0.0.1',
                port: config.port || 49152,
                token: config.token,
                version: config.version || '0.1.0',
                socketFactory: config.socketFactory || null
            });
        } else {
            this.bridgeSocket = null;
        }

        if (config.textObserver) {
            this.textObserver = config.textObserver;
        } else if (TextObserverClass) {
            this.textObserver = new TextObserverClass({
                targetLanguage: config.targetLanguage || null
            });
        } else {
            this.textObserver = null;
        }

        var ReplacerClass = (typeof SmartLinterAtomicReplacer !== 'undefined')
            ? SmartLinterAtomicReplacer
            : (global.SmartLinterAtomicReplacer || null);

        if (config.replacer) {
            this.replacer = config.replacer;
        } else if (ReplacerClass) {
            this.replacer = new ReplacerClass({
                appInstance: config.appInstance || (typeof app !== 'undefined' ? app : null),
                bridgeSocket: this.bridgeSocket,
                textObserver: this.textObserver
            });
        } else {
            this.replacer = null;
        }

        this.appInstance = config.appInstance || (typeof app !== 'undefined' ? app : null);
        this.idleTask = null;
        this.isRunning = false;
        this.tickCount = 0;
        this.eventCount = 0;
        this.lastHeartbeatTime = 0;
        this.lastConnectAttemptTime = 0;
        this.logs = [];

        // Bound event handler references for clean removal
        var self = this;
        this.boundIdleHandler = function(event) {
            self.onIdleTick(event);
        };
        this.boundSelectionHandler = function(event) {
            self.onSelectionChanged(event);
        };
        this.boundAttributeHandler = function(event) {
            self.onAttributeChanged(event);
        };
        this.boundActivateHandler = function(event) {
            self.onActivate(event);
        };
    }

    SmartLinterDaemon.prototype.log = function(msg) {
        var timestamp = (new Date()).toISOString ? (new Date()).toISOString() : String(new Date());
        var entry = '[' + timestamp + '] [SmartLinterDaemon] ' + msg;
        this.logs.push(entry);
        if (this.logs.length > 300) {
            this.logs.shift();
        }
        if (typeof $ !== 'undefined' && $.writeln) {
            $.writeln(entry);
        }
    };

    /**
     * Starts the daemon: cleans old idle task, registers new idleTask, attaches event listeners,
     * and initiates bridge server handshake.
     * @returns {boolean}
     */
    SmartLinterDaemon.prototype.start = function() {
        if (this.isRunning) {
            return true;
        }

        var inApp = this.appInstance || (typeof app !== 'undefined' ? app : null);
        if (!inApp) {
            this.log('InDesign app instance not available');
            this.isRunning = true;
            return false;
        }

        // 1. Remove existing idle task if reloading / restarting
        try {
            if (inApp.idleTasks) {
                var existingTask = inApp.idleTasks.itemByName(this.engineId);
                if (existingTask && existingTask.isValid) {
                    existingTask.remove();
                    this.log('Removed previous idle task: ' + this.engineId);
                }
            }
        } catch (e) {
            // Task did not exist
        }

        // 2. Register native IdleTask (runs every 1000ms)
        try {
            if (inApp.idleTasks && inApp.idleTasks.add) {
                this.idleTask = inApp.idleTasks.add({
                    name: this.engineId,
                    sleep: this.sleepMs
                });

                var idleEventType = (typeof IdleEvent !== 'undefined' && IdleEvent.ON_IDLE)
                    ? IdleEvent.ON_IDLE
                    : 'onIdle';

                this.idleTask.addEventListener(idleEventType, this.boundIdleHandler);
                this.log('Registered IdleTask (' + this.sleepMs + 'ms interval)');
            }
        } catch (err) {
            this.log('Warning: Could not register IdleTask: ' + err.message);
        }

        // 3. Register Native InDesign Event Listeners
        try {
            if (inApp.addEventListener) {
                var selEvent = (typeof Event !== 'undefined' && Event.AFTER_SELECTION_CHANGED)
                    ? Event.AFTER_SELECTION_CHANGED
                    : 'afterSelectionChanged';
                var attrEvent = (typeof Event !== 'undefined' && Event.AFTER_ATTRIBUTE_CHANGED)
                    ? Event.AFTER_ATTRIBUTE_CHANGED
                    : 'afterAttributeChanged';
                var actEvent = (typeof Event !== 'undefined' && Event.AFTER_ACTIVATE)
                    ? Event.AFTER_ACTIVATE
                    : 'afterActivate';

                inApp.addEventListener(selEvent, this.boundSelectionHandler);
                inApp.addEventListener(attrEvent, this.boundAttributeHandler);
                try {
                    inApp.addEventListener(actEvent, this.boundActivateHandler);
                } catch (eAct) {
                    // afterActivate might not be available on all InDesign versions
                }
                this.log('Attached native InDesign event listeners (selection, attribute changed & activate)');
            }
        } catch (err) {
            this.log('Warning: Could not attach native event listeners: ' + err.message);
        }

        this.isRunning = true;

        // 4. Initial Handshake Attempt
        if (this.bridgeSocket) {
            this.attemptConnection();
        }

        this.log('SmartLinter persistent background daemon started in #targetengine: smartlinter_persistent_engine');
        return true;
    };

    /**
     * Stops the daemon, removes idle tasks and listeners.
     */
    SmartLinterDaemon.prototype.stop = function() {
        this.isRunning = false;
        var inApp = this.appInstance || (typeof app !== 'undefined' ? app : null);

        if (this.idleTask) {
            try {
                this.idleTask.remove();
            } catch (e) {}
            this.idleTask = null;
        }

        if (inApp && inApp.removeEventListener) {
            try {
                var selEvent = (typeof Event !== 'undefined' && Event.AFTER_SELECTION_CHANGED)
                    ? Event.AFTER_SELECTION_CHANGED
                    : 'afterSelectionChanged';
                var attrEvent = (typeof Event !== 'undefined' && Event.AFTER_ATTRIBUTE_CHANGED)
                    ? Event.AFTER_ATTRIBUTE_CHANGED
                    : 'afterAttributeChanged';
                var actEvent = (typeof Event !== 'undefined' && Event.AFTER_ACTIVATE)
                    ? Event.AFTER_ACTIVATE
                    : 'afterActivate';

                inApp.removeEventListener(selEvent, this.boundSelectionHandler);
                inApp.removeEventListener(attrEvent, this.boundAttributeHandler);
                try {
                    inApp.removeEventListener(actEvent, this.boundActivateHandler);
                } catch (eAct) {}
            } catch (e) {}
        }

        if (this.bridgeSocket && typeof this.bridgeSocket.disconnect === 'function') {
            this.bridgeSocket.disconnect();
        }

        this.log('SmartLinter persistent daemon stopped');
    };

    /**
     * Attempts handshake connection to bridge server.
     * @param {boolean} [force=false] If true, bypasses status check and throttle delay
     * @returns {boolean}
     */
    SmartLinterDaemon.prototype.attemptConnection = function(force) {
        if (!this.bridgeSocket || typeof this.bridgeSocket.handshake !== 'function') return false;

        if (!force && this.bridgeSocket.status === 'CONNECTED') {
            return false;
        }

        var now = (new Date()).getTime();
        if (!force && (now - this.lastConnectAttemptTime < this.reconnectIntervalMs)) {
            return false;
        }

        this.lastConnectAttemptTime = now;
        var success = this.bridgeSocket.handshake();
        if (success) {
            this.log('Connected to Tauri Bridge Server (' + this.bridgeSocket.host + ':' + this.bridgeSocket.port + ')');
        }
        return success;
    };

    /**
     * Idle task callback (fires every 1000ms during InDesign idle cycles)
     * @param {Object} [event]
     */
    SmartLinterDaemon.prototype.onIdleTick = function(event) {
        if (!this.isRunning) {
            return;
        }

        this.tickCount++;
        var now = (new Date()).getTime();

        // 1. Connection check & Auto-reconnection (throttled)
        this.attemptConnection();

        // 2. Active paragraph observation & dispatch
        if (this.textObserver) {
            var inApp = this.appInstance || (typeof app !== 'undefined' ? app : null);
            var payload = this.textObserver.captureActiveParagraph(inApp, this.bridgeSocket);
            if (payload) {
                this.log('Dispatched telemetry for paragraph ' + payload.paragraphId + ' (hash: ' + payload.hash.substring(0, 8) + '...)');
            }
        }

        // 3. Periodic Heartbeat dispatch
        if (this.bridgeSocket && this.bridgeSocket.status === 'CONNECTED') {
            if (now - this.lastHeartbeatTime >= this.heartbeatIntervalMs) {
                var activeDocName = '';
                var inApp = this.appInstance || (typeof app !== 'undefined' ? app : null);
                if (inApp && inApp.documents && inApp.documents.length > 0 && inApp.activeDocument) {
                    activeDocName = inApp.activeDocument.name || '';
                }
                var hbSuccess = this.bridgeSocket.sendHeartbeat(activeDocName);
                this.lastHeartbeatTime = now;
                if (!hbSuccess) {
                    this.log('Heartbeat failed, attempting immediate reconnection');
                    this.attemptConnection(true);
                }
            }
        }

        // 4. Update idle event sleep time if event object is provided
        if (event && typeof event === 'object') {
            try {
                event.idleTime = this.sleepMs / 1000;
            } catch (e) {}
        }
    };

    /**
     * InDesign Selection Change event callback
     */
    SmartLinterDaemon.prototype.onSelectionChanged = function(event) {
        if (!this.isRunning) return;
        this.eventCount++;

        // 1. Immediate reconnection check (throttled)
        this.attemptConnection();

        // 2. Active paragraph observation & dispatch
        if (this.textObserver) {
            var inApp = this.appInstance || (typeof app !== 'undefined' ? app : null);
            this.textObserver.captureActiveParagraph(inApp, this.bridgeSocket);
        }
    };

    /**
     * InDesign Text/Attribute Change event callback
     */
    SmartLinterDaemon.prototype.onAttributeChanged = function(event) {
        if (!this.isRunning) return;
        this.eventCount++;

        // 1. Immediate reconnection check (throttled)
        this.attemptConnection();

        // 2. Active paragraph observation & dispatch
        if (this.textObserver) {
            var inApp = this.appInstance || (typeof app !== 'undefined' ? app : null);
            this.textObserver.captureActiveParagraph(inApp, this.bridgeSocket);
        }
    };

    /**
     * InDesign Application Activation event callback (window/document focus restored)
     */
    SmartLinterDaemon.prototype.onActivate = function(event) {
        if (!this.isRunning) return;
        this.eventCount++;

        // 1. Immediate reconnection check (throttled)
        this.attemptConnection();

        // 2. Active paragraph observation & dispatch
        if (this.textObserver) {
            var inApp = this.appInstance || (typeof app !== 'undefined' ? app : null);
            this.textObserver.captureActiveParagraph(inApp, this.bridgeSocket);
        }
    };

    /**
     * Returns the current daemon status and telemetry statistics
     * @returns {Object}
     */
    SmartLinterDaemon.prototype.getStatus = function() {
        return {
            engine: 'smartlinter_persistent_engine',
            engineId: this.engineId,
            isRunning: this.isRunning,
            tickCount: this.tickCount,
            eventCount: this.eventCount,
            bridgeStatus: this.bridgeSocket ? this.bridgeSocket.status : 'NO_SOCKET',
            sessionToken: this.bridgeSocket ? this.bridgeSocket.sessionToken : null,
            lastSentPayload: this.textObserver ? this.textObserver.lastSentPayload : null,
            lastHeartbeatTime: this.lastHeartbeatTime
        };
    };

    /**
     * Executes atomic text replacement on the active InDesign paragraph.
     * @param {Object|string} command ReplacementCommand
     * @param {Object} [options]
     * @returns {Object} ReplacementResult
     */
    SmartLinterDaemon.prototype.executeReplacement = function(command, options) {
        options = options || {};
        if (!this.replacer) {
            var ReplacerClass = (typeof SmartLinterAtomicReplacer !== 'undefined')
                ? SmartLinterAtomicReplacer
                : (global.SmartLinterAtomicReplacer || null);
            if (ReplacerClass) {
                this.replacer = new ReplacerClass({
                    appInstance: this.appInstance,
                    bridgeSocket: this.bridgeSocket,
                    textObserver: this.textObserver
                });
            }
        }

        if (this.replacer) {
            var inApp = this.appInstance || (typeof app !== 'undefined' ? app : null);
            var mergedOptions = {
                appInstance: inApp,
                bridgeSocket: this.bridgeSocket
            };
            for (var key in options) {
                if (options.hasOwnProperty(key)) {
                    mergedOptions[key] = options[key];
                }
            }
            return this.replacer.execute(command, mergedOptions);
        }

        return {
            commandId: command ? (command.commandId || 'unknown') : 'unknown',
            status: 'FAILED',
            currentHash: '',
            message: 'AtomicReplacer not initialized in daemon'
        };
    };

    /** Locates a QA paragraph in InDesign without editing the document. */
    SmartLinterDaemon.prototype.locateParagraph = function(command, options) {
        options = options || {};
        if (!this.replacer) {
            var ReplacerClass = (typeof SmartLinterAtomicReplacer !== 'undefined')
                ? SmartLinterAtomicReplacer
                : (global.SmartLinterAtomicReplacer || null);
            if (ReplacerClass) {
                this.replacer = new ReplacerClass({ appInstance: this.appInstance });
            }
        }
        if (!this.replacer || typeof this.replacer.locateParagraph !== 'function') {
            return { commandId: command ? (command.commandId || 'unknown') : 'unknown', status: 'NOT_FOUND', message: 'AtomicReplacer not initialized in daemon' };
        }
        return this.replacer.locateParagraph(command, {
            appInstance: options.appInstance || this.appInstance || (typeof app !== 'undefined' ? app : null)
        });
    };

    /** Returns the current QA paragraph contents without changing selection or focus. */
    SmartLinterDaemon.prototype.getLiveParagraphSnapshot = function(command, options) {
        options = options || {};
        if (!this.replacer) {
            var ReplacerClass = (typeof SmartLinterAtomicReplacer !== 'undefined')
                ? SmartLinterAtomicReplacer
                : (global.SmartLinterAtomicReplacer || null);
            if (ReplacerClass) {
                this.replacer = new ReplacerClass({ appInstance: this.appInstance });
            }
        }
        if (!this.replacer || typeof this.replacer.getLiveParagraphSnapshot !== 'function') {
            return { commandId: command ? (command.commandId || 'unknown') : 'unknown', status: 'ERROR', message: 'AtomicReplacer not initialized in daemon' };
        }
        return this.replacer.getLiveParagraphSnapshot(command, {
            appInstance: options.appInstance || this.appInstance || (typeof app !== 'undefined' ? app : null)
        });
    };

    // Auto-instantiate singleton in ExtendScript environment
    var daemonInstance = null;
    if (typeof $ !== 'undefined' && $.global) {
        $.global.SmartLinterDaemon = SmartLinterDaemon;
        if (!$.global.SmartLinterDaemonInstance) {
            try {
                daemonInstance = new SmartLinterDaemon();
                $.global.SmartLinterDaemonInstance = daemonInstance;
                if (typeof app !== 'undefined') {
                    daemonInstance.start();
                }
            } catch (e) {}
        } else {
            daemonInstance = $.global.SmartLinterDaemonInstance;
            try {
                if (daemonInstance && typeof daemonInstance.stop === 'function') {
                    daemonInstance.stop();
                }
            } catch (e) {}
            $.global.SmartLinterDaemonInstance = null;
            try {
                daemonInstance = new SmartLinterDaemon();
                $.global.SmartLinterDaemonInstance = daemonInstance;
                if (typeof app !== 'undefined') {
                    daemonInstance.start();
                }
            } catch (e) {}
        }
    } else if (typeof global !== 'undefined') {
        global.SmartLinterDaemon = SmartLinterDaemon;
    }

    // CommonJS export for Node.js / unit tests
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            SmartLinterDaemon: SmartLinterDaemon,
            getDaemonInstance: function() { return daemonInstance; }
        };
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
