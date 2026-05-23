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
    console.warn(`[mcp-bridge] JSON parse failed (raw length=${data.length}, first 200 chars: ${data.slice(0, 200)})`);
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
  reconnectDelay = 5000;
  maxReconnectDelay = 30000;
  // 重连日志抑制：避免 MCP server 长时间不可用时刷屏
  // 前 3 次正常打印 INFO/ERROR，之后降级为 DEBUG 级别
  logSuppressThreshold = 3;
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
        }, 5000);

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
              this.logger.warn(`[mcp-bridge] RPC error from ${this.name}: id=${response.id} error=${errMsg}`);
              handlers.reject(new Error(`MCP error: ${errMsg}`));
            } else {
              handlers.resolve(response.result);
            }
          } else if (response && response.id) {
            this.logger.debug(`[mcp-bridge] unmatched response ${this.name}: id=${response.id} (no pending handler)`);
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
    // 前 N 次正常打印 INFO，之后降级为 DEBUG 避免刷屏
    if (this.reconnectAttempts <= this.logSuppressThreshold) {
      this.logger.info(
        `[mcp-bridge] Reconnecting to "${this.name}" in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})`,
      );
    }
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this._disposed) return;
      try {
        await this.connect();
        this.reconnectAttempts = 0; // 成功后重置计数
        this.logger.info(`[mcp-bridge] Reconnected to "${this.name}" successfully`);
      } catch (err) {
        // 前 N 次打印 ERROR，之后降级为 DEBUG
        if (this.reconnectAttempts <= this.logSuppressThreshold) {
          this.logger.error(`[mcp-bridge] Reconnect failed for "${this.name}": ${(err as Error).message}`);
        }
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

/** @param api - OpenClaw Plugin SDK API
 *
 * 重要：OpenClaw v2026.5.4 的 plugin loader 使用 runPluginRegisterSync()
 * 调用入口函数——不支持 async，不 await Promise。
 * 因此入口必须是**同步函数**，且所有 registerTool() 必须在同步返回前完成。
 *
 * 策略：在同步阶段立即注册 contracts.tools 中声明的所有工具（execute 内部
 * 检查连接状态），WebSocket 连接放后台异步 fire-and-forget。
 */
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
    const cfgPath = process.env.OPENCLAW_CONFIG_PATH || path.join(process.env.OPENCLAW_HOME || path.join(os.homedir(), ".openclaw"), "openclaw.json");
    const raw = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    pluginConfig =
      (raw?.plugins?.entries?.["mcp-bridge"]?.config as Record<string, unknown>) || {};
    configSource = "file";
  } catch (e) {
    // 从 api.config 降级读取 — 需要逐层类型断言（strict 模式下索引不能用于 {}）
    const plugins = api.config?.plugins as Record<string, unknown> | undefined;
    const entries = (plugins ?? {})["entries"] as Record<string, Record<string, unknown>> | undefined;
    const mcpBridge = entries?.["mcp-bridge"] as Record<string, unknown> | undefined;
    pluginConfig = (mcpBridge?.["config"] as Record<string, unknown>) || {};
    configSource = "api.config";
    logger.warn(`[mcp-bridge] File read failed (${(e as Error).message}), using api.config`);
  }

  const servers = (pluginConfig.servers as Record<string, Record<string, unknown>>) || {};

  // 防御层：确保已知 DCC 都存在默认条目（用户配置可能因旧版 bootstrap 缺失）
  const DEFAULT_DCC_SERVERS: Record<string, { type: string; url: string; enabled: boolean }> = {
    "blender-editor": { type: "websocket", url: "ws://127.0.0.1:18083", enabled: true },
    "unreal-editor": { type: "websocket", url: "ws://127.0.0.1:18080", enabled: true },
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
    ([k, v]) => `${k}:enabled=${v.enabled}`,
  );
  logger.info(
    `[mcp-bridge] Config source: ${configSource}, servers: [${serversSummary.join(", ")}]` +
      (configPatched ? " (auto-repaired)" : ""),
  );

  // --- 预注册工具（同步阶段） ---
  // OpenClaw 要求 registerTool() 在同步 register() 调用期间完成。
  // 我们直接注册 contracts.tools 中声明的工具，execute 内部通过 client 引用
  // 检查连接状态并转发调用。
  // 每个 server 对应一个 client 引用（初始 null，连接后赋值）。
  const serverClients = new Map<string, McpWebSocketClient | null>();

  for (const [serverName, serverDef] of Object.entries(servers)) {
    if (serverDef.enabled === false) {
      logger.info(`[mcp-bridge] Server "${serverName}" is disabled, skipping`);
      continue;
    }
    if (serverDef.type !== "websocket" || !serverDef.url) {
      logger.warn(`[mcp-bridge] Server "${serverName}" has invalid config: type=${serverDef.type} url=${serverDef.url || "(empty)"}, skipping`);
      continue;
    }
    // 预创建 client 引用占位
    serverClients.set(serverName, null);
  }

  // 预注册工具：根据 server name 生成固定工具名
  // Blender server "blender-editor" → 工具 "mcp_blender-editor_run_python"
  // 工具定义在 contracts.tools 里已声明；这里按 server 预注册已知工具。
  const KNOWN_TOOLS: Record<string, { name: string; description: string; inputSchema: Record<string, unknown> }[]> = {
    "blender-editor": [
      {
        name: "run_python",
        description: "在 Blender 中执行 Python 代码。\n\n上下文变量（已自动注入，无需 import）:\n  S = 选中对象列表\n  W = 当前场景文件路径\n  L = bpy 模块\n  C = bpy.context\n  D = bpy.data\n  bpy = bpy 模块\n\n将返回值赋给 result 变量，框架会自动提取并返回。\n所有写操作都有 Undo 支持（Ctrl+Z 可撤销）。\n\n快捷上下文: 设 get_context=true（无需 code）可获取编辑器状态。",
        inputSchema: {
          type: "object",
          properties: {
            code: { type: "string", description: "要执行的 Python 代码" },
            get_context: { type: "boolean", description: "设为 true 时直接返回编辑器上下文（软件/版本/选中对象/场景），无需提供 code", default: false },
          },
          required: [],
        },
      },
    ],
    "unreal-editor": [
      {
        name: "run_python",
        description: "Execute Python code in the Unreal Editor environment. The code runs with full access to the `unreal` module and editor APIs. Pre-injected variables: S (selected actors), W (editor world), L (unreal module). All operations are wrapped in an undo transaction (Ctrl+Z to revert). Dangerous operations (os.system, subprocess, etc.) are blocked by the security scanner.\n\nQuick context: set get_context=true (no code needed) to get editor state: active_panel (viewport/content_browser), selected (items from the active panel), selected_source, viewport_selection_count, content_browser_selection_count, mode, total_actors, level_name. The 'selected' field automatically contains viewport actors or content browser assets based on which panel the user was last interacting with.",
        inputSchema: {
          type: "object",
          properties: {
            code: { type: "string", description: "Python code to execute in Unreal Editor" },
            get_context: { type: "boolean", description: "Set to true to return editor context without executing code", default: false },
          },
          required: [],
        },
      },
    ],
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
                    text: `MCP server "${serverName}" is not connected. Please ensure Blender is running with Artifex Nexus addon enabled.`,
                  },
                ],
                isError: true,
              };
            }
            try {
              const startedAt = Date.now();
              const paramsSize = JSON.stringify(params).length;
              logger.info(`[mcp-bridge] tool execute: ${serverName}/${tool.name} id=${_id} params=${paramsSize}B`);
              client.stats.toolCallCount++;
              const result = (await client.callTool(tool.name, params)) as Record<string, unknown>;
              const latency = Date.now() - startedAt;
              if (result && result.content) {
                const textParts = (result.content as { type: string; text: string }[])
                  .filter((c) => c.type === "text")
                  .map((c) => c.text);
                logger.info(`[mcp-bridge] tool done: ${serverName}/${tool.name} id=${_id} latency=${latency}ms`);
                return {
                  content: [
                    { type: "text", text: textParts.join("\n") || JSON.stringify(result) },
                  ],
                };
              }
              logger.info(`[mcp-bridge] tool done: ${serverName}/${tool.name} id=${_id} latency=${latency}ms (no text content)`);
              return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              };
            } catch (err) {
              client.stats.toolErrorCount++;
              logger.error(`[mcp-bridge] tool failed: ${serverName}/${tool.name} id=${_id} error=${(err as Error).message}`);
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
        totalRegistered++;
        logger.info(`[mcp-bridge] Registered tool: ${openclawToolName}`);
      } catch (regErr) {
        totalFailed++;
        logger.error(
          `[mcp-bridge] Failed to register tool "${openclawToolName}": ${(regErr as Error).message}`,
        );
      }
    }
  }

  logger.info(
    `[mcp-bridge] Pre-registration complete: ${totalRegistered} registered, ${totalFailed} failed`,
  );

  // --- 后台异步连接（fire-and-forget） ---
  // 连接成功后更新 serverClients 引用，使 execute 可用。
  void (async () => {
    for (const [serverName, serverDef] of Object.entries(servers)) {
      if (serverDef.enabled === false || serverDef.type !== "websocket" || !serverDef.url) {
        continue;
      }

      const client = new McpWebSocketClient(
        serverName,
        serverDef.url as string,
        logger,
        (tools) => {
          // 重连时更新工具信息（但不需要 re-register，因为已预注册）
          logger.info(`[mcp-bridge] Discovered ${tools.length} tools from "${serverName}" on (re)connect`);
        },
      );
      clients.set(serverName, client);
      serverClients.set(serverName, client);

      try {
        await client.connect();
        logger.info(`[mcp-bridge] Background connect to "${serverName}" succeeded`);
      } catch (err) {
        logger.warn(
          `[mcp-bridge] Initial connection to "${serverName}" failed: ${(err as Error).message}. Will retry in background.`,
        );
      }
    }
  })();

  // Cleanup
  return {
    async dispose() {
      logger.info(`[mcp-bridge] dispose: disconnecting ${clients.size} clients`);
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

// 注意：不要在这里写 module.exports = exports.default
// esbuild 打包时会自动处理 export default → module.exports.default
// OpenClaw 的 resolvePluginModuleExport 会自动 unwrap .default 属性
