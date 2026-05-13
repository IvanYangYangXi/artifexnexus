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
  | { type: "TOGGLE_MERGE" }
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
  mergeEnabled: boolean;
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
      if (!action.text.trim()) return state;
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
      // pendingQueue 残留的排队消息在断连后永远无法处理（processQueue 仅在 Gateway final 事件触发），
      // 必须清理。mergeEnabled 不重置（用户偏好跨重连保留）。
      return { ...state, messages: state.messages.map(m => m.isStreaming ? { ...m, isStreaming: false } : m), pendingQueue: [], chatState: "idle", streamingMessageId: null, error: null, cancelledMessageId: state.cancelledMessageId };
    case "TOGGLE_MERGE":
      return { ...state, mergeEnabled: !state.mergeEnabled };
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
    let mergeEnabled = true;
    try { const v = localStorage.getItem("artifex_chat:mergeEnabled"); if (v !== null) mergeEnabled = v === "true"; } catch { /* ignore */ }
    return { chatState: "idle" as ChatState, messages: [], streamingMessageId: null, pendingQueue: [], error: null, sessions: [], activeSessionId: "", cancelledMessageId: null, mergeEnabled };
  });

  const lastTextRef = React.useRef("");
  const prevWsStateRef = React.useRef<"disconnected" | "connecting" | "connected" | "degraded">("disconnected");
  /** Ref mirror of state for callbacks that run in stale closures (processQueue, handleGatewayEvent) */
  const stateRef = React.useRef(state);
  stateRef.current = state;

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

    ws.connect().catch((err) => {
      console.error("[chat-service] gateway-ws connect failed:", err);
    });

    // ── 健康状态轮询：health 事件通过 WS 消息流更新 GatewayWebSocket 内部状态，
    // 这里定时同步到 React state 以驱动 UI 更新。 ──
    const healthInterval = setInterval(() => {
      if (cancelled) return;
      const degraded = ws.eventLoopDegraded;
      // 仅在状态变化时打日志，避免刷屏
      if (degraded !== eventLoopDegraded) {
        console.log(`[chat-service] healthInterval: eventLoopDegraded ${eventLoopDegraded} → ${degraded}, ws.state=${ws.state}`);
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

  // ─── Gateway 事件处理（b5bfb7e 原始逻辑） ─────────────────────────────

  function handleGatewayEvent(event: GatewayChatEvent) {
    console.debug(`[chat-service] event: state=${event.state} session=${sessionKeyRef.current?.slice(0,12)}...`);
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
        if (event.state === "error") {
          console.warn(`[chat-service] error event: session=${sessionKeyRef.current?.slice(0,12)}...`);
          dispatch({ type: "SET_ERROR", error: "AI 响应出错，请重试" });
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
    console.log(`[chat-service] sendMessage: session=${sessionKeyRef.current.slice(0,12)}... text=${text.length}B`);
    if (state.chatState === "sending" || state.chatState === "streaming" || state.chatState === "tool_executing") {
      console.debug("[chat-service] sendMessage: enqueued (busy state)");
      dispatch({ type: "ADD_USER_MESSAGE", text }); dispatch({ type: "ENQUEUE", text }); return;
    }
    dispatch({ type: "ADD_USER_MESSAGE", text });
    const ws = wsRef.current;
    // TASK-0057: 移除 isSendReady() 阻断逻辑，仅保留 ws === null 空值守卫。
    // 所有其他状态（connected/degraded/reconnecting）直接委托给 sendChat() 内部排队。
    if (!ws) {
      dispatch({ type: "SET_ERROR", error: gatewayRunning ? "连接未建立，请稍等重试" : "Gateway 未启动" });
      return;
    }
    // TASK-0057: 先调用 sendChat()，成功后再创建占位气泡，消除空假回复（方案 §3.6 修复 A）
    const cfg = selectedConfig.current;
    const ok = await ws.sendChat({
      sessionKey: sessionKeyRef.current,
      message: text,
      thinking: cfg.thinking,
    });
    if (!ok) {
      dispatch({ type: "SET_ERROR", error: "发送失败或消息已排队，请稍等重试" });
      return;
    }
    const streamMsgId = genMsgId();
    dispatch({ type: "START_STREAMING", messageId: streamMsgId });
    lastTextRef.current = "";
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
    const currentState = stateRef.current;
    if (currentState.pendingQueue.length === 0) return;

    if (currentState.mergeEnabled) {
      // TASK-0057: 合并发送模式（方案 §3.1）
      // 读取当前 mergeEnabled 状态（来自 ref，避免 stale closure）
      // 跳过纯空白消息，将非空白消息按 \n 拼接为一条发送
      const messages = currentState.pendingQueue.filter(m => m.trim());
      if (messages.length === 0) {
        // 队列中仅有空白消息，安全清空
        for (let i = 0; i < currentState.pendingQueue.length; i++) {
          dispatch({ type: "DEQUEUE" });
        }
        return;
      }

      // 构建第一批：最多 10 条，总长不超过 4096 字符
      const firstBatch: string[] = [];
      let charCount = 0;
      for (const msg of messages) {
        const sepLen = firstBatch.length > 0 ? 1 : 0; // \n 分隔符
        if (firstBatch.length >= 10 || (charCount + sepLen + msg.length > 4096 && firstBatch.length > 0)) {
          break; // 当前批次已满，剩余消息留待下一轮 FINISH_STREAMING
        }
        firstBatch.push(msg);
        charCount += (firstBatch.length > 1 ? 1 : 0) + msg.length;
      }

      // 从队列前端移除第一批消息
      for (let i = 0; i < firstBatch.length; i++) {
        dispatch({ type: "DEQUEUE" });
      }
      const mergedText = firstBatch.join("\n");
      console.log(`[chat-service] processQueue: merge mode, sending batch of ${firstBatch.length} msgs (${mergedText.length} chars)`);
      setTimeout(() => sendMessage(mergedText), 100);
    } else {
      // TASK-0057: 逐条发送模式（方案 §3.1，现行为）
      // 每次 FINISH_STREAMING 触发 processQueue 时发送下一条，天然串行
      const [next] = currentState.pendingQueue;
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

  /** 切换合并发送开关，持久化到 localStorage（方案 §3.4） */
  function toggleMerge(): void {
    const newVal = !state.mergeEnabled;
    try { localStorage.setItem("artifex_chat:mergeEnabled", String(newVal)); } catch { /* ignore */ }
    dispatch({ type: "TOGGLE_MERGE" });
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
    mergeEnabled: state.mergeEnabled, toggleMerge,
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
