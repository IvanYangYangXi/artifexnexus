/**
 * Gateway WebSocket 客户端 — 与 OpenClaw Gateway 全双工通信
 *
 * 协议参考 artclaw_bridge 的 gateway_client.py（WebSocket full-duplex 模式）。
 * 流程：connect → challenge → handshake → chat.send → receive stream → chat.abort（取消）
 *
 * 关键设计：
 * - 自动重连（三阶段：启动快速重试 → 指数退避 → 持久化慢速，永不放弃）
 * - 心跳 ping（30s）
 * - 连接状态管理
 * - 取消支持（同 WS 发送 chat.abort）
 */

import type { GatewayChatEvent, GatewayMessageBlock } from "./types";
import { getExternalNotificationStore } from "../notification-store";

// ─── 常量 ──────────────────────────────────────────────────────────────────

const PROTOCOL_VERSION = 3;
const HANDSHAKE_TIMEOUT = 10_000;
// STORY-0039-HOTFIX：网关重连后 Event Loop 可能严重退化（delayMaxMs 可达 30s+），
// 15s 的 ACK_TIMEOUT 远小于实际处理延迟，导致 chat.send 被误判为失败。
// 提升到 60s，容忍重连后的退化期。
const ACK_TIMEOUT = 60_000;
const CHAT_TIMEOUT = 300_000;
const PING_INTERVAL = 30_000;
const RECONNECT_BASE_DELAY = 3_000;
const RECONNECT_MAX_DELAY = 30_000;
const MAX_RECONNECT_ATTEMPTS = 5;
/** 首次连接（从未连上过）快速重试次数：2s 间隔 × 15 次 = 30s 窗口 */
const MAX_STARTUP_FAST_RETRIES = 15;
const STARTUP_FAST_RETRY_DELAY = 2_000;
/** 所有重试用尽后的持久化重试间隔（永不放弃） */
const PERSISTENT_RETRY_INTERVAL = 30_000;

/** 重连后冷却时间（ms）：在此期间 sendChat 会被阻止，等网关恢复 */
const RECONNECT_COOLDOWN_MS = 1_500;

/** 心跳超时（ms）：此时间内未收到任何消息/pong，视为僵尸连接，主动重连 */
const HEARTBEAT_TIMEOUT_MS = 60_000;

/** 慢 RPC 日志阈值（ms）：超过此值的 RPC 调用记录慢日志 */
const SLOW_RPC_LOG_THRESHOLD_MS = 500;

/** 握手追踪警告阈值（ms）：握手超此值未完成 → warn */
const HANDSHAKE_TRACK_WARN_MS = 8_000;

/** 空闲断开超时（ms）：30 分钟无交互 → 软断开节省资源，下次 sendChat 自动重连。
 *  原 10 分钟太短，与 Gateway 自身 WS 超时 + keepalive（2 分间隔）竞争导致频繁重连。
 *  延长到 30 分钟，让 keepalive 有充足余量。 */
const IDLE_DISCONNECT_MS = 30 * 60 * 1000;

/** 空闲断开时的 WS close code（非 1000，用于 onclose 区分语义） */
const IDLE_CLOSE_CODE = 4002;

/** MCP Bridge 连续工具调用失败阈值：超过此时 Bridge 标记为不可用 */
const MAX_CONSECUTIVE_TOOL_FAILURES = 3;

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

/** EventLoop 状态变化回调（v4 重构：替代 onQueueDrain，让 chat-service 知道何时驱动队列） */
export type ReadyHandler = (event: { ready: boolean; reason: string }) => void;

/** 待处理的 RPC 请求 */
interface PendingRequest {
  resolve: (payload: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/** sendChat 返回结果。
 *  v4 重构：删除 queued 三态。gateway-ws 不再持有业务队列，
 *  所有排队由 chat-service 统一管理。
 *  reason 用于上层精准处理：
 *    - not_ready: WS 未连接 / 退化 / 冷却中 → 调用方应入队等待
 *    - send_error: WS send() 抛错 → 同上
 *    - ack_timeout: chat.send 60s 内无 ACK → 同上
 *    - aborted: 主动取消
 */
export type SendResult =
  | { ok: true }
  | { ok: false; reason: "not_ready" | "send_error" | "ack_timeout" | "no_ws" };

// ─── Gateway WS 客户端 ─────────────────────────────────────────────────────

export class GatewayWebSocket {
  private _url: string;
  private _token: string;
  private _ws: WebSocket | null = null;
  private _state: WsConnectionState = "disconnected";
  private _pendingRequests: Map<string, PendingRequest> = new Map();
  private _messageHandlers: MessageHandler[] = [];
  private _stateHandlers: StateHandler[] = [];
  private _readyHandlers: ReadyHandler[] = [];
  private _reqId = 0;
  private _pingTimer: ReturnType<typeof setInterval> | null = null;
  private _reconnectAttempts = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _disposed = false;

  /** 最近一次连接成功的时间戳（用于重连冷却判断） */
  private _reconnectionTime = 0;

  /** 网关事件循环是否处于退化状态（从 health 事件解析） */
  private _eventLoopDegraded = false;

  /** 上次打印 health 详情日志时的 degraded 状态（抑制稳态重复日志，约每 2s 一次太吵） */
  private _lastLoggedHealthDegraded: boolean | null = null;
  private _lastLoggedHealthDelayMs = -1;

  /** FIX-DEGRADED-FLAP: degraded health 事件连续命中计数（去抖：连续 5 次才相信） */
  private _degradedHitCount = 0;
  /** 连续多少次 degraded=true 的 health 事件才相信（去抖）。
   *  health 事件约 2s 一次 → 5 次 = 持续 10 秒高延迟才相信 */
  private static readonly DEGRADED_CONFIRM_THRESHOLD = 5;
  /** v5: 恢复确认计数 — 退出 degraded 也需要连续 N 次 healthy 事件，防止抖动闪烁。 */
  private _healthyHitCount = 0;
  private static readonly HEALTHY_CONFIRM_THRESHOLD = 3;
  /** 真正算 degraded 的 delayMaxMs 阈值（ms）— 低于此值不算（gateway 自身误报）。
   *  Gateway 默认 1000ms 就报 degraded 太敏感。
   *  v5: 提到 20000ms — 低于 20s 的延迟不影响用户收发消息，标记为 degraded 反而让 UI 一直黄闪。 */
  private static readonly DEGRADED_DELAY_THRESHOLD_MS = 20000;

  /** 连接建立时间戳（用于启动宽限期：刚连上 15s 内不报 degraded） */
  private _connectionEstablishedAt = 0;

  /** 启动宽限期（ms）：连接建立后这段时间内忽略 Event Loop 退化。
   *  Gateway 冷启动后初始化插件、加载 MCP bridge 等会触发短暂 EventLoop 抖动，
   *  3s 太短不够；提到 30s 让 gateway 完全稳定下来再相信 health 事件。 */
  private static readonly STARTUP_GRACE_MS = 30000;

  /** 最近一次收到消息/pong 的时间戳（心跳超时检测） */
  private _lastActivityTime = 0;

  /** 当前握手开始时间戳（0=无进行中握手） */
  private _handshakeStartedAt = 0;

  /** 空闲定时器（超过 IDLE_DISCONNECT_MS 无交互 → 软断开） */
  private _idleTimer: ReturnType<typeof setTimeout> | null = null;

  /** 是否因空闲而断开（非 dispose，允许 sendChat 时自动重连） */
  private _idleDisconnected = false;

  /** MCP Bridge 是否可用（连续工具调用失败超过阈值 → false） */
  private _mcpBridgeAvailable = true;

  /** 连续工具调用失败计数 */
  private _consecutiveToolFailures = 0;

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

  /** 注册 ready 状态变化处理器（v4 重构：chat-service 监听以驱动队列） */
  onReadyChange(handler: ReadyHandler): () => void {
    this._readyHandlers.push(handler);
    return () => {
      this._readyHandlers = this._readyHandlers.filter((h) => h !== handler);
    };
  }

  /** 触发 ready 变化通知 */
  private _notifyReadyChange(reason: string): void {
    const ready = this.isSendReady();
    this._readyHandlers.forEach((h) => {
      try { h({ ready, reason }); } catch (err) { console.warn("[gateway-ws] readyHandler threw:", err); }
    });
  }

  // ─── 连接管理 ──────────────────────────────────────────────────────────

  /** 连接到 Gateway */
  async connect(): Promise<boolean> {
    if (this._disposed || this._state === "connecting" || this._state === "handshaking") {
      return this._state === "connected";
    }

    const neverConnected = this._reconnectionTime === 0;
    console.log(
      `[gateway-ws] Connecting to ${this._url} (attempt=${this._reconnectAttempts + 1}, neverConnected=${neverConnected})`,
    );
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
            // 空闲断开：不自动重连，等 sendChat 唤醒
            if (event.code === IDLE_CLOSE_CODE || this._idleDisconnected) {
              console.log("[gateway-ws] Idle-disconnected, waiting for user activity to reconnect");
              return;
            }
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
    this._stopIdleTimer();
    this._idleDisconnected = false;
    this._rejectAllPending(new Error("Client disconnected"));
    if (this._ws) {
      this._ws.close(1000, "Client disconnect");
      this._ws = null;
    }
    this._setState("disconnected");
  }

  // ─── 通用 RPC ──────────────────────────────────────────────────────────

  /** 慢请求日志（对齐 clawket 250ms 阈值，我们放宽到 500ms） */
  private _logSlowRpc(method: string, startedAt: number, error?: Error): void {
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= SLOW_RPC_LOG_THRESHOLD_MS) {
      const suffix = error ? ` error=${error.message}` : "";
      console.warn(`[gateway-ws] Slow RPC: method=${method} elapsedMs=${elapsedMs}${suffix}`);
    }
  }

  /**
   * 发送通用 RPC 请求并等待响应。
   * 用于 chat.history、commands.list 等非流式 RPC。
   */
  async sendRpc(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (!this._ws || this._state !== "connected") {
      throw new Error("WebSocket not connected");
    }
    const startedAt = Date.now();
    const reqId = this._nextReqId();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pendingRequests.delete(reqId);
        this._logSlowRpc(method, startedAt, new Error("timeout"));
        reject(new Error(`RPC ${method} timeout`));
      }, CHAT_TIMEOUT);

      this._pendingRequests.set(reqId, {
        resolve: (payload) => {
          this._logSlowRpc(method, startedAt);
          resolve(payload);
        },
        reject: (error) => {
          this._logSlowRpc(method, startedAt, error);
          reject(error);
        },
        timeout,
      });
      this._ws!.send(JSON.stringify({ type: "req", id: reqId, method, params }));
    });
  }

  // ─── 健康感知 ──────────────────────────────────────────────────────────

  /**
   * 是否准备好发送聊天消息。
   * 需要同时满足：(a) WS 已连接 (b) 已过重连冷却期 (c) 事件循环未退化
   */
  isSendReady(): boolean {
    if (this._state !== "connected" || !this._ws) return false;
    // 空闲断开状态：不可发送（触发 sendChat 中的唤醒逻辑）
    if (this._idleDisconnected) return false;
    // 重连冷却期内不允许发送
    if (this._reconnectionTime > 0 && Date.now() - this._reconnectionTime < RECONNECT_COOLDOWN_MS) {
      return false;
    }
    // 事件循环退化时不允许发送（消息会被延迟数十秒）
    if (this._eventLoopDegraded) {
      return false;
    }
    return true;
  }

  /** 网关事件循环是否退化 */
  get eventLoopDegraded(): boolean {
    return this._eventLoopDegraded;
  }

  /** MCP Bridge 是否可用（false 时聊天正常但 DCC 工具不可用） */
  get mcpBridgeAvailable(): boolean {
    return this._mcpBridgeAvailable;
  }

  // ─── 聊天 ──────────────────────────────────────────────────────────────

  /**
   * 设置会话模型（公开方法，供 chat-service 在 UI 切换模型时调用）。
   *
   * 策略：先尝试 sessions.patch（更新已有会话），失败则降级到 sessions.create（新会话）。
   * 仅在 model 非空且 sessionKey 非空时执行。
   */
  async ensureSessionModel(sessionKey: string, model: string): Promise<void> {
    if (!model || !sessionKey) return;

    // 提取纯 modelId（去掉 provider/ 前缀，Gateway 期望纯 model id）
    const bareModel = model.includes("/") ? model.split("/").pop()! : model;

    // 策略 1：sessions.patch（已有会话）
    try {
      console.log(`[gateway-ws] ensureSessionModel: patching session ${sessionKey.slice(0, 20)}... model=${bareModel}`);
      await this.sendRpc("sessions.patch", { key: sessionKey, model: bareModel });
      console.log(`[gateway-ws] ensureSessionModel: sessions.patch ok`);
      return;
    } catch (err) {
      console.log(`[gateway-ws] ensureSessionModel: sessions.patch failed (${(err as Error).message}), trying sessions.create...`);
    }

    // 策略 2：sessions.create（新建会话，幂等）
    try {
      console.log(`[gateway-ws] ensureSessionModel: creating session ${sessionKey.slice(0, 20)}... model=${bareModel}`);
      await this.sendRpc("sessions.create", { key: sessionKey, model: bareModel });
      console.log(`[gateway-ws] ensureSessionModel: sessions.create ok`);
    } catch (err) {
      // 会话已存在时会报错，静默忽略
      console.log(`[gateway-ws] ensureSessionModel: sessions.create also failed (may already exist): ${(err as Error).message}`);
    }
  }

  /**
   * 发送聊天消息（chat.send RPC）
   *
   * v4 重构：gateway-ws 不再持有队列。
   * 不可发送时立即返回 not_ready，由 chat-service 入队。
   *
   * @returns Promise<SendResult>
   */
  async sendChat(params: {
    sessionKey: string;
    message: string;
    /** 思考强度（off/minimal/low/medium/high/xhigh/adaptive/max），透传到 Gateway chat.send.thinking */
    thinking?: string;
  }): Promise<SendResult> {
    // 重置空闲计时器（用户有操作 → 不再空闲）
    this._resetIdleTimer();

    // 空闲断开 → 唤醒重连（fire-and-forget），告知调用方 not_ready
    if (this._idleDisconnected) {
      this._idleDisconnected = false;
      console.log("[gateway-ws] Waking from idle disconnect, reconnecting...");
      this.connect(); // fire-and-forget
      return { ok: false, reason: "not_ready" };
    }

    // 断连/退化/冷却期 → 调用方自己入队
    if (!this.isSendReady()) {
      console.log(`[gateway-ws] sendChat not ready (state=${this._state}, degraded=${this._eventLoopDegraded}, cooldown=${Date.now() - this._reconnectionTime < RECONNECT_COOLDOWN_MS})`);
      return { ok: false, reason: "not_ready" };
    }

    return this._doSendChat(params);
  }

  /** 实际执行 chat.send RPC */
  private async _doSendChat(params: {
    sessionKey: string;
    message: string;
    thinking?: string;
  }): Promise<SendResult> {

    const startedAt = Date.now();
    const reqId = this._nextReqId();
    const idempotencyKey = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

    const msgPreview = params.message.length > 60 ? params.message.slice(0,60)+"..." : params.message;
    console.log(`[gw] DO-SEND reqId=${reqId} session=${params.sessionKey.slice(0,12)}... msg="${msgPreview}" len=${params.message.length}`);

    const chatParams: Record<string, unknown> = {
      sessionKey: params.sessionKey,
      message: params.message,
      idempotencyKey,
    };

    // thinking 是 Gateway chat.send 的合法参数（来自 OpenClaw acp-cli.js requestParams）
    if (params.thinking) chatParams.thinking = params.thinking;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this._pendingRequests.delete(reqId);
        this._logSlowRpc("chat.send", startedAt, new Error("ACK timeout"));
        resolve({ ok: false, reason: "ack_timeout" });
      }, ACK_TIMEOUT);

      this._pendingRequests.set(reqId, {
        resolve: (ackPayload) => {
          clearTimeout(timeout);
          this._logSlowRpc("chat.send", startedAt);
          // Gateway chat.send ACK: status 可能在 payload 顶层或嵌套
          const status = ackPayload?.status ?? "";
          // 只要没有 error，且收到了响应，就认为成功
          resolve({ ok: true });
        },
        reject: () => {
          clearTimeout(timeout);
          this._logSlowRpc("chat.send", startedAt, new Error("rejected"));
          resolve({ ok: false, reason: "send_error" });
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
      } catch (err) {
        console.warn("[gateway-ws] chat.send ws send failed:", err);
        clearTimeout(timeout);
        this._pendingRequests.delete(reqId);
        resolve({ ok: false, reason: "send_error" });
      }
    });
  }

  /**
   * v4.1.7 已废弃：Gateway 不接受 `agent.turn` 方法（INVALID_REQUEST）。
   * Gateway 自身有 WS heartbeat（每 ~10 秒 event=heartbeat），加上我们的
   * `_startPing()` 每 30 秒发 type:"ping"，已足够保活。
   *
   * 保留空函数避免外部引用报错。
   */
  async sendAgentTurn(_sessionKey: string): Promise<void> {
    // noop — Gateway 没有 agent.turn 方法；WS ping 帧 + Gateway heartbeat 已经够保活
    return;
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
      } catch (err) {
        console.warn("[gateway-ws] abortChat ws send failed:", err);
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

        // 慢握手追踪：超过 HANDSHAKE_TRACK_WARN_MS 仍在等待
        const elapsed = Date.now() - (this._handshakeStartedAt || Date.now());
        if (elapsed > HANDSHAKE_TRACK_WARN_MS) {
          console.warn(
            `[gateway-ws] Slow handshake: ${elapsed}ms elapsed (challengeReceived=${challengeReceived}, connectSent=${connectSent})`,
          );
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
    this._lastActivityTime = Date.now();
    this._resetIdleTimer(); // 有消息交互 → 重置空闲计时
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

      // ── 健康事件（用于检测 Event Loop 退化） ──
      if (msg.event === "health") {
        const payload = msg.payload ?? msg;
        const el = payload.eventLoop as Record<string, unknown> | undefined;
        if (el) {
          const inGrace = this._connectionEstablishedAt > 0
            && (Date.now() - this._connectionEstablishedAt) < GatewayWebSocket.STARTUP_GRACE_MS;
          // 仅在首次或状态变化时打印详细 health 日志，抑制稳态噪声（约每 2s 一次太吵）
          const currentDegraded = el.degraded === true;
          const currentDelay = typeof el.delayMaxMs === "number" ? el.delayMaxMs : 0;
          const degradedChanged = this._lastLoggedHealthDegraded !== null &&
            this._lastLoggedHealthDegraded !== currentDegraded;
          const delayChangedSignificantly = currentDelay > 0 &&
            Math.abs(currentDelay - this._lastLoggedHealthDelayMs) > Math.max(currentDelay * 0.5, 5000);
          if (this._lastLoggedHealthDegraded === null || degradedChanged || delayChangedSignificantly) {
            console.log(
              `[gateway-ws] health: degraded=${el.degraded}, delayMaxMs=${el.delayMaxMs}, ` +
              `utilization=${el.utilization}, reasons=${JSON.stringify(el.reasons)}, ` +
              `inGracePeriod=${inGrace}, connAge=${this._connectionEstablishedAt ? Date.now() - this._connectionEstablishedAt : 0}ms`,
            );
            this._lastLoggedHealthDegraded = currentDegraded;
            this._lastLoggedHealthDelayMs = currentDelay;
          }
          if (inGrace && el.degraded === true) {
            // 启动宽限期内：只 log，不设置退化标志
            console.log(
              `[gateway-ws] health: degraded 发生在启动宽限期内，忽略 (剩余 ${GatewayWebSocket.STARTUP_GRACE_MS - (Date.now() - this._connectionEstablishedAt)}ms)`,
            );
            return;
          }
          // v5: 对称去抖 — 进入 AND 退出 degraded 都需要连续确认，防止单次抖动导致 UI 闪烁。
          const delayMs = typeof el.delayMaxMs === "number" ? el.delayMaxMs : 0;
          const isReallyDegraded = el.degraded === true && delayMs >= GatewayWebSocket.DEGRADED_DELAY_THRESHOLD_MS;
          const wasDegraded = this._eventLoopDegraded;

          if (isReallyDegraded) {
            // 当前事件报告退化
            this._healthyHitCount = 0; // 重置恢复计数
            this._degradedHitCount++;
            if (this._degradedHitCount < GatewayWebSocket.DEGRADED_CONFIRM_THRESHOLD) {
              console.log(
                `[gateway-ws] health: degraded hit ${this._degradedHitCount}/${GatewayWebSocket.DEGRADED_CONFIRM_THRESHOLD} (delayMs=${delayMs}, debouncing)`,
              );
              return;
            }
            // 连续 N 次退化 → 进入 degraded 状态
            if (!wasDegraded) {
              this._eventLoopDegraded = true;
              console.warn(
                `[gateway-ws] Event Loop DEGRADED: reasons=${JSON.stringify(el.reasons)}, delayMaxMs=${el.delayMaxMs}, utilization=${el.utilization}`,
              );
              this._notifyReadyChange("event_loop_degraded");
            }
          } else {
            // 当前事件报告健康
            this._degradedHitCount = 0; // 重置退化计数
            if (wasDegraded) {
              // 当前处于 degraded → 需要连续 N 次健康才退出
              this._healthyHitCount++;
              if (this._healthyHitCount < GatewayWebSocket.HEALTHY_CONFIRM_THRESHOLD) {
                console.log(
                  `[gateway-ws] health: healthy hit ${this._healthyHitCount}/${GatewayWebSocket.HEALTHY_CONFIRM_THRESHOLD} (delayMs=${delayMs}, recovering)`,
                );
                return;
              }
              // 连续 N 次健康 → 退出 degraded 状态
              this._eventLoopDegraded = false;
              this._healthyHitCount = 0;
              console.log("[gateway-ws] Event Loop recovered");
              this._notifyReadyChange("event_loop_recovered");
            } else {
              // 本身就是健康状态，维持即可
              this._healthyHitCount = 0;
            }
          }
          if (wasDegraded !== this._eventLoopDegraded) {
            if (this._eventLoopDegraded) {
              console.warn(
                `[gateway-ws] Event Loop DEGRADED: reasons=${JSON.stringify(el.reasons)}, delayMaxMs=${el.delayMaxMs}, utilization=${el.utilization}`,
              );
              this._notifyReadyChange("event_loop_degraded");
            } else {
              console.log("[gateway-ws] Event Loop recovered");
              // v4 重构：通知 chat-service 驱动队列（不再持有 _pendingSendQueue）
              this._notifyReadyChange("event_loop_recovered");
            }
          }
        }
        return;
      }

      // notify 事件（脚本/cron 通知）
      if (msg.event === "notify") {
        this._handleNotifyEvent(msg);
        return;
      }

      // 调试：打印所有事件（帮助理解 Gateway 协议格式）
      if (msg.event && msg.event !== "chat" && msg.event !== "agent" && msg.event !== "tick" && msg.event !== "health" && msg.event !== "notify") {
        console.log(`[gateway-ws] event=${msg.event}`, JSON.stringify(msg.payload ?? msg).slice(0, 300));
      }

      // chat 事件（文本流）
      if (msg.event === "chat") {
        const payload = msg.payload ?? msg;
        const state = payload.state ?? "delta";
        const rawMessage = payload.message;
        const messageBlocks = this._extractMessageBlocks(rawMessage);
        const text = this._extractText(rawMessage ?? "");
        console.log(`[gw] RECV-CHAT state=${state} runId=${payload.runId?.slice(0,8)} textLen=${text.length} blocks=${messageBlocks?.length ?? 0}`);
        const chatEvent: GatewayChatEvent = {
          state: payload.state ?? "delta",
          message: text,
          runId: payload.runId,
          rawError: typeof payload.rawError === "string" ? payload.rawError : undefined,
          ...(messageBlocks && messageBlocks.length > 0 ? { messageBlocks } : {}),
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
              error: typeof data.error === "string" ? data.error : undefined,
              startedAt: data.startedAt,
              endedAt: data.endedAt,
              durationMs: data.endedAt && data.startedAt ? data.endedAt - data.startedAt : undefined,
            },
          };
          this._messageHandlers.forEach((h) => h(toolEvent));
          // P2-8：跟踪工具调用成败（MCP Bridge 可用性检测）
          this._trackToolCallResult(data);
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
          // P2-8：跟踪命令输出成败（exitCode 非零视为失败）
          this._trackToolCallResult(data);
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

  /** 从 Gateway 消息对象中提取 message blocks（保留 tool_result 等块） */
  private _extractMessageBlocks(message: unknown): GatewayMessageBlock[] | undefined {
    if (typeof message === "object" && message !== null) {
      const m = message as Record<string, unknown>;
      const content = m.content;
      if (typeof content === "string") {
        // 纯文本消息，无 blocks
        return undefined;
      }
      if (Array.isArray(content)) {
        const blocks = content as GatewayMessageBlock[];
        // 只有包含非 text 类型 block 时才返回（纯文本 blocks 已有 message 字段覆盖）
        const hasNonTextBlock = blocks.some((b) => b.type !== "text");
        return hasNonTextBlock ? blocks : undefined;
      }
    }
    return undefined;
  }

  /** 处理 Gateway notify 事件（脚本/cron 通知 → 前端 NotificationStore） */
  private _handleNotifyEvent(msg: Record<string, unknown>): void {
    const payload = (msg.payload ?? msg) as Record<string, unknown>;
    try {
      const store = getExternalNotificationStore();
      const validTypes = ["info", "success", "warning", "error"];
      const rawType = typeof payload.type === "string" ? payload.type : "info";
      const type = validTypes.includes(rawType)
        ? (rawType as "info" | "success" | "warning" | "error")
        : "info";
      store.addNotification({
        type,
        title: typeof payload.title === "string" ? payload.title : "通知",
        message: typeof payload.message === "string" ? payload.message : "",
        source: typeof payload.source === "string" ? payload.source : "gateway",
      });
    } catch (err) {
      console.warn("[gateway-ws] Failed to handle notify event:", err);
    }
  }

  /** P2-8：跟踪工具调用结果，连续失败超过阈值 → MCP Bridge 标记为不可用 */
  private _trackToolCallResult(data: Record<string, unknown>): void {
    // 仅跟踪 phase=end 的事件（最终结果）
    if (data.phase !== "end") return;

    const isError =
      // tool item: status 含 "error"
      (typeof data.status === "string" && data.status.toLowerCase().includes("error")) ||
      // command_output: exitCode 非零
      (typeof data.exitCode === "number" && data.exitCode !== 0);

    if (isError) {
      this._consecutiveToolFailures++;
      if (
        this._consecutiveToolFailures >= MAX_CONSECUTIVE_TOOL_FAILURES &&
        this._mcpBridgeAvailable
      ) {
        this._mcpBridgeAvailable = false;
        console.warn(
          `[gateway-ws] MCP Bridge UNAVAILABLE: ${this._consecutiveToolFailures} consecutive tool failures`,
        );
      }
    } else {
      // 成功 → 重置计数器
      if (this._consecutiveToolFailures > 0) {
        this._consecutiveToolFailures = 0;
        if (!this._mcpBridgeAvailable) {
          this._mcpBridgeAvailable = true;
          console.log("[gateway-ws] MCP Bridge recovered (tool call succeeded)");
        }
      }
    }
  }

  /** 启动心跳 */
  private _startPing(): void {
    this._stopPing();
    this._lastActivityTime = Date.now();
    this._resetIdleTimer();
    this._pingTimer = setInterval(() => {
      if (!this._ws || this._state !== "connected") return;

      // 心跳超时检测：超过 HEARTBEAT_TIMEOUT_MS 未收到任何消息
      if (Date.now() - this._lastActivityTime > HEARTBEAT_TIMEOUT_MS) {
        console.warn(
          `[gateway-ws] Heartbeat timeout (${Math.round((Date.now() - this._lastActivityTime) / 1000)}s no activity), forcing reconnect...`,
        );
        try { this._ws.close(4001, "heartbeat timeout"); } catch { /* ignore */ }
        this._ws = null;
        this._stopPing();
        this._rejectAllPending(new Error("Heartbeat timeout"));
        this._setState("disconnected");
        this._scheduleReconnect();
        return;
      }

      try {
        this._ws.send(JSON.stringify({ type: "ping" }));
      } catch {
        // ping 失败忽略，下次心跳超时会处理
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

  // ─── 空闲管理 ──────────────────────────────────────────────────────────

  /** 重置空闲计时器（每次用户交互/消息接收时调用） */
  private _resetIdleTimer(): void {
    this._stopIdleTimer();
    if (this._disposed) return;
    this._idleTimer = setTimeout(() => this._onIdleTimeout(), IDLE_DISCONNECT_MS);
  }

  /** 停止空闲计时器 */
  private _stopIdleTimer(): void {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
  }

  /** 空闲超时处理：软断开（保留重连能力，等待下次 sendChat 触发唤醒） */
  private _onIdleTimeout(): void {
    if (this._disposed || this._state !== "connected") return;
    console.log(
      `[gateway-ws] Idle timeout (${IDLE_DISCONNECT_MS / 1000}s), disconnecting to save resources...`,
    );
    this._idleDisconnected = true;
    this._stopPing();
    if (this._ws) {
      try { this._ws.close(IDLE_CLOSE_CODE, "idle disconnect"); } catch { /* ignore */ }
      this._ws = null;
    }
    this._setState("disconnected");
  }

  /** 自动重连 */
  private _scheduleReconnect(): void {
    if (this._disposed) return;

    const neverConnected = this._reconnectionTime === 0;

    // 阶段 1：首次连接前 → 快速重试（2s 间隔，覆盖 Gateway 冷启动窗口）
    if (neverConnected && this._reconnectAttempts < MAX_STARTUP_FAST_RETRIES) {
      this._cancelReconnect();
      this._reconnectAttempts++;
      console.log(
        `[gateway-ws] Startup fast retry: attempt=${this._reconnectAttempts}/${MAX_STARTUP_FAST_RETRIES}, delay=${STARTUP_FAST_RETRY_DELAY}ms`,
      );
      this._reconnectTimer = setTimeout(async () => {
        if (this._disposed) return;
        const ok = await this.connect();
        if (!ok) this._scheduleReconnect();
      }, STARTUP_FAST_RETRY_DELAY);
      return;
    }

    // 阶段 2：已连过或快速重试用尽 → 指数退避（限 5 次）
    if (this._reconnectAttempts < MAX_STARTUP_FAST_RETRIES + MAX_RECONNECT_ATTEMPTS) {
      this._cancelReconnect();
      this._reconnectAttempts++;
      const expoAttempt = this._reconnectAttempts - (neverConnected ? MAX_STARTUP_FAST_RETRIES : 0);
      const delay = Math.min(
        RECONNECT_BASE_DELAY * Math.pow(1.5, Math.max(0, expoAttempt - 1)),
        RECONNECT_MAX_DELAY,
      );
      console.log(
        `[gateway-ws] Scheduling reconnect: attempt=${this._reconnectAttempts}, delay=${delay}ms, neverConnected=${neverConnected}`,
      );
      this._reconnectTimer = setTimeout(async () => {
        if (this._disposed) return;
        const ok = await this.connect();
        if (!ok) this._scheduleReconnect();
      }, delay);
      return;
    }

    // 阶段 3：所有短周期重试用尽 → 持久化慢速重试（30s 间隔，永不放弃）
    console.log(
      `[gateway-ws] All fast retries exhausted (${this._reconnectAttempts} attempts), switching to persistent retry (${PERSISTENT_RETRY_INTERVAL / 1000}s interval)`,
    );
    this._cancelReconnect();
    this._reconnectTimer = setTimeout(async () => {
      if (this._disposed) return;
      const ok = await this.connect();
      if (!ok) this._scheduleReconnect();
    }, PERSISTENT_RETRY_INTERVAL);
  }

  /**
   * Gateway 启动期间重试（close code 1013）。
   * 不消耗 _reconnectAttempts，固定 2s 间隔重试最多 10 次。
   * 一旦连上或 disposed 就停止。
   */
  private _startupRetryCount = 0;
  private static readonly MAX_STARTUP_RETRIES = 10;

  private _scheduleStartupRetry(): void {
    if (this._disposed || this._startupRetryCount >= GatewayWebSocket.MAX_STARTUP_RETRIES) {
      // 超出启动重试上限，降级到 _scheduleReconnect（现已支持持久化重试，不会停止）
      if (!this._disposed) this._scheduleReconnect();
      return;
    }
    this._cancelReconnect();
    this._startupRetryCount++;
    console.log(
      `[gateway-ws] Gateway start retry (1013): attempt=${this._startupRetryCount}/${GatewayWebSocket.MAX_STARTUP_RETRIES}`,
    );
    this._reconnectTimer = setTimeout(async () => {
      if (this._disposed) return;
      const ok = await this.connect();
      if (ok) {
        // 成功连接，重置启动重试计数
        this._startupRetryCount = 0;
      }
      // 如果仍失败且又收到 1013，onclose 会再次调用 _scheduleStartupRetry
    }, STARTUP_FAST_RETRY_DELAY);
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
    if (state === "connected") {
      this._reconnectionTime = Date.now();
      this._connectionEstablishedAt = Date.now();
      // FIX-BUG4: 重连后乐观初始化（原悲观=true 导致 isSendReady 永远 false，
      // 用户消息卡在 pendingQueue 不发送）。
      // 等首次 health 事件确认真实状态；如真退化会立即标记。
      this._eventLoopDegraded = false;
      this._degradedHitCount = 0; // 重置去抖计数
      this._lastLoggedHealthDegraded = null; // 重连后首次 health 事件必须打印
      this._lastLoggedHealthDelayMs = -1;
      // 清除空闲断开标记（重连成功 = 不再空闲）
      this._idleDisconnected = false;
      // 重置 MCP Bridge 状态（新连接 = 重新评估）
      this._consecutiveToolFailures = 0;
      this._mcpBridgeAvailable = true;
      // 启动空闲计时器
      this._resetIdleTimer();
      // v4 重构：连接恢复 → 通知 chat-service 驱动队列（延迟到冷却期结束）
      setTimeout(() => {
        if (!this._disposed && this._state === "connected") {
          this._notifyReadyChange("ws_connected");
        }
      }, RECONNECT_COOLDOWN_MS + 200);
      // 握手完成：记录耗时
      if (this._handshakeStartedAt > 0) {
        console.log(`[gateway-ws] Handshake complete in ${Date.now() - this._handshakeStartedAt}ms`);
        this._handshakeStartedAt = 0;
      }
    }
    if (state === "disconnected") {
      this._eventLoopDegraded = false;
      // v4 重构：通知 chat-service ready=false（停止驱动队列）
      this._notifyReadyChange("ws_disconnected");
      // 非空闲断开 → 停止空闲计时器（空闲断开时计时器已被 _onIdleTimeout 处理）
      if (!this._idleDisconnected) {
        this._stopIdleTimer();
      }
    }
    if (state === "handshaking") {
      this._handshakeStartedAt = Date.now();
    }
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
