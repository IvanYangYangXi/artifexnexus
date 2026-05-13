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
  gatewayRunning?: boolean;
  /** WebSocket 是否已连接 */
  wsConnected?: boolean;
  /** WS 已连接但 Event Loop 退化（Gateway 繁忙） */
  wsDegraded?: boolean;
  /** DCC MCP Server 连接状态列表 */
  dccStatus?: { name: string; connected: boolean }[];
  onStartGateway?: () => void;
}

export function Topbar({
  onToggleSidebar, onTogglePanel, sidebarHidden, panelOpen,
  gatewayRunning, wsConnected, wsDegraded, dccStatus, onStartGateway,
}: TopbarProps) {
  const [showDropdown, setShowDropdown] = React.useState(false);
  // 超过 3 个时折叠为下拉
  const maxInline = 3;
  const inlineItems = dccStatus && dccStatus.length <= maxInline ? dccStatus : undefined;
  const hasOverflow = dccStatus && dccStatus.length > maxInline;
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
        <div className="relative hidden items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[11px] font-medium md:flex">
          {/* Gateway 进程状态 */}
          <span className={`flex h-1.5 w-1.5 rounded-full ${gatewayRunning ? "bg-emerald-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]" : "bg-muted-foreground/40"}`} />
          <span className="text-muted-foreground">GW</span>
          {/* WebSocket 连接状态 */}
          <span className="text-muted-foreground/50">·</span>
          <span className={`flex h-1.5 w-1.5 rounded-full ${wsDegraded ? "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)] animate-pulse" : wsConnected ? "bg-emerald-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]" : gatewayRunning ? "bg-amber-400 animate-pulse" : "bg-muted-foreground/40"}`} />
          <span className={wsDegraded ? "text-amber-400" : wsConnected ? "text-foreground/80" : gatewayRunning ? "text-amber-400" : "text-muted-foreground"}>
            WS
          </span>
          {/* 内联显示 DCC 状态（<=3 个） */}
          {inlineItems && inlineItems.map((d) => (
            <React.Fragment key={d.name}>
              <span className="text-muted-foreground/50">·</span>
              <span className={`flex h-1.5 w-1.5 rounded-full ${d.connected ? "bg-emerald-400" : "bg-amber-400"}`} />
              <span className={d.connected ? "text-foreground/80" : "text-muted-foreground"}>{d.name}</span>
            </React.Fragment>
          ))}
          {/* 折叠下拉（>3 个） */}
          {hasOverflow && (
            <>
              <span className="text-muted-foreground/50">·</span>
              <button className="text-muted-foreground hover:text-foreground" onClick={() => setShowDropdown(!showDropdown)}>
                {dccStatus!.filter(d => d.connected).length}/{dccStatus!.length} DCC ▾
              </button>
              {showDropdown && (
                <div className="absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-lg border border-white/[0.10] bg-card p-1.5 shadow-xl backdrop-blur-xl">
                  <div className="flex items-center gap-2 rounded px-2 py-1 text-[11px]">
                    <span className={`h-1.5 w-1.5 rounded-full ${gatewayRunning ? "bg-emerald-400" : "bg-muted-foreground/40"}`} />
                    <span className="text-foreground">Gateway</span>
                    <span className="flex-1 text-right text-muted-foreground">{gatewayRunning ? "运行中" : "未运行"}</span>
                  </div>
                  <div className="flex items-center gap-2 rounded px-2 py-1 text-[11px]">
                    <span className={`h-1.5 w-1.5 rounded-full ${wsDegraded ? "bg-amber-400" : wsConnected ? "bg-emerald-400" : gatewayRunning ? "bg-amber-400" : "bg-muted-foreground/40"}`} />
                    <span className="text-foreground">WebSocket</span>
                    <span className="flex-1 text-right text-muted-foreground">
                      {wsDegraded ? "繁忙" : wsConnected ? "已连接" : gatewayRunning ? "连接中…" : "未连接"}
                    </span>
                  </div>
                  {dccStatus!.map((d) => (
                    <div key={d.name} className="flex items-center gap-2 rounded px-2 py-1 text-[11px]">
                      <span className={`h-1.5 w-1.5 rounded-full ${d.connected ? "bg-emerald-400" : "bg-amber-400"}`} />
                      <span className={d.connected ? "text-foreground" : "text-muted-foreground"}>{d.name}</span>
                      <span className="flex-1 text-right text-muted-foreground">{d.connected ? "已连接" : "未连接"}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Gateway 启动按钮（仅未运行时显示） */}
        {!gatewayRunning && onStartGateway && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onStartGateway}>
            <Play className="mr-1 h-3 w-3" />启动
          </Button>
        )}

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
