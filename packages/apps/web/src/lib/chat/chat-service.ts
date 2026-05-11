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
          if (m.id !== state.streamingMessageId || !m.toolCalls) return m;
          return {
            ...m,
            toolCalls: m.toolCalls.map((tc) =>
              tc.id === action.toolCallId ? { ...tc, ...action.update } : tc,
            ),
          };
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

  // sessionKey 格式：agent:<agentId>:<sessionId>
  const [sessionId] = React.useState(() => `session-${Date.now()}`);
  const sessionKey = `agent:${agentId}:${sessionId}`;

  // Gateway WebSocket
  const wsRef = React.useRef<GatewayWebSocket | null>(null);
  const [wsState, setWsState] = React.useState<"disconnected" | "connecting" | "connected">("disconnected");

  // Reducer
  const [state, dispatch] = React.useReducer(chatReducer, null, () => {
    let sessions = loadSessions();
    // 首次使用：无会话时创建默认会话
    if (sessions.length === 0) {
      const defaultSession: ChatSession = {
        id: "default",
        title: "新对话",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [],
      };
      sessions = [defaultSession];
      persistSessions(sessions);
      persistActiveSession(defaultSession.id);
    }
    const activeId = getActiveSessionId(sessions);
    const active = sessions.find((s) => s.id === activeId);
    return {
      chatState: "idle" as ChatState,
      messages: active?.messages ?? [],
      streamingMessageId: null,
      pendingQueue: [],
      error: null,
      sessions,
      activeSessionId: active?.id ?? sessions[0].id,
      cancelledMessageId: null,
    };
  });

  // 上次累积文本（用于计算增量）
  const lastTextRef = React.useRef("");

  // ─── Gateway 连接管理 ─────────────────────────────────────────────────

  // 追踪上一次连接状态用于检测重连
  const prevWsStateRef = React.useRef<"disconnected" | "connecting" | "connected">("disconnected");

  React.useEffect(() => {
    const wsUrl = `ws://127.0.0.1:${gatewayPort}`;
    const ws = new GatewayWebSocket(wsUrl, gatewayToken);
    wsRef.current = ws;

    ws.onStateChange((wsState) => {
      const mapped = wsState === "connected" ? "connected"
        : wsState === "disconnected" ? "disconnected"
        : "connecting";

      // 自动恢复：重连后检测是否有未完成的流式消息
      if (mapped === "connected" && prevWsStateRef.current !== "connected") {
        // 延迟检查，等 Reducer 状态稳定
        setTimeout(() => {
          const lastMsg = state.messages[state.messages.length - 1];
          if (lastMsg?.role === "assistant" && lastMsg.isStreaming && lastMsg.content.length > 0) {
            // 有未完成的流式消息 → 自动续写
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

    // 自动连接
    ws.connect().catch(() => {});

    return () => {
      ws.disconnect();
      wsRef.current = null;
    };
  }, [gatewayPort, gatewayToken]);

  // ─── Gateway 事件处理 ──────────────────────────────────────────────────

  function handleGatewayEvent(event: GatewayChatEvent) {
    switch (event.state) {
      case "delta": {
        if (event.message) {
          // Gateway 发送累积文本，提取增量
          const lastText = lastTextRef.current;
          const incremental = event.message.startsWith(lastText)
            ? event.message.slice(lastText.length)
            : event.message;
          lastTextRef.current = event.message;
          if (incremental) {
            dispatch({ type: "APPEND_DELTA", text: incremental });
          }
        }
        break;
      }

      case "final": {
        const finalText = event.message || lastTextRef.current;
        if (finalText && state.streamingMessageId) {
          // 确保最终文本完整
          lastTextRef.current = "";
          // 用完整文本替换流式内容
          dispatch({ type: "APPEND_DELTA", text: "" }); // trigger re-render
        }
        dispatch({ type: "FINISH_STREAMING" });
        lastTextRef.current = "";
        // 处理队列
        processQueue();
        break;
      }

      case "aborted":
      case "error": {
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
