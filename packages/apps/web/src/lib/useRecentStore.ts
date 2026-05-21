/**
 * useRecentStore — 最近使用记录（localStorage 持久化）
 *
 * 记录两类操作：
 *   - pin: 钉选 Skill（D2 面板点击 Pin 图标时）
 *   - run:  运行 Tool（D3 Play 按钮 / RunPanel 运行成功时）
 *
 * 上限 50 条，按时间倒序排列。跨组件共享（模块级单例 + subscribe 模式）。
 */

"use client";

import * as React from "react";

// ── Types ──────────────────────────────────────────────────────────────────

interface RecentSkill {
  type: "pin";
  name: string;
  displayName: string;
  timestamp: number;
}

interface RecentTool {
  type: "run";
  id: string;
  name: string;
  timestamp: number;
}

export type RecentItem = RecentSkill | RecentTool;

// ── Store ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = "artifex.shell.recentItems";
const MAX_ITEMS = 50;

class RecentStore {
  private items: RecentItem[] = [];
  private listeners = new Set<() => void>();

  constructor() {
    this.load();
  }

  getItems(): RecentItem[] {
    return this.items;
  }

  addSkill(name: string, displayName: string) {
    // 去重：移除同名 skill 的记录
    this.items = this.items.filter(
      (item) => !(item.type === "pin" && item.name === name)
    );
    this.items.unshift({
      type: "pin",
      name,
      displayName,
      timestamp: Date.now(),
    });
    this.trim();
    this.save();
    this.notify();
  }

  addTool(id: string, name: string) {
    // 去重：移除同 id 的 tool 记录
    this.items = this.items.filter(
      (item) => !(item.type === "run" && item.id === id)
    );
    this.items.unshift({
      type: "run",
      id,
      name,
      timestamp: Date.now(),
    });
    this.trim();
    this.save();
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private trim() {
    if (this.items.length > MAX_ITEMS) {
      this.items = this.items.slice(0, MAX_ITEMS);
    }
  }

  private load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.items = parsed.slice(0, MAX_ITEMS);
        }
      }
    } catch {
      this.items = [];
    }
  }

  private save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items));
    } catch {
      // localStorage 满了或不可用，静默忽略
    }
  }

  private notify() {
    this.listeners.forEach((fn) => fn());
  }
}

// 模块级单例
const store = new RecentStore();

// 命令式 API（供 RunPanel 等非 React context 组件使用）
export function addRecentSkill(name: string, displayName: string) {
  store.addSkill(name, displayName);
}

export function addRecentTool(id: string, name: string) {
  store.addTool(id, name);
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useRecentStore() {
  const [items, setItems] = React.useState<RecentItem[]>(() => store.getItems());

  React.useEffect(() => {
    const unsub = store.subscribe(() => setItems([...store.getItems()]));
    return unsub;
  }, []);

  return {
    recentItems: items,
    addRecentSkill: (name: string, displayName: string) => store.addSkill(name, displayName),
    addRecentTool: (id: string, name: string) => store.addTool(id, name),
  };
}
