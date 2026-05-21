/**
 * Chat 领域类型 — 对齐 docs/specs/ui/web-chat-structure.md §4
 *
 * 替代 chatMock.ts 中的 MockMessage，用于 STORY-0039 真实 API 接线。
 * STORY-0039: Chat function wiring (API + WebSocket streaming)
 */

// ─── 消息 ──────────────────────────────────────────────────────────────────

/** 消息角色 */
export type MessageRole = "user" | "assistant" | "system";

/** 工具调用状态 */
export type ToolCallStatus = "pending" | "running" | "done" | "error";

/** 单个工具调用 */
export interface ToolCall {
  id: string;
  name: string;
  status: ToolCallStatus;
  /** 耗时毫秒 */
  durationMs?: number;
  /** 输入参数（JSON 字符串） */
  input?: string;
  /** 输出结果（JSON 字符串） */
  output?: string;
}

/** 单条聊天消息 */
export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  /** 流式生成中（仅 assistant 消息） */
  isStreaming?: boolean;
  /** 工具调用列表（仅 assistant 消息） */
  toolCalls?: ToolCall[];
  /** Gateway 运行 ID（仅 assistant 消息，用于跨事件关联）。
   *  v4.1.2 新增：避免 Gateway 跨 runId 事件交错时错误 FINISH。 */
  runId?: string;
}

// ─── 对话状态机 ────────────────────────────────────────────────────────────

/** 对话状态（对齐 spec §4 状态机） */
export type ChatState =
  | "idle"
  | "sending"
  | "streaming"
  | "tool_executing"
  | "error"
  | "queued";

// ─── 会话 ──────────────────────────────────────────────────────────────────

/** 对话会话 */
export interface ChatSession {
  id: string;
  /** 显示名称 */
  title: string;
  /** 创建时间 ISO */
  createdAt: string;
  /** 最后活动时间 ISO */
  updatedAt: string;
  /** 消息列表 */
  messages: ChatMessage[];
}

// ─── 共享常量 ──────────────────────────────────────────────────────────────

/** localStorage key：用户选择的聊天模型 */
export const CHAT_MODEL_STORAGE_KEY = "artifex.chat.model";

// ─── 模型/Agent ────────────────────────────────────────────────────────────

/** 可选模型 */
export interface ModelOption {
  id: string;
  name: string;
  providerId?: string;
}

/** Agent 预设 */
export interface AgentOption {
  id: string;
  name: string;
}

// ─── API 请求/响应 ─────────────────────────────────────────────────────────

/** 发送到 Gateway 的 chat.send RPC 参数 */
export interface ChatSendParams {
  sessionKey: string;
  message: string;
  idempotencyKey: string;
  /** 思考强度 */
  thinking?: string;
}

/** Gateway chat 事件（WebSocket 接收） */
export interface GatewayChatEvent {
  state: "delta" | "final" | "aborted" | "error";
  /** 累积文本（error 状态时为错误描述） */
  message: string;
  /** 运行 ID */
  runId?: string;
  /** 原始错误详情（来自 Gateway 的 rawError 字段，如 "429 status code (no body)"） */
  rawError?: string;
  /** 工具调用信息（Anthropic 风格 content blocks） */
  messageBlocks?: GatewayMessageBlock[];
  /** Tool 调用生命周期事件（来自 event=agent, stream=item, kind=tool） */
  toolCall?: {
    id: string;
    phase: "start" | "update" | "end";
    name: string;
    title: string;
    /** Gateway 状态："in_progress" | "completed" | "failed" */
    status: string;
    meta?: string;
    /** 失败时的错误信息 */
    error?: string;
    startedAt?: number;
    endedAt?: number;
    durationMs?: number;
  };
  /** Tool 命令输出事件（来自 event=agent, stream=command_output） */
  toolOutput?: {
    toolCallId: string;
    phase: "delta" | "end";
    output: string;
    exitCode?: number;
    durationMs?: number;
  };
}

/** Gateway 消息块 */
export interface GatewayMessageBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | GatewayMessageBlock[];
}

// ─── 流式累积器 ────────────────────────────────────────────────────────────

/** 流式累积状态（用于逐 token 渲染 + 工具调用跟踪） */
export interface StreamAccumulator {
  /** 累积的文本内容 */
  text: string;
  /** 检测到的工具调用（运行时动态填充） */
  toolCalls: Map<string, ToolCall>;
  /** 当前活跃的工具调用 ID */
  activeToolCallId: string | null;
  /** 流是否结束 */
  done: boolean;
}
