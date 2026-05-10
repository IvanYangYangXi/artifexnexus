"use client";

/**
 * SystemPage — 系统模块（安装向导 + Gateway + 运行状态）
 *
 * 复刻 apps/desktop 的 InstallerWizard + GatewayStatusCard
 * STORY-0036: UI 结构 + mock 数据，STORY-0040 接入真实 API
 */

import * as React from "react";
import { Terminal, Server, Activity, Play, RotateCw, ExternalLink, ChevronDown, ChevronRight } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, Button } from "@artifex-nexus/ui";
import { ScrollFade } from "../chat/ScrollFade";

// ─── mock 数据（复刻 installer.fixtures.ts） ──────────────────────────────

type ItemState = "unavailable" | "pending" | "not-installed" | "installing" | "installed" | "update-available" | "failed";

interface InstallChild {
  label: string; version: string; installPath: string; projectPath: string; scriptPath: string; state: ItemState;
}

interface InstallItem {
  id: string; name: string; iconKey: string; state: ItemState; expandable: boolean; comingSoon?: boolean; children?: InstallChild[]; errorMessage?: string;
}

const FIXTURE_ITEMS: InstallItem[] = [
  { id: "openclaw", name: "OpenClaw", iconKey: "openclaw", state: "not-installed", expandable: false },
  { id: "web-ui", name: "Web UI", iconKey: "web-ui", state: "pending", expandable: false },
  { id: "blender", name: "Blender", iconKey: "blender", state: "pending", expandable: true, children: [] },
  { id: "unreal", name: "Unreal Engine", iconKey: "unreal", state: "pending", expandable: true, children: [
    { label: "UE 5.4 主项目", version: "5.4.2", installPath: "C:\\Program Files\\Epic Games\\UE_5.4", projectPath: "D:\\Proj\\MyGame", scriptPath: "<install>/plugins/unreal/init.py", state: "pending" },
  ]},
  { id: "max", name: "3ds Max", iconKey: "max", state: "pending", expandable: true, children: [
    { label: "3ds Max 2024", version: "2024.2", installPath: "C:\\Program Files\\Autodesk\\3ds Max 2024", projectPath: "", scriptPath: "<install>/plugins/max/init.ms", state: "pending" },
  ]},
  { id: "maya", name: "Maya", iconKey: "maya", state: "pending", expandable: true, children: [] },
  { id: "comfyui", name: "ComfyUI", iconKey: "comfyui", state: "unavailable", expandable: true, comingSoon: true, children: [] },
];

const STATE_LABELS: Record<ItemState, string> = {
  unavailable: "不可用", pending: "等待中", "not-installed": "未安装", installing: "安装中", installed: "已安装", "update-available": "可更新", failed: "失败",
};

const STATE_COLORS: Record<ItemState, string> = {
  unavailable: "bg-muted text-muted-foreground", pending: "bg-muted text-muted-foreground",
  "not-installed": "bg-muted text-muted-foreground", installing: "bg-sky-500/15 text-sky-400",
  installed: "bg-emerald-500/15 text-emerald-400", "update-available": "bg-amber-500/15 text-amber-400",
  failed: "bg-red-500/15 text-red-400",
};

const ICON_LABELS: Record<string, string> = {
  openclaw: "OC", "web-ui": "W", blender: "B", unreal: "U", max: "3", maya: "M", comfyui: "C",
};

// ─── 主组件 ────────────────────────────────────────────────────────────────

export function SystemPage() {
  const [tab, setTab] = React.useState("installer");

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-white/[0.06] bg-muted/30 px-3">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-7">
            <TabsTrigger value="installer" className="h-6 gap-1 text-xs"><Terminal className="h-3 w-3" />安装向导</TabsTrigger>
            <TabsTrigger value="gateway" className="h-6 gap-1 text-xs"><Server className="h-3 w-3" />Gateway</TabsTrigger>
            <TabsTrigger value="status" className="h-6 gap-1 text-xs"><Activity className="h-3 w-3" />运行状态</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {tab === "installer" && <InstallerTab />}
      {tab === "gateway" && <GatewayTab />}
      {tab === "status" && <StatusTab />}
    </div>
  );
}

// ─── 安装向导 Tab ──────────────────────────────────────────────────────────

function InstallerTab() {
  const [items, setItems] = React.useState(FIXTURE_ITEMS);
  const [logs, setLogs] = React.useState<{ time: string; level: string; message: string }[]>([]);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  const addLog = (level: string, message: string) => {
    setLogs((prev) => [...prev.slice(-199), { time: new Date().toLocaleTimeString("zh-CN", { hour12: false }), level, message }]);
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const handleDetect = (id: string) => {
    addLog("info", `正在检测 ${id}...`);
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, state: "installing" as ItemState } : it));
    setTimeout(() => {
      setItems((prev) => prev.map((it) => {
        if (it.id !== id) return it;
        if (it.id === "openclaw") return { ...it, state: "installed" };
        if (it.id === "comfyui") return { ...it, state: "unavailable" };
        return { ...it, state: Math.random() > 0.3 ? "installed" : "not-installed" };
      }));
      addLog("info", `${id} 检测完成`);
    }, 800);
  };

  const handleInstall = (id: string) => {
    addLog("info", `正在安装 ${id}...`);
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, state: "installing" } : it));
    setTimeout(() => {
      setItems((prev) => prev.map((it) => it.id === id ? { ...it, state: "installed" } : it));
      addLog("info", `${id} 安装完成`);
    }, 1500);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* 全局操作栏 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-4 py-2">
        <Button size="sm" className="h-7 gap-1 text-xs rounded-full" onClick={() => { addLog("info", "全局检测开始"); }}>
          <Play className="h-3 w-3" />全局检测
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs rounded-full">全局设置</Button>
        <div className="flex-1" />
        <Button variant="outline" size="sm" className="h-7 text-xs rounded-full">完成</Button>
      </div>

      {/* 安装清单 */}
      <ScrollFade className="flex-1">
        <div className="p-3 space-y-1">
          {items.map((item) => (
            <div key={item.id}>
              <div className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-white/[0.04]">
                {item.expandable && (
                  <button onClick={() => toggleExpand(item.id)} className="text-muted-foreground">
                    {expanded.has(item.id) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </button>
                )}
                {!item.expandable && <div className="w-3.5" />}
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-[10px] font-bold text-muted-foreground">
                  {ICON_LABELS[item.iconKey] || "?"}
                </span>
                <span className="flex-1 text-sm font-medium">{item.name}</span>
                {item.comingSoon && <span className="text-[10px] text-muted-foreground">即将推出</span>}
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATE_COLORS[item.state]}`}>
                  {STATE_LABELS[item.state]}
                </span>
                {item.state === "failed" && item.errorMessage && (
                  <span className="max-w-[120px] truncate text-[10px] text-red-400">{item.errorMessage}</span>
                )}
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" className="h-6 text-[10px] rounded-full" onClick={() => handleDetect(item.id)}>检测</Button>
                  {!item.expandable && (
                    <Button variant="outline" size="sm" className="h-6 text-[10px] rounded-full">设置</Button>
                  )}
                  {item.state === "not-installed" && (
                    <Button size="sm" className="h-6 text-[10px] rounded-full" onClick={() => handleInstall(item.id)}>安装</Button>
                  )}
                  {item.state === "installed" && (
                    <Button variant="outline" size="sm" className="h-6 text-[10px] rounded-full">重装</Button>
                  )}
                  {item.state === "failed" && (
                    <Button size="sm" className="h-6 text-[10px] rounded-full">重试</Button>
                  )}
                </div>
              </div>

              {/* 子项 */}
              {item.expandable && expanded.has(item.id) && item.children && (
                <div className="ml-10 space-y-1 border-l border-white/[0.06] pl-4">
                  {item.children.map((child, i) => (
                    <div key={i} className="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-white/[0.04]">
                      <span className="flex-1">{child.label}</span>
                      <span className="text-[10px] text-muted-foreground">{child.version}</span>
                      <span className={`rounded px-1 py-0 text-[9px] font-medium ${STATE_COLORS[child.state]}`}>{STATE_LABELS[child.state]}</span>
                      <Button variant="outline" size="sm" className="h-5 text-[9px] rounded-full">检测</Button>
                      <Button variant="outline" size="sm" className="h-5 text-[9px] rounded-full">设置</Button>
                      <Button size="sm" className="h-5 text-[9px] rounded-full">安装</Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollFade>

      {/* 日志面板 */}
      <div className="shrink-0 border-t border-white/[0.06]">
        <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] text-muted-foreground">
          <span>日志</span>
          <span className="flex-1" />
          <button onClick={() => setLogs([])}>清空</button>
        </div>
        <div className="max-h-[120px] overflow-y-auto border-t border-white/[0.04] px-3 py-1 text-[10px] font-mono">
          {logs.length === 0 && <span className="text-muted-foreground">暂无日志</span>}
          {logs.map((l, i) => (
            <div key={i} className={l.level === "error" ? "text-red-400" : l.level === "warn" ? "text-amber-400" : "text-muted-foreground"}>
              {l.time} {l.message}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Gateway Tab ────────────────────────────────────────────────────────────

function GatewayTab() {
  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
      {/* 状态卡片 */}
      <div className="rounded-[16px] border border-white/[0.08] bg-white/[0.04] p-4 backdrop-blur-xl shadow-[0_8px_32px_-12px_rgba(0,0,0,0.55)]">
        <div className="flex items-center gap-3">
          <span className="flex h-3 w-3 rounded-full bg-muted-foreground/40" />
          <span className="text-sm font-medium">未运行</span>
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          PID: — · 端口: 19789 · 启动时间: —
        </div>
        <div className="mt-3 flex gap-2">
          <button className="rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground shadow-[0_4px_16px_-4px_hsl(var(--primary)/0.5)]">
            ▶ 启动 Gateway
          </button>
          <button className="rounded-full border border-white/[0.10] bg-white/[0.05] px-4 py-1.5 text-xs backdrop-blur-md" disabled>
            🌐 OpenClaw Web UI
          </button>
        </div>
      </div>

      {/* 日志面板 */}
      <div className="flex-1 rounded-[16px] border border-white/[0.08] bg-white/[0.04] p-4 backdrop-blur-xl">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Gateway 日志</span>
          <span className="flex-1" />
          <button className="text-[10px]">清屏</button>
        </div>
        <div className="mt-2 font-mono text-[10px] text-muted-foreground">
          <div>18:30:01 INFO Gateway started</div>
          <div>18:30:02 INFO Plugin loaded: mcp-bridge</div>
          <div className="text-muted-foreground/50">— STORY-0040 接入真实日志流 —</div>
        </div>
      </div>
    </div>
  );
}

// ─── 运行状态 Tab ───────────────────────────────────────────────────────────

function StatusTab() {
  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
      <div className="rounded-[16px] border border-white/[0.08] bg-white/[0.04] p-4 backdrop-blur-xl">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />Sidecar 运行中
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
          <div>端口: 19789</div>
          <div>HOME: ~/.artifexnexus/.openclaw/</div>
          <div>版本: v2026.5.4</div>
        </div>
      </div>

      <div className="rounded-[16px] border border-white/[0.08] bg-white/[0.04] p-4 backdrop-blur-xl">
        <div className="text-sm font-medium">DCC 连接</div>
        <div className="mt-2 space-y-1.5 text-xs">
          {[
            { name: "Blender 5.1", addr: "ws://127.0.0.1:18083", connected: true },
            { name: "Maya 2026", addr: "—", connected: false },
            { name: "Unreal 5.5", addr: "—", connected: false },
          ].map((d) => (
            <div key={d.name} className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${d.connected ? "bg-emerald-400" : "bg-muted-foreground/40"}`} />
              <span>{d.name}</span>
              <span className="text-muted-foreground">{d.addr}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-[16px] border border-white/[0.08] bg-white/[0.04] p-4 backdrop-blur-xl">
        <div className="text-sm font-medium">部署校验</div>
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          <div>✅ blender-addon-5.1 — 全部 12 个文件校验通过</div>
          <div>✅ gateway-mcp-bridge — 全部 4 个文件校验通过</div>
        </div>
      </div>
    </div>
  );
}
