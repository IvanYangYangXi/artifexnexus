"use client";

/**
 * Topbar — A 区顶栏（40px 全宽）
 *
 * 对齐 docs/specs/ui/web-chat-structure.md §2
 *   A1 菜单区（左）：Logo + 汉堡菜单（窄屏）
 *   A2 搜索区（中）：全局搜索框 + ⌘K 提示
 *   A3 控制区（右）：状态指示 + Gateway 启动按钮 + 面板开关 + 通知铃铛
 */

import * as React from "react";
import { Bell, Menu, Play, PanelRight, Search, Sparkles } from "lucide-react";

import { Button, Input, cn } from "@artifex-nexus/ui";

interface TopbarProps {
  onToggleSidebar: () => void;
  onTogglePanel: () => void;
  sidebarHidden: boolean;
  panelOpen: boolean;
}

export function Topbar({
  onToggleSidebar,
  onTogglePanel,
  sidebarHidden,
  panelOpen,
}: TopbarProps) {
  return (
    <header className="flex h-10 items-center gap-2 border-b border-white/[0.06] bg-white/[0.02] px-3 backdrop-blur-xl text-titlebar-foreground">
      {/* A1 菜单区 */}
      <div className="flex shrink-0 items-center gap-2">
        {sidebarHidden && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={onToggleSidebar}
            aria-label="打开侧边栏"
          >
            <Menu className="h-4 w-4" />
          </Button>
        )}
        <div className="flex items-center gap-1.5 px-1">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-[13px] font-semibold tracking-tight">
            Artifex Nexus
          </span>
        </div>
      </div>

      {/* A2 搜索区 — 居中，最大宽 480 */}
      <div className="mx-auto w-full max-w-[480px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="搜索 Skill / Tool / 文件 / 对话…"
            className="h-7 pl-8 pr-12 text-xs"
          />
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* A3 控制区 */}
      <div className="flex shrink-0 items-center gap-1.5">
        {/* 状态指示 */}
        <div className="hidden items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium md:flex">
          <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]" />
          <span className="text-muted-foreground">Gateway</span>
          <span className="text-muted-foreground/50">·</span>
          <span className="font-mono">2 DCC</span>
        </div>

        {/* Gateway 启动（占位：默认运行中所以隐藏，演示用 ghost button） */}
        <Button
          size="sm"
          variant="ghost"
          className="hidden h-7 px-2 text-xs lg:inline-flex"
          aria-label="启动 Gateway"
        >
          <Play className="mr-1 h-3 w-3" />
          启动
        </Button>

        {/* 面板开关 */}
        <Button
          size="icon"
          variant="ghost"
          className={cn(
            "h-7 w-7",
            panelOpen && "bg-accent text-accent-foreground",
          )}
          onClick={onTogglePanel}
          aria-label={panelOpen ? "隐藏右侧面板" : "显示右侧面板"}
        >
          <PanelRight className="h-4 w-4" />
        </Button>

        {/* 通知 */}
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label="通知"
        >
          <Bell className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
