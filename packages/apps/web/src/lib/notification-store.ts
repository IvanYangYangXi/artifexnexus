/**
 * 通知状态管理 — 使用 React Context + useReducer
 *
 * 功能：
 *   - 收集来自 Tauri IPC / Gateway WS 的通知
 *   - 内存保留最近 50 条 + localStorage 持久化
 *   - 未读计数 + 标记已读
 *   - addNotification 自动触发 sonner toast()
 *
 * 外部入口：
 *   import { useNotifications, NotificationProvider } from "../lib/notification-store";
 *
 *   const { addNotification, notifications, unreadCount } = useNotifications();
 *   addNotification({ type: "success", title: "完成", message: "操作成功" });
 */

import * as React from "react";
import { toast } from "@artifex-nexus/ui";

// ─── 类型 ──────────────────────────────────────────────────────────────────

export type NotificationType = "info" | "success" | "warning" | "error";

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: string; // ISO
  source?: string;
  read: boolean;
  /** 详细内容（合规检查的问题列表等），在详情弹窗中以 pre 格式展示 */
  detail?: string;
}

export interface AddNotificationParams {
  type: NotificationType;
  title: string;
  message: string;
  source?: string;
  /** 详细内容，点击详情弹窗时展示 */
  detail?: string;
}

// ─── Actions ───────────────────────────────────────────────────────────────

type NotificationAction =
  | { type: "ADD"; payload: AppNotification }
  | { type: "MARK_READ"; id: string }
  | { type: "MARK_ALL_READ" }
  | { type: "CLEAR_ALL" }
  | { type: "LOAD"; payload: AppNotification[] };

interface NotificationState {
  notifications: AppNotification[];
}

const MAX_NOTIFICATIONS = 50;
const STORAGE_KEY = "artifex.notifications";

// ─── 持久化 ────────────────────────────────────────────────────────────────

function loadFromStorage(): AppNotification[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_NOTIFICATIONS);
  } catch {
    return [];
  }
}

function saveToStorage(notifications: AppNotification[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications.slice(0, MAX_NOTIFICATIONS)));
  } catch { /* quota exceeded, silently ignore */ }
}

// ─── Reducer ───────────────────────────────────────────────────────────────

function notificationReducer(
  state: NotificationState,
  action: NotificationAction,
): NotificationState {
  switch (action.type) {
    case "ADD": {
      const next = [action.payload, ...state.notifications].slice(0, MAX_NOTIFICATIONS);
      saveToStorage(next);
      return { notifications: next };
    }
    case "MARK_READ": {
      const next = state.notifications.map((n) =>
        n.id === action.id ? { ...n, read: true } : n,
      );
      saveToStorage(next);
      return { notifications: next };
    }
    case "MARK_ALL_READ": {
      const next = state.notifications.map((n) => ({ ...n, read: true }));
      saveToStorage(next);
      return { notifications: next };
    }
    case "CLEAR_ALL": {
      saveToStorage([]);
      return { notifications: [] };
    }
    case "LOAD": {
      return { notifications: action.payload.slice(0, MAX_NOTIFICATIONS) };
    }
    default:
      return state;
  }
}

// ─── Context ───────────────────────────────────────────────────────────────

interface NotificationContextValue {
  notifications: AppNotification[];
  unreadCount: number;
  addNotification: (params: AddNotificationParams) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearAll: () => void;
}

const NotificationContext = React.createContext<NotificationContextValue>({
  notifications: [],
  unreadCount: 0,
  addNotification: () => {},
  markAsRead: () => {},
  markAllAsRead: () => {},
  clearAll: () => {},
});

// ─── Provider ──────────────────────────────────────────────────────────────

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(notificationReducer, {
    notifications: [],
  });

  // 初始化时从 localStorage 加载
  const initialized = React.useRef(false);
  if (!initialized.current) {
    initialized.current = true;
    const stored = loadFromStorage();
    if (stored.length > 0) {
      dispatch({ type: "LOAD", payload: stored });
    }
  }

  const addNotification = React.useCallback((params: AddNotificationParams) => {
    const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const notification: AppNotification = {
      ...params,
      id,
      timestamp: new Date().toISOString(),
      read: false,
    };
    dispatch({ type: "ADD", payload: notification });

    // 自动触发 sonner toast
    toast[params.type](params.title, {
      description: params.message.length > 100
        ? params.message.slice(0, 100) + "..."
        : params.message,
    });
  }, []);

  const markAsRead = React.useCallback((id: string) => {
    dispatch({ type: "MARK_READ", id });
  }, []);

  const markAllAsRead = React.useCallback(() => {
    dispatch({ type: "MARK_ALL_READ" });
  }, []);

  const clearAll = React.useCallback(() => {
    dispatch({ type: "CLEAR_ALL" });
  }, []);

  const unreadCount = state.notifications.filter((n) => !n.read).length;

  const value = React.useMemo(
    () => ({
      notifications: state.notifications,
      unreadCount,
      addNotification,
      markAsRead,
      markAllAsRead,
      clearAll,
    }),
    [state.notifications, unreadCount, addNotification, markAsRead, markAllAsRead, clearAll],
  );

  return React.createElement(NotificationContext.Provider, { value }, children);
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useNotifications(): NotificationContextValue {
  return React.useContext(NotificationContext);
}

/**
 * 从外部（非 React 组件）获取通知 Store，用于 gateway-ws.ts 等纯 TS 模块。
 * 通过 window 上的全局引用实现。
 */
type ExternalNotificationStore = {
  addNotification: (params: AddNotificationParams) => void;
};

let _externalStore: ExternalNotificationStore | null = null;

export function registerExternalNotificationStore(store: ExternalNotificationStore): void {
  _externalStore = store;
}

export function getExternalNotificationStore(): ExternalNotificationStore {
  if (!_externalStore) {
    // 降级：直接 toast，不进入通知历史
    console.warn("[notification-store] External store not registered, fallback to toast-only");
    return {
      addNotification: (params) => {
        toast[params.type](params.title, {
          description: params.message.length > 100
            ? params.message.slice(0, 100) + "..."
            : params.message,
        });
      },
    };
  }
  return _externalStore;
}
