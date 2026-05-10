"use client";

/**
 * SystemPage — 系统模块（安装向导 + Gateway + 运行状态）
 *
 * STORY-0036: mock 占位，STORY-0038 Desktop 内嵌时接入真实逻辑
 */

import * as React from "react";
import { Terminal, Server, Activity } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@artifex-nexus/ui";

export function SystemPage() {
  const [tab, setTab] = React.useState("installer");

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-7">
            <TabsTrigger value="installer" className="h-6 gap-1 text-xs">
              <Terminal className="h-3 w-3" />安装向导
            </TabsTrigger>
            <TabsTrigger value="gateway" className="h-6 gap-1 text-xs">
              <Server className="h-3 w-3" />Gateway
            </TabsTrigger>
            <TabsTrigger value="status" className="h-6 gap-1 text-xs">
              <Activity className="h-3 w-3" />运行状态
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {tab === "installer" && <InstallerTab />}
      {tab === "gateway" && <GatewayTab />}
      {tab === "status" && <StatusTab />}
    </div>
  );
}

function InstallerTab() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-md text-center">
        <Terminal className="mx-auto mb-4 h-12 w-12 text-primary" />
        <h2 className="text-xl font-semibold">安装向导</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          STORY-0038 接入 Desktop 真实安装向导逻辑
        </p>
        <p className="mt-4 text-[11px] text-muted-foreground/70">
          当前为占位页面。安装清单、日志面板、检测/安装/卸载功能将在 Desktop 内嵌时接入。
        </p>
      </div>
    </div>
  );
}

function GatewayTab() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden p-4">
      {/* 状态卡片 */}
      <div className="rounded-[16px] border border-white/[0.08] bg-white/[0.04] p-4 backdrop-blur-xl shadow-[0_8px_32px_-12px_rgba(0,0,0,0.55)]">
        <div className="flex items-center gap-3">
          <span className="flex h-3 w-3 rounded-full bg-muted-foreground/40" />
          <span className="text-sm font-medium">Gateway 未运行</span>
          <span className="text-[10px] text-muted-foreground">端口: 19789</span>
        </div>
        <div className="mt-3 flex gap-2">
          <button className="rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground shadow-[0_4px_16px_-4px_hsl(var(--primary)/0.5)]">
            ▶ 启动
          </button>
          <button className="rounded-full border border-white/[0.10] bg-white/[0.05] px-4 py-1.5 text-xs backdrop-blur-md">
            🌐 OpenClaw Web UI
          </button>
        </div>
      </div>

      {/* 日志面板占位 */}
      <div className="mt-3 flex-1 rounded-[16px] border border-white/[0.08] bg-white/[0.04] p-4 backdrop-blur-xl">
        <div className="text-xs text-muted-foreground">Gateway 日志 — STORY-0038 接入</div>
      </div>
    </div>
  );
}

function StatusTab() {
  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
      {/* Sidecar 状态 */}
      <div className="rounded-[16px] border border-white/[0.08] bg-white/[0.04] p-4 backdrop-blur-xl">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          Sidecar 运行中
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          端口: 19789 · HOME: ~/.artifexnexus/.openclaw/
        </div>
      </div>

      {/* DCC 连接 */}
      <div className="rounded-[16px] border border-white/[0.08] bg-white/[0.04] p-4 backdrop-blur-xl">
        <div className="text-sm font-medium">DCC 连接</div>
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Blender 5.1 · ws://127.0.0.1:18083
          </div>
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
            Maya 2026 · 未连接
          </div>
        </div>
      </div>

      {/* 部署校验 */}
      <div className="rounded-[16px] border border-white/[0.08] bg-white/[0.04] p-4 backdrop-blur-xl">
        <div className="text-sm font-medium">部署校验</div>
        <div className="mt-2 text-xs text-muted-foreground">
          STORY-0038 接入 openclaw.deploy.validate
        </div>
      </div>
    </div>
  );
}
