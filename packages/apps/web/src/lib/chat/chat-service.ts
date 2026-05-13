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
} from "./types";
import { GatewayWebSocket } from "./gateway-ws";

// ─── 内存消息缓存（同步，跟 ArtClawToolManager cachedMessages 同思路）────
// 按 sessionKey 缓存消息数组。切对话时同步存/取，零延迟。
// Gateway history 仅作为后台静默刷新源，不阻塞 UI。
const messageCache = new Map<string, ChatMessage[]>();

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
  | { type: "APPEND_DELTA"; text: string }
  | { type: "UPDATE_TOOL_CALL"; toolCallId: string; update: Partial<ToolCall> }
  | { type: "FINISH_STREAMING" }
  | { type: "SET_ERROR"; error: string }
  | { type: "STOP" }
  | { type: "ENQUEUE"; text: string }
  | { type: "DEQUEUE" }
  | { type: "SET_SESSION"; session: ChatSession }
  | { type: "SET_SESSIONS"; sessions: ChatSession[] }
  | { type: "CLEAR_MESSAGES" }
  | { type: "RESET_STATE" }
  | { type: "LOAD_HISTORY"; messages: ChatMessage[] };

export interface ChatServiceState {
  chatState: ChatState;
  messages: ChatMessage[];
  streamingMessageId: string | null;
  pendingQueue: string[];
  error: string | null;
  sessions: ChatSession[];
  activeSessionId: string;
  cancelledMessageId: string | null;
}

// ─── Reducer ───────────────────────────────────────────────────────────────

let msgSeq = 0;
function genMsgId(): string { msgSeq++; return `msg-${Date.now()}-${msgSeq}`; }

export function chatReducer(state: ChatServiceState, action: ChatAction): ChatServiceState {
  switch (action.type) {
    case "ADD_USER_MESSAGE":
      return { ...state, messages: [...state.messages, { id: genMsgId(), role: "user", content: action.text, timestamp: new Date().toISOString() }], error: null };
    case "START_STREAMING":
      return { ...state, messages: [...state.messages, { id: action.messageId, role: "assistant", content: "", timestamp: new Date().toISOString(), isStreaming: true }], streamingMessageId: action.messageId, chatState: "streaming" };
    case "APPEND_DELTA":
      return { ...state, messages: state.messages.map(m => m.id === state.streamingMessageId ? { ...m, content: m.content + action.text } : m) };
    case "UPDATE_TOOL_CALL":
      return { ...state, messages: state.messages.map(m => { if (m.id !== state.streamingMessageId) return m; const existing = m.toolCalls ?? []; const idx = existing.findIndex(tc => tc.id === action.toolCallId); const updated = idx >= 0 ? existing.map(tc => tc.id === action.toolCallId ? { ...tc, ...action.update } : tc) : [...existing, { id: action.toolCallId, name: "", status: "running" as const, ...action.update }]; return { ...m, toolCalls: updated }; }), chatState: "tool_executing" };
    case "FINISH_STREAMING":
      return { ...state, messages: state.messages.map(m => m.id === state.streamingMessageId ? { ...m, isStreaming: false } : m), streamingMessageId: null, chatState: "idle", cancelledMessageId: null };
    case "SET_ERROR":
      return { ...state, messages: state.messages.map(m => m.id === state.streamingMessageId ? { ...m, isStreaming: false } : m), streamingMessageId: null, chatState: "error", error: action.error };
    case "STOP":
      return { ...state, messages: state.messages.map(m => m.id === state.streamingMessageId ? { ...m, isStreaming: false } : m), streamingMessageId: null, chatState: "idle", cancelledMessageId: state.streamingMessageId };
    case "ENQUEUE":
      return { ...state, pendingQueue: [...state.pendingQueue, action.text] };
    case "DEQUEUE":
      if (state.pendingQueue.length === 0) return state;
      return { ...state, pendingQueue: state.pendingQueue.slice(1) };
    case "SET_SESSION":
      return { ...state, messages: action.session.messages, activeSessionId: action.session.id, chatState: "idle", streamingMessageId: null, error: null, cancelledMessageId: null };
    case "SET_SESSIONS":
      return { ...state, sessions: action.sessions };
    case "CLEAR_MESSAGES":
      return { ...state, messages: [], chatState: "idle", streamingMessageId: null, error: null, cancelledMessageId: null };
    case "RESET_STATE":
      // Gateway 断连时清理：把所有 isStreaming 的消息标记为完成，避免 UI 卡在流式状态。
      // 注意：不清 cancelledMessageId，避免破坏 stop() → resume() 链路。
      return { ...state, messages: state.messages.map(m => m.isStreaming ? { ...m, isStreaming: false } : m), chatState: "idle", streamingMessageId: null, error: null, cancelledMessageId: state.cancelledMessageId };
    case "LOAD_HISTORY":
      return { ...state, messages: action.messages, chatState: "idle", streamingMessageId: null, error: null, cancelledMessageId: null };
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
    return { chatState: "idle" as ChatState, messages: [], streamingMessageId: null, pendingQueue: [], error: null, sessions: [], activeSessionId: "", cancelledMessageId: null };
  });

  const lastTextRef = React.useRef("");
  const prevWsStateRef = React.useRef<"disconnected" | "connecting" | "connected" | "degraded">("disconnected");

  // ─── 消息变化时自动同步内存缓存 + localStorage ──────────────────────
  // 仅在非流式状态下写入（避免 APPEND_DELTA 每帧写）
  React.useEffect(() => {
    if (sessionKeyRef.current && state.messages.length > 0 && !state.streamingMessageId) {
      messageCache.set(sessionKeyRef.current, state.messages);
      persistMessages(sessionKeyRef.current, state.messages);
    }
  }, [state.messages, state.streamingMessageId]);

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
    });

    ws.onMessage((event: GatewayChatEvent) => {
      handleGatewayEvent(event);
    });

    ws.connect().catch(() => {});

    // ── 健康状态轮询：health 事件通过 WS 消息流更新 GatewayWebSocket 内部状态，
    // 这里定时同步到 React state 以驱动 UI 更新。 ──
    const healthInterval = setInterval(() => {
      if (cancelled) return;
      const degraded = ws.eventLoopDegraded;
      setEventLoopDegraded(degraded);
      // P2-8：同步 MCP Bridge 可用性
      const mcpOk = ws.mcpBridgeAvailable;
      setMcpBridgeAvailable(mcpOk);
      // 连上了但事件循环退化 → 显示 degraded 状态
      if (ws.state === "connected" && degraded) {
        setWsState("degraded");
      } else if (ws.state === "connected" && !degraded) {
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

  // ─── Gateway 事件处理（b5bfb7e 原始逻辑） ─────────────────────────────

  function handleGatewayEvent(event: GatewayChatEvent) {
    switch (event.state) {
      case "delta": {
        if (event.message) {
          const lastText = lastTextRef.current;
          const incremental = event.message.startsWith(lastText) ? event.message.slice(lastText.length) : event.message;
          lastTextRef.current = event.message;
          if (incremental) dispatch({ type: "APPEND_DELTA", text: incremental });
        }
        if (event.toolCall) {
          const tc = event.toolCall;
          dispatch({ type: "UPDATE_TOOL_CALL", toolCallId: tc.id, update: { id: tc.id, name: tc.name, input: tc.meta || tc.title, status: tc.phase === "end" ? "done" : "running", durationMs: tc.durationMs } });
        }
        if (event.toolOutput && event.toolOutput.phase === "delta") {
          dispatch({ type: "UPDATE_TOOL_CALL", toolCallId: event.toolOutput.toolCallId, update: { output: event.toolOutput.output, status: "running" } });
        }
        break;
      }
      case "final": {
        if (event.toolCall) {
          const tc = event.toolCall;
          dispatch({ type: "UPDATE_TOOL_CALL", toolCallId: tc.id, update: { id: tc.id, name: tc.name, status: "done", durationMs: tc.durationMs } });
          break;
        }
        if (event.toolOutput) {
          dispatch({ type: "UPDATE_TOOL_CALL", toolCallId: event.toolOutput.toolCallId, update: { output: event.toolOutput.output, status: event.toolOutput.exitCode === 0 ? "done" : "error", durationMs: event.toolOutput.durationMs } });
          break;
        }
        dispatch({ type: "FINISH_STREAMING" });
        lastTextRef.current = "";
        processQueue();
        break;
      }
      case "aborted":
      case "error": {
        if (event.state === "error") dispatch({ type: "SET_ERROR", error: "AI 响应出错，请重试" });
        else dispatch({ type: "STOP" });
        lastTextRef.current = "";
        break;
      }
    }
  }

  // ─── 发送/停止/恢复/队列 ──────────────────────────────────────────────

  // 当前选中配置（由 ChatView 通过 ChatControlBar 回调更新）
  const selectedConfig = React.useRef<{ agentId?: string; model?: string; thinking?: string }>({});

  function setSelectedConfig(cfg: { agentId?: string; model?: string; thinking?: string }) {
    selectedConfig.current = cfg;
    // NOTE: 不在此处更新 sessionKeyRef。
    // sessionKeyRef 由 switchSession() / createNewSession() 统一管理。
    // 旧逻辑 `sessionKeyRef.current = 'agent:${cfg.agentId}:${state.activeSessionId}'`
    // 在新建对话时会用残留的旧 activeSessionId 拼出错误 key，导致 Gateway 收到
    // 无效 sessionKey → 崩溃 / WS 断连。
  }

  async function sendMessage(text: string): Promise<void> {
    if (!text.trim()) return;
    if (!sessionKeyRef.current) { dispatch({ type: "SET_ERROR", error: "请先选择一个对话" }); return; }
    if (state.chatState === "sending" || state.chatState === "streaming" || state.chatState === "tool_executing") {
      dispatch({ type: "ADD_USER_MESSAGE", text }); dispatch({ type: "ENQUEUE", text }); return;
    }
    dispatch({ type: "ADD_USER_MESSAGE", text });
    const ws = wsRef.current;
    // STORY-0039-HOTFIX：使用 isSendReady() 替代 ws.state !== "connected"，
    // 避免在网关重连冷却期 / 事件循环退化期发送消息导致超时。
    if (!ws || !ws.isSendReady()) {
      if (ws && ws.eventLoopDegraded) {
        dispatch({ type: "SET_ERROR", error: "Gateway 正在恢复中，请稍后重试..." });
      } else if (ws && ws.state === "connected") {
        dispatch({ type: "SET_ERROR", error: "Gateway 刚完成重连，请稍等几秒再发送" });
      } else if (gatewayRunning) {
        // Gateway 进程在运行但 WebSocket 未连接 → 区分"gateway 挂了"和"正在建立连接"
        dispatch({ type: "SET_ERROR", error: "WebSocket 未连接，Gateway 正在运行中" });
      } else {
        dispatch({ type: "SET_ERROR", error: "Gateway 未启动，请检查系统面板" });
      }
      return;
    }
    const streamMsgId = genMsgId();
    dispatch({ type: "START_STREAMING", messageId: streamMsgId });
    lastTextRef.current = "";
    const cfg = selectedConfig.current;
    const ok = await ws.sendChat({
      sessionKey: sessionKeyRef.current,
      message: text,
      thinking: cfg.thinking,
    });
    if (!ok) dispatch({ type: "SET_ERROR", error: "发送失败，请检查 Gateway 状态" });
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

  function processQueue(): void {
    if (state.pendingQueue.length > 0) {
      const [next] = state.pendingQueue;
      dispatch({ type: "DEQUEUE" });
      setTimeout(() => sendMessage(next), 100);
    }
  }

  // ─── 会话管理 ──────────────────────────────────────────────────────────

  function switchSession(sessionId: string): void {
    // 守卫：拒绝哨兵值（__empty__/__new__）和空值。
    if (!sessionId || sessionId === "__empty__" || sessionId === "__new__") {
      return;
    }

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
    sessionKeyRef.current = newKey;
    dispatch({ type: "CLEAR_MESSAGES" });
  }

  function deleteSession(sessionId: string): void {
    // 从内存缓存清除
    const key = sessionId.includes(":") ? sessionId : `agent:${agentId}:${sessionId}`;
    messageCache.delete(key);
    // 如果删除的是当前会话，清空消息
    if (sessionKeyRef.current === key) {
      dispatch({ type: "CLEAR_MESSAGES" });
    }
  }

  function renameSession(_sessionId: string, _title: string): void {
    // 未来实现：通过 Gateway API 重命名 session
  }

  // ─── 持久化（已迁移到 Gateway 侧，前端不再管理） ─────────────────────

  /** 从 Gateway HTTP 历史加载消息（切换对话时调用） */
  function loadHistoryMessages(rawMessages: unknown[]): void {
    const messages: ChatMessage[] = [];
    for (const [idx, m] of rawMessages.entries()) {
      if (typeof m !== "object" || m === null) continue;
      const msg = m as Record<string, unknown>;
      const role = msg.role === "user" ? "user" : msg.role === "system" ? "system" : "assistant";
      // 提取文本内容
      let content = "";
      if (typeof msg.content === "string") {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        content = (msg.content as Array<{ type?: string; text?: string }>)
          .filter(b => b.type === "text")
          .map(b => b.text ?? "")
          .join("");
      }
      // 跳过纯 system 消息（如 system prompt）和空消息
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
    isStreaming: state.chatState === "streaming" || state.chatState === "tool_executing",
    cancelledMessageId: state.cancelledMessageId, getSessionKey: () => sessionKeyRef.current,
    sendMessage, stop, resume, clearMessages: () => dispatch({ type: "CLEAR_MESSAGES" }),
    switchSession, createNewSession, deleteSession, renameSession, loadHistoryMessages,
    /** 更新 ChatControlBar 选中的 Agent/Model/Thinking，影响 chat.send params */
    setSelectedConfig,
    /** 获取 WS 实例（供 ChatView 发送 chat.history 等 RPC） */
    getWs: () => wsRef.current,
    /** 发送 agentTurn keep-alive（防止 Gateway 回收会话进程） */
    sendAgentTurn: (sessionKey: string) => {
      const ws = wsRef.current;
      if (ws) ws.sendAgentTurn(sessionKey);
    },
  };
}
