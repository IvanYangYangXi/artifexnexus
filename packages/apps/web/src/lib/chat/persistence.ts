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
      resolve(request.result);
    };

    request.onerror = () => {
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
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
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
      resolve(sessions);
    };
    request.onerror = () => reject(request.error);
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
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
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
    clearRequest.onerror = () => reject(clearRequest.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
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
      resolve(messages);
    };
    request.onerror = () => reject(request.error);
  });
}

/** 加载完整会话（含消息） */
export async function loadFullSession(sessionId: string): Promise<ChatSession | null> {
  const db = await openDB();
  const sessionMeta = await new Promise<Omit<ChatSession, "messages"> | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_SESSIONS, "readonly");
    const store = tx.objectStore(STORE_SESSIONS);
    const request = store.get(sessionId);
    request.onsuccess = () => resolve(request.result as Omit<ChatSession, "messages"> | undefined);
    request.onerror = () => reject(request.error);
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
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── 活动会话 ID ──────────────────────────────────────────────────────────

const ACTIVE_SESSION_KEY = "artifex.chat.activeSessionId";

export function getActiveSessionId(defaultId = "default"): string {
  try {
    return localStorage.getItem(ACTIVE_SESSION_KEY) ?? defaultId;
  } catch {
    return defaultId;
  }
}

export function setActiveSessionId(sessionId: string): void {
  try {
    localStorage.setItem(ACTIVE_SESSION_KEY, sessionId);
  } catch { /* ignore */ }
}
