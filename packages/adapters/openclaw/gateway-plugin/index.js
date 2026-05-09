"use strict";
/**
 * MCP Bridge Plugin for Artifex Nexus (OpenClaw Gateway)
 * ======================================================
 *
 * 复刻自 artclaw_bridge/platforms/openclaw/gateway/index.ts，精简：
 *   - 只保留 Blender MCP Server 连接
 *   - 去掉多 DCC 支持（M7 再加）
 *   - 去掉 RetryTracker
 *
 * 功能：
 *   - 通过 WebSocket 连接 Blender MCP Server
 *   - 自动 tools/list → 注册到 OpenClaw agent tools
 *   - 支持 late discovery（Blender 后启动也能自动发现）
 *   - 工具命名：mcp_{server-name}_{tool-name}
 *
 * 配置（openclaw.json → plugins.entries.mcp-bridge.config）：
 * {
 *   "servers": {
 *     "blender-editor": {
 *       "type": "websocket",
 *       "url": "ws://127.0.0.1:8083"
 *     }
 *   }
 * }
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = default_1;
// --- MCP JSON-RPC helpers ---
let nextRequestId = 1;
function createJsonRpcRequest(method, params) {
    return JSON.stringify({
        jsonrpc: "2.0",
        id: nextRequestId++,
        method,
        params: params || {},
    });
}
function parseJsonRpcResponse(data) {
    try {
        return JSON.parse(data);
    }
    catch {
        return null;
    }
}
class McpWebSocketClient {
    constructor(name, url, logger, onToolsDiscovered) {
        this.ws = null;
        this.tools = [];
        this.pendingRequests = new Map();
        this.connected = false;
        this.reconnectTimer = null;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 3000;
        this.maxReconnectDelay = 5000;
        this.pingInterval = null;
        this.pingIntervalMs = 15000;
        this._disposed = false;
        this.serverInfo = {};
        this.serverCapabilities = {};
        this.stats = {
            totalReconnects: 0,
            lastConnectedAt: null,
            lastDisconnectedAt: null,
            toolCallCount: 0,
            toolErrorCount: 0,
        };
        this.name = name;
        this.url = url;
        this.logger = logger;
        this.onToolsDiscovered = onToolsDiscovered || null;
    }
    async connect() {
        if (this._disposed)
            return;
        return new Promise((resolve, reject) => {
            try {
                // Node.js 环境使用 ws 包，浏览器环境使用 globalThis.WebSocket
                const WS = globalThis.WebSocket || require("ws");
                this.ws = new WS(this.url);
                const timeout = setTimeout(() => {
                    reject(new Error(`Connection to ${this.url} timed out`));
                    this.ws?.close();
                }, 10000);
                this.ws.onopen = async () => {
                    clearTimeout(timeout);
                    this.connected = true;
                    this.reconnectAttempts = 0;
                    this.stats.lastConnectedAt = new Date().toISOString();
                    this.logger.info(`[mcp-bridge] Connected to MCP server "${this.name}" at ${this.url}`);
                    try {
                        await this.initialize();
                        await this.discoverTools();
                        this.startPing();
                        if (this.onToolsDiscovered && this.tools.length > 0) {
                            this.onToolsDiscovered(this.tools);
                        }
                        resolve();
                    }
                    catch (err) {
                        reject(err);
                    }
                };
                this.ws.onmessage = (event) => {
                    const data = typeof event.data === "string" ? event.data : String(event.data);
                    const response = parseJsonRpcResponse(data);
                    if (response && response.id && this.pendingRequests.has(response.id)) {
                        const handlers = this.pendingRequests.get(response.id);
                        this.pendingRequests.delete(response.id);
                        if (response.error) {
                            const errMsg = response.error.message || JSON.stringify(response.error);
                            handlers.reject(new Error(`MCP error: ${errMsg}`));
                        }
                        else {
                            handlers.resolve(response.result);
                        }
                    }
                };
                this.ws.onclose = () => {
                    const wasConnected = this.connected;
                    this.connected = false;
                    this.stopPing();
                    if (wasConnected) {
                        this.stats.lastDisconnectedAt = new Date().toISOString();
                        this.stats.totalReconnects++;
                        this.logger.warn(`[mcp-bridge] Disconnected from "${this.name}" (reconnects: ${this.stats.totalReconnects})`);
                    }
                    this.scheduleReconnect();
                };
                this.ws.onerror = (err) => {
                    clearTimeout(timeout);
                    const msg = err.message || String(err);
                    if (!this.connected) {
                        reject(new Error(`Failed to connect to ${this.url}: ${msg}`));
                    }
                    else {
                        this.logger.error(`[mcp-bridge] WebSocket error for "${this.name}": ${msg}`);
                    }
                };
            }
            catch (err) {
                reject(err);
            }
        });
    }
    scheduleReconnect() {
        if (this._disposed || this.reconnectTimer)
            return;
        this.reconnectAttempts++;
        const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1), this.maxReconnectDelay);
        this.logger.info(`[mcp-bridge] Reconnecting to "${this.name}" in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})`);
        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = null;
            if (this._disposed)
                return;
            try {
                await this.connect();
                this.logger.info(`[mcp-bridge] Reconnected to "${this.name}" successfully`);
            }
            catch (err) {
                this.logger.error(`[mcp-bridge] Reconnect failed for "${this.name}": ${err.message}`);
            }
        }, delay);
    }
    startPing() {
        this.stopPing();
        this.pingInterval = setInterval(() => {
            if (this.connected && this.ws) {
                try {
                    this.ws.send(JSON.stringify({
                        jsonrpc: "2.0",
                        id: nextRequestId++,
                        method: "ping",
                    }));
                }
                catch (err) {
                    this.logger.warn(`[mcp-bridge] Ping failed for "${this.name}": ${err.message}`);
                }
            }
        }, this.pingIntervalMs);
    }
    stopPing() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }
    async sendRequest(method, params) {
        if (!this.connected || !this.ws) {
            throw new Error(`Not connected to MCP server "${this.name}"`);
        }
        return new Promise((resolve, reject) => {
            const id = nextRequestId;
            const msg = createJsonRpcRequest(method, params);
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`Request ${method} to "${this.name}" timed out`));
            }, 30000);
            this.pendingRequests.set(id, {
                resolve: (result) => {
                    clearTimeout(timeout);
                    resolve(result);
                },
                reject: (err) => {
                    clearTimeout(timeout);
                    reject(err);
                },
            });
            this.ws.send(msg);
        });
    }
    async initialize() {
        const result = (await this.sendRequest("initialize", {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: {
                name: "artifex-nexus-mcp-bridge",
                version: "5.0.0",
            },
        }));
        this.serverInfo = result.serverInfo || {};
        this.serverCapabilities = result.capabilities || {};
        this.logger.info(`[mcp-bridge] Initialized "${this.name}": ${this.serverInfo.name || "unknown"} v${this.serverInfo.version || "?"}`);
        if (this.ws && this.connected) {
            this.ws.send(JSON.stringify({
                jsonrpc: "2.0",
                method: "notifications/initialized",
            }));
        }
    }
    async discoverTools() {
        if (!this.serverCapabilities.tools) {
            this.logger.info(`[mcp-bridge] Server "${this.name}" does not advertise tools capability`);
            this.tools = [];
            return;
        }
        const result = (await this.sendRequest("tools/list", {}));
        this.tools = result.tools || [];
        this.logger.info(`[mcp-bridge] Discovered ${this.tools.length} tools from "${this.name}"`);
    }
    async callTool(toolName, args) {
        return this.sendRequest("tools/call", {
            name: toolName,
            arguments: args || {},
        });
    }
    disconnect() {
        this._disposed = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.stopPing();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
        this.pendingRequests.clear();
    }
}
/** @param api - OpenClaw Plugin SDK API */
function default_1(api) {
    const logger = api.log || console;
    const clients = new Map();
    // 读取配置 — 直接从文件读取确保获取最新 enabled 状态
    let pluginConfig = {};
    let configSource = "unknown";
    try {
        const fs = require("node:fs");
        const path = require("node:path");
        const os = require("node:os");
        const cfgPath = process.env.OPENCLAW_CONFIG_PATH || path.join(process.env.OPENCLAW_HOME || path.join(os.homedir(), ".openclaw"), "openclaw.json");
        const raw = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        pluginConfig =
            raw?.plugins?.entries?.["mcp-bridge"]?.config || {};
        configSource = "file";
    }
    catch (e) {
        pluginConfig =
            api.config?.plugins?.["entries"]?.["mcp-bridge"]?.["config"] || {};
        configSource = "api.config";
        logger.warn(`[mcp-bridge] File read failed (${e.message}), using api.config`);
    }
    const servers = pluginConfig.servers || {};
    const serversSummary = Object.entries(servers).map(([k, v]) => `${k}:enabled=${v.enabled}`);
    logger.info(`[mcp-bridge] Config source: ${configSource}, servers: [${serversSummary.join(", ")}]`);
    // 已注册工具名（去重）
    const registeredToolNames = new Set();
    function registerToolsForServer(serverName, client, tools) {
        let newCount = 0;
        for (const tool of tools) {
            const openclawToolName = `mcp_${serverName}_${tool.name}`;
            if (registeredToolNames.has(openclawToolName)) {
                continue;
            }
            const parameters = tool.inputSchema || {
                type: "object",
                properties: {},
            };
            api.registerTool({
                name: openclawToolName,
                description: `[MCP:${serverName}] ${tool.description || tool.name}`,
                parameters,
                async execute(_id, params) {
                    if (!client.connected) {
                        client.stats.toolErrorCount++;
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `MCP server "${serverName}" is not connected. The DCC application may not be running.`,
                                },
                            ],
                            isError: true,
                        };
                    }
                    try {
                        client.stats.toolCallCount++;
                        const result = (await client.callTool(tool.name, params));
                        if (result && result.content) {
                            const textParts = result.content
                                .filter((c) => c.type === "text")
                                .map((c) => c.text);
                            return {
                                content: [
                                    { type: "text", text: textParts.join("\n") || JSON.stringify(result) },
                                ],
                            };
                        }
                        return {
                            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                        };
                    }
                    catch (err) {
                        client.stats.toolErrorCount++;
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `Error calling MCP tool "${tool.name}" on server "${serverName}": ${err.message}`,
                                },
                            ],
                            isError: true,
                        };
                    }
                },
            });
            registeredToolNames.add(openclawToolName);
            newCount++;
        }
        if (newCount > 0) {
            logger.info(`[mcp-bridge] Registered ${newCount} new tool(s) from "${serverName}" (total: ${registeredToolNames.size})`);
        }
    }
    // 连接每个配置的 server
    const initPromise = (async () => {
        for (const [serverName, serverDef] of Object.entries(servers)) {
            if (serverDef.enabled === false) {
                logger.info(`[mcp-bridge] Server "${serverName}" is disabled, skipping`);
                continue;
            }
            if (serverDef.type !== "websocket") {
                logger.warn(`[mcp-bridge] Server "${serverName}" has unsupported type "${serverDef.type}"`);
                continue;
            }
            if (!serverDef.url) {
                logger.error(`[mcp-bridge] Server "${serverName}" is missing "url" field`);
                continue;
            }
            const client = new McpWebSocketClient(serverName, serverDef.url, logger, (tools) => registerToolsForServer(serverName, client, tools));
            clients.set(serverName, client);
            try {
                await client.connect();
            }
            catch (err) {
                logger.warn(`[mcp-bridge] Initial connection to "${serverName}" failed: ${err.message}. Will retry in background.`);
            }
        }
        if (registeredToolNames.size > 0) {
            logger.info(`[mcp-bridge] Total tools registered: ${registeredToolNames.size}`);
        }
        else {
            logger.warn(`[mcp-bridge] No tools registered yet. Tools will be registered when MCP servers come online.`);
        }
    })();
    // Cleanup
    return {
        async dispose() {
            for (const [name, client] of clients) {
                const s = client.stats;
                logger.info(`[mcp-bridge] Disconnecting from "${name}" ` +
                    `(calls: ${s.toolCallCount}, errors: ${s.toolErrorCount}, reconnects: ${s.totalReconnects})`);
                client.disconnect();
            }
            clients.clear();
        },
    };
}
// CommonJS 兼容：确保 module.exports 直接是函数
// （OpenClaw 插件系统期望 module.exports = fn，而非 { default: fn }）
module.exports = exports.default;
