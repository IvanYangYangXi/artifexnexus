/**
 * useResourceExplorer — 资源管理器状态管理
 *
 * 管理当前目录浏览、收藏夹（localStorage 持久化）、搜索过滤。
 * 通过 Tauri `invoke("list_dir")` 获取目录内容。
 */

"use client";

import * as React from "react";
import { invoke } from "@tauri-apps/api/core";

// ── Types ──────────────────────────────────────────────────────────────────

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

export interface FavoriteEntry {
  path: string;
  name: string;
  is_dir: boolean;
}

// ── localStorage helpers ───────────────────────────────────────────────────

const FAVORITES_KEY = "artifex.explorer.favorites";
const LAST_DIR_KEY = "artifex.explorer.lastDir";

function loadFavorites(): FavoriteEntry[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* ignore */ }
  return [];
}

function saveFavorites(favs: FavoriteEntry[]) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
  } catch { /* ignore */ }
}

function loadLastDir(): string {
  try {
    return localStorage.getItem(LAST_DIR_KEY) || "";
  } catch {
    return "";
  }
}

function saveLastDir(dir: string) {
  try {
    if (dir) {
      localStorage.setItem(LAST_DIR_KEY, dir);
    } else {
      localStorage.removeItem(LAST_DIR_KEY);
    }
  } catch { /* ignore */ }
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useResourceExplorer() {
  const [currentDir, setCurrentDir] = React.useState<string>(() => loadLastDir());
  const [entries, setEntries] = React.useState<FileEntry[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [favorites, setFavorites] = React.useState<FavoriteEntry[]>(() => loadFavorites());

  // 递归搜索结果
  const [searchResults, setSearchResults] = React.useState<FileEntry[]>([]);
  const [searchLoading, setSearchLoading] = React.useState(false);
  const searchTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // 自动恢复到上次目录
  const didRestore = React.useRef(false);
  React.useEffect(() => {
    if (didRestore.current) return;
    if (currentDir) {
      didRestore.current = true;
      navigateTo(currentDir);
    }
    // 只跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 进入目录
  const navigateTo = React.useCallback(async (dirPath: string) => {
    setCurrentDir(dirPath);
    saveLastDir(dirPath);
    setLoading(true);
    setError(null);
    setSearch("");
    try {
      const result = await invoke<FileEntry[]>("list_dir", { path: dirPath });
      setEntries(result);
    } catch (e) {
      setError(String(e));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // 返回上级
  const navigateUp = React.useCallback(() => {
    if (!currentDir) return;
    const parent = currentDir.split(/[/\\]/).slice(0, -1).join("/");
    if (parent && parent !== currentDir) {
      navigateTo(parent);
    }
  }, [currentDir, navigateTo]);

  // 直接设置路径（面包屑点击 / 收藏跳转）
  const setPath = React.useCallback((dirPath: string) => {
    navigateTo(dirPath);
  }, [navigateTo]);

  // 搜索触发：防抖 300ms 后递归搜索子目录
  React.useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!search.trim() || !currentDir) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const results = await invoke<FileEntry[]>("search_dir", {
          path: currentDir,
          query: search,
          maxDepth: 5,
        });
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [search, currentDir]);

  // 搜索过滤（空搜索 → 当前目录条目；有搜索 → 递归结果，截断 200 条）
  const filteredEntries = React.useMemo(() => {
    if (!search.trim()) return entries;
    return searchResults.length > 200 ? searchResults.slice(0, 200) : searchResults;
  }, [entries, search, searchResults]);

  // 收藏操作
  const toggleFavorite = React.useCallback((entry: { name: string; path: string; is_dir: boolean }) => {
    setFavorites((prev) => {
      const exists = prev.find((f) => f.path === entry.path);
      let next: FavoriteEntry[];
      if (exists) {
        next = prev.filter((f) => f.path !== entry.path);
      } else {
        next = [{ path: entry.path, name: entry.name, is_dir: entry.is_dir }, ...prev];
      }
      saveFavorites(next);
      return next;
    });
  }, []);

  const isFavorited = React.useCallback(
    (path: string) => favorites.some((f) => f.path === path),
    [favorites],
  );

  // 面包屑分段
  const breadcrumbs = React.useMemo(() => {
    if (!currentDir) return [];
    const sep = currentDir.includes("\\") ? "\\" : "/";
    const parts = currentDir.split(/[/\\]/).filter(Boolean);
    // Windows: 修复盘符后缺少分隔符 → "C:" → "C:\\"
    const segments: { label: string; path: string }[] = [];
    let acc = "";
    parts.forEach((p, i) => {
      const isWinDrive = p.includes(":") && i === 0;
      if (i === 0) {
        acc = isWinDrive ? p + sep : p;
      } else {
        acc = acc + sep + p;
      }
      segments.push({ label: p, path: acc });
    });
    return segments;
  }, [currentDir]);

  return {
    currentDir,
    entries,
    filteredEntries,
    loading,
    searchLoading,
    error,
    search,
    setSearch,
    favorites,
    breadcrumbs,
    navigateTo,
    navigateUp,
    setPath,
    toggleFavorite,
    isFavorited,
    // 异步读取文件内容（D5 预览）
    readFileContent: React.useCallback(async (filePath: string): Promise<string | null> => {
      try {
        const result = await invoke<{ ok: boolean; content: string; error?: string }>("read_file_text", { path: filePath });
        if (result.ok) return result.content;
        return null;
      } catch {
        return null;
      }
    }, []),
  };
}
