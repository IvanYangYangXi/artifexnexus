/**
 * 对话自动清理模块
 *
 * 职责：
 * - 扫描 Gateway sessions 列表，识别过期/空会话
 * - 清理 IndexedDB + localStorage + 内存缓存
 * - 返回清理报告
 *
 * 清理规则（用户确认）：
 * - 空会话：创建 > 24h 且 hasTranscript=false → 自动删除
 * - 过期会话：updatedAt > 30d → 自动删除
 * - 静默清理：console.log 记录，不弹 toast
 */

import type { SessionSummary } from "../../ipc/openclaw";
import {
  deleteSession,
  loadAllSessions,
  deleteSessionsBatch,
  cleanLocalStorageCaches,
} from "./persistence";
import { buildSessionKey, isValidSessionKey } from "./session-key";

// ─── 常量 ──────────────────────────────────────────────────────────────────

/** 空会话保留时间（ms）：24 小时 */
const EMPTY_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/** 过期会话保留时间（ms）：30 天 */
const EXPIRED_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ─── 类型 ──────────────────────────────────────────────────────────────────

export interface CleanupReport {
  /** 扫描的会话总数 */
  totalScanned: number;
  /** 清理的空会话数 */
  emptyCleaned: number;
  /** 清理的过期会话数 */
  expiredCleaned: number;
  /** 清理的会话 key 列表 */
  cleanedKeys: string[];
  /** 跳过的会话数（活跃/保护中） */
  skipped: number;
  /** 清理耗时 ms */
  durationMs: number;
}

// ─── 判断逻辑 ──────────────────────────────────────────────────────────────

/**
 * 判断会话是否为空（创建超过 TTL 且无 transcript）。
 * hasTranscript 由 sidecar 的 _extract_session_summary 返回，
 * 基于 sessionFile 路径是否存在。
 */
function isEmptySession(session: SessionSummary): boolean {
  const now = Date.now();
  const createdAt = session.createdAt || 0;
  // 创建时间不足 TTL → 不视为过期空会话
  if (now - createdAt < EMPTY_SESSION_TTL_MS) return false;
  // 无 transcript 文件 → 空会话
  return session.hasTranscript === false;
}

/**
 * 判断会话是否已过期（超过 30 天未活动）。
 */
function isExpiredSession(session: SessionSummary): boolean {
  const now = Date.now();
  const updatedAt = session.updatedAt || session.createdAt || 0;
  return now - updatedAt > EXPIRED_SESSION_TTL_MS;
}

// ─── 清理执行 ──────────────────────────────────────────────────────────────

/**
 * 扫描 Gateway sessions 列表，返回需要清理的 sessionKey 列表。
 *
 * @param sessions - 从 sidecar 获取的会话摘要列表
 * @returns [空会话 key 列表, 过期会话 key 列表]
 */
export function scanExpiredSessions(sessions: SessionSummary[]): {
  emptyKeys: string[];
  expiredKeys: string[];
} {
  const emptyKeys: string[] = [];
  const expiredKeys: string[] = [];

  for (const session of sessions) {
    if (!session.sessionKey || !isValidSessionKey(session.sessionKey)) continue;

    if (isEmptySession(session)) {
      emptyKeys.push(session.sessionKey);
    } else if (isExpiredSession(session)) {
      expiredKeys.push(session.sessionKey);
    }
  }

  return { emptyKeys, expiredKeys };
}

/**
 * 执行清理：删除 IndexedDB 记录 + localStorage 缓存。
 *
 * @param sessionKeys - 要清理的 sessionKey 列表
 * @param onProgress - 每清理一条后的回调（用于外部日志）
 * @returns 成功清理的 key 列表
 */
export async function executeCleanup(
  sessionKeys: string[],
  onProgress?: (key: string, index: number, total: number) => void,
): Promise<string[]> {
  const cleaned: string[] = [];

  if (sessionKeys.length === 0) return cleaned;

  // 1. 分块批量删除 IndexedDB 会话 + 消息（块间 yield 事件循环，不阻塞 UI）
  const successKeys = await deleteSessionsBatch(sessionKeys, (_chunkSuccess, chunkIndex, totalChunks) => {
    if (onProgress) {
      onProgress(sessionKeys[chunkIndex] ?? "", chunkIndex, totalChunks);
    }
  });
  cleaned.push(...successKeys);

  // 2. 清理 localStorage 消息缓存
  cleanLocalStorageCaches(sessionKeys);

  // 3. 进度回调
  if (onProgress) {
    for (let i = 0; i < sessionKeys.length; i++) {
      onProgress(sessionKeys[i], i, sessionKeys.length);
    }
  }

  return cleaned;
}

/**
 * 执行自动清理的入口函数。
 *
 * @param sessions - 从 sidecar 获取的会话摘要列表
 * @param onComplete - 清理完成后的回调（接收报告）
 */
export async function performAutoCleanup(
  sessions: SessionSummary[],
  onComplete?: (report: CleanupReport) => void,
): Promise<CleanupReport> {
  const startTime = Date.now();

  const { emptyKeys, expiredKeys } = scanExpiredSessions(sessions);
  const allKeys = [...new Set([...emptyKeys, ...expiredKeys])];

  const report: CleanupReport = {
    totalScanned: sessions.length,
    emptyCleaned: 0,
    expiredCleaned: 0,
    cleanedKeys: [],
    skipped: sessions.length - allKeys.length,
    durationMs: 0,
  };

  if (allKeys.length === 0) {
    report.durationMs = Date.now() - startTime;
    console.log(
      `[session-cleanup] 扫描 ${sessions.length} 个会话，无需清理`,
    );
    onComplete?.(report);
    return report;
  }

  console.log(
    `[session-cleanup] 发现 ${emptyKeys.length} 个空会话 + ${expiredKeys.length} 个过期会话，共 ${allKeys.length} 条待清理`,
  );

  // 逐条日志
  if (emptyKeys.length > 0) {
    console.log(`[session-cleanup] 空会话（>24h 无历史记录）:`, emptyKeys.map(k => k.slice(-30)));
  }
  if (expiredKeys.length > 0) {
    console.log(`[session-cleanup] 过期会话（>30d 未活动）:`, expiredKeys.map(k => k.slice(-30)));
  }

  const cleaned = await executeCleanup(allKeys, (key, i, total) => {
    console.debug(`[session-cleanup] 清理中 (${i + 1}/${total}): ${key.slice(-30)}`);
  });

  report.cleanedKeys = cleaned;
  report.emptyCleaned = cleaned.filter(k => emptyKeys.includes(k)).length;
  report.expiredCleaned = cleaned.filter(k => expiredKeys.includes(k)).length;
  report.durationMs = Date.now() - startTime;

  console.log(
    `[session-cleanup] 清理完成：${cleaned.length}/${allKeys.length} 条 ` +
    `(空:${report.emptyCleaned} 过期:${report.expiredCleaned}) ` +
    `耗时 ${report.durationMs}ms`,
  );

  onComplete?.(report);
  return report;
}
