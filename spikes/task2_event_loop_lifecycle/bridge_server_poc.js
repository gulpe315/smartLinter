/**
 * SmartLinter Local Bridge Mock Server
 * Receives background telemetry/heartbeat from Word and InDesign add-ins.
 */

const http = require("http");

class BridgeMockServer {
    constructor(port = 49152) {
        this.port = port;
        this.server = null;
        this.receivedTelemetry = [];
        this.onTelemetryCallback = null;
    }

    start() {
        return new Promise((resolve, reject) => {
            this.server = http.createServer((req, res) => {
                // Enable CORS
                res.setHeader("Access-Control-Allow-Origin", "*");
                res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
                res.setHeader("Access-Control-Allow-Headers", "Content-Type");

                if (req.method === "OPTIONS") {
                    res.writeHead(204);
                    res.end();
                    return;
                }

                if (req.url === "/telemetry" && req.method === "POST") {
                    let body = "";
                    req.on("data", (chunk) => { body += chunk; });
                    req.on("end", () => {
                        try {
                            const data = JSON.parse(body);
                            this.receivedTelemetry.push(data);
                            if (this.onTelemetryCallback) {
                                this.onTelemetryCallback(data);
                            }
                            res.writeHead(200, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ status: "ok", count: this.receivedTelemetry.length }));
                        } catch (err) {
                            res.writeHead(400, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ error: "Invalid JSON" }));
                        }
                    });
                } else if (req.url === "/health") {
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ status: "healthy", uptime: process.uptime() }));
                } else {
                    res.writeHead(404);
                    res.end("Not Found");
                }
            });

            this.server.listen(this.port, "127.0.0.1", () => {
                resolve(this.port);
            });

            this.server.on("error", (err) => {
                reject(err);
            });
        });
    }

    stop() {
        return new Promise((resolve) => {
            if (this.server) {
                if (typeof this.server.closeAllConnections === "function") {
                    this.server.closeAllConnections();
                }
                this.server.close(() => {
                    this.server = null;
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    getStats() {
        const wordTelemetry = this.receivedTelemetry.filter(t => t.source === "WordOfficeJS");
        const indesignTelemetry = this.receivedTelemetry.filter(t => t.source === "InDesignUXP");
        return {
            totalReceived: this.receivedTelemetry.length,
            wordCount: wordTelemetry.length,
            indesignCount: indesignTelemetry.length,
            latestWord: wordTelemetry[wordTelemetry.length - 1],
            latestInDesign: indesignTelemetry[indesignTelemetry.length - 1]
        };
    }
}

module.exports = { BridgeMockServer };
