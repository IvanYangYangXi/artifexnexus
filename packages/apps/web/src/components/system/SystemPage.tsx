"use client";

/**
 * SystemPage — 系统模块（安装向导 + Gateway + 运行状态）
 *
 * 完全复刻 apps/desktop/src/routes/InstallerWizard.tsx 的功能
 * 在 Tauri 环境中通过 window.__TAURI__.invoke 调用真实 IPC
 */

import * as React from "react";
import { Terminal, Server, Activity, Play, RotateCw, ExternalLink, ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, Button } from "@artifex-nexus/ui";
import { ScrollFade } from "../chat/ScrollFade";

// ─── 类型（复刻 installer.types.ts） ────────────────────────────────────────

type ItemState = "unavailable" | "pending" | "not-installed" | "installing" | "installed" | "update-available" | "failed";

interface InstallChild { label: string; version: string; installPath: string; projectPath: string; scriptPath: string; state: ItemState; }
interface InstallItem { id: string; name: string; iconKey: string; state: ItemState; expandable: boolean; comingSoon?: boolean; children?: InstallChild[]; errorMessage?: string; }
interface LogEntry { time: string; itemId: string; level: "info" | "warn" | "error"; message: string; }

const FIXTURE_ITEMS: InstallItem[] = [
  { id: "openclaw", name: "OpenClaw", iconKey: "openclaw", state: "not-installed", expandable: false },
  { id: "web-ui", name: "Web UI", iconKey: "web-ui", state: "pending", expandable: false },
  { id: "blender", name: "Blender", iconKey: "blender", state: "pending", expandable: true, children: [] },
  { id: "unreal", name: "Unreal Engine", iconKey: "unreal", state: "pending", expandable: true, children: [{ label: "UE 5.4 主项目", version: "5.4.2", installPath: "C:\\Program Files\\Epic Games\\UE_5.4", projectPath: "D:\\Proj\\MyGame", scriptPath: "<install>/plugins/unreal/init.py", state: "pending" }] },
  { id: "max", name: "3ds Max", iconKey: "max", state: "pending", expandable: true, children: [{ label: "3ds Max 2024", version: "2024.2", installPath: "C:\\Program Files\\Autodesk\\3ds Max 2024", projectPath: "", scriptPath: "<install>/plugins/max/init.ms", state: "pending" }] },
  { id: "maya", name: "Maya", iconKey: "maya", state: "pending", expandable: true, children: [] },
  { id: "comfyui", name: "ComfyUI", iconKey: "comfyui", state: "unavailable", expandable: true, comingSoon: true, children: [] },
];

const STATE_LABELS: Record<ItemState, string> = { unavailable: "不可用", pending: "等待中", "not-installed": "未安装", installing: "安装中", installed: "已安装", "update-available": "可更新", failed: "失败" };
const STATE_COLORS: Record<ItemState, string> = { unavailable: "bg-muted text-muted-foreground", pending: "bg-muted text-muted-foreground", "not-installed": "bg-muted text-muted-foreground", installing: "bg-sky-500/15 text-sky-400", installed: "bg-emerald-500/15 text-emerald-400", "update-available": "bg-amber-500/15 text-amber-400", failed: "bg-red-500/15 text-red-400" };
const ICON_LABELS: Record<string, string> = { openclaw: "OC", "web-ui": "W", blender: "B", unreal: "U", max: "3", maya: "M", comfyui: "C" };

// ─── Tauri IPC 桥接 ─────────────────────────────────────────────────────────

function getTauri() { return (window as any).__TAURI__; }
async function tauriInvoke(cmd: string, args?: any) {
  const t = getTauri();
  if (t?.invoke) return t.invoke(cmd, args ?? {});
  throw new Error("非 Tauri 环境");
}

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

// ─── 安装向导 Tab（完全复刻 InstallerWizard） ──────────────────────────────

function InstallerTab() {
  const [items, setItems] = React.useState<InstallItem[]>(FIXTURE_ITEMS);
  const [logs, setLogs] = React.useState<LogEntry[]>([]);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [gatewayRunning, setGatewayRunning] = React.useState(false);
  const [webUiAvailable, setWebUiAvailable] = React.useState(false);

  const addLog = (itemId: string, level: LogEntry["level"], message: string) => {
    setLogs((prev) => [...prev.slice(-199), { time: new Date().toLocaleTimeString("zh-CN", { hour12: false }), itemId, level, message }]);
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const isOpenClawInstalled = items.some((it) => it.id === "openclaw" && it.state === "installed");
  const isGated = (item: InstallItem) => item.id !== "openclaw" && !isOpenClawInstalled;

  // 页面初始化自动检测
  React.useEffect(() => { handleGlobalDetect(); }, []);

  const handleGlobalDetect = () => {
    // OpenClaw 真实状态
    void (async () => {
      try {
        const status = await tauriInvoke("openclaw_status");
        let s: ItemState;
        if (status.gateway_running) s = "installed";
        else if (status.cli_installed) s = status.version_mismatch ? "update-available" : "installed";
        else s = "not-installed";
        setItems((prev) => prev.map((it) => it.id === "openclaw" ? { ...it, state: s } : it));
        setGatewayRunning(status.gateway_running);
        setWebUiAvailable(status.web_ui_available);
        addLog("openclaw", "info", `OpenClaw 状态: ${s === "installed" ? "已安装" : s === "update-available" ? "可更新" : "未安装"}`);
        // 部署校验
        try { const v = await tauriInvoke("openclaw_deploy_validate"); const sum = v.summary; if (sum.total === 0) addLog("openclaw", "info", "部署文件校验: 暂无部署记录"); else { const p: string[] = []; if (sum.ok > 0) p.push(`✅ ${sum.ok} 正常`); if (sum.outdated > 0) p.push(`🔄 ${sum.outdated} 可更新`); if (sum.corrupted > 0) p.push(`⚠️ ${sum.corrupted} 损坏`); if (sum.missing > 0) p.push(`❌ ${sum.missing} 缺失`); addLog("openclaw", "info", `部署文件校验: ${p.join(" · ")}`); } } catch {}
      } catch { setItems((prev) => prev.map((it) => it.id === "openclaw" ? { ...it, state: "not-installed" } : it)); }
    })();
    // DCC 检测
    for (const item of items) {
      if (item.id === "blender") {
        void (async () => {
          try {
            addLog(item.id, "info", `正在检测本机 ${item.name} 版本…`);
            const result = await tauriInvoke("openclaw_dcc_blender_detect");
            const children = result.versions.map((v: any) => ({ label: `${item.name} ${v.version}`, version: v.version, installPath: `%APPDATA%/Blender Foundation/Blender/${v.version}/scripts/addons`, projectPath: "", scriptPath: `artifex_nexus_v${result.addon_info.version}`, state: v.installed ? "installed" as const : "not-installed" as const }));
            const hasInstalled = children.some((c: InstallChild) => c.state === "installed");
            setItems((prev) => prev.map((it) => it.id === item.id ? { ...it, children, state: hasInstalled ? "installed" : "not-installed" } : it));
            addLog(item.id, "info", `检测到 ${result.versions.length} 个版本（已装: ${children.filter((c: InstallChild) => c.state === "installed").length}）`);
          } catch { addLog(item.id, "warn", "检测失败（sidecar 不可用）"); }
        })();
      } else if (item.id !== "openclaw" && item.id !== "comfyui" && item.id !== "web-ui") {
        setItems((prev) => prev.map((it) => it.id === item.id ? { ...it, state: Math.random() > 0.3 ? "installed" : "not-installed" } : it));
      }
    }
  };

  const handleInstall = (id: string) => {
    if (id === "openclaw") {
      setItems((prev) => prev.map((it) => it.id === id ? { ...it, state: "installing" } : it));
      addLog(id, "info", "开始安装 OpenClaw...");
      void (async () => {
        try {
          const r = await tauriInvoke("openclaw_install", { version: "v2026.5.4" });
          if (!r.success) { addLog(id, "error", r.error_message || "安装失败"); setItems((prev) => prev.map((it) => it.id === id ? { ...it, state: "failed", errorMessage: r.error_message } : it)); return; }
          addLog(id, "info", "安装完成，初始化配置...");
          const b = await tauriInvoke("openclaw_bootstrap", { version: "v2026.5.4" });
          if (!b.success) { addLog(id, "error", "初始化失败"); setItems((prev) => prev.map((it) => it.id === id ? { ...it, state: "failed" } : it)); return; }
          addLog(id, "info", "启动 Gateway...");
          const s = await tauriInvoke("openclaw_start", { port: b.port });
          if (!s.success) { addLog(id, "error", s.message || "启动失败"); setItems((prev) => prev.map((it) => it.id === id ? { ...it, state: "failed" } : it)); return; }
          addLog(id, "info", "Gateway 启动成功");
          setItems((prev) => prev.map((it) => {
            if (it.id === id) return { ...it, state: "installed" };
            if (it.state === "pending") return { ...it, state: "not-installed" };
            return it;
          }));
          setGatewayRunning(true);
        } catch (e: any) { addLog(id, "error", e.message || String(e)); setItems((prev) => prev.map((it) => it.id === id ? { ...it, state: "failed", errorMessage: e.message } : it)); }
      })();
      return;
    }
    // DCC 安装
    if (id === "blender") {
      setItems((prev) => prev.map((it) => it.id === id ? { ...it, state: "installing" } : it));
      addLog(id, "info", "正在安装 Blender 插件...");
      void (async () => {
        try {
          // 先装 mcp-bridge
          const bs = await tauriInvoke("openclaw_gateway_mcp_bridge_status");
          if (!bs.installed) { addLog(id, "info", "部署 MCP Bridge 插件..."); await tauriInvoke("openclaw_gateway_mcp_bridge_install"); }
          const r = await tauriInvoke("openclaw_dcc_blender_install", { version: "5.1", force: false });
          if (r.success) { addLog(id, "info", "Blender 插件安装完成"); setItems((prev) => prev.map((it) => it.id === id ? { ...it, state: "installed" } : it)); }
          else { addLog(id, "error", r.error || "安装失败"); setItems((prev) => prev.map((it) => it.id === id ? { ...it, state: "failed", errorMessage: r.error } : it)); }
        } catch (e: any) { addLog(id, "error", e.message); setItems((prev) => prev.map((it) => it.id === id ? { ...it, state: "failed" } : it)); }
      })();
      return;
    }
    // 其他 mock
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, state: "installing" } : it));
    addLog(id, "info", `正在安装 ${id}...`);
    setTimeout(() => { setItems((prev) => prev.map((it) => it.id === id ? { ...it, state: "installed" } : it)); addLog(id, "info", `${id} 安装完成`); }, 1500);
  };

  const handleDetect = (id: string) => { handleGlobalDetect(); };

  const handleOpenWebUi = async () => {
    try { const r = await tauriInvoke("openclaw_web_get_url"); if (r.available && r.url) window.open(r.url, "_blank"); else addLog("openclaw", "warn", r.reason || "Web UI 不可用"); } catch (e: any) { addLog("openclaw", "error", e.message); }
  };

  const handleAddChild = (parentId: string) => {
    const version = window.prompt("版本号（如 5.1）：");
    if (!version?.trim()) return;
    const label = `${parentId === "blender" ? "Blender" : parentId === "unreal" ? "Unreal" : parentId} ${version.trim()}`;
    setItems((prev) => prev.map((it) => it.id === parentId ? { ...it, children: [...(it.children || []), { label, version: version.trim(), installPath: "", projectPath: "", scriptPath: "", state: "not-installed" as const }] } : it));
  };

  const handleDeleteChild = (parentId: string, childIndex: number) => {
    setItems((prev) => prev.map((it) => it.id === parentId ? { ...it, children: (it.children || []).filter((_, i) => i !== childIndex) } : it));
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-4 py-2">
        <Button size="sm" className="h-7 gap-1 text-xs rounded-full" onClick={handleGlobalDetect}><Play className="h-3 w-3" />全局检测</Button>
        <div className="flex-1" />
        <Button variant="outline" size="sm" className="h-7 text-xs rounded-full">完成</Button>
      </div>
      <ScrollFade className="flex-1">
        <div className="p-3 space-y-1">
          {items.map((item) => (
            <div key={item.id}>
              <div className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-white/[0.04]">
                {item.expandable && <button onClick={() => toggleExpand(item.id)} className="text-muted-foreground">{expanded.has(item.id) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</button>}
                {!item.expandable && <div className="w-3.5" />}
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-[10px] font-bold text-muted-foreground">{ICON_LABELS[item.iconKey]}</span>
                <span className="flex-1 text-sm font-medium">{item.name}</span>
                {item.comingSoon && <span className="text-[10px] text-muted-foreground">即将推出</span>}
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATE_COLORS[item.state]}`}>{STATE_LABELS[item.state]}</span>
                {item.state === "failed" && item.errorMessage && <span className="max-w-[120px] truncate text-[10px] text-red-400">{item.errorMessage}</span>}
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" className="h-6 text-[10px] rounded-full" onClick={() => handleDetect(item.id)}>检测</Button>
                  {item.id === "openclaw" && <Button variant="outline" size="sm" className="h-6 text-[10px] rounded-full">设置</Button>}
                  {item.id === "openclaw" && gatewayRunning && <Button variant="outline" size="sm" className="h-6 text-[10px] rounded-full" onClick={handleOpenWebUi}>🌐 Web UI</Button>}
                  {item.state === "not-installed" && <Button size="sm" className="h-6 text-[10px] rounded-full" onClick={() => handleInstall(item.id)} disabled={isGated(item)}>安装</Button>}
                  {item.state === "installed" && <Button variant="outline" size="sm" className="h-6 text-[10px] rounded-full" onClick={() => handleInstall(item.id)}>重装</Button>}
                  {item.state === "failed" && <Button size="sm" className="h-6 text-[10px] rounded-full" onClick={() => handleInstall(item.id)}>重试</Button>}
                  {item.expandable && <Button variant="outline" size="sm" className="h-6 text-[10px] rounded-full" onClick={() => handleAddChild(item.id)}><Plus className="h-3 w-3" /></Button>}
                </div>
              </div>
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
                      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleDeleteChild(item.id, i)}><Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" /></Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollFade>
      <div className="shrink-0 border-t border-white/[0.06]">
        <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] text-muted-foreground"><span>日志</span><span className="flex-1" /><button onClick={() => setLogs([])}>清空</button></div>
        <div className="max-h-[120px] overflow-y-auto border-t border-white/[0.04] px-3 py-1 text-[10px] font-mono">
          {logs.length === 0 && <span className="text-muted-foreground">暂无日志</span>}
          {logs.map((l, i) => <div key={i} className={l.level === "error" ? "text-red-400" : l.level === "warn" ? "text-amber-400" : "text-muted-foreground"}>{l.time} {l.message}</div>)}
        </div>
      </div>
    </div>
  );
}

// ─── Gateway Tab ────────────────────────────────────────────────────────────

function GatewayTab() {
  const [state, setState] = React.useState<"running" | "stopped" | "errored">("stopped");
  const [pid, setPid] = React.useState<number | null>(null);
  const [port, setPort] = React.useState(19789);
  const [startedAt, setStartedAt] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    void (async () => {
      try { const s = await tauriInvoke("openclaw_status"); setState(s.gateway_running ? "running" : "stopped"); setPid(s.pid); setPort(s.port); } catch {}
    })();
  }, []);

  const handleStart = async () => {
    setBusy(true);
    try {
      if (state === "running") await tauriInvoke("openclaw_gateway_restart");
      else await tauriInvoke("openclaw_gateway_start");
      const s = await tauriInvoke("openclaw_status");
      setState(s.gateway_running ? "running" : "stopped");
      setPid(s.pid);
      setPort(s.port);
      setStartedAt(new Date().toLocaleString("zh-CN"));
    } catch { setState("errored"); }
    setBusy(false);
  };

  const dotClass = state === "running" ? "bg-emerald-400" : state === "errored" ? "bg-red-400" : "bg-muted-foreground/40";
  const stateLabel = state === "running" ? "运行中" : state === "errored" ? "异常" : "未运行";

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
      <div className="rounded-[16px] border border-white/[0.08] bg-white/[0.04] p-4 backdrop-blur-xl shadow-[0_8px_32px_-12px_rgba(0,0,0,0.55)]">
        <div className="flex items-center gap-3"><span className={`flex h-3 w-3 rounded-full ${dotClass}`} /><span className="text-sm font-medium">{stateLabel}</span></div>
        <div className="mt-2 text-xs text-muted-foreground">PID: {pid ?? "—"} · 端口: {port} · 启动: {startedAt ?? "—"}</div>
        <div className="mt-3 flex gap-2">
          <button className="rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground shadow-[0_4px_16px_-4px_hsl(var(--primary)/0.5)]" onClick={handleStart} disabled={busy}>{state === "running" ? "↻ 重启 Gateway" : "▶ 启动 Gateway"}</button>
          <button className="rounded-full border border-white/[0.10] bg-white/[0.05] px-4 py-1.5 text-xs backdrop-blur-md" disabled={state !== "running"} onClick={() => window.open(`http://127.0.0.1:${port}`, "_blank")}>🌐 OpenClaw Web UI</button>
        </div>
      </div>
      <div className="flex-1 rounded-[16px] border border-white/[0.08] bg-white/[0.04] p-4 backdrop-blur-xl">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><span>Gateway 日志</span><span className="flex-1" /></div>
        <div className="mt-2 font-mono text-[10px] text-muted-foreground"><div>— 日志流 STORY-0040 接入 —</div></div>
      </div>
    </div>
  );
}

// ─── 运行状态 Tab ───────────────────────────────────────────────────────────

function StatusTab() {
  const [deploySummary, setDeploySummary] = React.useState<any>(null);
  React.useEffect(() => { void (async () => { try { const v = await tauriInvoke("openclaw_deploy_validate"); setDeploySummary(v); } catch {} })(); }, []);
  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
      <div className="rounded-[16px] border border-white/[0.08] bg-white/[0.04] p-4 backdrop-blur-xl">
        <div className="flex items-center gap-2 text-sm font-medium"><span className="h-2 w-2 rounded-full bg-emerald-400" />Sidecar 运行中</div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground"><div>端口: 19789</div><div>HOME: ~/.artifexnexus/.openclaw/</div><div>版本: v2026.5.4</div></div>
      </div>
      <div className="rounded-[16px] border border-white/[0.08] bg-white/[0.04] p-4 backdrop-blur-xl">
        <div className="text-sm font-medium">DCC 连接</div>
        <div className="mt-2 space-y-1.5 text-xs">
          {[{ name: "Blender 5.1", addr: "ws://127.0.0.1:18083", ok: true }, { name: "Maya 2026", addr: "—", ok: false }].map((d) => (
            <div key={d.name} className="flex items-center gap-2"><span className={`h-1.5 w-1.5 rounded-full ${d.ok ? "bg-emerald-400" : "bg-muted-foreground/40"}`} /><span>{d.name}</span><span className="text-muted-foreground">{d.addr}</span></div>
          ))}
        </div>
      </div>
      <div className="rounded-[16px] border border-white/[0.08] bg-white/[0.04] p-4 backdrop-blur-xl">
        <div className="text-sm font-medium">部署校验</div>
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          {deploySummary ? deploySummary.deployments?.map((d: any) => <div key={d.id}>{d.status === "ok" ? "✅" : "⚠️"} {d.id} — {d.details}</div>) : <div>加载中...</div>}
        </div>
      </div>
    </div>
  );
}
