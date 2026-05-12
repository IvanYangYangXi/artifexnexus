/**
 * Gateway WebSocket 客户端 — 与 OpenClaw Gateway 全双工通信
 *
 * 协议参考 artclaw_bridge 的 gateway_client.py（WebSocket full-duplex 模式）。
 * 流程：connect → challenge → handshake → chat.send → receive stream → chat.abort（取消）
 *
 * 关键设计：
 * - 自动重连（指数退避，最大 5 次）
 * - 心跳 ping（30s）
 * - 连接状态管理
 * - 取消支持（同 WS 发送 chat.abort）
 */

import type { GatewayChatEvent } from "./types";

// ─── 常量 ──────────────────────────────────────────────────────────────────

const PROTOCOL_VERSION = 3;
const HANDSHAKE_TIMEOUT = 10_000;
const ACK_TIMEOUT = 15_000;
const CHAT_TIMEOUT = 300_000;
const PING_INTERVAL = 30_000;
const RECONNECT_BASE_DELAY = 3_000;
const RECONNECT_MAX_DELAY = 30_000;
const MAX_RECONNECT_ATTEMPTS = 5;

// ─── 类型 ──────────────────────────────────────────────────────────────────

/** 连接状态 */
export type WsConnectionState =
  | "disconnected"
  | "connecting"
  | "handshaking"
  | "connected";

/** 消息事件回调 */
export type MessageHandler = (event: GatewayChatEvent) => void;

/** 连接状态回调 */
export type StateHandler = (state: WsConnectionState) => void;

/** 待处理的 RPC 请求 */
interface PendingRequest {
  resolve: (payload: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

// ─── Gateway WS 客户端 ─────────────────────────────────────────────────────

export class GatewayWebSocket {
  private _url: string;
  private _token: string;
  private _ws: WebSocket | null = null;
  private _state: WsConnectionState = "disconnected";
  private _pendingRequests: Map<string, PendingRequest> = new Map();
  private _messageHandlers: MessageHandler[] = [];
  private _stateHandlers: StateHandler[] = [];
  private _reqId = 0;
  private _pingTimer: ReturnType<typeof setInterval> | null = null;
  private _reconnectAttempts = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _disposed = false;

  constructor(url: string, token = "") {
    this._url = url;
    this._token = token;
  }

  // ─── 生命周期 ──────────────────────────────────────────────────────────

  /** 获取当前连接状态 */
  get state(): WsConnectionState {
    return this._state;
  }

  /** 获取当前 WebSocket 实例（用于发送 chat.abort） */
  get ws(): WebSocket | null {
    return this._ws;
  }

  /** 注册消息处理器 */
  onMessage(handler: MessageHandler): () => void {
    this._messageHandlers.push(handler);
    return () => {
      this._messageHandlers = this._messageHandlers.filter((h) => h !== handler);
    };
  }

  /** 注册状态变更处理器 */
  onStateChange(handler: StateHandler): () => void {
    this._stateHandlers.push(handler);
    return () => {
      this._stateHandlers = this._stateHandlers.filter((h) => h !== handler);
    };
  }

  // ─── 连接管理 ──────────────────────────────────────────────────────────

  /** 连接到 Gateway */
  async connect(): Promise<boolean> {
    if (this._disposed || this._state === "connecting" || this._state === "handshaking") {
      return this._state === "connected";
    }

    this._setState("connecting");

    return new Promise((resolve) => {
      let connectResolved = false;
      const safeConnectResolve = (val: boolean) => {
        if (connectResolved) return;
        connectResolved = true;
        resolve(val);
      };

      try {
        this._ws = new WebSocket(this._url);
        const handshakeTimeout = setTimeout(() => {
          this._ws?.close();
          this._setState("disconnected");
          safeConnectResolve(false);
        }, HANDSHAKE_TIMEOUT);

        this._ws.onopen = async () => {
          clearTimeout(handshakeTimeout);
          this._setState("handshaking");
          try {
            const ok = await this._handshake();
            if (ok) {
              this._setState("connected");
              this._reconnectAttempts = 0;
              this._startPing();
              safeConnectResolve(true);
            } else {
              this._ws?.close();
              this._setState("disconnected");
              safeConnectResolve(false);
            }
          } catch {
            this._ws?.close();
            this._setState("disconnected");
            safeConnectResolve(false);
          }
        };

        this._ws.onmessage = (event: MessageEvent) => {
          this._handleMessage(event);
        };

        this._ws.onclose = (event: CloseEvent) => {
          clearTimeout(handshakeTimeout);
          this._stopPing();
          this._rejectAllPending(new Error("WebSocket closed"));
          this._setState("disconnected");
          safeConnectResolve(false);
          // 非主动关闭时自动重连
          if (event.code !== 1000 && !this._disposed) {
            // STORY-0039：Gateway 返回 close code 1013 + reason="gateway starting"
            // 表示 sidecar 尚未就绪。此时做短暂延迟重试（不消耗重连计数），
            // 避免指数退避导致的 WARN 刷屏。
            if (event.code === 1013) {
              console.log("[gateway-ws] Gateway still starting (code=1013), will retry in 2s...");
              this._scheduleStartupRetry();
            } else {
              this._scheduleReconnect();
            }
          }
        };

        this._ws.onerror = () => {
          // onclose 会紧接着触发，这里只记录
        };
      } catch {
        this._setState("disconnected");
        this._scheduleReconnect();
        safeConnectResolve(false);
      }
    });
  }

  /** 断开连接 */
  disconnect(): void {
    this._disposed = true;
    this._cancelReconnect();
    this._stopPing();
    this._rejectAllPending(new Error("Client disconnected"));
    if (this._ws) {
      this._ws.close(1000, "Client disconnect");
      this._ws = null;
    }
    this._setState("disconnected");
  }

  // ─── 通用 RPC ──────────────────────────────────────────────────────────

  /**
   * 发送通用 RPC 请求并等待响应。
   * 用于 chat.history、commands.list 等非流式 RPC。
   */
  async sendRpc(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (!this._ws || this._state !== "connected") {
      throw new Error("WebSocket not connected");
    }
    const reqId = this._nextReqId();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pendingRequests.delete(reqId);
        reject(new Error(`RPC ${method} timeout`));
      }, CHAT_TIMEOUT);

      this._pendingRequests.set(reqId, { resolve, reject, timeout });
      this._ws!.send(JSON.stringify({ type: "req", id: reqId, method, params }));
    });
  }

  // ─── 聊天 ──────────────────────────────────────────────────────────────

  /**
   * 发送聊天消息（chat.send RPC）
   *
   * @returns Promise<boolean> — 是否成功提交
   */
  async sendChat(params: {
    sessionKey: string;
    message: string;
  }): Promise<boolean> {
    if (!this._ws || this._state !== "connected") {
      return false;
    }

    const reqId = this._nextReqId();
    const idempotencyKey = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

    const chatParams: Record<string, unknown> = {
      sessionKey: params.sessionKey,
      message: params.message,
      idempotencyKey,
    };

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this._pendingRequests.delete(reqId);
        resolve(false);
      }, ACK_TIMEOUT);

      this._pendingRequests.set(reqId, {
        resolve: (ackPayload) => {
          clearTimeout(timeout);
          // Gateway chat.send ACK: status 可能在 payload 顶层或嵌套
          const status = ackPayload?.status ?? "";
          // 只要没有 error，且收到了响应，就认为成功
          resolve(true);
        },
        reject: () => {
          clearTimeout(timeout);
          resolve(false);
        },
        timeout,
      });

      try {
        this._ws!.send(JSON.stringify({
          type: "req",
          id: reqId,
          method: "chat.send",
          params: chatParams,
        }));
      } catch {
        clearTimeout(timeout);
        this._pendingRequests.delete(reqId);
        resolve(false);
      }
    });
  }

  /**
   * 取消当前聊天（chat.abort RPC）
   *
   * 在同一 WebSocket 连接上发送取消指令
   */
  async abortChat(sessionKey: string): Promise<void> {
    if (!this._ws || this._state !== "connected") {
      return;
    }

    const reqId = this._nextReqId();
    const payload = {
      type: "req",
      id: reqId,
      method: "chat.abort",
      params: { sessionKey },
    };

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this._pendingRequests.delete(reqId);
        resolve();
      }, 5_000);

      this._pendingRequests.set(reqId, {
        resolve: () => {
          clearTimeout(timeout);
          resolve();
        },
        reject: () => {
          clearTimeout(timeout);
          resolve();
        },
        timeout,
      });

      try {
        this._ws!.send(JSON.stringify(payload));
      } catch {
        clearTimeout(timeout);
        this._pendingRequests.delete(reqId);
        resolve();
      }
    });
  }

  // ─── 内部方法 ──────────────────────────────────────────────────────────

  /** 握手协议 */
  private async _handshake(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this._ws) {
        resolve(false);
        return;
      }

      const deadline = Date.now() + HANDSHAKE_TIMEOUT;
      let challengeReceived = false;
      let connectSent = false;
      let connectReqId = "";
      let resolved = false;

      // 安全 resolve 包装，避免多次 resolve
      const safeResolve = (val: boolean) => {
        if (resolved) return;
        resolved = true;
        resolve(val);
      };

      // 监听 WS 关闭——如果握手期间被服务端关闭，必须 resolve(false)
      // 避免 Promise 永远 pending 导致 connect() 挂起
      const origOnClose = this._ws.onclose;
      this._ws.onclose = (ev: CloseEvent) => {
        safeResolve(false);
        // 恢复原 onclose（让外层 connect() 的 onclose 逻辑继续执行）
        if (origOnClose) {
          (origOnClose as (ev: CloseEvent) => void)(ev);
        }
      };

      const originalOnMessage = this._ws.onmessage;
      this._ws.onmessage = (event: MessageEvent) => {
        // 超时
        if (Date.now() > deadline) {
          this._ws!.onmessage = originalOnMessage;
          console.warn("[gateway-ws] Handshake timed out");
          safeResolve(false);
          return;
        }

        try {
          const msg = JSON.parse(event.data as string);

          // Step 1: 等待 connect.challenge
          if (!challengeReceived) {
            if (msg.event === "connect.challenge") {
              challengeReceived = true;
              const nonce = msg.payload?.nonce ?? "";
              console.log("[gateway-ws] Received connect.challenge, sending connect...");
              connectReqId = `connect-${this._nextReqId()}`;
              this._sendConnectInternal(nonce, connectReqId);
              connectSent = true;
            }
            return;
          }

          // Step 2: connect 已发送，等待响应
          if (connectSent) {
            // 接受 res 或任何非 challenge 的消息作为握手完成信号
            if (msg.type === "res") {
              console.log(
                `[gateway-ws] Connect response: id=${msg.id}, error=${!!msg.error}, payload=${JSON.stringify(msg.payload)?.slice(0, 80)}`,
              );
              this._ws!.onmessage = originalOnMessage;
              // 响应匹配我们的 connect 请求 ID 且无错误 → 成功
              if (msg.id === connectReqId && !msg.error) {
                safeResolve(true);
              } else if (msg.error) {
                console.warn(`[gateway-ws] Connect rejected: ${JSON.stringify(msg.error)}`);
                safeResolve(false);
              } else {
                // 响应来了但 ID 不匹配或格式不同，仍视为成功（Gateway 已确认）
                safeResolve(true);
              }
              return;
            }

            // 其他事件（如 agent 推送）→ 忽略，继续等待 res
            console.log(`[gateway-ws] Pre-connect event: ${msg.event ?? msg.type}`);
          }
        } catch {
          // 非 JSON 消息忽略
        }

        // 超时检查（每次消息都检查）
        if (Date.now() > deadline) {
          this._ws!.onmessage = originalOnMessage;
          console.warn("[gateway-ws] Handshake timed out");
          safeResolve(false);
        }
      };
    });
  }

  /** 发送 connect RPC（内部，由 _handshake 调用） */
  private _sendConnectInternal(nonce: string, reqId: string): void {
    if (!this._ws) return;

    // Gateway client 白名单（来自 OpenClaw client-info.ts）：
    // client.id 枚举：webchat-ui | openclaw-control-ui | cli | node-host | webchat | ...
    // client.mode 枚举：webchat | cli | ui | backend | node | probe | test
    //
    // 参考 artclaw_bridge gateway_client.py _handshake()：
    //   - client.id: "cli"，client.mode: "cli"（工具类应用的通用标识）
    //   - scopes: ["operator.read", "operator.write", "operator.admin"]
    //   - device: 可选（含签名时防止 device identity required；空时降级到 token-only）

    const params: Record<string, unknown> = {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: {
        id: "openclaw-control-ui",
        displayName: "Artifex Nexus",
        version: "0.1.0",
        platform: "win32",
        mode: "ui",
      },
      caps: [],
      auth: { token: this._token },
      // STORY-0039：不传 device 字段。
      // ArtClawToolManager 的做法：当无 device identity 时不包含 device，
      // Gateway 在 dangerouslyDisableDeviceAuth=true 时允许无 device 连接。
      // 如果传了 device 但签名不完整，反而会被 schema 拒绝。
      role: "operator",
      scopes: ["operator.read", "operator.write", "operator.admin"],
    };

    const payload = JSON.stringify({
      type: "req",
      id: reqId,
      method: "connect",
      params,
    });

    console.log(`[gateway-ws] Sending connect: id=${reqId}, clientId=openclaw-control-ui`);
    this._ws.send(payload);
  }

  /** 处理 WebSocket 消息 */
  private _handleMessage(event: MessageEvent): void {
    try {
      const msg = JSON.parse(event.data as string);

      // RPC 响应
      if (msg.type === "res" && msg.id) {
        const pending = this._pendingRequests.get(msg.id);
        if (pending) {
          this._pendingRequests.delete(msg.id);
          clearTimeout(pending.timeout);
          if (msg.error) {
            pending.reject(new Error(typeof msg.error === "string" ? msg.error : JSON.stringify(msg.error)));
          } else {
            // 传整个响应对象（去掉 type/id），让调用方自己取需要的字段
            const { type: _t, id: _i, ...rest } = msg;
            pending.resolve(rest);
          }
        }
        return;
      }

      // 调试：打印所有事件（帮助理解 Gateway 协议格式）
      if (msg.event && msg.event !== "chat" && msg.event !== "agent" && msg.event !== "tick") {
        console.log(`[gateway-ws] event=${msg.event}`, JSON.stringify(msg.payload ?? msg).slice(0, 300));
      }

      // chat 事件（文本流）
      if (msg.event === "chat") {
        const payload = msg.payload ?? msg;
        const chatEvent: GatewayChatEvent = {
          state: payload.state ?? "delta",
          message: this._extractText(payload.message ?? ""),
          runId: payload.runId,
        };
        this._messageHandlers.forEach((h) => h(chatEvent));
      }

      // agent 事件（tool 调用 + 命令执行）
      if (msg.event === "agent") {
        const payload = msg.payload ?? msg;
        const stream = payload.stream;
        const data = payload.data ?? {};

        // stream="item" + kind="tool" → tool 调用生命周期
        if (stream === "item" && data.kind === "tool") {
          const toolEvent: GatewayChatEvent = {
            state: data.phase === "end" ? "final" : "delta",
            message: "",
            runId: payload.runId,
            toolCall: {
              id: data.toolCallId,
              phase: data.phase,  // start | update | end
              name: data.name,
              title: data.title,
              status: data.status,
              meta: data.meta,
              startedAt: data.startedAt,
              endedAt: data.endedAt,
              durationMs: data.endedAt && data.startedAt ? data.endedAt - data.startedAt : undefined,
            },
          };
          this._messageHandlers.forEach((h) => h(toolEvent));
        }

        // stream="command_output" → tool 输出
        if (stream === "command_output") {
          const toolEvent: GatewayChatEvent = {
            state: data.phase === "end" ? "final" : "delta",
            message: "",
            runId: payload.runId,
            toolOutput: {
              toolCallId: data.toolCallId,
              phase: data.phase,
              output: data.output ?? "",
              exitCode: data.exitCode,
              durationMs: data.durationMs,
            },
          };
          this._messageHandlers.forEach((h) => h(toolEvent));
        }
      }
    } catch {
      // 忽略非 JSON 消息
    }
  }

  /** 从 Gateway 消息对象中提取文本 */
  private _extractText(message: unknown): string {
    if (typeof message === "string") return message;
    if (typeof message === "object" && message !== null) {
      const m = message as Record<string, unknown>;
      const content = m.content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return (content as Array<{ type?: string; text?: string }>)
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("");
      }
    }
    return "";
  }

  /** 启动心跳 */
  private _startPing(): void {
    this._stopPing();
    this._pingTimer = setInterval(() => {
      if (this._ws && this._state === "connected") {
        try {
          this._ws.send(JSON.stringify({ type: "ping" }));
        } catch {
          // ping 失败忽略
        }
      }
    }, PING_INTERVAL);
  }

  /** 停止心跳 */
  private _stopPing(): void {
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
  }

  /** 自动重连 */
  private _scheduleReconnect(): void {
    if (this._disposed || this._reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      return;
    }
    this._cancelReconnect();
    this._reconnectAttempts++;
    const delay = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(1.5, this._reconnectAttempts - 1),
      RECONNECT_MAX_DELAY,
    );
    this._reconnectTimer = setTimeout(async () => {
      if (this._disposed) return;
      const ok = await this.connect();
      if (!ok && this._reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        this._scheduleReconnect();
      }
    }, delay);
  }

  /**
   * Gateway 启动期间重试（close code 1013）。
   * 不消耗 _reconnectAttempts，固定 2s 间隔重试最多 10 次。
   * 一旦连上或 disposed 就停止。
   */
  private _startupRetryCount = 0;
  private static readonly MAX_STARTUP_RETRIES = 10;
  private static readonly STARTUP_RETRY_DELAY = 2_000;

  private _scheduleStartupRetry(): void {
    if (this._disposed || this._startupRetryCount >= GatewayWebSocket.MAX_STARTUP_RETRIES) {
      // 超出启动重试上限，降级到普通重连
      if (!this._disposed) this._scheduleReconnect();
      return;
    }
    this._cancelReconnect();
    this._startupRetryCount++;
    this._reconnectTimer = setTimeout(async () => {
      if (this._disposed) return;
      const ok = await this.connect();
      if (ok) {
        // 成功连接，重置启动重试计数
        this._startupRetryCount = 0;
      }
      // 如果仍失败且又收到 1013，onclose 会再次调用 _scheduleStartupRetry
    }, GatewayWebSocket.STARTUP_RETRY_DELAY);
  }

  /** 取消重连 */
  private _cancelReconnect(): void {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  /** 通知状态变更 */
  private _setState(state: WsConnectionState): void {
    if (this._state === state) return;
    this._state = state;
    this._stateHandlers.forEach((h) => h(state));
  }

  /** 拒绝所有待处理请求 */
  private _rejectAllPending(error: Error): void {
    this._pendingRequests.forEach((p) => {
      clearTimeout(p.timeout);
      p.reject(error);
    });
    this._pendingRequests.clear();
  }

  /** 生成下一个请求 ID */
  private _nextReqId(): string {
    this._reqId++;
    return `rpc-${Date.now()}-${this._reqId}`;
  }
}
