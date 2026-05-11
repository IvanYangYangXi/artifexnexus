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
      try {
        this._ws = new WebSocket(this._url);
        const handshakeTimeout = setTimeout(() => {
          this._ws?.close();
          this._setState("disconnected");
          resolve(false);
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
              resolve(true);
            } else {
              this._ws?.close();
              this._setState("disconnected");
              resolve(false);
            }
          } catch {
            this._ws?.close();
            this._setState("disconnected");
            resolve(false);
          }
        };

        this._ws.onmessage = (event: MessageEvent) => {
          this._handleMessage(event);
        };

        this._ws.onclose = (event: CloseEvent) => {
          this._stopPing();
          this._rejectAllPending(new Error("WebSocket closed"));
          this._setState("disconnected");
          // 非主动关闭时自动重连
          if (event.code !== 1000 && !this._disposed) {
            this._scheduleReconnect();
          }
        };

        this._ws.onerror = () => {
          // onclose 会紧接着触发，这里只记录
        };
      } catch {
        this._setState("disconnected");
        this._scheduleReconnect();
        resolve(false);
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

    const payload = {
      type: "req",
      id: reqId,
      method: "chat.send",
      params: {
        sessionKey: params.sessionKey,
        message: params.message,
        idempotencyKey,
      },
    };

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this._pendingRequests.delete(reqId);
        resolve(false);
      }, ACK_TIMEOUT);

      this._pendingRequests.set(reqId, {
        resolve: (ackPayload) => {
          clearTimeout(timeout);
          const status = ackPayload?.status ?? "";
          resolve(status === "started" || status === "streaming" || status === "accepted" || status === "running");
        },
        reject: () => {
          clearTimeout(timeout);
          resolve(false);
        },
        timeout,
      });

      try {
        this._ws!.send(JSON.stringify(payload));
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

      const originalOnMessage = this._ws.onmessage;
      this._ws.onmessage = (event: MessageEvent) => {
        // 超时
        if (Date.now() > deadline) {
          this._ws!.onmessage = originalOnMessage;
          console.warn("[gateway-ws] Handshake timed out");
          resolve(false);
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
                resolve(true);
              } else if (msg.error) {
                console.warn(`[gateway-ws] Connect rejected: ${JSON.stringify(msg.error)}`);
                resolve(false);
              } else {
                // 响应来了但 ID 不匹配或格式不同，仍视为成功（Gateway 已确认）
                resolve(true);
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
          resolve(false);
        }
      };
    });
  }

  /** 发送 connect RPC（内部，由 _handshake 调用） */
  private _sendConnectInternal(nonce: string, reqId: string): void {
    if (!this._ws) return;

    // Gateway client 白名单（来自 OpenClaw client-info.ts）：
    // client.id 枚举：webchat-ui | openclaw-control-ui | node-host | webchat | cli | ...
    // client.mode 枚举：webchat | cli | ui | backend | node | probe | test
    //
    // Artifex Nexus 作为嵌入桌面的 Web 聊天界面，使用 webchat-ui / webchat

    const params: Record<string, unknown> = {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: {
        id: "webchat-ui",
        displayName: "Artifex Nexus",
        version: "0.1.0",
        platform: "win32",
        mode: "webchat",
      },
      caps: [],
      auth: { token: this._token },
      role: "operator",
      scopes: ["operator.read", "operator.write", "operator.admin"],
    };

    const payload = JSON.stringify({
      type: "req",
      id: reqId,
      method: "connect",
      params,
    });

    console.log(`[gateway-ws] Sending connect: id=${reqId}, clientId=webchat-ui`);
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
            pending.reject(new Error(String(msg.error)));
          } else {
            pending.resolve(msg.payload ?? {});
          }
        }
        return;
      }

      // chat 事件
      if (msg.event === "chat") {
        const payload = msg.payload ?? {};
        const event: GatewayChatEvent = {
          state: payload.state ?? "delta",
          message: this._extractText(payload.message ?? ""),
          runId: payload.runId,
        };
        this._messageHandlers.forEach((h) => h(event));
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
