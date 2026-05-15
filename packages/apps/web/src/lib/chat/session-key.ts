/**
 * session-key 解析 SDK
 *
 * sessionKey 格式：agent:{agentId}:{subKey}
 *   - agentId: 来自 Gateway 配置的 agent id
 *   - subKey:  "session-{timestamp}"（前端新建）或 Gateway sessionId
 *
 * 哨兵值：
 *   - __pending_new__  未发送的新建对话
 *   - __empty__        空占位（无对话可选）
 *   - __new__          触发新建对话面板
 *
 * 所有涉及 sessionKey 解析的逻辑统一通过此模块，避免各处重复 .split(":")[1]。
 */

// ─── 常量 ──────────────────────────────────────────────────────────────────

export const SESSION_KEY_PREFIX = "agent:" as const;

export const PENDING_NEW_KEY = "__pending_new__" as const;
export const EMPTY_KEY = "__empty__" as const;
export const NEW_KEY = "__new__" as const;

// ─── 类型 ──────────────────────────────────────────────────────────────────

export interface ParsedSessionKey {
  /** Gateway agent id */
  agentId: string;
  /** session-{timestamp} 或 Gateway sessionId */
  subKey: string;
}

// ─── 解析 ──────────────────────────────────────────────────────────────────

/**
 * 解析 sessionKey → { agentId, subKey }
 * 非法格式（非 agent: 前缀、格式不完整）返回 null
 */
export function parseSessionKey(key: string): ParsedSessionKey | null {
  if (!key.startsWith(SESSION_KEY_PREFIX)) return null;
  const rest = key.slice(SESSION_KEY_PREFIX.length);
  const idx = rest.indexOf(":");
  if (idx < 0) return null;
  return { agentId: rest.slice(0, idx), subKey: rest.slice(idx + 1) };
}

/** 从 sessionKey 提取 agentId（便捷方法） */
export function getAgentId(key: string): string | null {
  return parseSessionKey(key)?.agentId ?? null;
}

// ─── 构建 ──────────────────────────────────────────────────────────────────

/** 构建 sessionKey */
export function buildSessionKey(agentId: string, subKey: string): string {
  return `${SESSION_KEY_PREFIX}${agentId}:${subKey}`;
}

/** 新建对话时用的 subKey（timestamp 唯一） */
export function newSessionSubKey(): string {
  return `session-${Date.now()}`;
}

/** 为指定 agent 生成全新 sessionKey */
export function createSessionKey(agentId: string): string {
  return buildSessionKey(agentId, newSessionSubKey());
}

// ─── 哨兵 ──────────────────────────────────────────────────────────────────

/** 是否是哨兵值（非真实 sessionKey） */
export function isSentinel(key: string): boolean {
  return key === PENDING_NEW_KEY || key === EMPTY_KEY || key === NEW_KEY;
}

/** 是否是合法的真实 sessionKey */
export function isValidSessionKey(key: string): boolean {
  return !isSentinel(key) && parseSessionKey(key) !== null;
}

// ─── localStorage 标题 ─────────────────────────────────────────────────────

const TITLE_PREFIX = "artifex.session.title:";

/** 读取对话的自定义标题（从 localStorage） */
export function getCustomTitle(sessionKey: string): string | null {
  try {
    return localStorage.getItem(`${TITLE_PREFIX}${sessionKey}`);
  } catch {
    return null;
  }
}

/** 写入对话的自定义标题到 localStorage */
export function setCustomTitle(sessionKey: string, title: string): void {
  try {
    localStorage.setItem(`${TITLE_PREFIX}${sessionKey}`, title);
  } catch {
    // ignore
  }
}

/** 生成新建对话的标题文本（首条消息前30字，不含日期前缀）。
 *
 * 日期前缀（MM-DD HH:mm）由 ChatControlBar 在渲染时从 session.createdAt 统一添加，
 * 确保 dev 模式与 EXE 模式标题格式一致。
 */
export function generateSessionTitle(firstMessage: string): string {
  const summary = firstMessage.length > 30 ? firstMessage.slice(0, 30) + "…" : firstMessage;
  return summary;
}

/** 将 Unix 毫秒时间戳格式化为 "MM-DD HH:mm"（给对话列表标题前缀用） */
export function formatSessionDate(tsMs: number): string {
  const d = new Date(tsMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
