"use client";

/**
 * useUiPref — UI 偏好持久化 hook
 *
 * 策略：
 *   1. 初始值优先从 localStorage 读（快速，避免 RPC 延迟闪烁）
 *   2. 组件 mount 后异步读取 app.settings（后端文件，跨启动真正持久化）
 *      若与 localStorage 不同则更新 state（文件 > localStorage）
 *   3. setValue 同时写 localStorage（即时）+ 异步写 app.settings（持久化）
 *
 * 用法：
 *   const [viewMode, setViewMode] = useUiPref<"card"|"list">(
 *     "skillViewMode", "card"
 *   );
 */

import * as React from "react";

// ── 懒加载 IPC（避免 Next.js SSR 时 @tauri-apps/api 报错） ───────────────────
type AppSettingsKey = "skillViewMode" | "toolViewMode" | "skillFavoritesOnly" | "toolFavoritesOnly";

let _ipc: {
  getAppSettings: () => Promise<{ settings: Record<string, unknown> }>;
  setAppSettings: (patch: Record<string, unknown>) => Promise<unknown>;
} | null = null;

async function getIpc() {
  if (_ipc) return _ipc;
  try {
    const mod = await import("../ipc/openclaw");
    _ipc = {
      getAppSettings: mod.getAppSettings as unknown as () => Promise<{ settings: Record<string, unknown> }>,
      setAppSettings: mod.setAppSettings as unknown as (patch: Record<string, unknown>) => Promise<unknown>,
    };
  } catch {
    // 非 Tauri 环境（开发浏览器预览），静默降级为 localStorage-only
    _ipc = {
      getAppSettings: async () => ({ settings: {} }),
      setAppSettings: async () => {},
    };
  }
  return _ipc;
}

// ── localStorage helpers ──────────────────────────────────────────────────────
const LS_PREFIX = "artifex.uipref.";

// 旧 key → 新 key 迁移映射（含值转换）
const MIGRATION_MAP: Record<string, { newKey: AppSettingsKey; convert: (raw: string) => unknown }> = {
  "artifex.skills.skillViewMode": { newKey: "skillViewMode", convert: (v) => v },
  "artifex.skills.toolViewMode": { newKey: "toolViewMode", convert: (v) => v },
  "artifex.skills.skillFavoritesOnly": { newKey: "skillFavoritesOnly", convert: (v) => v === "1" },
  "artifex.skills.toolFavoritesOnly": { newKey: "toolFavoritesOnly", convert: (v) => v === "1" },
};

function migrateOldKeys(): void {
  // 检查并迁移旧 key → 新 key（只执行一次，迁移后删旧 key）
  for (const [oldKey, { newKey, convert }] of Object.entries(MIGRATION_MAP)) {
    const newFullKey = LS_PREFIX + newKey;
    // 新 key 已存在则跳过（已迁移过）
    if (localStorage.getItem(newFullKey) !== null) continue;
    const oldVal = localStorage.getItem(oldKey);
    if (oldVal !== null) {
      try {
        localStorage.setItem(newFullKey, JSON.stringify(convert(oldVal)));
      } catch { /* ignore */ }
      localStorage.removeItem(oldKey); // 清理旧 key
    }
  }
}

function lsRead<T>(key: AppSettingsKey, fallback: T): T {
  try {
    // 首次读取时做旧 key 迁移
    migrateOldKeys();
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function lsWrite<T>(key: AppSettingsKey, value: T): void {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch { /* ignore */ }
}

// ── hook ──────────────────────────────────────────────────────────────────────
export function useUiPref<T>(key: AppSettingsKey, defaultValue: T): [T, (v: T) => void] {
  const [value, _setValue] = React.useState<T>(() => lsRead(key, defaultValue));

  // 启动后从 app.settings 同步一次（以持久化文件为准）
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ipc = await getIpc();
        const { settings } = await ipc.getAppSettings();
        if (cancelled) return;
        const fromFile = settings[key];
        if (fromFile !== undefined && fromFile !== null) {
          const typed = fromFile as T;
          _setValue(typed);
          lsWrite(key, typed); // 同步回 localStorage
        }
      } catch {
        // 静默降级（sidecar 未启动等情况）
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const setValue = React.useCallback((v: T) => {
    _setValue(v);
    lsWrite(key, v);
    // 异步写入后端（不 await，失败静默）
    getIpc().then(ipc => ipc.setAppSettings({ [key]: v })).catch(() => {});
  }, [key]);

  return [value, setValue];
}
