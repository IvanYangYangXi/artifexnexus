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
  ToolCallStatus,
  ChatSession,
  GatewayChatEvent,
} from "./types";
import { GatewayWebSocket } from "./gateway-ws";

// ─── 常量 ──────────────────────────────────────────────────────────────────

const STORAGE_KEY_SESSIONS = "artifex.chat.sessions";
const STORAGE_KEY_ACTIVE = "artifex.chat.activeSessionId";

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
  | { type: "RESET_STATE" };

// ─── Reducer State ─────────────────────────────────────────────────────────

export interface ChatServiceState {
  /** 当前对话状态 */
  chatState: ChatState;
  /** 消息列表 */
  messages: ChatMessage[];
  /** 当前流式消息 ID */
  streamingMessageId: string | null;
  /** 排队消息（生成中用户发送） */
  pendingQueue: string[];
  /** 错误信息 */
  error: string | null;
  /** 会话列表 */
  sessions: ChatSession[];
  /** 当前会话 ID */
  activeSessionId: string;
  /** 上次取消的消息 ID（用于恢复） */
  cancelledMessageId: string | null;
}

// ─── Reducer ───────────────────────────────────────────────────────────────

let msgSeq = 0;
function genMsgId(): string {
  msgSeq++;
  return `msg-${Date.now()}-${msgSeq}`;
}

export function chatReducer(
  state: ChatServiceState,
  action: ChatAction,
): ChatServiceState {
  switch (action.type) {
    case "ADD_USER_MESSAGE": {
      const userMsg: ChatMessage = {
        id: genMsgId(),
        role: "user",
        content: action.text,
        timestamp: new Date().toISOString(),
      };
      return {
        ...state,
        messages: [...state.messages, userMsg],
        error: null,
      };
    }

    case "START_STREAMING": {
      const assistantMsg: ChatMessage = {
        id: action.messageId,
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
        isStreaming: true,
      };
      return {
        ...state,
        messages: [...state.messages, assistantMsg],
        streamingMessageId: action.messageId,
        chatState: "streaming",
      };
    }

    case "APPEND_DELTA": {
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === state.streamingMessageId
            ? { ...m, content: m.content + action.text }
            : m,
        ),
      };
    }

    case "UPDATE_TOOL_CALL": {
      return {
        ...state,
        messages: state.messages.map((m) => {
          if (m.id !== state.streamingMessageId) return m;
          const existingCalls = m.toolCalls ?? [];
          const existingIdx = existingCalls.findIndex((tc) => tc.id === action.toolCallId);
          let updatedCalls;
          if (existingIdx >= 0) {
            // 更新已有 toolCall
            updatedCalls = existingCalls.map((tc) =>
              tc.id === action.toolCallId ? { ...tc, ...action.update } : tc,
            );
          } else {
            // 新增 toolCall（phase=start 时）
            updatedCalls = [...existingCalls, { id: action.toolCallId, name: "", status: "running" as const, ...action.update }];
          }
          return { ...m, toolCalls: updatedCalls };
        }),
        chatState: "tool_executing",
      };
    }

    case "FINISH_STREAMING": {
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === state.streamingMessageId
            ? { ...m, isStreaming: false }
            : m,
        ),
        streamingMessageId: null,
        chatState: "idle",
        cancelledMessageId: null,
      };
    }

    case "SET_ERROR": {
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === state.streamingMessageId
            ? { ...m, isStreaming: false }
            : m,
        ),
        streamingMessageId: null,
        chatState: "error",
        error: action.error,
      };
    }

    case "STOP": {
      const stoppedMsgId = state.streamingMessageId;
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === stoppedMsgId
            ? { ...m, isStreaming: false }
            : m,
        ),
        streamingMessageId: null,
        chatState: "idle",
        cancelledMessageId: stoppedMsgId,
      };
    }

    case "ENQUEUE": {
      return {
        ...state,
        pendingQueue: [...state.pendingQueue, action.text],
      };
    }

    case "DEQUEUE": {
      if (state.pendingQueue.length === 0) return state;
      const [next, ...rest] = state.pendingQueue;
      return {
        ...state,
        pendingQueue: rest,
        // 标记需要发送 next（由调用方处理）
      };
    }

    case "SET_SESSION": {
      return {
        ...state,
        messages: action.session.messages,
        activeSessionId: action.session.id,
        chatState: "idle",
        streamingMessageId: null,
        error: null,
        cancelledMessageId: null,
      };
    }

    case "SET_SESSIONS": {
      return {
        ...state,
        sessions: action.sessions,
      };
    }

    case "CLEAR_MESSAGES": {
      return {
        ...state,
        messages: [],
        chatState: "idle",
        streamingMessageId: null,
        error: null,
        cancelledMessageId: null,
      };
    }

    case "RESET_STATE": {
      return {
        ...state,
        chatState: "idle",
        streamingMessageId: null,
        error: null,
        cancelledMessageId: null,
      };
    }

    default:
      return state;
  }
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export interface ChatServiceOptions {
  /** Gateway 端口 */
  gatewayPort: number;
  /** Gateway auth token */
  gatewayToken?: string;
  /** Agent ID */
  agentId?: string;
}

export function useChatService(options: ChatServiceOptions) {
  const { gatewayPort, gatewayToken = "", agentId = "artifex-nexus" } = options;

  // Gateway WebSocket
  const wsRef = React.useRef<GatewayWebSocket | null>(null);
  const [wsState, setWsState] = React.useState<"disconnected" | "connecting" | "connected">("disconnected");

  // Reducer
  const [state, dispatch] = React.useReducer(chatReducer, null, () => {
    let sessions = loadSessions();
    // 首次使用：无会话时创建默认会话
    if (sessions.length === 0) {
      const defaultSession: ChatSession = {
        id: `session-${Date.now()}`,
        title: "新对话",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [],
      };
      sessions = [defaultSession];
      persistSessions(sessions);
      persistActiveSession(defaultSession.id);
    }
    // 恢复上次活跃的会话（重开 exe 自动接续）
    const activeId = getActiveSessionId(sessions);
    const active = sessions.find((s) => s.id === activeId) ?? sessions[0];
    // 启动时清理卡死的 streaming 状态
    const messages = (active.messages ?? []).map((m) =>
      m.isStreaming ? { ...m, isStreaming: false } : m,
    );
    return {
      chatState: "idle" as ChatState,
      messages,
      streamingMessageId: null,
      pendingQueue: [],
      error: null,
      sessions,
      activeSessionId: active.id,
      cancelledMessageId: null,
    };
  });

  // sessionKey 使用活跃会话 ID（重开 exe 保持一致）
  const sessionKey = `agent:${agentId}:${state.activeSessionId}`;

  // 上次累积文本（用于计算增量）
  const lastTextRef = React.useRef("");

  // 流式接收超时机制：无新内容到达 STREAM_IDLE_TIMEOUT 后自动停止
  const STREAM_IDLE_TIMEOUT = 120_000; // 2 分钟无活动视为超时
  const streamTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  function resetStreamTimeout() {
    if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
    streamTimeoutRef.current = setTimeout(() => {
      console.warn("[chat-service] Stream idle timeout, finishing...");
      dispatch({ type: "FINISH_STREAMING" });
      lastTextRef.current = "";
      streamTimeoutRef.current = null;
    }, STREAM_IDLE_TIMEOUT);
  }

  function clearStreamTimeout() {
    if (streamTimeoutRef.current) {
      clearTimeout(streamTimeoutRef.current);
      streamTimeoutRef.current = null;
    }
  }

  // ─── Gateway 连接管理 ─────────────────────────────────────────────────

  // 追踪上一次连接状态用于检测重连
  const prevWsStateRef = React.useRef<"disconnected" | "connecting" | "connected">("disconnected");

  React.useEffect(() => {
    // port=0 表示凭据尚未就绪（AppShell 还没从 sidecar 拉到 auth_info），
    // 此时不建 WS，避免用默认端口空跑；等 port 更新到真实值再触发本 effect。
    if (!gatewayPort || gatewayPort <= 0) {
      setWsState("disconnected");
      return;
    }

    let cancelled = false;

    /**
     * 等待 Gateway HTTP 就绪后再建 WebSocket。
     *
     * 问题：OpenClaw Gateway 启动需要 ~5-8s（sidecar spawn → HTTP → plugins）。
     * 如果在 `gateway ready` 之前建 WebSocket，GW 返回
     * `startup-sidecars-pending` → 1008 拒绝，日志刷 WARN。
     *
     * 方案：轮询 HTTP 200 → 拿到响应后再等 3s → 建 WS。
     */
    const waitForGatewayReady = async (): Promise<boolean> => {
      const maxWait = 30_000; // 最长等 30s
      const startedAt = Date.now();
      while (!cancelled && Date.now() - startedAt < maxWait) {
        try {
          const resp = await fetch(`http://127.0.0.1:${gatewayPort}/v1/models`, {
            method: "GET",
            signal: AbortSignal.timeout(2000),
          });
          if (resp.ok) {
            // Gateway HTTP 就绪，额外等 3s 让 sidecars/plugins 完全初始化
            await new Promise((r) => setTimeout(r, 3000));
            return true;
          }
        } catch {
          // 未就绪，继续轮询
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      return false;
    };

    const doConnect = async () => {
      if (cancelled) return;
      const ready = await waitForGatewayReady();
      if (cancelled || !ready) return;

      const wsUrl = `ws://127.0.0.1:${gatewayPort}`;
      const ws = new GatewayWebSocket(wsUrl, gatewayToken);
      if (cancelled) { ws.disconnect(); return; }
      wsRef.current = ws;

      ws.onStateChange((wsState) => {
        const mapped = wsState === "connected" ? "connected"
          : wsState === "disconnected" ? "disconnected"
          : "connecting";

        if (mapped === "disconnected" && prevWsStateRef.current === "connected") {
          clearStreamTimeout();
          dispatch({ type: "RESET_STATE" });
        }

        if (mapped === "connected" && prevWsStateRef.current !== "connected") {
          setTimeout(() => {
            const lastMsg = state.messages[state.messages.length - 1];
            if (lastMsg?.role === "assistant" && lastMsg.isStreaming && lastMsg.content.length > 0) {
              resume();
            }
          }, 500);
        }
        prevWsStateRef.current = mapped;
        setWsState(mapped);
      });

      ws.onMessage((event: GatewayChatEvent) => {
        handleGatewayEvent(event);
      });

      ws.connect().catch(() => {});
    };

    doConnect();

    return () => {
      cancelled = true;
      if (wsRef.current) {
        wsRef.current.disconnect();
        wsRef.current = null;
      }
    };
  }, [gatewayPort, gatewayToken]);

  // ─── Gateway 事件处理 ──────────────────────────────────────────────────

  function handleGatewayEvent(event: GatewayChatEvent) {
    switch (event.state) {
      case "delta": {
        // 收到新内容，重置超时计时器
        resetStreamTimeout();

        // 文本增量
        if (event.message) {
          const lastText = lastTextRef.current;
          const incremental = event.message.startsWith(lastText)
            ? event.message.slice(lastText.length)
            : event.message;
          lastTextRef.current = event.message;
          if (incremental) {
            dispatch({ type: "APPEND_DELTA", text: incremental });
          }
        }

        // Tool 调用开始/更新
        if (event.toolCall) {
          const tc = event.toolCall;
          dispatch({
            type: "UPDATE_TOOL_CALL",
            toolCallId: tc.id,
            update: {
              id: tc.id,
              name: tc.name,
              input: tc.meta || tc.title,
              status: tc.phase === "end" ? "done" : "running",
              durationMs: tc.durationMs,
            },
          });
        }

        // Tool 输出增量
        if (event.toolOutput && event.toolOutput.phase === "delta") {
          dispatch({
            type: "UPDATE_TOOL_CALL",
            toolCallId: event.toolOutput.toolCallId,
            update: {
              output: event.toolOutput.output,
              status: "running",
            },
          });
        }
        break;
      }

      case "final": {
        clearStreamTimeout();

        // Tool 调用结束
        if (event.toolCall) {
          const tc = event.toolCall;
          dispatch({
            type: "UPDATE_TOOL_CALL",
            toolCallId: tc.id,
            update: {
              id: tc.id,
              name: tc.name,
              status: "done",
              durationMs: tc.durationMs,
            },
          });
          break; // tool end 不结束整个流
        }

        // Tool 输出结束
        if (event.toolOutput) {
          dispatch({
            type: "UPDATE_TOOL_CALL",
            toolCallId: event.toolOutput.toolCallId,
            update: {
              output: event.toolOutput.output,
              status: event.toolOutput.exitCode === 0 ? "done" : "error",
              durationMs: event.toolOutput.durationMs,
            },
          });
          break; // tool output end 不结束整个流
        }

        // 文本流结束
        const finalText = event.message || lastTextRef.current;
        if (finalText && state.streamingMessageId) {
          lastTextRef.current = "";
          dispatch({ type: "APPEND_DELTA", text: "" });
        }
        dispatch({ type: "FINISH_STREAMING" });
        lastTextRef.current = "";
        processQueue();
        break;
      }

      case "aborted":
      case "error": {
        clearStreamTimeout();
        const partialText = event.message || lastTextRef.current;
        if (partialText && state.streamingMessageId) {
          lastTextRef.current = "";
        }
        if (event.state === "error") {
          dispatch({ type: "SET_ERROR", error: "AI 响应出错，请重试" });
        } else {
          dispatch({ type: "STOP" });
        }
        lastTextRef.current = "";
        break;
      }
    }
  }

  // ─── 发送消息 ──────────────────────────────────────────────────────────

  async function sendMessage(text: string): Promise<void> {
    if (!text.trim()) return;

    // 如果正在生成中，排队
    if (state.chatState === "sending" || state.chatState === "streaming" || state.chatState === "tool_executing") {
      dispatch({ type: "ADD_USER_MESSAGE", text });
      dispatch({ type: "ENQUEUE", text });
      return;
    }

    // 添加用户消息
    dispatch({ type: "ADD_USER_MESSAGE", text });

    // 检查 Gateway 连接
    const ws = wsRef.current;
    if (!ws || ws.state !== "connected") {
      dispatch({ type: "SET_ERROR", error: "Gateway 未连接，请先启动 Gateway" });
      return;
    }

    // 开始流式
    const streamMsgId = genMsgId();
    dispatch({ type: "START_STREAMING", messageId: streamMsgId });
    lastTextRef.current = "";
    resetStreamTimeout(); // 启动超时计时器

    const ok = await ws.sendChat({
      sessionKey,
      message: text,
    });

    if (!ok) {
      dispatch({ type: "SET_ERROR", error: "发送失败，请检查 Gateway 状态" });
    }
  }

  // ─── 停止 ──────────────────────────────────────────────────────────────

  async function stop(): Promise<void> {
    clearStreamTimeout();
    const ws = wsRef.current;
    if (ws && ws.state === "connected") {
      await ws.abortChat(sessionKey);
    }
    dispatch({ type: "STOP" });
    lastTextRef.current = "";
  }

  // ─── 恢复（继续生成） ──────────────────────────────────────────────────

  async function resume(): Promise<void> {
    // 恢复 = 发送空白续写消息
    if (state.cancelledMessageId) {
      dispatch({ type: "RESET_STATE" });
      await sendMessage("请继续");
    }
  }

  // ─── 队列处理 ──────────────────────────────────────────────────────────

  function processQueue(): void {
    if (state.pendingQueue.length > 0) {
      const [next] = state.pendingQueue;
      dispatch({ type: "DEQUEUE" });
      // 延迟发送，等状态更新
      setTimeout(() => sendMessage(next), 100);
    }
  }

  // ─── 清理消息 ──────────────────────────────────────────────────────────

  function clearMessages(): void {
    dispatch({ type: "CLEAR_MESSAGES" });
  }

  // ─── 会话管理 ──────────────────────────────────────────────────────────

  function switchSession(sessionId: string): void {
    const session = state.sessions.find((s) => s.id === sessionId);
    if (session) {
      dispatch({ type: "SET_SESSION", session });
      persistActiveSession(sessionId);
    }
  }

  function createNewSession(): void {
    const newSession: ChatSession = {
      id: `session-${Date.now()}`,
      title: `新对话 · ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };
    const sessions = [newSession, ...state.sessions];
    dispatch({ type: "SET_SESSIONS", sessions });
    dispatch({ type: "SET_SESSION", session: newSession });
    persistSessions(sessions);
    persistActiveSession(newSession.id);
  }

  function deleteSession(sessionId: string): void {
    const sessions = state.sessions.filter((s) => s.id !== sessionId);
    if (sessions.length === 0) {
      createNewSession();
      return;
    }
    const nextId = sessionId === state.activeSessionId ? sessions[0].id : state.activeSessionId;
    dispatch({ type: "SET_SESSIONS", sessions });
    persistSessions(sessions);
    persistActiveSession(nextId);
    const nextSession = sessions.find((s) => s.id === nextId);
    if (nextSession) {
      dispatch({ type: "SET_SESSION", session: nextSession });
    }
  }

  function renameSession(sessionId: string, title: string): void {
    const sessions = state.sessions.map((s) =>
      s.id === sessionId ? { ...s, title, updatedAt: new Date().toISOString() } : s,
    );
    dispatch({ type: "SET_SESSIONS", sessions });
    persistSessions(sessions);
  }

  // ─── 持久化（每次消息变更自动保存） ────────────────────────────────────

  React.useEffect(() => {
    if (state.messages.length > 0) {
      saveCurrentSession(state.activeSessionId, state.sessions, state.messages);
    }
  }, [state.messages]);

  // ─── 返回值 ────────────────────────────────────────────────────────────

  return {
    // 状态
    chatState: state.chatState,
    messages: state.messages,
    sessions: state.sessions,
    activeSessionId: state.activeSessionId,
    pendingQueue: state.pendingQueue,
    error: state.error,
    wsState,
    isStreaming: state.chatState === "streaming" || state.chatState === "tool_executing",
    cancelledMessageId: state.cancelledMessageId,

    // 操作
    sendMessage,
    stop,
    resume,
    clearMessages,
    switchSession,
    createNewSession,
    deleteSession,
    renameSession,
  };
}

// ─── localStorage 持久化工具 ───────────────────────────────────────────────

function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SESSIONS);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

function persistSessions(sessions: ChatSession[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(sessions));
  } catch { /* ignore */ }
}

function getActiveSessionId(sessions: ChatSession[]): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_ACTIVE);
    if (stored && sessions.find((s) => s.id === stored)) return stored;
  } catch { /* ignore */ }
  return sessions[0]?.id ?? "default";
}

function persistActiveSession(sessionId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY_ACTIVE, sessionId);
  } catch { /* ignore */ }
}

function saveCurrentSession(
  activeId: string,
  sessions: ChatSession[],
  messages: ChatMessage[],
): void {
  try {
    const updated = sessions.map((s) =>
      s.id === activeId
        ? { ...s, messages, updatedAt: new Date().toISOString() }
        : s,
    );
    localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(updated));
  } catch { /* ignore */ }
}
