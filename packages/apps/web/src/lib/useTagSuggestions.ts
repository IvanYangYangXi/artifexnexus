"use client";

/**
 * useGlobalTagSuggestions — 全局标签推荐（module-level 缓存，全 App 只请求一次）
 *
 * 用法：
 *   const skillTags = useGlobalTagSuggestions("skill");
 *   const toolTags  = useGlobalTagSuggestions("nexus_tool");
 *
 * 首次调用发起 list 请求，后续调用直接返回缓存。
 * 降级：请求失败时静默返回空数组。
 *
 * 直接使用 invoke 绕过下一级模块 import，避免 Turbopack 动态 import 解析失败。
 */

import * as React from "react";
import { invoke } from "@tauri-apps/api/core";

// ── module-level cache ────────────────────────────────────────────────────────
type Kind = "skill" | "nexus_tool";

interface TagItem { tags?: string[] }

let _skillCache: string[] | null = null;
let _skillPromise: Promise<string[]> | null = null;

let _toolCache: string[] | null = null;
let _toolPromise: Promise<string[]> | null = null;

async function fetchSkillTags(): Promise<string[]> {
  try {
    const result = await invoke<{ items: TagItem[] }>("skill_list", {
      params: { page: 1, limit: 500 },
    });
    const set = new Set<string>();
    for (const item of result.items) {
      (item.tags || []).forEach((t) => { if (t.trim()) set.add(t.trim()); });
    }
    return Array.from(set).sort();
  } catch {
    return [];
  }
}

async function fetchToolTags(): Promise<string[]> {
  try {
    const result = await invoke<{ items: TagItem[] }>("nexus_tool_list", {
      params: { page: 1, limit: 500 },
    });
    const set = new Set<string>();
    for (const item of result.items) {
      (item.tags || []).forEach((t) => { if (t.trim()) set.add(t.trim()); });
    }
    return Array.from(set).sort();
  } catch {
    return [];
  }
}

// ── hook ──────────────────────────────────────────────────────────────────────
export function useGlobalTagSuggestions(kind: Kind): string[] {
  const [tags, setTags] = React.useState<string[]>(() => {
    if (kind === "skill") return _skillCache ?? [];
    return _toolCache ?? [];
  });

  React.useEffect(() => {
    if (kind === "skill") {
      if (_skillCache) { setTags(_skillCache); return; }
      if (!_skillPromise) {
        _skillPromise = fetchSkillTags().then((arr) => { _skillCache = arr; return arr; });
      }
      let cancelled = false;
      _skillPromise.then((arr) => { if (!cancelled) setTags(arr); });
      return () => { cancelled = true; };
    } else {
      if (_toolCache) { setTags(_toolCache); return; }
      if (!_toolPromise) {
        _toolPromise = fetchToolTags().then((arr) => { _toolCache = arr; return arr; });
      }
      let cancelled = false;
      _toolPromise.then((arr) => { if (!cancelled) setTags(arr); });
      return () => { cancelled = true; };
    }
  }, [kind]);

  return tags;
}
