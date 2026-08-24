#targetengine "smartlinter_persistent_engine"

/**
 * SmartLinter InDesign ExtendScript Bridge Socket & HTTP Client
 * 
 * Manages raw TCP/HTTP communication over ExtendScript's native `Socket` object
 * with the Local Tauri Bridge Server (127.0.0.1:49152).
 * Handles authentication handshake, paragraph telemetry dispatch, heartbeats, and result reporting.
 */

(function(global) {
    'use strict';

    /**
     * Reads the pairing token exported by Tauri BridgeServer from local app data file.
     * Searches %LOCALAPPDATA%\SmartLinter\pairing_token.txt with fallbacks.
     * @returns {string|null} Token string or null if not found/readable
     */
    function resolvePairingTokenFromFile() {
        try {
            var candidatePaths = [];

            // 1. Check %LOCALAPPDATA% via $.getenv
            if (typeof $ !== 'undefined' && typeof $.getenv === 'function') {
                var localAppData = $.getenv('LOCALAPPDATA');
                if (localAppData && localAppData.length > 0) {
                    candidatePaths.push(localAppData + '/SmartLinter/pairing_token.txt');
                    candidatePaths.push(localAppData + '\\SmartLinter\\pairing_token.txt');
                }
                var userProfile = $.getenv('USERPROFILE');
                if (userProfile && userProfile.length > 0) {
                    candidatePaths.push(userProfile + '/AppData/Local/SmartLinter/pairing_token.txt');
                }
            }

            // 2. Check Folder.userData (Roaming -> Local)
            if (typeof Folder !== 'undefined' && Folder.userData) {
                try {
                    if (Folder.userData.parent) {
                        var appDataRoot = Folder.userData.parent.fsName || Folder.userData.parent.fullName;
                        if (appDataRoot) {
                            candidatePaths.push(appDataRoot + '/Local/SmartLinter/pairing_token.txt');
                        }
                    }
                } catch (e) {}
            }

            // 3. Check ExtendScript tilde path (~/AppData/Local/SmartLinter/...)
            candidatePaths.push('~/AppData/Local/SmartLinter/pairing_token.txt');

            // 4. Test each candidate path with ExtendScript File API
            if (typeof File !== 'undefined') {
                for (var i = 0; i < candidatePaths.length; i++) {
                    var filePath = candidatePaths[i];
                    try {
                        var f = new File(filePath);
                        if (f.exists) {
                            var opened = f.open('r');
                            if (opened) {
                                var content = f.read();
                                f.close();
                                if (content) {
                                    // Trim whitespace and newlines
                                    var token = content.replace(/^[\s\r\n]+|[\s\r\n]+$/g, '');
                                    if (token.length > 0) {
                                        return token;
                                    }
                                }
                            }
                        }
                    } catch (err) {
                        // Ignore individual path access error and try next
                    }
                }
            }
        } catch (e) {
            // Suppress error and return null to trigger fallback
        }
        return null;
    }

    /**
     * SmartLinterBridgeSocket
     * @param {Object} [config]
     */
    function SmartLinterBridgeSocket(config) {
        config = config || {};
        this.host = config.host || '127.0.0.1';
        this.port = config.port || 49152;
        var defaultDevToken = 'smartlinter-default-dev-token-secret-32b';
        var fileToken = resolvePairingTokenFromFile();
        this.token = config.token || fileToken || defaultDevToken;
        this.version = config.version || '0.1.0';
        this.timeout = config.timeout || 3; // socket timeout in seconds
        this.status = 'DISCONNECTED'; // DISCONNECTED | CONNECTING | CONNECTED | ERROR
        this.sessionToken = null;
        this.lastError = null;
        this.lastHeartbeatTimestamp = 0;
        this.socketFactory = config.socketFactory || null;
    }

    /**
     * Creates a new socket instance
     * @returns {Socket}
     */
    SmartLinterBridgeSocket.prototype.createSocket = function() {
        if (this.socketFactory && typeof this.socketFactory === 'function') {
            return this.socketFactory();
        }
        if (typeof Socket !== 'undefined') {
            return new Socket();
        }
        throw new Error('ExtendScript native Socket is not available');
    };

    /**
     * Performs a synchronous HTTP/1.1 request via raw ExtendScript Socket.
     * @param {string} method e.g. "POST", "GET"
     * @param {string} path e.g. "/auth/handshake", "/telemetry"
     * @param {Object} [bodyObj] JSON payload
     * @param {Object} [customHeaders]
     * @returns {{ statusCode: number, body: any, raw: string, ok: boolean, error?: string }}
     */
    SmartLinterBridgeSocket.prototype.httpRequest = function(method, path, bodyObj, customHeaders) {
        var socket = null;
        try {
            socket = this.createSocket();
            socket.timeout = this.timeout;
            socket.encoding = 'UTF-8';

            var target = this.host + ':' + this.port;
            var opened = socket.open(target, 'UTF-8');
            if (!opened) {
                this.status = 'ERROR';
                this.lastError = 'Failed to open socket connection to ' + target;
                return { statusCode: 0, body: null, raw: '', ok: false, error: this.lastError };
            }

            var postData = bodyObj ? JSON.stringify(bodyObj) : '';
            var headers = customHeaders || {};

            var rawReq = method + ' ' + path + ' HTTP/1.1\r\n';
            rawReq += 'Host: ' + this.host + ':' + this.port + '\r\n';
            rawReq += 'User-Agent: SmartLinter-InDesign-ExtendScript/' + this.version + '\r\n';
            rawReq += 'Accept: application/json\r\n';
            rawReq += 'Content-Type: application/json; charset=utf-8\r\n';
            rawReq += 'Content-Length: ' + (function(str) {
                // Calculate UTF-8 byte length
                var bytes = 0;
                for (var i = 0; i < str.length; i++) {
                    var code = str.charCodeAt(i);
                    if (code < 0x80) bytes += 1;
                    else if (code < 0x800) bytes += 2;
                    else if (code < 0xd800 || code >= 0xe000) bytes += 3;
                    else { i++; bytes += 4; }
                }
                return bytes;
            })(postData) + '\r\n';
            rawReq += 'Authorization: Bearer ' + this.token + '\r\n';
            rawReq += 'x-bridge-token: ' + this.token + '\r\n';
            rawReq += 'Connection: close\r\n';

            for (var key in headers) {
                if (headers.hasOwnProperty(key)) {
                    rawReq += key + ': ' + headers[key] + '\r\n';
                }
            }

            rawReq += '\r\n';
            if (postData) {
                rawReq += postData;
            }

            socket.write(rawReq);

            var rawResponse = '';
            var chunk = '';
            while (!socket.eof) {
                chunk = socket.read();
                if (chunk && chunk.length > 0) {
                    rawResponse += chunk;
                } else {
                    break;
                }
            }
            socket.close();

            // Parse HTTP Status code
            var statusCode = 0;
            var statusMatch = rawResponse.match(/HTTP\/1\.[01]\s+(\d{3})/i);
            if (statusMatch) {
                statusCode = parseInt(statusMatch[1], 10);
            }

            // Extract HTTP response body (separated by \r\n\r\n or \n\n)
            var bodyText = '';
            var bodyIndex = rawResponse.indexOf('\r\n\r\n');
            if (bodyIndex !== -1) {
                bodyText = rawResponse.substring(bodyIndex + 4);
            } else {
                var altIndex = rawResponse.indexOf('\n\n');
                if (altIndex !== -1) {
                    bodyText = rawResponse.substring(altIndex + 2);
                }
            }

            var parsedBody = null;
            if (bodyText) {
                try {
                    parsedBody = JSON.parse(bodyText.replace(/^[\s\r\n]+|[\s\r\n]+$/g, ''));
                } catch (e) {
                    parsedBody = bodyText;
                }
            }

            var isOk = statusCode >= 200 && statusCode < 300;
            return {
                statusCode: statusCode,
                body: parsedBody,
                raw: rawResponse,
                ok: isOk
            };
        } catch (err) {
            if (socket) {
                try { socket.close(); } catch (e) {}
            }
            this.status = 'ERROR';
            this.lastError = err.message || String(err);
            return { statusCode: 0, body: null, raw: '', ok: false, error: this.lastError };
        }
    };

    /**
     * Performs authentication handshake with local bridge server.
     * @returns {boolean}
     */
    SmartLinterBridgeSocket.prototype.handshake = function() {
        this.status = 'CONNECTING';
        var nonce = 'es-' + (new Date()).getTime() + '-' + Math.floor(Math.random() * 1000000);
        var handshakePayload = {
            token: this.token,
            editorType: 'InDesign',
            version: this.version,
            clientNonce: nonce
        };

        var res = this.httpRequest('POST', '/auth/handshake', handshakePayload);
        if (res.ok && res.body && res.body.success) {
            this.status = 'CONNECTED';
            this.sessionToken = res.body.sessionToken || null;
            this.lastError = null;
            return true;
        } else {
            this.status = 'ERROR';
            this.lastError = (res.body && res.body.message) || 'Auth Handshake failed with status ' + res.statusCode;
            return false;
        }
    };

    /**
     * Sends paragraph telemetry payload to the bridge server.
     * @param {Object} payload ParagraphPayload
     * @returns {boolean}
     */
    SmartLinterBridgeSocket.prototype.sendTelemetry = function(payload) {
        if (!payload || !payload.paragraphId || !payload.hash) {
            return false;
        }
        var res = this.httpRequest('POST', '/telemetry', payload);
        if (res.ok) {
            this.status = 'CONNECTED';
            return true;
        }
        return false;
    };

    /**
     * Sends heartbeat payload to maintain pairing and update active document.
     * @param {string} [activeDocument]
     * @returns {boolean}
     */
    SmartLinterBridgeSocket.prototype.sendHeartbeat = function(activeDocument) {
        var payload = {
            editorType: 'InDesign',
            timestamp: (new Date()).getTime(),
            activeDocument: activeDocument || undefined
        };

        var res = this.httpRequest('POST', '/heartbeat', payload);

        if (res.ok) {
            this.status = 'CONNECTED';
            this.lastHeartbeatTimestamp = payload.timestamp;
            return true;
        } else {
            this.status = 'ERROR';
            this.lastError = (res.body && res.body.error) || (res.body && res.body.message) || ('Heartbeat failed with status ' + res.statusCode);
            return false;
        }
    };

    /**
     * Sends replacement result back to bridge server.
     * @param {Object} result ReplacementResult
     * @returns {boolean}
     */
    SmartLinterBridgeSocket.prototype.sendReplacementResult = function(result) {
        if (!result || !result.commandId) {
            return false;
        }
        var res = this.httpRequest('POST', '/replacement/result', result);
        return res.ok;
    };

    /**
     * Disconnects and resets state
     */
    SmartLinterBridgeSocket.prototype.disconnect = function() {
        this.status = 'DISCONNECTED';
        this.sessionToken = null;
    };

    // Expose helper on constructor
    SmartLinterBridgeSocket.resolvePairingTokenFromFile = resolvePairingTokenFromFile;

    // Register globally in ExtendScript
    if (typeof $ !== 'undefined' && $.global) {
        $.global.SmartLinterBridgeSocket = SmartLinterBridgeSocket;
    } else if (typeof global !== 'undefined') {
        global.SmartLinterBridgeSocket = SmartLinterBridgeSocket;
    }

    // CommonJS export for Node.js / unit tests
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            SmartLinterBridgeSocket: SmartLinterBridgeSocket,
            resolvePairingTokenFromFile: resolvePairingTokenFromFile
        };
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
