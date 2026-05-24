"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  default: () => src_default
});
module.exports = __toCommonJS(src_exports);
var nextRequestId = 1;
function createJsonRpcRequest(method, params) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: nextRequestId++,
    method,
    params: params || {}
  });
}
function parseJsonRpcResponse(data) {
  try {
    return JSON.parse(data);
  } catch {
    console.warn(`[mcp-bridge] JSON parse failed (raw length=${data.length}, first 200 chars: ${data.slice(0, 200)})`);
    return null;
  }
}
var McpWebSocketClient = class {
  name;
  url;
  logger;
  onToolsDiscovered;
  ws = null;
  tools = [];
  pendingRequests = /* @__PURE__ */ new Map();
  connected = false;
  reconnectTimer = null;
  reconnectAttempts = 0;
  reconnectDelay = 5e3;
  maxReconnectDelay = 3e4;
  // 重连日志抑制：避免 MCP server 长时间不可用时刷屏
  // 前 3 次正常打印 INFO/ERROR，之后降级为 DEBUG 级别
  logSuppressThreshold = 3;
  pingInterval = null;
  pingIntervalMs = 15e3;
  _disposed = false;
  serverInfo = {};
  serverCapabilities = {};
  stats = {
    totalReconnects: 0,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    toolCallCount: 0,
    toolErrorCount: 0
  };
  constructor(name, url, logger, onToolsDiscovered) {
    this.name = name;
    this.url = url;
    this.logger = logger;
    this.onToolsDiscovered = onToolsDiscovered || null;
  }
  async connect() {
    if (this._disposed) return;
    return new Promise((resolve, reject) => {
      try {
        const WS = globalThis.WebSocket || require("ws");
        this.ws = new WS(this.url);
        const timeout = setTimeout(() => {
          reject(new Error(`Connection to ${this.url} timed out`));
          this.ws?.close();
        }, 5e3);
        this.ws.onopen = async () => {
          clearTimeout(timeout);
          this.connected = true;
          this.reconnectAttempts = 0;
          this.stats.lastConnectedAt = (/* @__PURE__ */ new Date()).toISOString();
          this.logger.info(`[mcp-bridge] Connected to MCP server "${this.name}" at ${this.url}`);
          try {
            await this.initialize();
            await this.discoverTools();
            this.startPing();
            if (this.onToolsDiscovered && this.tools.length > 0) {
              this.onToolsDiscovered(this.tools);
            }
            resolve();
          } catch (err) {
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
              this.logger.warn(`[mcp-bridge] RPC error from ${this.name}: id=${response.id} error=${errMsg}`);
              handlers.reject(new Error(`MCP error: ${errMsg}`));
            } else {
              handlers.resolve(response.result);
            }
          } else if (response && response.id) {
            if (response.result && typeof response.result === "object" && Object.keys(response.result).length === 0) {
              return;
            }
            this.logger.debug(`[mcp-bridge] unmatched response ${this.name}: id=${response.id} (no pending handler)`);
          }
        };
        this.ws.onclose = () => {
          const wasConnected = this.connected;
          this.connected = false;
          this.stopPing();
          if (wasConnected) {
            this.stats.lastDisconnectedAt = (/* @__PURE__ */ new Date()).toISOString();
            this.stats.totalReconnects++;
            this.logger.warn(
              `[mcp-bridge] Disconnected from "${this.name}" (reconnects: ${this.stats.totalReconnects})`
            );
          }
          this.scheduleReconnect();
        };
        this.ws.onerror = (err) => {
          clearTimeout(timeout);
          const msg = err.message || String(err);
          if (!this.connected) {
            reject(new Error(`Failed to connect to ${this.url}: ${msg}`));
          } else {
            this.logger.error(`[mcp-bridge] WebSocket error for "${this.name}": ${msg}`);
          }
        };
      } catch (err) {
        reject(err);
      }
    });
  }
  scheduleReconnect() {
    if (this._disposed || this.reconnectTimer) return;
    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    );
    if (this.reconnectAttempts <= this.logSuppressThreshold) {
      this.logger.info(
        `[mcp-bridge] Reconnecting to "${this.name}" in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})`
      );
    }
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this._disposed) return;
      try {
        await this.connect();
        this.reconnectAttempts = 0;
        this.logger.info(`[mcp-bridge] Reconnected to "${this.name}" successfully`);
      } catch (err) {
        if (this.reconnectAttempts <= this.logSuppressThreshold) {
          this.logger.error(`[mcp-bridge] Reconnect failed for "${this.name}": ${err.message}`);
        }
      }
    }, delay);
  }
  startPing() {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (this.connected && this.ws) {
        try {
          this.ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              method: "ping"
            })
          );
        } catch (err) {
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
      }, 3e4);
      this.pendingRequests.set(id, {
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        }
      });
      this.ws.send(msg);
    });
  }
  async initialize() {
    const result = await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "artifex-nexus-mcp-bridge",
        version: "5.0.0"
      }
    });
    this.serverInfo = result.serverInfo || {};
    this.serverCapabilities = result.capabilities || {};
    this.logger.info(
      `[mcp-bridge] Initialized "${this.name}": ${this.serverInfo.name || "unknown"} v${this.serverInfo.version || "?"}`
    );
    if (this.ws && this.connected) {
      this.ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized"
        })
      );
    }
  }
  async discoverTools() {
    if (!this.serverCapabilities.tools) {
      this.logger.info(`[mcp-bridge] Server "${this.name}" does not advertise tools capability`);
      this.tools = [];
      return;
    }
    const result = await this.sendRequest("tools/list", {});
    this.tools = result.tools || [];
    this.logger.info(`[mcp-bridge] Discovered ${this.tools.length} tools from "${this.name}"`);
  }
  async callTool(toolName, args) {
    return this.sendRequest("tools/call", {
      name: toolName,
      arguments: args || {}
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
};
function src_default(api) {
  const logger = api.log || console;
  const clients = /* @__PURE__ */ new Map();
  let pluginConfig = {};
  let configSource = "unknown";
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    const os = require("node:os");
    const cfgPath = process.env.OPENCLAW_CONFIG_PATH || path.join(process.env.OPENCLAW_HOME || path.join(os.homedir(), ".openclaw"), "openclaw.json");
    const raw = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    pluginConfig = raw?.plugins?.entries?.["mcp-bridge"]?.config || {};
    configSource = "file";
  } catch (e) {
    const plugins = api.config?.plugins;
    const entries = (plugins ?? {})["entries"];
    const mcpBridge = entries?.["mcp-bridge"];
    pluginConfig = mcpBridge?.["config"] || {};
    configSource = "api.config";
    logger.warn(`[mcp-bridge] File read failed (${e.message}), using api.config`);
  }
  const servers = pluginConfig.servers || {};
  const DEFAULT_DCC_SERVERS = {
    "blender-editor": { type: "websocket", url: "ws://127.0.0.1:18083", enabled: true },
    "unreal-editor": { type: "websocket", url: "ws://127.0.0.1:18080", enabled: true }
  };
  let configPatched = false;
  for (const [name, def] of Object.entries(DEFAULT_DCC_SERVERS)) {
    if (!servers[name]) {
      servers[name] = { ...def };
      configPatched = true;
      logger.info(`[mcp-bridge] Auto-added missing server "${name}" (url=${def.url})`);
    }
  }
  const serversSummary = Object.entries(servers).map(
    ([k, v]) => `${k}:enabled=${v.enabled}`
  );
  logger.info(
    `[mcp-bridge] Config source: ${configSource}, servers: [${serversSummary.join(", ")}]` + (configPatched ? " (auto-repaired)" : "")
  );
  const serverClients = /* @__PURE__ */ new Map();
  for (const [serverName, serverDef] of Object.entries(servers)) {
    if (serverDef.enabled === false) {
      logger.info(`[mcp-bridge] Server "${serverName}" is disabled, skipping`);
      continue;
    }
    if (serverDef.type !== "websocket" || !serverDef.url) {
      logger.warn(`[mcp-bridge] Server "${serverName}" has invalid config: type=${serverDef.type} url=${serverDef.url || "(empty)"}, skipping`);
      continue;
    }
    serverClients.set(serverName, null);
  }
  const KNOWN_TOOLS = {
    "blender-editor": [
      {
        name: "run_python",
        description: "\u5728 Blender \u4E2D\u6267\u884C Python \u4EE3\u7801\u3002\n\n\u4E0A\u4E0B\u6587\u53D8\u91CF\uFF08\u5DF2\u81EA\u52A8\u6CE8\u5165\uFF0C\u65E0\u9700 import\uFF09:\n  S = \u9009\u4E2D\u5BF9\u8C61\u5217\u8868\n  W = \u5F53\u524D\u573A\u666F\u6587\u4EF6\u8DEF\u5F84\n  L = bpy \u6A21\u5757\n  C = bpy.context\n  D = bpy.data\n  bpy = bpy \u6A21\u5757\n\n\u5C06\u8FD4\u56DE\u503C\u8D4B\u7ED9 result \u53D8\u91CF\uFF0C\u6846\u67B6\u4F1A\u81EA\u52A8\u63D0\u53D6\u5E76\u8FD4\u56DE\u3002\n\u6240\u6709\u5199\u64CD\u4F5C\u90FD\u6709 Undo \u652F\u6301\uFF08Ctrl+Z \u53EF\u64A4\u9500\uFF09\u3002\n\n\u5FEB\u6377\u4E0A\u4E0B\u6587: \u8BBE get_context=true\uFF08\u65E0\u9700 code\uFF09\u53EF\u83B7\u53D6\u7F16\u8F91\u5668\u72B6\u6001\u3002",
        inputSchema: {
          type: "object",
          properties: {
            code: { type: "string", description: "\u8981\u6267\u884C\u7684 Python \u4EE3\u7801" },
            get_context: { type: "boolean", description: "\u8BBE\u4E3A true \u65F6\u76F4\u63A5\u8FD4\u56DE\u7F16\u8F91\u5668\u4E0A\u4E0B\u6587\uFF08\u8F6F\u4EF6/\u7248\u672C/\u9009\u4E2D\u5BF9\u8C61/\u573A\u666F\uFF09\uFF0C\u65E0\u9700\u63D0\u4F9B code", default: false }
          },
          required: []
        }
      }
    ],
    "unreal-editor": [
      {
        name: "run_python",
        description: "Execute Python code in the Unreal Editor environment. The code runs with full access to the `unreal` module and editor APIs. Pre-injected variables: S (selected actors), W (editor world), L (unreal module). All operations are wrapped in an undo transaction (Ctrl+Z to revert). Dangerous operations (os.system, subprocess, etc.) are blocked by the security scanner.\n\nQuick context: set get_context=true (no code needed) to get editor state: active_panel (viewport/content_browser), selected (items from the active panel), selected_source, viewport_selection_count, content_browser_selection_count, mode, total_actors, level_name. The 'selected' field automatically contains viewport actors or content browser assets based on which panel the user was last interacting with.",
        inputSchema: {
          type: "object",
          properties: {
            code: { type: "string", description: "Python code to execute in Unreal Editor" },
            get_context: { type: "boolean", description: "Set to true to return editor context without executing code", default: false }
          },
          required: []
        }
      }
    ]
  };
  let totalRegistered = 0;
  let totalFailed = 0;
  for (const [serverName] of serverClients) {
    const knownTools = KNOWN_TOOLS[serverName] || [];
    for (const tool of knownTools) {
      const openclawToolName = `mcp_${serverName}_${tool.name}`;
      try {
        api.registerTool({
          name: openclawToolName,
          description: `[MCP:${serverName}] ${tool.description}`,
          parameters: tool.inputSchema,
          async execute(_id, params) {
            const client = serverClients.get(serverName);
            if (!client || !client.connected) {
              logger.warn(`[mcp-bridge] tool called against disconnected server: ${serverName}/${tool.name}`);
              return {
                content: [
                  {
                    type: "text",
                    text: `MCP server "${serverName}" is not connected. Please ensure Blender is running with Artifex Nexus addon enabled.`
                  }
                ],
                isError: true
              };
            }
            try {
              const startedAt = Date.now();
              const paramsSize = JSON.stringify(params).length;
              logger.info(`[mcp-bridge] tool execute: ${serverName}/${tool.name} id=${_id} params=${paramsSize}B`);
              client.stats.toolCallCount++;
              const result = await client.callTool(tool.name, params);
              const latency = Date.now() - startedAt;
              if (result && result.content) {
                const textParts = result.content.filter((c) => c.type === "text").map((c) => c.text);
                logger.info(`[mcp-bridge] tool done: ${serverName}/${tool.name} id=${_id} latency=${latency}ms`);
                return {
                  content: [
                    { type: "text", text: textParts.join("\n") || JSON.stringify(result) }
                  ]
                };
              }
              logger.info(`[mcp-bridge] tool done: ${serverName}/${tool.name} id=${_id} latency=${latency}ms (no text content)`);
              return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
              };
            } catch (err) {
              client.stats.toolErrorCount++;
              logger.error(`[mcp-bridge] tool failed: ${serverName}/${tool.name} id=${_id} error=${err.message}`);
              return {
                content: [
                  {
                    type: "text",
                    text: `Error calling MCP tool "${tool.name}" on server "${serverName}": ${err.message}`
                  }
                ],
                isError: true
              };
            }
          }
        });
        totalRegistered++;
        logger.info(`[mcp-bridge] Registered tool: ${openclawToolName}`);
      } catch (regErr) {
        totalFailed++;
        logger.error(
          `[mcp-bridge] Failed to register tool "${openclawToolName}": ${regErr.message}`
        );
      }
    }
  }
  logger.info(
    `[mcp-bridge] Pre-registration complete: ${totalRegistered} registered, ${totalFailed} failed`
  );
  void (async () => {
    for (const [serverName, serverDef] of Object.entries(servers)) {
      if (serverDef.enabled === false || serverDef.type !== "websocket" || !serverDef.url) {
        continue;
      }
      const client = new McpWebSocketClient(
        serverName,
        serverDef.url,
        logger,
        (tools) => {
          logger.info(`[mcp-bridge] Discovered ${tools.length} tools from "${serverName}" on (re)connect`);
        }
      );
      clients.set(serverName, client);
      serverClients.set(serverName, client);
      try {
        await client.connect();
        logger.info(`[mcp-bridge] Background connect to "${serverName}" succeeded`);
      } catch (err) {
        logger.warn(
          `[mcp-bridge] Initial connection to "${serverName}" failed: ${err.message}. Will retry in background.`
        );
      }
    }
  })();
  return {
    async dispose() {
      logger.info(`[mcp-bridge] dispose: disconnecting ${clients.size} clients`);
      for (const [name, client] of clients) {
        const s = client.stats;
        logger.info(
          `[mcp-bridge] Disconnecting from "${name}" (calls: ${s.toolCallCount}, errors: ${s.toolErrorCount}, reconnects: ${s.totalReconnects})`
        );
        client.disconnect();
      }
      clients.clear();
    }
  };
}
