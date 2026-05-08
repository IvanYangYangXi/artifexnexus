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

// --- MCP JSON-RPC helpers ---

let nextRequestId = 1;

function createJsonRpcRequest(method: string, params?: Record<string, unknown>): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: nextRequestId++,
    method,
    params: params || {},
  });
}

function parseJsonRpcResponse(data: string): Record<string, unknown> | null {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

// --- WebSocket MCP Client ---

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface McpClientStats {
  totalReconnects: number;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  toolCallCount: number;
  toolErrorCount: number;
}

class McpWebSocketClient {
  name: string;
  url: string;
  logger: Console;
  onToolsDiscovered: ((tools: McpTool[]) => void) | null;
  ws: WebSocket | null = null;
  tools: McpTool[] = [];
  pendingRequests: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }> = new Map();
  connected = false;
  reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  reconnectAttempts = 0;
  reconnectDelay = 3000;
  maxReconnectDelay = 5000;
  pingInterval: ReturnType<typeof setInterval> | null = null;
  pingIntervalMs = 15000;
  _disposed = false;
  serverInfo: Record<string, unknown> = {};
  serverCapabilities: Record<string, unknown> = {};
  stats: McpClientStats = {
    totalReconnects: 0,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    toolCallCount: 0,
    toolErrorCount: 0,
  };

  constructor(
    name: string,
    url: string,
    logger: Console,
    onToolsDiscovered?: (tools: McpTool[]) => void,
  ) {
    this.name = name;
    this.url = url;
    this.logger = logger;
    this.onToolsDiscovered = onToolsDiscovered || null;
  }

  async connect(): Promise<void> {
    if (this._disposed) return;

    return new Promise((resolve, reject) => {
      try {
        // Node.js 环境使用 ws 包，浏览器环境使用 globalThis.WebSocket
        const WS = (globalThis as unknown as Record<string, unknown>).WebSocket || require("ws");
        this.ws = new (WS as typeof WebSocket)(this.url) as WebSocket;

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
          } catch (err) {
            reject(err);
          }
        };

        this.ws.onmessage = (event: MessageEvent) => {
          const data = typeof event.data === "string" ? event.data : String(event.data);
          const response = parseJsonRpcResponse(data);
          if (response && response.id && this.pendingRequests.has(response.id as number)) {
            const handlers = this.pendingRequests.get(response.id as number)!;
            this.pendingRequests.delete(response.id as number);
            if (response.error) {
              const errMsg = (response.error as Record<string, unknown>).message || JSON.stringify(response.error);
              handlers.reject(new Error(`MCP error: ${errMsg}`));
            } else {
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
            this.logger.warn(
              `[mcp-bridge] Disconnected from "${this.name}" (reconnects: ${this.stats.totalReconnects})`,
            );
          }
          this.scheduleReconnect();
        };

        this.ws.onerror = (err: Event) => {
          clearTimeout(timeout);
          const msg = (err as ErrorEvent).message || String(err);
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

  scheduleReconnect(): void {
    if (this._disposed || this.reconnectTimer) return;
    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1),
      this.maxReconnectDelay,
    );
    this.logger.info(
      `[mcp-bridge] Reconnecting to "${this.name}" in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})`,
    );
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this._disposed) return;
      try {
        await this.connect();
        this.logger.info(`[mcp-bridge] Reconnected to "${this.name}" successfully`);
      } catch (err) {
        this.logger.error(`[mcp-bridge] Reconnect failed for "${this.name}": ${(err as Error).message}`);
      }
    }, delay);
  }

  startPing(): void {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (this.connected && this.ws) {
        try {
          this.ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: nextRequestId++,
              method: "ping",
            }),
          );
        } catch (err) {
          this.logger.warn(`[mcp-bridge] Ping failed for "${this.name}": ${(err as Error).message}`);
        }
      }
    }, this.pingIntervalMs);
  }

  stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  async sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
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

      this.ws!.send(msg);
    });
  }

  async initialize(): Promise<void> {
    const result = (await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "artifex-nexus-mcp-bridge",
        version: "5.0.0",
      },
    })) as Record<string, unknown>;

    this.serverInfo = (result.serverInfo as Record<string, unknown>) || {};
    this.serverCapabilities = (result.capabilities as Record<string, unknown>) || {};
    this.logger.info(
      `[mcp-bridge] Initialized "${this.name}": ${this.serverInfo.name || "unknown"} v${this.serverInfo.version || "?"}`,
    );

    if (this.ws && this.connected) {
      this.ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }),
      );
    }
  }

  async discoverTools(): Promise<void> {
    if (!this.serverCapabilities.tools) {
      this.logger.info(`[mcp-bridge] Server "${this.name}" does not advertise tools capability`);
      this.tools = [];
      return;
    }

    const result = (await this.sendRequest("tools/list", {})) as Record<string, unknown>;
    this.tools = (result.tools as McpTool[]) || [];
    this.logger.info(`[mcp-bridge] Discovered ${this.tools.length} tools from "${this.name}"`);
  }

  async callTool(toolName: string, args?: Record<string, unknown>): Promise<unknown> {
    return this.sendRequest("tools/call", {
      name: toolName,
      arguments: args || {},
    });
  }

  disconnect(): void {
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

// --- Plugin Entry ---

interface PluginAPI {
  log?: Console;
  config?: Record<string, unknown>;
  registerTool: (def: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    execute: (id: string, params: Record<string, unknown>) => Promise<{
      content: { type: string; text: string }[];
      isError?: boolean;
    }>;
  }) => void;
}

/** @param api - OpenClaw Plugin SDK API */
export default function (api: PluginAPI) {
  const logger = api.log || console;
  const clients = new Map<string, McpWebSocketClient>();

  // 读取配置 — 直接从文件读取确保获取最新 enabled 状态
  let pluginConfig: Record<string, unknown> = {};
  let configSource = "unknown";
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    const os = require("node:os");
    const cfgPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
    const raw = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    pluginConfig =
      (raw?.plugins?.entries?.["mcp-bridge"]?.config as Record<string, unknown>) || {};
    configSource = "file";
  } catch (e) {
    pluginConfig =
      (api.config?.plugins as Record<string, unknown>)?.["entries"]?.["mcp-bridge"]?.["config"] as Record<string, unknown> || {};
    configSource = "api.config";
    logger.warn(`[mcp-bridge] File read failed (${(e as Error).message}), using api.config`);
  }

  const servers = (pluginConfig.servers as Record<string, Record<string, unknown>>) || {};
  const serversSummary = Object.entries(servers).map(
    ([k, v]) => `${k}:enabled=${v.enabled}`,
  );
  logger.info(
    `[mcp-bridge] Config source: ${configSource}, servers: [${serversSummary.join(", ")}]`,
  );

  // 已注册工具名（去重）
  const registeredToolNames = new Set<string>();

  function registerToolsForServer(
    serverName: string,
    client: McpWebSocketClient,
    tools: McpTool[],
  ): void {
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
            const result = (await client.callTool(tool.name, params)) as Record<string, unknown>;
            if (result && result.content) {
              const textParts = (result.content as { type: string; text: string }[])
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
          } catch (err) {
            client.stats.toolErrorCount++;
            return {
              content: [
                {
                  type: "text",
                  text: `Error calling MCP tool "${tool.name}" on server "${serverName}": ${(err as Error).message}`,
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
      logger.info(
        `[mcp-bridge] Registered ${newCount} new tool(s) from "${serverName}" (total: ${registeredToolNames.size})`,
      );
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
        logger.warn(
          `[mcp-bridge] Server "${serverName}" has unsupported type "${serverDef.type}"`,
        );
        continue;
      }

      if (!serverDef.url) {
        logger.error(`[mcp-bridge] Server "${serverName}" is missing "url" field`);
        continue;
      }

      const client = new McpWebSocketClient(
        serverName,
        serverDef.url as string,
        logger,
        (tools) => registerToolsForServer(serverName, client, tools),
      );
      clients.set(serverName, client);

      try {
        await client.connect();
      } catch (err) {
        logger.warn(
          `[mcp-bridge] Initial connection to "${serverName}" failed: ${(err as Error).message}. Will retry in background.`,
        );
      }
    }

    if (registeredToolNames.size > 0) {
      logger.info(`[mcp-bridge] Total tools registered: ${registeredToolNames.size}`);
    } else {
      logger.warn(
        `[mcp-bridge] No tools registered yet. Tools will be registered when MCP servers come online.`,
      );
    }
  })();

  // Cleanup
  return {
    async dispose() {
      for (const [name, client] of clients) {
        const s = client.stats;
        logger.info(
          `[mcp-bridge] Disconnecting from "${name}" ` +
            `(calls: ${s.toolCallCount}, errors: ${s.toolErrorCount}, reconnects: ${s.totalReconnects})`,
        );
        client.disconnect();
      }
      clients.clear();
    },
  };
}
