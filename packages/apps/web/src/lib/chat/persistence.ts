/**
 * IndexedDB 持久化层 — 会话与消息存储
 *
 * 方案B（用户选择）：IndexedDB 替代 localStorage
 * 优势：容量充足（通常 50%+ 磁盘空间），支持索引，异步非阻塞
 *
 * 数据库结构：
 *   Database: artifex-chat
 *   ObjectStore: sessions（keyPath: id）— 会话元数据
 *   ObjectStore: messages（keyPath: id, index: sessionId）— 消息
 */

import type { ChatSession, ChatMessage } from "./types";

// ─── 常量 ──────────────────────────────────────────────────────────────────

const DB_NAME = "artifex-chat";
const DB_VERSION = 1;
const STORE_SESSIONS = "sessions";
const STORE_MESSAGES = "messages";

// ─── 数据库初始化 ──────────────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      // 会话存储
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        const sessionStore = db.createObjectStore(STORE_SESSIONS, {
          keyPath: "id",
        });
        sessionStore.createIndex("updatedAt", "updatedAt", { unique: false });
      }
      // 消息存储
      if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
        const messageStore = db.createObjectStore(STORE_MESSAGES, {
          keyPath: "id",
        });
        messageStore.createIndex("sessionId", "sessionId", { unique: false });
        messageStore.createIndex("timestamp", "timestamp", { unique: false });
      }
    };

    request.onsuccess = () => {
      console.log(`[persistence] DB opened: ${DB_NAME} v${DB_VERSION}`);
      resolve(request.result);
    };

    request.onerror = () => {
      console.error("[persistence] DB open failed:", request.error);
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

// ─── 会话 CRUD ─────────────────────────────────────────────────────────────

/** 保存/更新会话（不含消息，消息单独存储） */
export async function saveSession(session: Omit<ChatSession, "messages">): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SESSIONS, "readwrite");
    const store = tx.objectStore(STORE_SESSIONS);
    store.put({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    });
    tx.oncomplete = () => {
      console.debug(`[persistence] session saved: ${session.id}`);
      resolve();
    };
    tx.onerror = () => {
      console.error(`[persistence] session save failed: ${session.id}`, tx.error);
      reject(tx.error);
    };
  });
}

/** 加载所有会话（不含消息） */
export async function loadAllSessions(): Promise<Omit<ChatSession, "messages">[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SESSIONS, "readonly");
    const store = tx.objectStore(STORE_SESSIONS);
    const index = store.index("updatedAt");
    const request = index.getAll();
    request.onsuccess = () => {
      // 按更新时间倒序
      const sessions = (request.result as Omit<ChatSession, "messages">[]).reverse();
      console.log(`[persistence] sessions loaded: ${sessions.length}`);
      resolve(sessions);
    };
    request.onerror = () => {
      console.error("[persistence] sessions load failed:", request.error);
      reject(request.error);
    };
  });
}

/** 删除会话 */
export async function deleteSession(sessionId: string): Promise<void> {
  const db = await openDB();
  // 同时删除消息
  await deleteMessagesBySession(sessionId);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SESSIONS, "readwrite");
    const store = tx.objectStore(STORE_SESSIONS);
    store.delete(sessionId);
    tx.oncomplete = () => {
      console.debug(`[persistence] session deleted: ${sessionId}`);
      resolve();
    };
    tx.onerror = () => {
      console.error(`[persistence] session delete failed: ${sessionId}`, tx.error);
      reject(tx.error);
    };
  });
}

// ─── 消息 CRUD ─────────────────────────────────────────────────────────────

/** 保存消息（批量） */
export async function saveMessages(
  sessionId: string,
  messages: ChatMessage[],
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MESSAGES, "readwrite");
    const store = tx.objectStore(STORE_MESSAGES);

    // 先删除该会话的旧消息，再写入新消息
    const index = store.index("sessionId");
    const clearRequest = index.openCursor(IDBKeyRange.only(sessionId));
    clearRequest.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        // 删除完毕，写入新消息
        for (const msg of messages) {
          store.put({ ...msg, sessionId });
        }
      }
    };
    clearRequest.onerror = () => {
      console.error(`[persistence] message clear failed: ${sessionId}`, clearRequest.error);
      reject(clearRequest.error);
    };
    tx.oncomplete = () => {
      console.debug(`[persistence] messages saved: ${sessionId} count=${messages.length}`);
      resolve();
    };
    tx.onerror = () => {
      console.error(`[persistence] message save tx failed: ${sessionId}`, tx.error);
      reject(tx.error);
    };
  });
}

/** 加载会话的所有消息 */
export async function loadMessages(sessionId: string): Promise<ChatMessage[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MESSAGES, "readonly");
    const store = tx.objectStore(STORE_MESSAGES);
    const index = store.index("sessionId");
    const request = index.getAll(sessionId);
    request.onsuccess = () => {
      // 按时间戳排序
      const messages = (request.result as (ChatMessage & { sessionId: string })[])
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        .map(({ sessionId: _sid, ...msg }) => msg as ChatMessage);
      console.debug(`[persistence] messages loaded: ${sessionId} count=${messages.length}`);
      resolve(messages);
    };
    request.onerror = () => {
      console.error(`[persistence] messages load failed: ${sessionId}`, request.error);
      reject(request.error);
    };
  });
}

/** 加载完整会话（含消息） */
export async function loadFullSession(sessionId: string): Promise<ChatSession | null> {
  const db = await openDB();
  const sessionMeta = await new Promise<Omit<ChatSession, "messages"> | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_SESSIONS, "readonly");
    const store = tx.objectStore(STORE_SESSIONS);
    const request = store.get(sessionId);
    request.onsuccess = () => {
      const meta = request.result as Omit<ChatSession, "messages"> | undefined;
      console.debug(`[persistence] full session loaded: ${sessionId} found=${!!meta}`);
      resolve(meta);
    };
    request.onerror = () => {
      console.error(`[persistence] full session load failed: ${sessionId}`, request.error);
      reject(request.error);
    };
  });

  if (!sessionMeta) return null;

  const messages = await loadMessages(sessionId);
  return { ...sessionMeta, messages };
}

// ─── 内部工具 ──────────────────────────────────────────────────────────────

/** 删除会话的所有消息 */
async function deleteMessagesBySession(sessionId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MESSAGES, "readwrite");
    const store = tx.objectStore(STORE_MESSAGES);
    const index = store.index("sessionId");
    const request = index.openCursor(IDBKeyRange.only(sessionId));
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => {
      console.debug(`[persistence] messages deleted for session: ${sessionId}`);
      resolve();
    };
    tx.onerror = () => {
      console.error(`[persistence] messages delete failed: ${sessionId}`, tx.error);
      reject(tx.error);
    };
  });
}

// ─── 批量操作（自动清理） ──────────────────────────────────────────────────

/** 批量删除的 chunk 大小：每处理此数量后 yield 到事件循环 */
const BATCH_CHUNK_SIZE = 5;

/**
 * 单 chunk 删除（在单个 IndexedDB 事务内完成）。
 */
async function _deleteChunk(sessionIds: string[]): Promise<string[]> {
  if (sessionIds.length === 0) return [];

  const db = await openDB();
  const successIds: string[] = [];

  return new Promise((resolve) => {
    const tx = db.transaction(
      [STORE_SESSIONS, STORE_MESSAGES],
      "readwrite",
    );
    const sessionStore = tx.objectStore(STORE_SESSIONS);
    const messageStore = tx.objectStore(STORE_MESSAGES);
    const msgIndex = messageStore.index("sessionId");

    let completed = 0;
    const total = sessionIds.length;

    for (const sessionId of sessionIds) {
      // 删除消息
      const cursorReq = msgIndex.openCursor(IDBKeyRange.only(sessionId));
      cursorReq.onsuccess = (event) => {
        const cursor = (
          event.target as IDBRequest<IDBCursorWithValue>
        ).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      cursorReq.onerror = () => {
        console.warn(
          `[persistence] chunk message delete failed: ${sessionId}`,
          cursorReq.error,
        );
      };

      // 删除会话
      const delReq = sessionStore.delete(sessionId);
      delReq.onsuccess = () => {
        successIds.push(sessionId);
        completed++;
      };
      delReq.onerror = () => {
        console.warn(
          `[persistence] chunk session delete failed: ${sessionId}`,
          delReq.error,
        );
        completed++;
      };
    }

    tx.oncomplete = () => resolve(successIds);
    tx.onerror = () => {
      console.error("[persistence] chunk tx failed:", tx.error);
      resolve(successIds);
    };
  });
}

/** yield 到事件循环（让 UI 有机会渲染/响应输入） */
function _yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * 批量删除多个会话及其消息（分块执行，避免阻塞主线程）。
 *
 * 每 {@link BATCH_CHUNK_SIZE} 条为一块，块间 yield 到事件循环，
 * 保证下拉菜单、消息渲染等 UI 操作不被长时间阻塞。
 *
 * @param sessionIds - 要删除的会话 ID 列表
 * @param onChunk - 每完成一块的回调（successIds, chunkIndex, totalChunks）
 * @returns 成功删除的会话 ID 列表
 */
export async function deleteSessionsBatch(
  sessionIds: string[],
  onChunk?: (successIds: string[], chunkIndex: number, totalChunks: number) => void,
): Promise<string[]> {
  if (sessionIds.length === 0) return [];

  const allSuccess: string[] = [];
  const totalChunks = Math.ceil(sessionIds.length / BATCH_CHUNK_SIZE);

  for (let i = 0; i < sessionIds.length; i += BATCH_CHUNK_SIZE) {
    const chunk = sessionIds.slice(i, i + BATCH_CHUNK_SIZE);
    const chunkIndex = Math.floor(i / BATCH_CHUNK_SIZE);

    const success = await _deleteChunk(chunk);
    allSuccess.push(...success);
    onChunk?.(success, chunkIndex, totalChunks);

    // 块间 yield：让 UI 有机会处理事件
    if (i + BATCH_CHUNK_SIZE < sessionIds.length) {
      await _yieldToEventLoop();
    }
  }

  console.debug(
    `[persistence] batch deleted: ${allSuccess.length}/${sessionIds.length} sessions (${totalChunks} chunks)`,
  );
  return allSuccess;
}

/**
 * 清理 localStorage 中的消息缓存。
 *
 * 删除所有 `artifex_chat:{sessionKey}` 格式的 key。
 */
export function cleanLocalStorageCaches(sessionKeys: string[]): void {
  const LS_PREFIX = "artifex_chat:";
  let cleaned = 0;

  for (const key of sessionKeys) {
    try {
      const lsKey = `${LS_PREFIX}${key}`;
      if (localStorage.getItem(lsKey) !== null) {
        localStorage.removeItem(lsKey);
        cleaned++;
      }
    } catch {
      // localStorage 不可用，静默忽略
    }
  }

  if (cleaned > 0) {
    console.debug(
      `[persistence] localStorage caches cleaned: ${cleaned}/${sessionKeys.length}`,
    );
  }
}

// ─── 活动会话 ID ──────────────────────────────────────────────────────────

const ACTIVE_SESSION_KEY = "artifex.chat.activeSessionId";

export function getActiveSessionId(defaultId = "default"): string {
  try {
    return localStorage.getItem(ACTIVE_SESSION_KEY) ?? defaultId;
  } catch (err) {
    console.warn("[persistence] localStorage read failed for activeSessionId:", err);
    return defaultId;
  }
}

export function setActiveSessionId(sessionId: string): void {
  try {
    localStorage.setItem(ACTIVE_SESSION_KEY, sessionId);
  } catch (err) {
    console.warn("[persistence] localStorage write failed for activeSessionId:", err);
  }
}
