"use client";

/**
 * SystemPage — 系统模块（安装向导 + Gateway + 运行状态）
 *
 * 完全复刻 apps/desktop/src/routes/InstallerWizard.tsx
 * IPC 通过 src/lib/tauriIpc.ts 桥接
 */

import * as React from "react";
import { Terminal, Server, Activity, Play, ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, Button } from "@artifex-nexus/ui";
import { ScrollFade } from "../chat/ScrollFade";
import { getIpc } from "../../lib/ipc";
import type { OpenClawStatus, GatewayStatus, DeployValidationResult } from "../../ipc/openclaw";

// ─── 类型 ───────────────────────────────────────────────────────────────────

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
  const [items, setItems] = React.useState<InstallItem[]>(FIXTURE_ITEMS);
  const [logs, setLogs] = React.useState<LogEntry[]>([]);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [openclawStatus, setOpenclawStatus] = React.useState<OpenClawStatus | null>(null);

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

  const handleGlobalDetect = async () => {
    const ipc = await getIpc();
    // OpenClaw 状态
    try {
      const status = await ipc.getOpenClawStatus();
      setOpenclawStatus(status);
      let s: ItemState;
      if (status.gateway_running) s = "installed";
      else if (status.cli_installed) s = status.version_mismatch ? "update-available" : "installed";
      else s = "not-installed";
      setItems((prev) => prev.map((it) => it.id === "openclaw" ? { ...it, state: s } : it));
      addLog("openclaw", "info", `OpenClaw 状态: ${s === "installed" ? "已安装" : s === "update-available" ? "可更新" : "未安装"}`);
      try {
        const v = await ipc.validateDeployments();
        const sum = v.summary;
        if (sum.total === 0) addLog("openclaw", "info", "部署文件校验: 暂无部署记录");
        else {
          const p: string[] = [];
          if (sum.ok > 0) p.push(`✅ ${sum.ok} 正常`);
          if (sum.outdated > 0) p.push(`🔄 ${sum.outdated} 可更新`);
          if (sum.corrupted > 0) p.push(`⚠️ ${sum.corrupted} 损坏`);
          if (sum.missing > 0) p.push(`❌ ${sum.missing} 缺失`);
          addLog("openclaw", "info", `部署文件校验: ${p.join(" · ")}`);
        }
      } catch { addLog("openclaw", "warn", "部署校验失败"); }
    } catch {
      setItems((prev) => prev.map((it) => it.id === "openclaw" ? { ...it, state: "not-installed" } : it));
      addLog("openclaw", "warn", "OpenClaw 状态查询失败（sidecar 不可用）");
    }

    // Blender 检测
    try {
      addLog("blender", "info", "正在检测本机 Blender 版本…");
      const result = await ipc.detectBlenderVersions();
      const children = result.versions.map((v: any) => ({
        label: `Blender ${v.version}`, version: v.version,
        installPath: `%APPDATA%/Blender Foundation/Blender/${v.version}/scripts/addons`,
        projectPath: "", scriptPath: `artifex_nexus_v${result.addon_info.version}`,
        state: (v.installed ? "installed" : "not-installed") as ItemState,
      }));
      const hasInstalled = children.some((c: any) => c.state === "installed");
      setItems((prev) => prev.map((it) => it.id === "blender" ? { ...it, children, state: hasInstalled ? "installed" : "not-installed" } : it));
      addLog("blender", "info", `检测到 ${result.versions.length} 个版本（已装: ${children.filter((c: any) => c.state === "installed").length}）`);
    } catch { addLog("blender", "warn", "Blender 检测失败（sidecar 不可用）"); }
  };

  const handleInstall = async (id: string) => {
    const ipc = await getIpc();
    if (id === "openclaw") {
      setItems((prev) => prev.map((it) => it.id === id ? { ...it, state: "installing" } : it));
      addLog(id, "info", "开始安装 OpenClaw...");
      try {
        const r = await ipc.installOpenClaw("v2026.5.4");
        if (!r.success) { addLog(id, "error", r.error_message || "安装失败"); setItems((prev) => prev.map((it) => it.id === id ? { ...it, state: "failed" as ItemState, errorMessage: r.error_message || undefined } : it)); return; }
        addLog(id, "info", "安装完成，初始化配置...");
        const b = await ipc.bootstrapOpenClaw("v2026.5.4");
        if (!b.success) { addLog(id, "error", "初始化失败"); setItems((prev) => prev.map((it) => it.id === id ? { ...it, state: "failed" } : it)); return; }
        addLog(id, "info", "启动 Gateway...");
        const s = await ipc.startOpenClaw(b.port);
        if (!s.success) { addLog(id, "error", s.message || "启动失败"); setItems((prev) => prev.map((it) => it.id === id ? { ...it, state: "failed" } : it)); return; }
        addLog(id, "info", "Gateway 启动成功");
        setItems((prev) => prev.map((it) => {
          if (it.id === id) return { ...it, state: "installed" };
          if (it.state === "pending") return { ...it, state: "not-installed" };
          return it;
        }));
      } catch (e: any) { addLog(id, "error", e.message || String(e)); setItems((prev) => prev.map((it) => it.id === id ? { ...it, state: "failed" as ItemState, errorMessage: e.message || undefined } : it)); }
      return;
    }
    if (id === "blender") {
      setItems((prev) => prev.map((it) => it.id === id ? { ...it, state: "installing" } : it));
      addLog(id, "info", "正在安装 Blender 插件...");
      try {
        const bs = await ipc.invoke("openclaw_gateway_mcp_bridge_status");
        if (!bs?.installed) { addLog(id, "info", "部署 MCP Bridge 插件..."); await ipc.invoke("openclaw_gateway_mcp_bridge_install"); }
        const r = await ipc.installBlenderAddon("5.1", false);
        if (r.success) { addLog(id, "info", "Blender 插件安装完成"); setItems((prev) => prev.map((it) => it.id === id ? { ...it, state: "installed" } : it)); }
        else { addLog(id, "error", r.error || "安装失败"); setItems((prev) => prev.map((it) => it.id === id ? { ...it, state: "failed" as ItemState, errorMessage: r.error || undefined } : it)); }
      } catch (e: any) { addLog(id, "error", e.message); setItems((prev) => prev.map((it) => it.id === id ? { ...it, state: "failed" } : it)); }
      return;
    }
    // mock
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, state: "installing" } : it));
    addLog(id, "info", `正在安装 ${id}...`);
    setTimeout(() => { setItems((prev) => prev.map((it) => it.id === id ? { ...it, state: "installed" } : it)); addLog(id, "info", `${id} 安装完成`); }, 1500);
  };

  const handleAddChild = (parentId: string) => {
    const version = window.prompt("版本号（如 5.1）：");
    if (!version?.trim()) return;
    const label = `${parentId === "blender" ? "Blender" : parentId} ${version.trim()}`;
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
                  <Button variant="outline" size="sm" className="h-6 text-[10px] rounded-full" onClick={handleGlobalDetect}>检测</Button>
                  {item.id === "openclaw" && <Button variant="outline" size="sm" className="h-6 text-[10px] rounded-full">设置</Button>}
                  {item.id === "openclaw" && openclawStatus?.gateway_running && <Button variant="outline" size="sm" className="h-6 text-[10px] rounded-full" onClick={() => window.open(`http://127.0.0.1:${openclawStatus.port}`, "_blank")}>🌐 Web UI</Button>}
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
  const [status, setStatus] = React.useState<GatewayStatus | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [logs, setLogs] = React.useState<string[]>([]);

  const fetchStatus = async () => { try { const ipc = await getIpc(); const s = await ipc.getGatewayStatus(); setStatus(s); } catch {} };
  React.useEffect(() => { fetchStatus(); }, []);

  // 轮询日志
  React.useEffect(() => {
    if (status?.state !== "running") return;
    const timer = setInterval(async () => {
      try {
        const ipc = await getIpc();
        const result = await ipc.tailGatewayLog({ lines: 50 });
        if (result?.lines) setLogs(result.lines);
      } catch {}
    }, 3000);
    return () => clearInterval(timer);
  }, [status?.state]);

  const handleStart = async () => {
    setBusy(true);
    try {
      const ipc = await getIpc();
      if (status?.state === "running") await ipc.restartGateway();
      else await ipc.startGateway();
      await fetchStatus();
    } catch {} finally { setBusy(false); }
  };

  const state = status?.state ?? "stopped";
  const dotClass = state === "running" ? "bg-emerald-400" : state === "errored" ? "bg-red-400" : "bg-muted-foreground/40";
  const stateLabel = state === "running" ? "运行中" : state === "errored" ? "异常" : "未运行";

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
      <div className="rounded-[16px] border border-white/[0.08] bg-white/[0.04] p-4 backdrop-blur-xl shadow-[0_8px_32px_-12px_rgba(0,0,0,0.55)]">
        <div className="flex items-center gap-3"><span className={`flex h-3 w-3 rounded-full ${dotClass}`} /><span className="text-sm font-medium">{stateLabel}</span></div>
        <div className="mt-2 text-xs text-muted-foreground">PID: {status?.pid ?? "—"} · 端口: {status?.port ?? 19789} · 启动: {status?.started_at ? new Date(status.started_at * 1000).toLocaleString("zh-CN") : "—"}</div>
        {state === "errored" && status?.last_error && <div className="mt-2 rounded bg-red-500/10 px-2 py-1 text-xs text-red-400">{status.last_error}</div>}
        <div className="mt-3 flex gap-2">
          <button className="rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground shadow-[0_4px_16px_-4px_hsl(var(--primary)/0.5)]" onClick={handleStart} disabled={busy}>{state === "running" ? "↻ 重启 Gateway" : "▶ 启动 Gateway"}</button>
          <button className="rounded-full border border-white/[0.10] bg-white/[0.05] px-4 py-1.5 text-xs backdrop-blur-md disabled:opacity-40" disabled={state !== "running"} onClick={async () => { const ipc = await getIpc(); try { await ipc.openOpenClawWebUi(); } catch {} }}>🌐 OpenClaw Web UI</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto rounded-[16px] border border-white/[0.08] bg-white/[0.04] p-4 backdrop-blur-xl font-mono text-[10px]">
        {logs.length === 0 ? <span className="text-muted-foreground">Gateway 未运行，暂无日志</span> : logs.map((l, i) => <div key={i} className="text-muted-foreground">{l}</div>)}
      </div>
    </div>
  );
}

// ─── 运行状态 Tab ───────────────────────────────────────────────────────────

function StatusTab() {
  const [deploy, setDeploy] = React.useState<DeployValidationResult | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [dccStatus, setDccStatus] = React.useState<{name: string; port: number | null; url: string | null; running: boolean}[]>([]);

  const runDeployCheck = async () => {
    setChecking(true);
    try { const ipc = await getIpc(); const v = await ipc.validateDeployments(); setDeploy(v); } catch {} finally { setChecking(false); }
  };

  const refreshDCC = async () => {
    try {
      const ipc = await getIpc();
      const items: {name: string; port: number | null; url: string | null; running: boolean}[] = [];
      // Blender
      try {
        const p = await ipc.getDCCPort("blender");
        items.push({ name: "Blender", port: p.port, url: p.url, running: false });
        // 尝试通过 fetch 检测是否在线（WebSocket 不可行，用 HTTP 探测 sidecar 端口）
        try { await fetch(`http://127.0.0.1:${p.port}`, { mode: "no-cors" }); items[items.length-1].running = true; } catch {}
      } catch { items.push({ name: "Blender", port: null, url: null, running: false }); }
      setDccStatus(items);
    } catch {}
  };

  React.useEffect(() => { runDeployCheck(); refreshDCC(); }, []);

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
      <div className="rounded-[16px] border border-white/[0.08] bg-white/[0.04] p-4 backdrop-blur-xl">
        <div className="flex items-center gap-2 text-sm font-medium"><span className="h-2 w-2 rounded-full bg-emerald-400" />Sidecar 运行中</div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground"><div>端口: 19789</div><div>HOME: ~/.artifexnexus/.openclaw/</div><div>版本: v2026.5.4</div></div>
      </div>
      <div className="rounded-[16px] border border-white/[0.08] bg-white/[0.04] p-4 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">DCC 连接</span>
          <div className="flex-1" />
          <Button variant="outline" size="sm" className="h-6 text-[10px] rounded-full" onClick={refreshDCC}>刷新</Button>
        </div>
        <div className="mt-2 space-y-1.5 text-xs">
          {dccStatus.length === 0 && <div className="text-muted-foreground">点击刷新检测</div>}
          {dccStatus.map((d) => (
            <div key={d.name} className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${d.running ? "bg-emerald-400" : d.port ? "bg-amber-400" : "bg-muted-foreground/40"}`} />
              <span>{d.name}</span>
              <span className="text-muted-foreground">
                {d.running ? `MCP Server 运行中 · ws://127.0.0.1:${d.port}` : d.port ? `端口已配置(${d.port}) · MCP Server 未启动` : "未配置"}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-[16px] border border-white/[0.08] bg-white/[0.04] p-4 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">部署校验</span>
          <div className="flex-1" />
          <Button variant="outline" size="sm" className="h-6 text-[10px] rounded-full" onClick={runDeployCheck} disabled={checking}>
            {checking ? "校验中..." : "校验"}
          </Button>
        </div>
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          {deploy ? deploy.deployments?.map((d: any) => <div key={d.id}>{d.status === "ok" ? "✅" : "⚠️"} {d.id} — {d.details}</div>) : <div>点击校验按钮检测</div>}
        </div>
      </div>
    </div>
  );
}
