/**
 * Chat 状态机服务 — 对齐 docs/specs/ui/web-chat-structure.md §4
 *
 * 使用 useReducer 管理对话状态机：
 *   Idle → Sending → Streaming → ToolExecuting → Idle
 *
 * 职责：
 * - 管理消息列表（CRUD + 流式追加）
 * - 管理对话状态转换
 * - 管理发送队列（生成中排队）
 * - 桥接 GatewayWebSocket 与 UI 状态
 */

import * as React from "react";
import type {
  ChatMessage,
  ChatState,
  ToolCall,
  ChatSession,
  GatewayChatEvent,
  GatewayMessageBlock,
} from "./types";
import { CHAT_MODEL_STORAGE_KEY } from "./types";
import { GatewayWebSocket } from "./gateway-ws";
import type { SendResult } from "./gateway-ws";

// ─── 内存消息缓存（同步，跟 ArtClawToolManager cachedMessages 同思路）────
// 按 sessionKey 缓存消息数组。切对话时同步存/取，零延迟。
// Gateway history 仅作为后台静默刷新源，不阻塞 UI。
const messageCache = new Map<string, ChatMessage[]>();

/** v4.2: compaction 补齐 — 每次同步从 Gateway 拉取的最大消息数 */
const SYNC_FETCH_LIMIT = 20;

// ─── AI 错误信息解析（将 Gateway 原始错误映射为用户可理解的中文提示）────

/**
 * 解析 AI 调用错误，返回带具体原因的用户提示。
 *
 * 匹配规则（按优先级）：
 * - 429 → API 配额/速率超限，请稍后重试或更换 Key
 * - 403 → API Key 无效或已过期
 * - 401 → API Key 鉴权失败
 * - 500/502/503 → 服务端异常
 * - timeout / ETIMEDOUT → 请求超时
 * - 其他 → 保留 Gateway 原文（不再用笼统的"AI 响应出错"）
 */
function parseAiErrorMessage(raw: string): string {
  const lower = raw.toLowerCase();

  // 429: 速率限制 / 配额耗尽
  if (lower.includes("429") || lower.includes("rate limit")) {
    return "API 配额/速率超限（429），请稍后重试或更换 API Key";
  }
  // 403: Key 过期 / 无权访问
  if (lower.includes("403") || lower.includes("forbidden")) {
    return "API Key 无效或已过期（403），请检查并更新 Key";
  }
  // 401: 鉴权失败
  if (lower.includes("401") || lower.includes("unauthorized")) {
    return "API Key 鉴权失败（401），请检查 Key 是否正确";
  }
  // 5xx: 服务端异常
  if (/\b5\d{2}\b/.test(raw)) {
    const code = raw.match(/\b(5\d{2})\b/)?.[1] ?? "5xx";
    return `AI 服务端异常（${code}），请稍后重试`;
  }
  // 超时
  if (lower.includes("timeout") || lower.includes("etimedout")) {
    return "AI 请求超时，请检查网络后重试";
  }
  // 如果 Gateway 给了有意义的错误信息，直接用
  if (raw.length > 10) {
    return `AI 响应出错：${raw.slice(0, 120)}`;
  }
  // 兜底
  return "AI 响应出错，请重试";
}

// ─── localStorage 持久化（P1-4：防页面刷新/崩溃丢失消息） ──────────
const LS_PREFIX = "artifex_chat:";
const MAX_PERSISTED_MESSAGES = 200;
let _persistTimer: ReturnType<typeof setTimeout> | null = null;

/** 从 localStorage 恢复指定会话的消息 */
function loadPersistedMessages(sessionKey: string): ChatMessage[] | null {
  try {
    const raw = localStorage.getItem(`${LS_PREFIX}${sessionKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChatMessage[];
    if (!Array.isArray(parsed)) return null;
    return parsed.slice(0, MAX_PERSISTED_MESSAGES);
  } catch {
    return null;
  }
}

/** debounced 写入 localStorage（500ms，避免流式消息期间高频写） */
function persistMessages(sessionKey: string, messages: ChatMessage[]): void {
  if (_persistTimer) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => {
    try {
      const subset = messages.slice(-MAX_PERSISTED_MESSAGES);
      localStorage.setItem(`${LS_PREFIX}${sessionKey}`, JSON.stringify(subset));
    } catch {
      // localStorage 满了或不可写，静默忽略
    }
  }, 500);
}

// ─── Reducer Action ────────────────────────────────────────────────────────

export type ChatAction =
  | { type: "ADD_USER_MESSAGE"; text: string }
  | { type: "START_STREAMING"; messageId: string }
  | { type: "APPEND_DELTA"; text: string; targetMessageId?: string }
  | { type: "UPDATE_TOOL_CALL"; toolCallId: string; update: Partial<ToolCall> }
  | { type: "FINISH_STREAMING"; targetMessageId?: string }
  | { type: "BIND_RUN_ID"; messageId: string; runId: string }
  | { type: "SET_ERROR"; error: string }
  | { type: "STOP" }
  | { type: "ENQUEUE"; text: string }
  | { type: "DEQUEUE" }
  | { type: "DEQUEUE_BY_TEXT"; text: string }
  | { type: "DEQUEUE_AT"; index: number }
  | { type: "SET_SESSION"; session: ChatSession }
  | { type: "SET_SESSIONS"; sessions: ChatSession[] }
  | { type: "CLEAR_MESSAGES" }
  | { type: "RESET_STATE" }
  | { type: "TOGGLE_MERGE" }
  | { type: "LOAD_HISTORY"; messages: ChatMessage[] }
  | { type: "MERGE_MESSAGES"; messages: ChatMessage[] };

export interface ChatServiceState {
  chatState: ChatState;
  messages: ChatMessage[];
  streamingMessageId: string | null;
  pendingQueue: string[];
  error: string | null;
  sessions: ChatSession[];
  activeSessionId: string;
  cancelledMessageId: string | null;
  mergeEnabled: boolean;
}

// ─── Reducer ───────────────────────────────────────────────────────────────

  let msgSeq = 0;
  function genMsgId(): string { msgSeq++; return `msg-${Date.now()}-${msgSeq}`; }
  /** 生成消息追踪 ID，贯穿 sendMessage → sendChat → gateway → 回复全链路 */
  function genTraceId(): string { msgSeq++; return `tr-${Date.now().toString(36)}-${msgSeq}`; }

  // ─── 埋点：消息发送/接收日志（诊断用）───────────────────────────────
  function _trace(label: string, traceId: string, detail: string): void {
    console.log(`[chat] ${label} | trace=${traceId.slice(0,10)} | ${detail}`);
  }

export function chatReducer(state: ChatServiceState, action: ChatAction): ChatServiceState {
  switch (action.type) {
    case "ADD_USER_MESSAGE":
      return { ...state, messages: [...state.messages, { id: genMsgId(), role: "user", content: action.text, timestamp: new Date().toISOString() }], error: null };
    case "START_STREAMING":
      return { ...state, messages: [...state.messages, { id: action.messageId, role: "assistant", content: "", timestamp: new Date().toISOString(), isStreaming: true }], streamingMessageId: action.messageId, chatState: "streaming" };
    case "APPEND_DELTA": {
      // v4.1.2: 优先用 targetMessageId（按 runId 关联的消息），fallback 到 streamingMessageId
      const targetId = action.targetMessageId ?? state.streamingMessageId;
      return { ...state, messages: state.messages.map(m => m.id === targetId ? { ...m, content: m.content + action.text } : m) };
    }
    case "UPDATE_TOOL_CALL":
      return { ...state, messages: state.messages.map(m => { if (m.id !== state.streamingMessageId) return m; const existing = m.toolCalls ?? []; const idx = existing.findIndex(tc => tc.id === action.toolCallId); const updated = idx >= 0 ? existing.map(tc => tc.id === action.toolCallId ? { ...tc, ...action.update } : tc) : [...existing, { id: action.toolCallId, name: "", status: "running" as const, ...action.update }]; return { ...m, toolCalls: updated }; }), chatState: "tool_executing" };
    case "FINISH_STREAMING": {
      // v4.1.2: 优先用 targetMessageId（按 runId 关联），只 finish 该条；
      // 没有 targetMessageId 时（兜底）finish 当前 streaming 占位
      const targetId = action.targetMessageId ?? state.streamingMessageId;
      const newStreamingId = action.targetMessageId && action.targetMessageId !== state.streamingMessageId
        ? state.streamingMessageId  // 只 finish 了别的消息，当前 streaming 不变
        : null;
      const newChatState = newStreamingId ? state.chatState : "idle";
      return {
        ...state,
        messages: state.messages.map(m => m.id === targetId ? { ...m, isStreaming: false } : m),
        streamingMessageId: newStreamingId,
        chatState: newChatState as ChatState,
        cancelledMessageId: newStreamingId ? state.cancelledMessageId : null,
      };
    }
    case "BIND_RUN_ID": {
      // 把 runId 绑到指定消息（首次见到该 runId 时调用）
      return { ...state, messages: state.messages.map(m => m.id === action.messageId ? { ...m, runId: action.runId } : m) };
    }
    case "SET_ERROR":
      return { ...state, messages: state.messages.map(m => m.id === state.streamingMessageId ? { ...m, isStreaming: false } : m), streamingMessageId: null, chatState: "error", error: action.error };
    case "STOP":
      return { ...state, messages: state.messages.map(m => m.id === state.streamingMessageId ? { ...m, isStreaming: false } : m), streamingMessageId: null, chatState: "idle", cancelledMessageId: state.streamingMessageId };
    case "ENQUEUE":
      if (!action.text.trim()) return state;
      return { ...state, pendingQueue: [...state.pendingQueue, action.text] };
    case "DEQUEUE":
      if (state.pendingQueue.length === 0) return state;
      return { ...state, pendingQueue: state.pendingQueue.slice(1) };
    case "DEQUEUE_BY_TEXT": {
      // FIX: 精准移除指定文本（首次出现），不影响其他消息
      const idx = state.pendingQueue.indexOf(action.text);
      if (idx < 0) return state;
      const next = [...state.pendingQueue];
      next.splice(idx, 1);
      return { ...state, pendingQueue: next };
    }
    case "DEQUEUE_AT": {
      // 按 index 精准移除（用户操作：删除队列中第 N 条）
      if (action.index < 0 || action.index >= state.pendingQueue.length) return state;
      const next = [...state.pendingQueue];
      next.splice(action.index, 1);
      return { ...state, pendingQueue: next };
    }
    case "SET_SESSION":
      // FIX: 切换会话清空 pendingQueue（队列消息属于上一个会话，新会话不应该继承）
      return { ...state, messages: action.session.messages, activeSessionId: action.session.id, pendingQueue: [], chatState: "idle", streamingMessageId: null, error: null, cancelledMessageId: null };
    case "SET_SESSIONS":
      return { ...state, sessions: action.sessions };
    case "CLEAR_MESSAGES":
      // FIX: 同样清空 pendingQueue
      return { ...state, messages: [], pendingQueue: [], chatState: "idle", streamingMessageId: null, error: null, cancelledMessageId: null };
    case "RESET_STATE": {
      // Gateway 断连时清理。
      // v4.1.3 修复：以前只把 isStreaming 置 false 留下空回复占位，UI 永远显示空白消息。
      // 新策略：
      //   - 内容为空 + 无 toolCalls 的 streaming 占位 → 直接从 messages 移除（彻底没回复）
      //   - 同时找到这些占位"前面那条用户消息" → 重新入队等重连后自动重发
      //   - 有内容/有 toolCalls 的 streaming 占位 → 仅置 isStreaming=false（保留已收到的部分）
      const newMessages: ChatMessage[] = [];
      const reEnqueueTexts: string[] = [];
      for (let i = 0; i < state.messages.length; i++) {
        const m = state.messages[i];
        const isEmptyStreaming = m.isStreaming && m.role === "assistant" && !m.content && (!m.toolCalls || m.toolCalls.length === 0);
        if (isEmptyStreaming) {
          // 找前一条 user 消息，重新入队
          for (let j = i - 1; j >= 0; j--) {
            const prev = state.messages[j];
            if (prev.role === "user") {
              reEnqueueTexts.push(prev.content);
              break;
            }
          }
          // 跳过该空回复占位（不加入 newMessages）
          continue;
        }
        if (m.isStreaming) {
          newMessages.push({ ...m, isStreaming: false });
        } else {
          newMessages.push(m);
        }
      }
      // 把要重新入队的文本加到 pendingQueue 头部（保留原有队列在后）
      const newPendingQueue = [...reEnqueueTexts, ...state.pendingQueue];
      if (reEnqueueTexts.length > 0) {
        console.log(`[chat] RESET_STATE: re-enqueueing ${reEnqueueTexts.length} unanswered user messages`);
      }
      return {
        ...state,
        messages: newMessages,
        pendingQueue: newPendingQueue,
        chatState: "idle",
        streamingMessageId: null,
        error: null,
        cancelledMessageId: state.cancelledMessageId,
      };
    }
    case "TOGGLE_MERGE":
      return { ...state, mergeEnabled: !state.mergeEnabled };
    case "LOAD_HISTORY":
      // FIX: 加载历史时清空 pendingQueue
      return { ...state, messages: action.messages, pendingQueue: [], chatState: "idle", streamingMessageId: null, error: null, cancelledMessageId: null };
    case "MERGE_MESSAGES": {
      // v4.2: compaction 补齐 — 按 ID 去重，按时间排序合并新消息
      const existingIds = new Set(state.messages.map(m => m.id));
      const toAdd = action.messages.filter(m => !existingIds.has(m.id));
      if (toAdd.length === 0) return state;
      console.log(`[chat] MERGE_MESSAGES: adding ${toAdd.length} new messages (total before=${state.messages.length})`);
      return {
        ...state,
        messages: [...state.messages, ...toAdd].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        ),
      };
    }
    default:
      return state;
  }
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export interface ChatServiceOptions {
  gatewayPort: number;
  gatewayToken?: string;
  agentId?: string;
  gatewayRunning?: boolean;
  /** port/token 凭据是否已从 sidecar 拉取到。未就绪时不建 WS。 */
  authReady?: boolean;
}

export function useChatService(options: ChatServiceOptions) {
  const { gatewayPort, gatewayToken = "", agentId = "artifex-nexus", gatewayRunning = false, authReady = false } = options;

  // sessionKey 由外部通过 switchSession 控制，初始为空（等待对话列表选中）
  const sessionKeyRef = React.useRef("");

  const wsRef = React.useRef<GatewayWebSocket | null>(null);
  const [wsState, setWsState] = React.useState<"disconnected" | "connecting" | "connected" | "degraded">("disconnected");
  /** Gateway 事件循环是否处于退化状态（从 health 事件检测） */
  const [eventLoopDegraded, setEventLoopDegraded] = React.useState(false);
  /** MCP Bridge 是否可用（连续工具调用失败 → false） */
  const [mcpBridgeAvailable, setMcpBridgeAvailable] = React.useState(true);

  // Reducer — 初始空消息列表（对话内容由 Gateway 加载）
  const [state, dispatch] = React.useReducer(chatReducer, null, () => {
    let mergeEnabled = true;
    try { const v = localStorage.getItem("artifex_chat:mergeEnabled"); if (v !== null) mergeEnabled = v === "true"; } catch { /* ignore */ }
    return { chatState: "idle" as ChatState, messages: [], streamingMessageId: null, pendingQueue: [], error: null, sessions: [], activeSessionId: "", cancelledMessageId: null, mergeEnabled };
  });

  const lastTextRef = React.useRef("");
  const prevWsStateRef = React.useRef<"disconnected" | "connecting" | "connected" | "degraded">("disconnected");
  /** Ref mirror of state for callbacks that run in stale closures (processQueue, handleGatewayEvent) */
  const stateRef = React.useRef(state);
  stateRef.current = state;
  /** FIX-BUG3: 用 ref 跟踪 prevDegraded，避免 healthInterval 闭包捕获过期值 */
  const prevDegradedRef = React.useRef(false);
  /** v4 重构：processQueue 防重入（同时只有一次 chat.send 在飞） */
  const sendingRef = React.useRef(false);
  /** v4.1.2: runId → 对应的 assistant messageId 映射。
   *  Gateway 多个 runId 事件可能交错，用此 map 保证内容写到正确的消息上。 */
  const runIdToMsgIdRef = React.useRef<Map<string, string>>(new Map());
  /** v4.1.2: 每个 runId 累积文本（替代单一 lastTextRef），避免不同 run 互相影响 */
  const runIdToLastTextRef = React.useRef<Map<string, string>>(new Map());
  /** v4.1.10: 每条消息的端到端耗时追踪
   *  key=runId 或 msgId, value={sentAt, ackAt, firstDeltaAt, finalAt}
   *  用于打印 "用户体感时间 vs Gateway ACK 时间" 对比 */
  const msgTimingRef = React.useRef<Map<string, {
    sentAt: number;
    ackAt?: number;
    firstDeltaAt?: number;
    firstDeltaCharsAt?: number;
    finalAt?: number;
    runId?: string;
  }>>(new Map());
  /** v4.2: syncFromGateway 并发保护 — 同一时间只允许一次同步在飞 */
  const syncInFlightRef = React.useRef(false);

  // ─── 消息变化时自动同步内存缓存 + localStorage ──────────────────────
  // 仅在非流式状态下写入（避免 APPEND_DELTA 每帧写）
  React.useEffect(() => {
    if (sessionKeyRef.current && state.messages.length > 0 && !state.streamingMessageId) {
      messageCache.set(sessionKeyRef.current, state.messages);
      persistMessages(sessionKeyRef.current, state.messages);
    }
  }, [state.messages, state.streamingMessageId]);

  // v4.1 关键修复：状态机驱动器
  // 当 chatState 变为 idle 且 pendingQueue 非空 → 自动 processQueue
  // 这是除 final/onReadyChange 之外的最终防御，确保队列不会卡住
  // v4.1.4: 也检查 streamingMessageId === null 确保上一条真正完成
  React.useEffect(() => {
    if (
      state.chatState === "idle" &&
      state.pendingQueue.length > 0 &&
      state.streamingMessageId === null &&
      !sendingRef.current
    ) {
      console.log(`[chat] auto-driver: chatState=idle + pendingQueue[${state.pendingQueue.length}] + no streaming → processQueue`);
      // setTimeout 0 让 React commit 完成
      const timer = setTimeout(() => processQueue(), 0);
      return () => clearTimeout(timer);
    }
  }, [state.chatState, state.pendingQueue.length, state.streamingMessageId]);

  // v4.1 sendingRef 安全网：90 秒超时强制重置（防止异常路径让 sendingRef=true 永久残留 → 队列死锁）
  React.useEffect(() => {
    if (!sendingRef.current) return;
    const timer = setTimeout(() => {
      if (sendingRef.current) {
        console.warn(`[chat] sendingRef stuck at true for 90s → force reset`);
        sendingRef.current = false;
        // 强制驱动一次队列
        if (stateRef.current.pendingQueue.length > 0) {
          processQueue();
        }
      }
    }, 90_000);
    return () => clearTimeout(timer);
  }, [state.chatState]);

  // v4.1.3：streaming 超时检测
  // 如果 START_STREAMING 后 60 秒还没收到任何 chat 事件（content 仍空 + 无 toolCalls），
  // 认为 Gateway 异常 / 崩溃 → 把对应 user 消息重新入队 + 移除空占位
  // 触发 RESET_STATE 同款逻辑
  React.useEffect(() => {
    const sid = state.streamingMessageId;
    if (!sid) return;
    const STREAMING_TIMEOUT_MS = 60_000;
    const checkTimer = setTimeout(() => {
      const cur = stateRef.current.messages.find(m => m.id === sid);
      if (cur && cur.isStreaming && !cur.content && (!cur.toolCalls || cur.toolCalls.length === 0)) {
        console.warn(`[chat] streaming timeout: msg=${sid.slice(0,10)} 60s no chat event → recover via RESET_STATE`);
        // 用 RESET_STATE 恢复（移除空占位 + 重新入队前一条 user 消息）
        dispatch({ type: "RESET_STATE" });
      }
    }, STREAMING_TIMEOUT_MS);
    return () => clearTimeout(checkTimer);
  }, [state.streamingMessageId]);

  // ─── Gateway 连接管理 ─────────────────────────────────────────────────
  // 关键：仅在 gatewayRunning=true 且 authReady=true 时才建 WS，
  // 避免向未就绪 Gateway 或使用空 token 重复连接

  React.useEffect(() => {
    if (!gatewayPort || gatewayPort <= 0 || !gatewayRunning || !authReady) {
      setWsState("disconnected");
      return;
    }

    let cancelled = false;

    const wsUrl = `ws://127.0.0.1:${gatewayPort}`;
    const ws = new GatewayWebSocket(wsUrl, gatewayToken);
    if (cancelled) { ws.disconnect(); return; }
    wsRef.current = ws;

    ws.onStateChange((s) => {
      const mapped = s === "connected" ? "connected" : s === "disconnected" ? "disconnected" : "connecting";
      const wasDisconnected = prevWsStateRef.current === "disconnected";
      if (mapped === "disconnected" && prevWsStateRef.current === "connected") {
        dispatch({ type: "RESET_STATE" });
      }
      prevWsStateRef.current = mapped;
      setWsState(mapped);
      // 状态变更时同步检查事件循环退化
      const degraded = ws.eventLoopDegraded;
      setEventLoopDegraded(degraded);
      if (mapped === "connected" && degraded) {
        setWsState("degraded");
      }
      // v4.2: WS 从断连恢复为 connected → 补齐 compaction 期间丢失的消息
      if (mapped === "connected" && wasDisconnected) {
        syncFromGateway();
      }
    });

    ws.onMessage((event: GatewayChatEvent) => {
      handleGatewayEvent(event);
    });

    // v4 重构：监听 WS ready 状态变化，驱动 pendingQueue
    // gateway-ws 不再持有队列；ready=true 时 chat-service 主动 processQueue
    ws.onReadyChange(({ ready, reason }) => {
      console.log(`[chat] READY-CHANGE ready=${ready} reason=${reason} pendingQueue=${stateRef.current.pendingQueue.length}`);
      if (ready && stateRef.current.pendingQueue.length > 0 && stateRef.current.chatState === "idle") {
        console.log(`[chat] READY: triggering processQueue`);
        queueMicrotask(() => processQueue()); // v4: 异步避免 stale state
      }
    });

    ws.connect().catch((err) => {
      console.error("[chat-service] gateway-ws connect failed:", err);
    });

    // ── 健康状态轮询：health 事件通过 WS 消息流更新 GatewayWebSocket 内部状态，
    // 这里定时同步到 React state 以驱动 UI 更新。 ──
    const healthInterval = setInterval(() => {
      if (cancelled) return;
      const degraded = ws.eventLoopDegraded;
      const prevDegraded = prevDegradedRef.current; // FIX-BUG3: 用 ref 不用 stale state
      // 仅在状态变化时打日志，避免刷屏
      if (degraded !== prevDegraded) {
        console.log(`[chat] health: eventLoopDegraded ${prevDegraded} → ${degraded} ws=${ws.state}`);
        // EventLoop 恢复 → 重试 pendingQueue 中滞留的消息
        if (prevDegraded && !degraded && stateRef.current.pendingQueue.length > 0) {
          console.log(`[chat] health: EventLoop recovered, retrying pendingQueue[${stateRef.current.pendingQueue.length}]`);
          queueMicrotask(() => processQueue()); // v4: 异步触发
        }
        prevDegradedRef.current = degraded; // 同步 ref
      }
      setEventLoopDegraded(degraded);
      // P2-8：同步 MCP Bridge 可用性
      const mcpOk = ws.mcpBridgeAvailable;
      setMcpBridgeAvailable(mcpOk);
      // 连上了但事件循环退化 → 显示 degraded 状态
      const currentWsState = prevWsStateRef.current;
      if (ws.state === "connected" && degraded) {
        if (currentWsState !== "degraded") {
          console.log(`[chat-service] healthInterval: wsState "${currentWsState}" → "degraded" (eventLoop degraded)`);
        }
        setWsState("degraded");
      } else if (ws.state === "connected" && !degraded) {
        if (currentWsState !== "connected") {
          console.log(`[chat-service] healthInterval: wsState "${currentWsState}" → "connected" (eventLoop OK)`);
        }
        setWsState("connected");
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(healthInterval);
      ws.disconnect();
      wsRef.current = null;
    };
  }, [gatewayPort, gatewayToken, gatewayRunning, authReady]);

  // ─── Gateway 事件处理（v4.1.2：runId 关联消息） ─────────────────────

  /**
   * 解析 chat 事件 → 找到/创建对应的 messageId（按 runId 关联）。
   *
   * v4.1.5 关键修复：从 final 事件来时禁止"首次绑定到当前 streaming"。
   * 因为 final 可能是上一条对话的延迟事件（runId 已从 map 清除），
   * 错绑会导致**错位 finish 当前 streaming → 用户消息变空回复**。
   *
   * @param runId Gateway runId
   * @param hasContent 事件是否带文本（false 时仅用于 finish/abort）
   * @param eventState 事件类型（"delta"|"final"|...）— 用于判断是否允许首次绑定
   * @returns { msgId, isNew }：msgId 为本事件应该写入的消息 ID
   */
  function _resolveTargetMessage(
    runId: string | undefined,
    hasContent: boolean,
    eventState: "delta" | "final" | "aborted" | "error" = "delta",
  ): { msgId: string | null; isNew: boolean } {
    // 无 runId：fallback 用当前 streaming 占位
    if (!runId) {
      const cur = stateRef.current.streamingMessageId;
      if (cur) return { msgId: cur, isNew: false };
      // 极端：没有当前 streaming 又没 runId → 兜底创建（防御性）
      if (hasContent && eventState === "delta") {
        const newId = genMsgId();
        console.warn(`[chat] AUTO-STREAM (no runId, no current streaming): id=${newId.slice(0,10)}`);
        dispatch({ type: "START_STREAMING", messageId: newId });
        return { msgId: newId, isNew: true };
      }
      return { msgId: null, isNew: false };
    }

    // 有 runId：查 map
    const existing = runIdToMsgIdRef.current.get(runId);
    if (existing) return { msgId: existing, isNew: false };

    // ⚠️ v4.1.5 关键修复：runId 没在 map 中 + 事件是 final/aborted/error
    // → 绝不绑定到当前 streaming（很可能是上一条对话的延迟事件），
    // 否则会错误地 finish 用户当前消息 → 空回复 bug
    if (eventState === "final" || eventState === "aborted" || eventState === "error") {
      console.warn(`[chat] STALE-EVENT: ignoring ${eventState} event for unknown runId=${runId.slice(0,8)} (no map binding, current streaming=${stateRef.current.streamingMessageId?.slice(0,10) ?? "none"})`);
      return { msgId: null, isNew: false };
    }

    // 首次见到此 runId（仅 delta）：尝试绑到当前 streaming 占位
    const curStreaming = stateRef.current.streamingMessageId;
    if (curStreaming) {
      // 检查这个 streaming 占位是否还没绑 runId
      const curMsg = stateRef.current.messages.find(m => m.id === curStreaming);
      if (curMsg && !curMsg.runId) {
        runIdToMsgIdRef.current.set(runId, curStreaming);
        dispatch({ type: "BIND_RUN_ID", messageId: curStreaming, runId });
        console.log(`[chat] BIND runId=${runId.slice(0,8)} → msg=${curStreaming.slice(0,10)}`);
        return { msgId: curStreaming, isNew: false };
      }
    }

    // 当前 streaming 占位已绑了别的 runId（或无占位）→ 为此 runId 新建占位
    if (hasContent) {
      const newId = genMsgId();
      console.warn(`[chat] AUTO-STREAM for new runId=${runId.slice(0,8)}: id=${newId.slice(0,10)} (current streaming=${curStreaming ?? "none"})`);
      runIdToMsgIdRef.current.set(runId, newId);
      dispatch({ type: "START_STREAMING", messageId: newId });
      dispatch({ type: "BIND_RUN_ID", messageId: newId, runId });
      return { msgId: newId, isNew: true };
    }

    return { msgId: null, isNew: false };
  }

  /**
   * 从 messageBlocks 中提取 tool_result 块，更新对应 ToolCall 的 output。
   *
   * 背景：非 exec 类型的 MCP 工具调用（如 web_search）不产生 command_output 事件，
   * 工具结果仅嵌入在最终 chat message 的 content blocks 中（Anthropic 风格 tool_result）。
   * 此函数解析这些 blocks 并将结果写入对应 ToolCall.output。
   */
  function _processMessageBlocks(
    event: GatewayChatEvent,
    dispatch: React.Dispatch<ChatAction>,
  ): void {
    const blocks = event.messageBlocks;
    if (!blocks || blocks.length === 0) return;

    const toolResultBlocks = blocks.filter((b): b is GatewayMessageBlock => b.type === "tool_result");
    if (toolResultBlocks.length === 0) return;

    for (const block of toolResultBlocks) {
      const toolUseId = block.tool_use_id;
      if (!toolUseId) continue;

      const content = block.content;
      let resultText: string | undefined;
      if (typeof content === "string") {
        resultText = content;
      } else if (Array.isArray(content)) {
        // content 可能是子 block 数组（如 [{type: "text", text: "..."}]）
        resultText = (content as GatewayMessageBlock[])
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("\n");
      }

      if (resultText !== undefined) {
        dispatch({
          type: "UPDATE_TOOL_CALL",
          toolCallId: toolUseId,
          update: { output: resultText, status: "done" },
        });
      }
    }
  }

  function handleGatewayEvent(event: GatewayChatEvent) {
    const sId = state.streamingMessageId?.slice(0,10) ?? "none";
    const runIdShort = event.runId?.slice(0,8) ?? "none";
    _trace("RECV", sId, `state=${event.state} runId=${runIdShort} hasMsg=${!!event.message} msgLen=${event.message?.length??0} hasTool=${!!event.toolCall}`);
    switch (event.state) {
      case "delta": {
        // 处理文本内容：按 runId 关联到对应消息
        if (event.message) {
          const { msgId } = _resolveTargetMessage(event.runId, true, "delta");
          if (msgId) {
            // v4.1.10: 记录首次 delta 时间（含字符）— 用户实际看到第一个字的时刻
            const timing = msgTimingRef.current.get(msgId);
            if (timing && !timing.firstDeltaCharsAt && event.message.length > 0) {
              timing.firstDeltaCharsAt = Date.now();
              timing.runId = event.runId;
              const firstByteMs = timing.firstDeltaCharsAt - timing.sentAt;
              const ackToFirstByteMs = timing.ackAt ? timing.firstDeltaCharsAt - timing.ackAt : -1;
              console.log(`[chat] TIMING msg=${msgId.slice(0,10)} runId=${event.runId?.slice(0,8)} sent→firstByte=${firstByteMs}ms (ack=${timing.ackAt ? timing.ackAt - timing.sentAt : "?"}ms, ack→firstByte=${ackToFirstByteMs}ms)`);
            }
            // 累积式增量计算（按 runId 独立）
            const runKey = event.runId ?? "_no_runid_";
            const lastText = runIdToLastTextRef.current.get(runKey) ?? "";
            const incremental = event.message.startsWith(lastText) ? event.message.slice(lastText.length) : event.message;
            runIdToLastTextRef.current.set(runKey, event.message);
            if (incremental) dispatch({ type: "APPEND_DELTA", text: incremental, targetMessageId: msgId });
          }
        }
        if (event.toolCall) {
          const tc = event.toolCall;
          // 根据 Gateway 状态映射：completed → done，failed → error
          const mappedStatus =
            tc.phase === "end"
              ? tc.status === "failed"
                ? "error"
                : "done"
              : "running";
          dispatch({
            type: "UPDATE_TOOL_CALL",
            toolCallId: tc.id,
            update: {
              id: tc.id,
              name: tc.name,
              input: tc.meta || tc.title,
              status: mappedStatus,
              durationMs: tc.durationMs,
              ...(tc.error ? { output: tc.error } : {}),
            },
          });
        }
        if (event.toolOutput && event.toolOutput.phase === "delta") {
          dispatch({ type: "UPDATE_TOOL_CALL", toolCallId: event.toolOutput.toolCallId, update: { output: event.toolOutput.output, status: "running" } });
        }
        // 处理 messageBlocks 中的 tool_result → 更新对应 ToolCall.output
        _processMessageBlocks(event, dispatch);
        break;
      }
      case "final": {
        if (event.toolCall) {
          const tc = event.toolCall;
          // 根据 Gateway 状态映射：completed → done，failed → error
          const mappedStatus = tc.status === "failed" ? "error" : "done";
          dispatch({
            type: "UPDATE_TOOL_CALL",
            toolCallId: tc.id,
            update: {
              id: tc.id,
              name: tc.name,
              status: mappedStatus,
              durationMs: tc.durationMs,
              ...(tc.error ? { output: tc.error } : {}),
            },
          });
          break;
        }
        if (event.toolOutput) {
          dispatch({ type: "UPDATE_TOOL_CALL", toolCallId: event.toolOutput.toolCallId, update: { output: event.toolOutput.output, status: event.toolOutput.exitCode === 0 ? "done" : "error", durationMs: event.toolOutput.durationMs } });
          break;
        }
        // 处理 messageBlocks 中的 tool_result → 更新对应 ToolCall.output
        _processMessageBlocks(event, dispatch);
        // 处理 final.message（gateway 可能跳过 delta 直接发 final 含完整文本）
        let targetMsgId: string | null = null;
        if (event.message) {
          // v4.1.5: 即使是 final，含 message 时也允许首次绑定（视为 delta 语义）
          const { msgId } = _resolveTargetMessage(event.runId, true, "delta");
          targetMsgId = msgId;
          if (msgId) {
            const runKey = event.runId ?? "_no_runid_";
            const lastText = runIdToLastTextRef.current.get(runKey) ?? "";
            const incremental = event.message.startsWith(lastText) ? event.message.slice(lastText.length) : event.message;
            if (incremental) {
              console.log(`[chat] final: appending ${incremental.length} chars to msg=${msgId.slice(0,10)} runId=${runIdShort}`);
              dispatch({ type: "APPEND_DELTA", text: incremental, targetMessageId: msgId });
              runIdToLastTextRef.current.set(runKey, event.message);
            }
          }
        } else {
          // 无 message 的 final：找 runId 对应消息（仅 finish 该消息，不影响其他 streaming）
          // v4.1.5 关键修复：传 eventState="final" → 防止 stale runId 错绑当前 streaming
          const { msgId } = _resolveTargetMessage(event.runId, false, "final");
          targetMsgId = msgId;
        }
        // v4.1.5: 如果 targetMsgId 为 null（stale final），不 finish 任何消息
        if (targetMsgId === null) {
          console.log(`[chat] final: ignored stale runId=${runIdShort} (no FINISH dispatched)`);
        } else {
          // v4.1.10: 打印端到端耗时对比（用户体感时间 vs Gateway ACK 时间）
          const timing = msgTimingRef.current.get(targetMsgId);
          if (timing) {
            timing.finalAt = Date.now();
            const totalMs = timing.finalAt - timing.sentAt;
            const ackMs = timing.ackAt ? timing.ackAt - timing.sentAt : -1;
            const firstByteMs = timing.firstDeltaCharsAt ? timing.firstDeltaCharsAt - timing.sentAt : -1;
            const streamingMs = timing.firstDeltaCharsAt ? timing.finalAt - timing.firstDeltaCharsAt : -1;
            console.log(
              `[chat] TIMING-FINAL msg=${targetMsgId.slice(0,10)} runId=${runIdShort} ` +
              `total=${totalMs}ms (ack=${ackMs}ms + idle=${firstByteMs - ackMs}ms + streaming=${streamingMs}ms)`,
            );
            msgTimingRef.current.delete(targetMsgId);
          }
          // 仅 finish 关联的消息（不无脑清掉 streamingMessageId）
          dispatch({ type: "FINISH_STREAMING", targetMessageId: targetMsgId });
        }
        // 清理该 runId 的累积缓存
        if (event.runId) {
          runIdToLastTextRef.current.delete(event.runId);
          runIdToMsgIdRef.current.delete(event.runId);
        }
        // v4 修复：reducer commit 是 React batch，setTimeout(0) 等下一个 tick
        // v4.2: 延迟 200ms 再 processQueue，给 syncFromGateway 时间补齐 compaction 消息
        setTimeout(() => processQueue(), 200);
        // v4.2: compaction 补齐 — 每次 final 后异步拉 Gateway 历史，补齐丢失消息
        syncFromGateway();
        break;
      }
      case "aborted":
      case "error": {
        // v4.2: 错误/取消时也尝试补齐（可能 compaction 成功但前端收到了 abort 信号）
        syncFromGateway();
        if (event.state === "error") {
          // 优先用 rawError（含 HTTP 状态码），其次用 message
          const raw = event.rawError || event.message || "";
          console.warn(`[chat-service] error event: session=${sessionKeyRef.current?.slice(0,12)}... raw="${raw.slice(0,200)}"`);
          dispatch({ type: "SET_ERROR", error: parseAiErrorMessage(raw) });
        }
        else {
          console.log(`[chat-service] aborted: session=${sessionKeyRef.current?.slice(0,12)}...`);
          dispatch({ type: "STOP" });
        }
        lastTextRef.current = "";
        break;
      }
    }
  }

  // ─── v4.2: compaction 补齐 ─────────────────────────────────────────────
  // 每次 Gateway 回复 final/error/aborted 后，异步拉取会话最新消息，
  // 补齐全 compaction 期间可能丢失的后续回复。

  /** 从 chat.history RPC 响应中解析消息（复用 loadHistoryMessages 的解析逻辑） */
  function _parseHistoryMessages(rawMessages: unknown[]): ChatMessage[] {
    const messages: ChatMessage[] = [];
    for (const [idx, m] of rawMessages.entries()) {
      if (typeof m !== "object" || m === null) continue;
      const msg = m as Record<string, unknown>;
      const role = msg.role === "user" ? "user" : msg.role === "system" ? "system" : "assistant";
      let content = "";
      if (typeof msg.content === "string") {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        content = (msg.content as Array<{ type?: string; text?: string }>)
          .filter(b => b.type === "text")
          .map(b => b.text ?? "")
          .join("");
      }
      if (role === "system" && content.length > 500) continue;
      if (!content) continue;
      messages.push({
        id: (msg.id as string) ?? `history-${idx}-${Date.now()}`,
        role: role as "user" | "assistant" | "system",
        content,
        timestamp: (msg.timestamp as string) ?? new Date().toISOString(),
        isStreaming: false,
      });
    }
    return messages;
  }

  function syncFromGateway(): void {
    const ws = wsRef.current;
    const sk = sessionKeyRef.current;
    if (!ws || !sk) return;
    // WS 必须处于可通信状态
    if (ws.state !== "connected" && ws.state !== "handshaking") return;

    // v4.2 P1-2: 并发保护 — 上一次同步未完成则跳过
    if (syncInFlightRef.current) {
      console.log("[chat] syncFromGateway: skipped (already in flight)");
      return;
    }
    syncInFlightRef.current = true;
    console.log("[chat] syncFromGateway: triggered");

    (async () => {
      try {
        const result = await ws.sendRpc("chat.history", { sessionKey: sk, limit: SYNC_FETCH_LIMIT });
        const payload = result?.payload ?? result;
        const rawMessages = (payload as Record<string, unknown>)?.messages as unknown[] ?? [];
        if (rawMessages.length === 0) { console.log("[chat] syncFromGateway: done (0 remote messages)"); return; }

        const remoteMessages = _parseHistoryMessages(rawMessages);
        const localIds = new Set(stateRef.current.messages.map(m => m.id));
        const newMessages = remoteMessages.filter(m => !localIds.has(m.id));

        if (newMessages.length > 0) {
          console.log(
            `[chat] syncFromGateway: found ${newMessages.length} new messages ` +
            `(local=${stateRef.current.messages.length}, remote=${remoteMessages.length}), merging...`,
          );
          dispatch({ type: "MERGE_MESSAGES", messages: newMessages });
          // 同步写入内存缓存
          const existing = messageCache.get(sk) ?? [];
          const cacheIds = new Set(existing.map(m => m.id));
          const toCache = newMessages.filter(m => !cacheIds.has(m.id));
          if (toCache.length > 0) {
            messageCache.set(sk, [...existing, ...toCache].sort(
              (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
            ));
          }
        } else {
          console.log("[chat] syncFromGateway: done (0 new, all synced)");
        }
      } catch (err) {
        // 静默失败：可能是 WS 断连、会话不存在等，不影响正常流程
        console.warn("[chat] syncFromGateway failed (non-fatal):", (err as Error).message.slice(0, 100));
      } finally {
        syncInFlightRef.current = false;
      }
    })();
  }

  // ─── 发送/停止/恢复/队列 ──────────────────────────────────────────────

  // 当前选中配置（由 ChatView 通过 ChatControlBar 回调更新）
  const selectedConfig = React.useRef<{ agentId?: string; model?: string; thinking?: string }>({});

  function setSelectedConfig(cfg: { agentId?: string; model?: string; thinking?: string }) {
    selectedConfig.current = { ...selectedConfig.current, ...cfg };
    // NOTE: 使用 spread 合并而非直接赋值，避免部分字段更新时丢失其他字段。
    // 例如 ChatControlBar 模型下拉只传 { model } 时不能覆盖 agentId / thinking。
    // sessionKeyRef 由 switchSession() / createNewSession() 统一管理。
  }

  /**
   * UI 切换模型时调用：更新 selectedConfig + 通过 Gateway RPC 设置会话模型。
   *
   * 调用 ensureSessionModel（sessions.patch → fallback sessions.create），
   * 而非每次 sendChat 都调用，避免冗余 RPC 开销。
   *
   * @returns Promise，调用方可 await 确保模型设置完成后再发消息（新会话场景）
   */
  const _lastModelSetRef = React.useRef<string>("");
  function changeModel(model: string): Promise<void> {
    if (!model || model === _lastModelSetRef.current) return Promise.resolve();
    selectedConfig.current = { ...selectedConfig.current, model };
    _lastModelSetRef.current = model;

    // 持久化到 localStorage
    try { localStorage.setItem(CHAT_MODEL_STORAGE_KEY, model); } catch { /* ignore */ }

    // 通过 Gateway RPC 设置会话模型
    // connected 或 degraded（连接仍在但 EventLoop 繁忙）都尝试发送 RPC
    const ws = wsRef.current;
    const sk = sessionKeyRef.current;
    if (ws && sk && ws.state === "connected") {
      return ws.ensureSessionModel(sk, model).catch((err) => {
        console.warn("[chat-service] changeModel: ensureSessionModel failed:", err);
      });
    }
    return Promise.resolve();
  }

  // ─── v4 重构核心：单一队列 + 单一驱动器 ─────────────────────────────
  //
  // 设计原则：
  // 1. **唯一队列**：chat-service.pendingQueue 是消息排队的唯一来源。gateway-ws 不再持有队列。
  // 2. **唯一发送函数**：_doSend(text) 只负责发送 → 成功创建 streaming，失败保留消息在队列。
  // 3. **唯一驱动器**：processQueue() 检查 ready + idle，从 pendingQueue 取头部发送。
  // 4. **驱动事件**：(a) sendMessage 入队后触发 (b) FINISH_STREAMING (c) WS ready 变化 (d) EventLoop recovered
  // 5. **防重入**：sendingRef 保证同时只有一次 chat.send 在飞，避免双发。

  /**
   * v4.1 修订：用户主动发送一条消息。
   *
   * 队列管理策略（用户期待）：
   *   - 队列中的消息**必须可见、可撤回、可删除**（在徽章里展示）
   *   - 普通对话：当前 idle + WS ready → 直接发送（不入队），用户感知零延迟
   *   - 生成中 / WS 不 ready → 入队，用户能看到队列中的消息并删除
   *
   * UI 期待：
   *   - 普通发消息不应该闪一下队列徽章
   *   - 生成中发的消息出现在队列里 + 队列徽章可见可操作
   *
   * 注意：
   *   - 入队的消息**不立即** ADD_USER_MESSAGE（避免对话框重复显示）
   *   - 直到从队列拉出实际发送时才 ADD_USER_MESSAGE
   */
  async function sendMessage(text: string): Promise<void> {
    if (!text.trim()) return;
    if (!sessionKeyRef.current) {
      dispatch({ type: "SET_ERROR", error: "请先选择一个对话" });
      return;
    }
    const traceId = genTraceId();
    const ws = wsRef.current;
    const canSendNow =
      stateRef.current.chatState === "idle" &&
      stateRef.current.pendingQueue.length === 0 &&
      stateRef.current.streamingMessageId === null && // v4.1.4: 防御 streaming 占位仍活跃
      !sendingRef.current && // v4.1.4: 防御 _doSend 在飞中
      ws !== null && ws.isSendReady();
    _trace("SEND", traceId, `text="${text.slice(0,50)}" (${text.length}B) chatState=${state.chatState} canSendNow=${canSendNow}`);

    if (canSendNow) {
      // 直接发送路径：ADD_USER_MESSAGE → _doSend
      // 不入队，避免徽章闪烁
      dispatch({ type: "ADD_USER_MESSAGE", text });
      sendingRef.current = true;
      _doSend(text, traceId, /*alreadyShown=*/true);
    } else {
      // 入队路径：仅 ENQUEUE（不 ADD_USER_MESSAGE，避免对话框重复显示）
      // 消息会留在队列里，用户可见、可删除；从队列发出时才 ADD_USER_MESSAGE
      _trace("ENQUEUE", traceId, `chatState=${state.chatState} streamingId=${stateRef.current.streamingMessageId?.slice(0,10) ?? "null"} sendingRef=${sendingRef.current} ws.ready=${ws?.isSendReady()} qBefore=${stateRef.current.pendingQueue.length} → enqueue`);
      dispatch({ type: "ENQUEUE", text });
      // 触发驱动器（防御：如果 idle 但 ws 未 ready，等 onReadyChange 触发；否则 setTimeout 后会发出）
      setTimeout(() => processQueue(), 0);
    }
  }

  /**
   * v4.1.4 修订：实际发送一条消息到 Gateway。
   *
   * 调用约定：
   *   - 调用方必须保证 sendingRef.current === false 之前已设置 true
   *   - 调用方负责传入 `alreadyShown`：
   *       - true：消息已 ADD_USER_MESSAGE（直发路径）→ 本函数不再 ADD
   *       - false：从队列拉出来的（队列路径）→ 本函数 ADD_USER_MESSAGE 显示
   *   - 队列路径下还要 DEQUEUE_BY_TEXT（成功后从队列移除）
   *   - 失败：直发路径不入队（已经在对话框显示）；队列路径保留在队列
   *
   * v4.1.4 关键修复：sendingRef 在 dispatch 完成后再延迟重置，
   *   避免 React commit 前的 race（auto-driver useEffect 误触发 → 双发）
   */
  async function _doSend(text: string, traceId: string, alreadyShown: boolean): Promise<void> {
    if (!sessionKeyRef.current) {
      sendingRef.current = false;
      return;
    }
    const ws = wsRef.current;
    if (!ws) {
      _trace("DO-SEND-ERR", traceId, `ws=null gwRunning=${gatewayRunning}`);
      sendingRef.current = false;
      return;
    }
    const cfg = selectedConfig.current;
    _trace("DO-SEND", traceId, `text="${text.slice(0,40)}..." alreadyShown=${alreadyShown} session=${sessionKeyRef.current.slice(0,12)}`);
    // v4.1.10: 记录发送时间，用于端到端耗时对比
    const sentAt = Date.now();
    let succeeded = false;
    try {
      const result: SendResult = await ws.sendChat({
        sessionKey: sessionKeyRef.current,
        message: text,
        thinking: cfg.thinking,
      });
      const ackAt = Date.now();
      const ackMs = ackAt - sentAt;
      if (!result.ok) {
        _trace("DO-SEND-FAIL", traceId, `reason=${result.reason} ackMs=${ackMs}`);
        if (alreadyShown) {
          // 直发失败：消息已在对话框显示。需要把它降级到队列里让用户能撤回 + 等驱动事件重试
          dispatch({ type: "ENQUEUE", text });
          dispatch({ type: "SET_ERROR", error: "发送失败，已加入队列等重试" });
        }
        // 队列路径失败：消息仍在队列里，等下次驱动重试
        return;
      }
      succeeded = true;
      // 发送成功：
      _trace("DO-SEND-OK", traceId, `ackMs=${ackMs} ${alreadyShown ? "START_STREAMING" : "DEQUEUE + ADD + START_STREAMING"}`);
      if (!alreadyShown) {
        // 队列路径：从队列移除 + 在对话框显示
        dispatch({ type: "DEQUEUE_BY_TEXT", text });
        dispatch({ type: "ADD_USER_MESSAGE", text });
      }
      const streamMsgId = genMsgId();
      // v4.1.4 关键修复：每次新消息发出 → 清除所有 stale runId 映射
      // 避免 Gateway reuse 旧 runId 时把新消息的回复写到旧占位
      // （前提：上一条消息 final 已到达，map 在 final 处理时本应清掉，但防御为先）
      runIdToMsgIdRef.current.clear();
      runIdToLastTextRef.current.clear();
      // v4.1.10: 记录消息生命周期时间点
      msgTimingRef.current.set(streamMsgId, { sentAt, ackAt });
      dispatch({ type: "START_STREAMING", messageId: streamMsgId });
      lastTextRef.current = "";
    } catch (err) {
      _trace("DO-SEND-EXC", traceId, `exception=${(err as Error).message}`);
    } finally {
      // v4.1.4: 延迟重置 sendingRef，等 React commit 完成 + 状态稳定
      // 这样 auto-driver useEffect 不会在 dispatch commit 间隙误触发新一轮 processQueue
      if (succeeded) {
        // 成功路径：等 START_STREAMING reducer commit + chatState 变 streaming 后再释放锁
        setTimeout(() => { sendingRef.current = false; }, 50);
      } else {
        // 失败路径：立即释放（让 auto-driver 重试或下一条出列）
        sendingRef.current = false;
      }
    }
  }

  /** 直接发送到 Gateway（v4 已废弃；保留 noop 防止外部引用） */
  async function _sendToGateway(_text: string, _traceId: string): Promise<void> {
    console.warn("[chat] _sendToGateway is deprecated in v4 refactor; use sendMessage instead");
  }

  async function stop(): Promise<void> {
    const ws = wsRef.current;
    if (ws && ws.state === "connected") await ws.abortChat(sessionKeyRef.current);
    // STOP reducer 已经设置 cancelledMessageId，不再跟 RESET_STATE 清除它。
    dispatch({ type: "STOP" });
    lastTextRef.current = "";
  }

  async function resume(): Promise<void> {
    if (state.cancelledMessageId) { dispatch({ type: "RESET_STATE" }); await sendMessage("请继续"); }
  }

  /**
   * v4 重构：唯一的队列驱动器。
   *
   * 触发条件：
   *   - sendMessage 入队后（用户发新消息）
   *   - FINISH_STREAMING 后（一条对话完成，处理下一条）
   *   - WS 状态变 connected（重连成功）
   *   - WS ready 变 true（EventLoop recovered）
   *
   * 防止重入：sendingRef 保证同时只有一次 chat.send 在飞。
   * 防止双发：处理中的消息保留在 pendingQueue，发成功后才 DEQUEUE_BY_TEXT。
   */
  function processQueue(): void {
    // 防重入
    if (sendingRef.current) {
      console.log(`[chat] processQueue: skipped, sending in flight`);
      return;
    }

    const currentState = stateRef.current;

    // 队列空 → noop
    if (currentState.pendingQueue.length === 0) return;

    // 当前还在生成中 → 等 FINISH_STREAMING 再处理
    if (currentState.chatState === "streaming" || currentState.chatState === "tool_executing") {
      console.log(`[chat] processQueue: chatState=${currentState.chatState}, waiting for FINISH_STREAMING`);
      return;
    }

    // v4.1.4 额外防御：streamingMessageId 非空 → 仍有未结束的 streaming 占位（chatState 可能为 idle，
    // 但说明上一条还没真正 final）→ 等
    if (currentState.streamingMessageId) {
      console.log(`[chat] processQueue: streamingMessageId=${currentState.streamingMessageId.slice(0,10)} still active, waiting`);
      return;
    }

    // WS 不 ready → 等 onReadyChange 再触发
    const ws = wsRef.current;
    if (!ws || !ws.isSendReady()) {
      console.log(`[chat] processQueue: WS not ready (state=${ws?.state}, degraded=${ws?.eventLoopDegraded}), waiting for ready event`);
      return;
    }

    // 清理空白消息
    const validMessages = currentState.pendingQueue.filter(m => m.trim());
    if (validMessages.length === 0) {
      console.log(`[chat] processQueue: clearing ${currentState.pendingQueue.length} whitespace-only items`);
      for (let i = 0; i < currentState.pendingQueue.length; i++) {
        dispatch({ type: "DEQUEUE" });
      }
      return;
    }

    // 决定本次要发送的文本
    let textToSend: string;
    let textsConsumed: string[];
    if (currentState.mergeEnabled && validMessages.length > 1) {
      // 合并发送：取队列前 N 条（最多 10 条 / 4096 字符）
      const batch: string[] = [];
      let charCount = 0;
      for (const msg of validMessages) {
        const sepLen = batch.length > 0 ? 1 : 0;
        if (batch.length >= 10 || (charCount + sepLen + msg.length > 4096 && batch.length > 0)) break;
        batch.push(msg);
        charCount += sepLen + msg.length;
      }
      textToSend = batch.join("\n");
      textsConsumed = batch;
    } else {
      // 顺序发送：取队列头部一条
      textToSend = validMessages[0];
      textsConsumed = [validMessages[0]];
    }

    const traceId = genTraceId();
    _trace("PROCESS-Q", traceId, `merge=${currentState.mergeEnabled} sending ${textsConsumed.length}/${validMessages.length} pending=${currentState.pendingQueue.length}`);

    // 标记 sending（防止 onReadyChange / FINISH_STREAMING 触发重入）
    sendingRef.current = true;

    // 合并模式下：先把被合并的中间消息从队列移除 + ADD_USER_MESSAGE 显示在对话框
    if (textsConsumed.length > 1) {
      // 合并：每条原始消息都 ADD_USER_MESSAGE（让对话框看到用户发了哪几条），
      // 然后从队列移除，textToSend 走 _doSendMerged 发送拼接后的内容
      for (const t of textsConsumed) {
        dispatch({ type: "DEQUEUE_BY_TEXT", text: t });
        dispatch({ type: "ADD_USER_MESSAGE", text: t });
      }
      _doSendMerged(textToSend, traceId, textsConsumed);
    } else {
      // 单条：保留在队列，_doSend 成功后通过 DEQUEUE_BY_TEXT 移除 + ADD_USER_MESSAGE
      _doSend(textToSend, traceId, /*alreadyShown=*/false);
    }
  }

  /** v4 重构：合并发送的专用路径（消息已 DEQUEUE + ADD_USER_MESSAGE，发成功不需要再操作 messages） */
  async function _doSendMerged(text: string, traceId: string, originalTexts: string[]): Promise<void> {
    if (!sessionKeyRef.current) { sendingRef.current = false; return; }
    const ws = wsRef.current;
    if (!ws) { sendingRef.current = false; return; }
    const cfg = selectedConfig.current;
    _trace("DO-SEND-MERGED", traceId, `text="${text.slice(0,60)}..." len=${text.length} count=${originalTexts.length}`);
    // v4.1.10: 记录发送时间
    const sentAt = Date.now();
    let succeeded = false;
    try {
      const result: SendResult = await ws.sendChat({
        sessionKey: sessionKeyRef.current,
        message: text,
        thinking: cfg.thinking,
      });
      const ackAt = Date.now();
      const ackMs = ackAt - sentAt;
      if (!result.ok) {
        // 合并发送失败：把原始消息逐条重新入队（保留用户原始内容，方便撤回）
        // 已 ADD_USER_MESSAGE 的对话框消息保持不变，但加错误提示
        _trace("DO-SEND-MERGED-FAIL", traceId, `reason=${result.reason} ackMs=${ackMs} → re-enqueue ${originalTexts.length} originals`);
        for (const t of originalTexts) {
          dispatch({ type: "ENQUEUE", text: t });
        }
        return;
      }
      succeeded = true;
      _trace("DO-SEND-MERGED-OK", traceId, `ackMs=${ackMs} START_STREAMING`);
      const streamMsgId = genMsgId();
      // v4.1.4: 同 _doSend，清除 stale runId 映射
      runIdToMsgIdRef.current.clear();
      runIdToLastTextRef.current.clear();
      // v4.1.10: 记录消息时间
      msgTimingRef.current.set(streamMsgId, { sentAt, ackAt });
      dispatch({ type: "START_STREAMING", messageId: streamMsgId });
      lastTextRef.current = "";
    } catch (err) {
      _trace("DO-SEND-MERGED-EXC", traceId, `exception=${(err as Error).message}`);
      // 异常时也重新入队
      for (const t of originalTexts) {
        dispatch({ type: "ENQUEUE", text: t });
      }
    } finally {
      // v4.1.4: 同 _doSend，延迟重置 sendingRef
      if (succeeded) {
        setTimeout(() => { sendingRef.current = false; }, 50);
      } else {
        sendingRef.current = false;
      }
    }
  }

  // ─── 会话管理 ──────────────────────────────────────────────────────────

  function switchSession(sessionId: string): void {
    // 守卫：拒绝哨兵值（__empty__/__new__）和空值。
    if (!sessionId || sessionId === "__empty__" || sessionId === "__new__") {
      return;
    }

    console.log(`[chat-service] switchSession: ${sessionId.slice(0,12)}...`);
    // 1. 把当前对话的消息存入内存缓存
    const currentKey = sessionKeyRef.current;
    if (currentKey && state.messages.length > 0) {
      messageCache.set(currentKey, state.messages);
    }

    // 2. 更新 sessionKey
    const newKey = sessionId.includes(":") ? sessionId : `agent:${agentId}:${sessionId}`;
    sessionKeyRef.current = newKey;

    // 3. 从内存缓存同步读取目标对话的消息
    const cached = messageCache.get(newKey);
    if (cached && cached.length > 0) {
      // 有缓存 → 直接加载（同步，零延迟）
      dispatch({ type: "LOAD_HISTORY", messages: cached });
    } else {
      // 无内存缓存 → 尝试 localStorage 恢复
      const persisted = loadPersistedMessages(newKey);
      if (persisted && persisted.length > 0) {
        messageCache.set(newKey, persisted);
        dispatch({ type: "LOAD_HISTORY", messages: persisted });
      } else {
        // 无缓存也无持久化 → 清空（新对话 or 首次加载）
        dispatch({ type: "CLEAR_MESSAGES" });
      }
    }
  }

  function createNewSession(): void {
    const newKey = `agent:${agentId}:session-${Date.now()}`;
    console.log(`[chat-service] createNewSession: key=${newKey.slice(0,12)}...`);
    sessionKeyRef.current = newKey;
    dispatch({ type: "CLEAR_MESSAGES" });
  }

  function deleteSession(sessionId: string): void {
    // 从内存缓存清除
    const key = sessionId.includes(":") ? sessionId : `agent:${agentId}:${sessionId}`;
    console.log(`[chat-service] deleteSession: ${key.slice(0,12)}...`);
    messageCache.delete(key);
    // 如果删除的是当前会话，清空消息
    if (sessionKeyRef.current === key) {
      dispatch({ type: "CLEAR_MESSAGES" });
    }
  }

  function renameSession(_sessionId: string, _title: string): void {
    // 未来实现：通过 Gateway API 重命名 session
  }

  /**
   * 批量清理指定会话的内存缓存。
   *
   * 由 session-cleanup.ts 调用，在 IndexedDB + localStorage 清理后同步清除内存。
   * 如果当前活跃会话被清理 → 清空消息列表。
   */
  function cleanExpiredSessions(sessionKeys: string[]): number {
    let cleaned = 0;
    for (const key of sessionKeys) {
      if (messageCache.has(key)) {
        messageCache.delete(key);
        cleaned++;
      }
      // 如果删的是当前活跃会话 → 清空消息
      if (sessionKeyRef.current === key) {
        dispatch({ type: "CLEAR_MESSAGES" });
      }
    }
    if (cleaned > 0) {
      console.log(
        `[chat-service] cleanExpiredSessions: ${cleaned} memory caches cleared`,
      );
    }
    return cleaned;
  }

  /** 切换合并发送开关，持久化到 localStorage（方案 §3.4） */
  function toggleMerge(): void {
    const newVal = !state.mergeEnabled;
    try { localStorage.setItem("artifex_chat:mergeEnabled", String(newVal)); } catch { /* ignore */ }
    dispatch({ type: "TOGGLE_MERGE" });
    // v4 修复：切换合并 toggle 后立即驱动队列，避免队列卡住等下次发送才解锁
    queueMicrotask(() => processQueue());
  }

  /** v4.1：用户从队列中删除一条消息（按 index） */
  function removeFromQueue(index: number): void {
    console.log(`[chat] removeFromQueue index=${index} pendingQueue=${stateRef.current.pendingQueue.length}`);
    dispatch({ type: "DEQUEUE_AT", index });
  }

  /** v4.1：用户清空整个队列 */
  function clearQueue(): void {
    console.log(`[chat] clearQueue pendingQueue=${stateRef.current.pendingQueue.length}`);
    const cnt = stateRef.current.pendingQueue.length;
    for (let i = 0; i < cnt; i++) dispatch({ type: "DEQUEUE" });
  }


  // ─── 持久化（已迁移到 Gateway 侧，前端不再管理） ─────────────────────

  /** 从 Gateway HTTP 历史加载消息（切换对话时调用） */
  function loadHistoryMessages(rawMessages: unknown[]): void {
    const messages = _parseHistoryMessages(rawMessages);
    dispatch({ type: "LOAD_HISTORY", messages });
    // 同步写入内存缓存
    if (sessionKeyRef.current && messages.length > 0) {
      messageCache.set(sessionKeyRef.current, messages);
    }
  }

  return {
    chatState: state.chatState, messages: state.messages, sessions: state.sessions,
    activeSessionId: state.activeSessionId, pendingQueue: state.pendingQueue, error: state.error,
    wsState, eventLoopDegraded, mcpBridgeAvailable,
    mergeEnabled: state.mergeEnabled, toggleMerge,
    isStreaming: state.chatState === "streaming" || state.chatState === "tool_executing",
    cancelledMessageId: state.cancelledMessageId, getSessionKey: () => sessionKeyRef.current,
    sendMessage, stop, resume, clearMessages: () => dispatch({ type: "CLEAR_MESSAGES" }),
    switchSession, createNewSession, deleteSession, renameSession, loadHistoryMessages,
    /** v4.1：从队列中删除一条消息（按 index） */
    removeFromQueue,
    /** v4.1：清空队列 */
    clearQueue,
    /** 更新 ChatControlBar 选中的 Agent/Model/Thinking，影响 chat.send params */
    setSelectedConfig,
    /** UI 切换模型时调用：更新选定模型 + 通过 Gateway RPC 设置会话模型 */
    changeModel,
    /** 批量清理指定会话的内存缓存（由 session-cleanup 调用） */
    cleanExpiredSessions,
    /** 获取 WS 实例（供 ChatView 发送 chat.history 等 RPC） */
    getWs: () => wsRef.current,
    /** 发送 agentTurn keep-alive（防止 Gateway 回收会话进程） */
    sendAgentTurn: (sessionKey: string) => {
      const ws = wsRef.current;
      if (ws) ws.sendAgentTurn(sessionKey);
    },
  };
}
