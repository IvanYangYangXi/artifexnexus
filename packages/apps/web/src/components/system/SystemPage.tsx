"use client";

/**
 * SystemPage — 系统模块（安装向导 + Gateway + 运行状态）
 *
 * 完全复刻 apps/desktop/src/routes/InstallerWizard.tsx
 * IPC 通过 src/lib/tauriIpc.ts 桥接
 */

import * as React from "react";
import { Terminal, Server, Activity, Play, ChevronDown, ChevronRight, Plus, Trash2, FolderOpen } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, Button, Input, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@artifex-nexus/ui";
import { ScrollFade } from "../chat/ScrollFade";
import { getIpc } from "../../lib/ipc";
import type { OpenClawStatus, GatewayStatus, DeployValidationResult } from "../../ipc/openclaw";
import { detectUEVersions, installUEPlugin, uninstallUEPlugin } from "../../ipc/openclaw";

// ─── 通用弹窗 Hook（替代 window.confirm / window.prompt） ─────────────────

interface DialogField { key: string; label: string; defaultValue?: string; placeholder?: string; type?: "text" | "checkbox"; }
interface DialogState {
  open: boolean;
  title: string;
  description?: string;
  fields: DialogField[];
  confirmLabel?: string;
  resolve: ((result: Record<string, string> | null) => void) | null;
}

function useAppDialog() {
  const [state, setState] = React.useState<DialogState>({ open: false, title: "", fields: [], resolve: null });

  const showConfirm = React.useCallback((title: string, description?: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({ open: true, title, description, fields: [], confirmLabel: "确认", resolve: (r) => resolve(r !== null) });
    });
  }, []);

  const showForm = React.useCallback((title: string, fields: DialogField[], opts?: { description?: string; confirmLabel?: string }): Promise<Record<string, string> | null> => {
    return new Promise((resolve) => {
      setState({ open: true, title, description: opts?.description, fields, confirmLabel: opts?.confirmLabel || "确定", resolve: (r) => resolve(r) });
    });
  }, []);

  const handleClose = React.useCallback(() => {
    state.resolve?.(null);
    setState((s) => ({ ...s, open: false, resolve: null }));
  }, [state.resolve]);

  const DialogUI = React.useCallback(() => {
    const [values, setValues] = React.useState<Record<string, string>>({});
    React.useEffect(() => {
      if (state.open) {
        const init: Record<string, string> = {};
        state.fields.forEach((f) => { init[f.key] = f.defaultValue || ""; });
        setValues(init);
      }
    }, [state.open, state.fields]);

    const handleConfirm = () => {
      state.resolve?.(state.fields.length > 0 ? values : {});
      setState((s) => ({ ...s, open: false, resolve: null }));
    };

    return (
      <Dialog open={state.open} onOpenChange={(open) => { if (!open) handleClose(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">{state.title}</DialogTitle>
            {state.description && <DialogDescription className="text-xs">{state.description}</DialogDescription>}
          </DialogHeader>
          {state.fields.length > 0 && (
            <div className="space-y-3 py-2">
              {state.fields.map((f) => f.type === "checkbox" ? (
                <label key={f.key} className="flex items-center gap-2 cursor-pointer rounded px-1 py-1 hover:bg-white/[0.04]">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-white/20 bg-white/[0.06] accent-primary"
                    checked={values[f.key] === "true"}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.checked ? "true" : "false" }))}
                  />
                  <span className="text-xs text-foreground">{f.label}</span>
                </label>
              ) : (
                <div key={f.key}>
                  <label className="text-[11px] text-muted-foreground">{f.label}</label>
                  <Input
                    className="mt-1 h-8 text-xs"
                    placeholder={f.placeholder}
                    value={values[f.key] || ""}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
                  />
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" className="rounded-full text-xs" onClick={handleClose}>取消</Button>
            <Button size="sm" className="rounded-full text-xs" onClick={handleConfirm}>{state.confirmLabel || "确定"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }, [state, handleClose]);

  return { showConfirm, showForm, DialogUI };
}

// ─── 类型 ───────────────────────────────────────────────────────────────────

type ItemState = "unavailable" | "pending" | "not-installed" | "installing" | "installed" | "update-available" | "failed";
interface InstallChild { label: string; version: string; installPath: string; projectPath: string; scriptPath: string; state: ItemState; }
interface InstallItem { id: string; name: string; iconKey: string; state: ItemState; expandable: boolean; comingSoon?: boolean; children?: InstallChild[]; errorMessage?: string; }
interface LogEntry { time: string; itemId: string; level: "info" | "warn" | "error"; message: string; }

const FIXTURE_ITEMS: InstallItem[] = [
  { id: "openclaw", name: "OpenClaw", iconKey: "openclaw", state: "not-installed", expandable: false },
  { id: "web-ui", name: "Web UI", iconKey: "web-ui", state: "pending", expandable: false },
  { id: "blender", name: "Blender", iconKey: "blender", state: "pending", expandable: true, children: [] },
  { id: "unreal_engine", name: "Unreal Engine", iconKey: "unreal_engine", state: "pending", expandable: true, children: [{ label: "UE 5.7 主项目", version: "5.7.0", installPath: "D:\\Proj\\MyGame", projectPath: "", scriptPath: "", state: "pending" }] },
  { id: "3ds_max", name: "3ds Max", iconKey: "3ds_max", state: "pending", expandable: true, children: [{ label: "3ds Max 2024", version: "2024.2", installPath: "C:\\Program Files\\Autodesk\\3ds Max 2024", projectPath: "", scriptPath: "<install>/plugins/3ds_max/init.ms", state: "pending" }] },
  { id: "maya", name: "Maya", iconKey: "maya", state: "pending", expandable: true, children: [] },
  { id: "comfyui", name: "ComfyUI", iconKey: "comfyui", state: "unavailable", expandable: true, comingSoon: true, children: [] },
];

const STATE_LABELS: Record<ItemState, string> = { unavailable: "不可用", pending: "等待中", "not-installed": "未安装", installing: "安装中", installed: "已安装", "update-available": "可更新", failed: "失败" };
const STATE_COLORS: Record<ItemState, string> = { unavailable: "bg-muted text-muted-foreground", pending: "bg-muted text-muted-foreground", "not-installed": "bg-muted text-muted-foreground", installing: "bg-sky-500/15 text-sky-400", installed: "bg-emerald-500/15 text-emerald-400", "update-available": "bg-amber-500/15 text-amber-400", failed: "bg-red-500/15 text-red-400" };
const ICON_LABELS: Record<string, string> = { openclaw: "OC", "web-ui": "W", blender: "B", unreal_engine: "U", "3ds_max": "3", maya: "M", comfyui: "C" };

// StyleE 玻璃常量
const GLASS = "rounded-[16px] border border-white/[0.08] bg-white/[0.04] backdrop-blur-xl shadow-[0_8px_32px_-12px_rgba(0,0,0,0.55),inset_0_1px_0_0_rgba(255,255,255,0.06)]";

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
            <TabsTrigger value="dataman" className="h-6 gap-1 text-xs"><FolderOpen className="h-3 w-3" />数据管理</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {tab === "installer" && <InstallerTab />}
      {tab === "gateway" && <GatewayTab />}
      {tab === "dataman" && <DataManagementTab />}
    </div>
  );
}

// ─── 安装向导 Tab ──────────────────────────────────────────────────────────

function InstallerTab() {
  const [items, setItems] = React.useState<InstallItem[]>(FIXTURE_ITEMS);
  const [logs, setLogs] = React.useState<LogEntry[]>([]);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [openclawStatus, setOpenclawStatus] = React.useState<OpenClawStatus | null>(null);
  const { showConfirm, showForm, DialogUI } = useAppDialog();

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
          // 有损坏/缺失时，逐条输出明细
          for (const d of v.deployments ?? []) {
            const label = d.id;
            const ver = d.currentVersion ? ` (v${d.currentVersion})` : "";
            if (d.status === "corrupted") {
              const files = d.corrupted_files ?? [];
              if (files.length > 0) {
                for (const f of files) addLog("openclaw", "warn", `  ⚠️ 损坏: ${label}/${f}${ver} — ${d.details}`);
              } else {
                addLog("openclaw", "warn", `  ⚠️ 损坏: ${label}${ver} — ${d.details}`);
              }
            }
            if (d.status === "missing") {
              const files = d.missing_files ?? [];
              if (files.length > 0) {
                for (const f of files) addLog("openclaw", "warn", `  ❌ 缺失: ${label}/${f}${ver}`);
              } else {
                addLog("openclaw", "warn", `  ❌ 缺失: ${label}${ver} — ${d.details}`);
              }
            }
            if (d.status === "outdated") {
              addLog("openclaw", "info", `  🔄 可更新: ${label}${ver} → v${d.sourceVersion}`);
            }
          }
        }
      } catch { addLog("openclaw", "warn", "部署校验失败"); }
    } catch (err) { console.warn("[SystemPage] refresh getOpenClawStatus failed:", err);
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
    const item = items.find((it) => it.id === id);
    let userChecked: Record<string, string> | undefined;
    // OpenClaw 重装确认弹窗（含保留项选择）
    if (item?.state === "installed" && id === "openclaw") {
      const formResult = await showForm("重新安装 OpenClaw", [
        { key: "preserveProvidersAndAuth", label: "供应商配置 + API 凭据（baseUrl / API Key / 模型列表）", defaultValue: "true", type: "checkbox" },
        { key: "preserveAgents", label: "Agent 配置 + 工作空间（Agent 预设 / 独立 workspace 文件）", defaultValue: "true", type: "checkbox" },
        { key: "preservePluginsAndMemory", label: "插件配置 + Memory（全部启用插件 / AI 长期记忆 / 梦境数据）", defaultValue: "true", type: "checkbox" },
        { key: "preserveMCPServers", label: "MCP 服务器配置（mcp-bridge 下全部 MCP 连接）", defaultValue: "true", type: "checkbox" },
        { key: "preserveSkills", label: "Skill（workspace/skills/ 全部 Skill）", defaultValue: "true", type: "checkbox" },
      ], { description: "重装会备份选定数据 → 全新安装 → 恢复。勾选的项目将在重装后自动恢复，未勾选使用默认配置。", confirmLabel: "确认重装" });
      if (!formResult) return;
      userChecked = formResult as Record<string, string>;
    } else if (item?.state === "installed") {
      // 非 OpenClaw 的重装确认
      const ok = await showConfirm(`确认重装 ${item.name}？`, "重装会重新下载/部署组件，当前配置将保留。");
      if (!ok) return;
    }
    const ipc = await getIpc();
    if (id === "openclaw") {
      setItems((prev) => prev.map((it) => it.id === id ? { ...it, state: "installing" } : it));
      setOpenclawStatus((prev) => prev ? { ...prev, gateway_running: false } : null);

      // ★ 重装第一步：停 Gateway（释放文件锁 + 停止 health monitor）
      // 所有后续步骤（backup/clean_install/bootstrap）不再各自停 gateway
      try {
        await ipc.stopOpenClaw();
        addLog(id, "info", "Gateway 已停止");
      } catch (e: any) {
        addLog(id, "warn", `停止 Gateway 失败: ${typeof e === "string" ? e : (e?.message || String(e))}`);
      }

      // 重装流程：Phase 1 备份 → Phase 2 全新安装 → Phase 3 恢复
      // 获取 userChecked 的勾选项（即复选框选中对应 key → value 为 "true"）
      const preserveOptions: Record<string, boolean> = {};
      if (userChecked) {
        for (const [key, val] of Object.entries(userChecked)) {
          if (key.startsWith("preserve")) preserveOptions[key] = val === "true";
        }
      }
      const hasPreserve = Object.values(preserveOptions).some(Boolean);

      if (hasPreserve) {
        // Phase 1: 备份
        try {
          addLog(id, "info", "Phase 1: 备份用户数据...");
          const backupR = await ipc.backupOpenClaw(preserveOptions);
          if (!backupR.success) {
            addLog(id, "error", `备份失败: ${backupR.error || "未知错误"}`);
          } else {
            // 全量安全网快照信息
            const snap = backupR.full_snapshot;
            if (snap?.snapshot_dir) {
              addLog(id, "info", `安全网快照: ${snap.snapshot_dir.split(/[\\/]/).slice(-2).join("/")} (${snap.file_count} 文件, ${((snap.total_size_bytes ?? 0) / 1024).toFixed(0)} KB)`);
            }
            const skipNote = (backupR.skipped_count ?? 0) > 0
              ? `, 跳过 ${backupR.skipped_count} 个被锁文件`
              : "";
            addLog(id, "info", `备份完成 (${backupR.items.length} 项, ${(backupR.total_size_bytes / 1024).toFixed(0)} KB${skipNote})`);
            // 把跳过的文件展开打印（最多 5 条）
            if (backupR.skipped && backupR.skipped.length) {
              for (const s of backupR.skipped.slice(0, 5)) {
                addLog(id, "warn", `跳过: ${s.path.split(/[\\/]/).slice(-3).join("/")} (${s.error.split(":")[0]})`);
              }
              if (backupR.skipped.length > 5) {
                addLog(id, "warn", `…还有 ${backupR.skipped.length - 5} 个文件跳过`);
              }
            }
            // 保存 timestamp 供 restore 使用
            (window as any).__openclaw_backup_ts = backupR.timestamp;
          }
        } catch (e: any) {
          const msg = typeof e === "string" ? e : (e?.message || String(e || "未知错误"));
          addLog(id, "warn", `备份异常: ${msg}（继续重装）`);
        }
      }

      try {
        if (hasPreserve) {
          // Phase 2-3: 安全网 → 删除 → CLI 全量重装 → bootstrap → 选择性恢复
          const backupTs = (window as any).__openclaw_backup_ts;
          if (backupTs) {
            addLog(id, "info", "Phase 2-3: 全量重装 CLI + 全新安装 + 恢复...");
            const restoreR = await ipc.restoreOpenClaw({
              backupTimestamp: backupTs,
              preserveOptions,
              version: "v2026.5.4",
            });
            delete (window as any).__openclaw_backup_ts;
            if (restoreR.success) {
              addLog(id, "info", "恢复完成");
            } else {
              addLog(id, "warn", `部分恢复失败: ${restoreR.errors?.map((e: any) => e.item).join(", ") || restoreR.error}`);
            }
          } else {
            // fallback: 备份失败 → 普通安装 CLI + bootstrap
            addLog(id, "info", "安装 OpenClaw CLI...");
            const r = await ipc.installOpenClaw("v2026.5.4");
            if (!r.success) {
              addLog(id, "error", r.error_message || "安装失败");
              setItems((prev) => prev.map((it) => it.id === id ? { ...it, state: "failed" as ItemState, errorMessage: r.error_message || undefined } : it));
              return;
            }
            addLog(id, "info", "初始化配置...");
            const b = await ipc.bootstrapOpenClaw("v2026.5.4");
            if (!b.success) { addLog(id, "error", "初始化失败"); setItems((prev) => prev.map((it) => it.id === id ? { ...it, state: "failed" } : it)); return; }
          }
        } else {
          // 非重装: 安装 CLI + 普通 bootstrap
          addLog(id, "info", "安装 OpenClaw CLI...");
          const r = await ipc.installOpenClaw("v2026.5.4");
          if (!r.success) {
            addLog(id, "error", r.error_message || "安装失败");
            setItems((prev) => prev.map((it) => it.id === id ? { ...it, state: "failed" as ItemState, errorMessage: r.error_message || undefined } : it));
            return;
          }
          addLog(id, "info", "初始化配置...");
          const b = await ipc.bootstrapOpenClaw("v2026.5.4");
          if (!b.success) { addLog(id, "error", "初始化失败"); setItems((prev) => prev.map((it) => it.id === id ? { ...it, state: "failed" } : it)); return; }
        }

        addLog(id, "info", "启动 Gateway...");
        const s = await ipc.startOpenClaw();
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
        const bs = await ipc.getMCPBridgeStatus();
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

  const handleAddChild = async (parentId: string) => {
    const item = items.find((it) => it.id === parentId);
    const dccName = item?.name || parentId;
    const isUE = parentId === "unreal_engine";
    const result = await showForm(`添加 ${dccName} 版本`, [
      { key: "version", label: "版本号", placeholder: "如 5.7" },
      { key: "installPath", label: isUE ? "项目根目录" : "安装路径（可选）", placeholder: isUE ? "含有 .uproject 的项目根目录" : "留空则自动计算" },
    ]);
    if (!result || !result.version?.trim()) return;
    const version = result.version.trim();
    let installPath = result.installPath?.trim() || "";
    if (!installPath) {
      if (parentId === "blender") installPath = `%APPDATA%/Blender Foundation/Blender/${version}/scripts/addons/`;
      else if (parentId === "maya") installPath = `~/Documents/maya/${version}/scripts/`;
      else if (parentId === "3ds_max") installPath = `%LOCALAPPDATA%/Autodesk/3dsMax/${version}/ENU/scripts/`;
      else if (parentId === "unreal_engine") installPath = "";  // UE 必须手动指定项目根目录
    }
    const label = `${dccName} ${version}`;
    setItems((prev) => prev.map((it) => it.id === parentId ? { ...it, children: [...(it.children || []), { label, version, installPath, projectPath: "", scriptPath: "", state: "not-installed" as const }] } : it));
  };

  const handleDeleteChild = async (parentId: string, childIndex: number) => {
    const item = items.find((it) => it.id === parentId);
    const child = item?.children?.[childIndex];
    const label = child?.label || `子项 ${childIndex + 1}`;
    const ok = await showConfirm(`确认删除「${label}」？`, child?.state === "installed" ? "已安装的插件将被卸载。" : undefined);
    if (!ok) return;
    // 如果已安装则先尝试卸载
    if (child?.state === "installed") {
      void (async () => {
        try {
          const ipc = await getIpc();
          addLog(parentId, "info", `[${label}] 正在卸载...`);
          if (parentId === "unreal_engine") {
            const r = await uninstallUEPlugin(child.version, child.installPath || "", false);
            if (r.success) addLog(parentId, "info", `[${label}] 卸载成功`);
            else addLog(parentId, "warn", `[${label}] 卸载失败: ${r.error}`);
          } else {
            const r = await ipc.uninstallBlenderAddon(child.version);
            if (r.success) addLog(parentId, "info", `[${label}] 卸载成功`);
            else addLog(parentId, "warn", `[${label}] 卸载失败: ${r.error}`);
          }
        } catch (e: any) { addLog(parentId, "warn", `[${label}] 卸载异常: ${e.message}`); }
      })();
    }
    setItems((prev) => prev.map((it) => it.id === parentId ? { ...it, children: (it.children || []).filter((_, i) => i !== childIndex) } : it));
  };

  // 子项设置（编辑版本号和安装路径）— 自定义弹窗
  const handleChildSettings = async (parentId: string, childIndex: number) => {
    const item = items.find((it) => it.id === parentId);
    const child = item?.children?.[childIndex];
    if (!child) return;
    // 计算默认路径
    let defaultPath = child.installPath;
    if (!defaultPath && child.version) {
      if (parentId === "blender") defaultPath = `%APPDATA%/Blender Foundation/Blender/${child.version}/scripts/addons/`;
      else if (parentId === "maya") defaultPath = `~/Documents/maya/${child.version}/scripts/`;
      else if (parentId === "3ds_max") defaultPath = `%LOCALAPPDATA%/Autodesk/3dsMax/${child.version}/ENU/scripts/`;
      else if (parentId === "unreal_engine") defaultPath = "";
    }
    const isUE = parentId === "unreal_engine";
    const result = await showForm(`编辑「${child.label}」`, [
      { key: "version", label: "版本号", defaultValue: child.version, placeholder: "如 5.7" },
      { key: "installPath", label: isUE ? "项目根目录" : "安装路径", defaultValue: defaultPath || "", placeholder: isUE ? "含有 .uproject 的项目根目录" : "留空则自动计算" },
    ]);
    if (!result) return;
    const newVersion = result.version?.trim() || child.version;
    const newInstallPath = result.installPath?.trim() || "";
    // 重新计算默认路径
    let computedPath = newInstallPath;
    if (!computedPath && newVersion) {
      if (parentId === "blender") computedPath = `%APPDATA%/Blender Foundation/Blender/${newVersion}/scripts/addons/`;
      else if (parentId === "maya") computedPath = `~/Documents/maya/${newVersion}/scripts/`;
      else if (parentId === "3ds_max") computedPath = `%LOCALAPPDATA%/Autodesk/3dsMax/${newVersion}/ENU/scripts/`;
      else if (parentId === "unreal_engine") computedPath = "";
    }
    const newLabel = `${item?.name ?? parentId} ${newVersion}`;
    setItems((prev) => prev.map((it) => it.id === parentId ? {
      ...it,
      children: (it.children || []).map((c, i) => i === childIndex ? { ...c, label: newLabel, version: newVersion, installPath: computedPath } : c),
    } : it));
  };

  // 子项安装/重装
  const handleChildInstall = async (parentId: string, childIndex: number) => {
    const item = items.find((it) => it.id === parentId);
    const child = item?.children?.[childIndex];
    if (!child) return;
    const isReinstall = child.state === "installed";
    if (isReinstall) {
      if (!(await showConfirm(`确认重装「${child.label}」？`, "将先卸载旧版本再重新安装。"))) return;
    }
    // 更新子项状态
    setItems((prev) => prev.map((it) => it.id === parentId ? {
      ...it, children: (it.children || []).map((c, i) => i === childIndex ? { ...c, state: "installing" as const } : c),
    } : it));
    addLog(parentId, "info", `[${child.label}] ${isReinstall ? "重装" : "安装"}中...`);
    try {
      const ipc = await getIpc();

      // ── UE 安装分支 ──
      if (parentId === "unreal_engine") {
        if (!child.installPath) {
          throw new Error("请先设置项目根目录（包含 .uproject 的目录）");
        }
        addLog(parentId, "info", `[${child.label}] 项目路径: ${child.installPath}`);

        // 检查并安装 mcp-bridge
        const bs = await ipc.getMCPBridgeStatus();
        if (!bs?.installed) {
          addLog(parentId, "info", `[${child.label}] 部署 MCP Bridge 插件...`);
          await ipc.invoke("openclaw_gateway_mcp_bridge_install");
        }

        const r = await installUEPlugin(child.version, child.installPath, isReinstall);
        if (r.success) {
          addLog(parentId, "info", `[${child.label}] ${isReinstall ? "重装" : "安装"}成功 → ${r.target}`);
          setItems((prev) => prev.map((it) => it.id === parentId ? {
            ...it, state: "installed" as const, children: (it.children || []).map((c, i) => i === childIndex ? { ...c, state: "installed" as const } : c),
          } : it));
        } else {
          throw new Error(r.error || "安装失败");
        }
        return;
      }

      // ── Blender 安装分支 ──
      if (isReinstall) {
        addLog(parentId, "info", `[${child.label}] 卸载旧版本...`);
        try { await ipc.uninstallBlenderAddon(child.version); } catch {}
      }
      const bs = await ipc.getMCPBridgeStatus();
      if (!bs?.installed) {
        addLog(parentId, "info", `[${child.label}] 部署 MCP Bridge 插件...`);
        await ipc.invoke("openclaw_gateway_mcp_bridge_install");
      }
      const r = await ipc.installBlenderAddon(child.version, false);
      if (r.success) {
        addLog(parentId, "info", `[${child.label}] ✅ 安装成功`);
        setItems((prev) => prev.map((it) => it.id === parentId ? {
          ...it, children: (it.children || []).map((c, i) => i === childIndex ? { ...c, state: "installed" as const } : c),
        } : it));
      } else {
        addLog(parentId, "error", `[${child.label}] ❌ 安装失败: ${r.error}`);
        setItems((prev) => prev.map((it) => it.id === parentId ? {
          ...it, children: (it.children || []).map((c, i) => i === childIndex ? { ...c, state: "failed" as const } : c),
        } : it));
      }
    } catch (e: any) {
      addLog(parentId, "error", `[${child.label}] ❌ 异常: ${e.message}`);
      setItems((prev) => prev.map((it) => it.id === parentId ? {
        ...it, children: (it.children || []).map((c, i) => i === childIndex ? { ...c, state: "failed" as const } : c),
      } : it));
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <DialogUI />
      <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-4 py-2">
        <Button size="sm" className="h-7 gap-1 text-[11px] rounded-full" onClick={handleGlobalDetect}><Play className="h-3 w-3" />全局检测</Button>
      </div>
      <ScrollFade className="flex-1">
        <div className="p-3 space-y-1">
          {items.map((item) => (
            <div key={item.id}>
              <div className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-white/[0.04] border-b border-white/[0.04]">
                {item.expandable && <button onClick={() => toggleExpand(item.id)} className="text-muted-foreground">{expanded.has(item.id) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</button>}
                {!item.expandable && <div className="w-3.5" />}
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-[11px] font-bold text-muted-foreground">{ICON_LABELS[item.iconKey]}</span>
                <span className="flex-1 text-sm font-medium">{item.name}</span>
                {item.comingSoon && <span className="text-[11px] text-muted-foreground">即将推出</span>}
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATE_COLORS[item.state]}`}>{STATE_LABELS[item.state]}</span>
                {item.state === "failed" && item.errorMessage && <span className="max-w-[120px] truncate text-[11px] text-red-400">{item.errorMessage}</span>}
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" className="h-6 text-[11px] rounded-full" onClick={handleGlobalDetect}>检测</Button>
                  {item.id === "openclaw" && <Button variant="outline" size="sm" className="h-6 text-[11px] rounded-full" onClick={() => { /* 跳转设置页：通过 URL hash 或全局事件 */ window.dispatchEvent(new CustomEvent("nav", { detail: "settings" })); }}>设置</Button>}
                  {item.id === "openclaw" && openclawStatus?.gateway_running && <Button variant="outline" size="sm" className="h-6 text-[11px] rounded-full" onClick={() => window.open(`http://127.0.0.1:${openclawStatus.port}`, "_blank")}>🌐 Web UI</Button>}
                  {item.state === "not-installed" && <Button size="sm" className="h-6 text-[11px] rounded-full" onClick={() => handleInstall(item.id)} disabled={isGated(item)}>安装</Button>}
                  {item.state === "installed" && <Button variant="outline" size="sm" className="h-6 text-[11px] rounded-full" onClick={() => handleInstall(item.id)}>重装</Button>}
                  {item.state === "failed" && <Button size="sm" className="h-6 text-[11px] rounded-full" onClick={() => handleInstall(item.id)}>重试</Button>}
                  {item.expandable && <Button variant="outline" size="sm" className="h-6 text-[11px] rounded-full" onClick={() => handleAddChild(item.id)}><Plus className="h-3 w-3" /></Button>}
                </div>
              </div>
              {item.expandable && expanded.has(item.id) && item.children && (
                <div className="ml-10 space-y-1 border-l border-white/[0.06] pl-4">
                  {item.children.map((child, i) => (
                    <div key={i} className="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-white/[0.04]">
                      <span className="flex-1">{child.label}</span>
                      <span className="text-[11px] text-muted-foreground">{child.version}</span>
                      <span className={`rounded px-1 py-0 text-[11px] font-medium ${STATE_COLORS[child.state]}`}>{STATE_LABELS[child.state]}</span>
                      <Button variant="outline" size="sm" className="h-5 text-[11px] rounded-full" onClick={() => handleChildSettings(item.id, i)}>设置</Button>
                      <Button size="sm" className="h-5 text-[11px] rounded-full" disabled={child.state === "installing"} onClick={() => handleChildInstall(item.id, i)}>
                        {child.state === "installed" ? "重装" : child.state === "installing" ? "安装中…" : child.state === "failed" ? "重试" : "安装"}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleDeleteChild(item.id, i)}><Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" /></Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollFade>
      {/* 底部：运行状态 + 可调高度日志 */}
      <div className="shrink-0 border-t border-white/[0.06]">
        {/* 运行状态摘要 */}
        <StatusBar addLog={addLog} />
        {/* 日志头部 */}
        <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-muted-foreground border-t border-white/[0.04]">
          <span>日志</span><span className="flex-1" /><button className="hover:text-foreground" onClick={() => setLogs([])}>清空</button>
        </div>
        {/* 可调高度日志区（自动滚底） */}
        <InstallerLogView logs={logs} />
      </div>
    </div>
  );
}

// ─── 运行状态摘要栏 ─────────────────────────────────────────────────────────

function StatusBar({ addLog }: { addLog: (id: string, level: LogEntry["level"], msg: string) => void }) {
  const [dccStatus, setDccStatus] = React.useState<{name: string; port: number | null; mcpListening: boolean; gatewayConnected: boolean}[]>([]);
  const [deploy, setDeploy] = React.useState<any>(null);
  const [sidecarPort, setSidecarPort] = React.useState<number | null>(null);
  const [repairing, setRepairing] = React.useState(false);

  const refresh = async () => {
    try {
      const ipc = await getIpc();
      // DCC 状态
      const items: {name: string; port: number | null; mcpListening: boolean; gatewayConnected: boolean}[] = [];

      // Bug #6 修复：先检查 Gateway 是否在运行
      let gatewayRunning = false;
      try {
        const ocStatus = await ipc.getOpenClawStatus();
        gatewayRunning = ocStatus.gateway_running;
      } catch (err) { console.warn("[SystemPage] StatusBar.refresh getOpenClawStatus failed:", err); }

      // 获取 MCP Bridge 状态（一次调用检测所有 DCC）
      let bridgeStatus: any = null;
      if (gatewayRunning) {
        try { bridgeStatus = await ipc.getMCPBridgeStatus(); } catch (err) {
          console.warn("[SystemPage] StatusBar.refresh getMCPBridgeStatus failed:", err);
        }
      }

      // ── Blender ──
      try {
        const p = await ipc.getDCCPort("blender");
        let mcpListening = false;
        let gatewayConnected = false;

        if (gatewayRunning && bridgeStatus) {
          if (bridgeStatus.blenderConnected) {
            gatewayConnected = true;
            mcpListening = true;
          } else {
            try { await fetch(`http://127.0.0.1:${p.port}`, { mode: "no-cors", signal: AbortSignal.timeout(1500) }); mcpListening = true; } catch {}
          }
        } else if (gatewayRunning) {
          try { await fetch(`http://127.0.0.1:${p.port}`, { mode: "no-cors", signal: AbortSignal.timeout(1500) }); mcpListening = true; } catch {}
        } else {
          try { await fetch(`http://127.0.0.1:${p.port}`, { mode: "no-cors", signal: AbortSignal.timeout(1500) }); mcpListening = true; } catch {}
        }

        items.push({ name: "Blender", port: p.port, mcpListening, gatewayConnected });
      } catch { items.push({ name: "Blender", port: null, mcpListening: false, gatewayConnected: false }); }

      // ── Unreal Engine ──
      try {
        const p = await ipc.getDCCPort("unreal");
        let mcpListening = false;
        let gatewayConnected = false;

        if (gatewayRunning && bridgeStatus) {
          if (bridgeStatus.unrealConnected) {
            gatewayConnected = true;
            mcpListening = true;
          } else {
            try { await fetch(`http://127.0.0.1:${p.port}`, { mode: "no-cors", signal: AbortSignal.timeout(1500) }); mcpListening = true; } catch {}
          }
        } else if (gatewayRunning) {
          try { await fetch(`http://127.0.0.1:${p.port}`, { mode: "no-cors", signal: AbortSignal.timeout(1500) }); mcpListening = true; } catch {}
        } else {
          try { await fetch(`http://127.0.0.1:${p.port}`, { mode: "no-cors", signal: AbortSignal.timeout(1500) }); mcpListening = true; } catch {}
        }

        items.push({ name: "Unreal", port: p.port, mcpListening, gatewayConnected });
      } catch { items.push({ name: "Unreal", port: null, mcpListening: false, gatewayConnected: false }); }

      setDccStatus(items);
      // Sidecar 端口
      try { const st = await ipc.getStatus(); setSidecarPort(st.port ?? 19789); } catch { setSidecarPort(19789); }
      // 部署校验
      const v = await ipc.validateDeployments();
      setDeploy(v);
    } catch (err) { console.warn("[SystemPage] StatusBar.refresh failed:", err); }
  };

  React.useEffect(() => { refresh(); }, []);

  const repairAll = async () => {
    if (!deploy?.deployments) return;
    setRepairing(true);
    const ipc = await getIpc();
    const damaged = deploy.deployments.filter(
      (d: any) => d.status === "corrupted" || d.status === "missing"
    );
    if (damaged.length === 0) { setRepairing(false); return; }
    for (const d of damaged) {
      try {
        const r = await ipc.repairDeployment(d.id);
        if (r.success) addLog("openclaw", "info", `🛠️ 已修复: ${d.id}`);
        else addLog("openclaw", "error", `🛠️ 修复失败: ${d.id} — ${r.error}`);
      } catch (err: any) {
        addLog("openclaw", "error", `🛠️ 修复失败: ${d.id} — ${err}`);
      }
    }
    setRepairing(false);
    refresh();
  };

  return (
    <div className="flex flex-wrap items-center gap-3 px-3 py-1.5 text-[11px]">
      <span className="text-muted-foreground">运行状态:</span>
      {dccStatus.map((d) => (
        <span key={d.name} className="flex items-center gap-1">
          <span className={`h-1.5 w-1.5 rounded-full ${d.gatewayConnected ? "bg-emerald-400" : d.mcpListening ? "bg-amber-400" : d.port ? "bg-muted-foreground/40" : "bg-muted-foreground/40"}`} />
          {d.name} {d.port ? `端口 ${d.port}` : "未配置"}
          {d.gatewayConnected ? " · Gateway 已连接" : d.mcpListening ? " · MCP Server 监听中 · Gateway 未连接" : d.port ? " · 未启动" : ""}
        </span>
      ))}
      {deploy && (
        <span className="text-muted-foreground">
          · 校验: {deploy.summary?.ok ?? 0}✅ {deploy.summary?.outdated ?? 0}🔄 {deploy.summary?.corrupted ?? 0}⚠️ {deploy.summary?.missing ?? 0}❌
        </span>
      )}
      {(deploy?.summary?.corrupted ?? 0) + (deploy?.summary?.missing ?? 0) > 0 && (
        <Button variant="outline" size="sm" className="h-5 text-[11px] rounded-full text-amber-400 border-amber-400/30"
          disabled={repairing} onClick={repairAll}>
          {repairing ? "修复中…" : "修复"}
        </Button>
      )}
      <span className="text-muted-foreground">· Sidecar 端口 {sidecarPort ?? 19789}</span>
      <div className="flex-1" />
      <Button variant="outline" size="sm" className="h-5 text-[11px] rounded-full" onClick={refresh}>刷新</Button>
    </div>
  );
}

// ─── InstallerLogView：安装向导日志（自动滚底 + 可调高度） ──────────────────

function InstallerLogView({ logs }: { logs: LogEntry[] }) {
  const endRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);
  return (
    <div className="resize-y overflow-y-auto border-t border-white/[0.04] px-3 py-1 text-[11px] font-mono" style={{ minHeight: 80, maxHeight: 300, height: 120 }}>
      {logs.length === 0 && <span className="text-muted-foreground">暂无日志</span>}
      {logs.map((l, i) => <div key={i} className={l.level === "error" ? "text-red-400" : l.level === "warn" ? "text-amber-400" : "text-muted-foreground"}>{l.time} {l.message}</div>)}
      <div ref={endRef} />
    </div>
  );
}

// ─── LogView：日志渲染组件（自动滚底 + 限制条数保性能） ─────────────────────

const MAX_LOG_LINES = 200;

function LogView({ logs, emptyMessage }: { logs: string[]; emptyMessage?: string }) {
  const endRef = React.useRef<HTMLDivElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = React.useState(true);

  // 自动滚动到底部
  React.useEffect(() => {
    if (autoScroll && endRef.current) {
      endRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  // 检测用户是否手动滚动了（距底部 > 50px 时暂停自动滚动）
  const handleScroll = React.useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setAutoScroll(atBottom);
  }, []);

  // 只渲染最后 MAX_LOG_LINES 行（性能保护）
  const visible = logs.length > MAX_LOG_LINES ? logs.slice(-MAX_LOG_LINES) : logs;

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto font-mono text-[11px] leading-[1.6]"
      onScroll={handleScroll}
    >
      {visible.length === 0 ? (
        <span className="text-muted-foreground">{emptyMessage ?? "Gateway 未运行，暂无日志"}</span>
      ) : (
        visible.map((l, i) => (
          <div key={i} className={`whitespace-pre-wrap break-all ${l.includes("ERROR") || l.includes("error") ? "text-red-400" : l.includes("WARN") || l.includes("warn") ? "text-amber-400" : "text-muted-foreground"}`}>
            {l}
          </div>
        ))
      )}
      <div ref={endRef} />
      {!autoScroll && visible.length > 0 && (
        <button
          className="sticky bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-primary/80 px-3 py-1 text-[11px] text-primary-foreground shadow-lg backdrop-blur-md"
          onClick={() => { setAutoScroll(true); endRef.current?.scrollIntoView({ behavior: "smooth" }); }}
        >
          ↓ 跳至底部
        </button>
      )}
    </div>
  );
}

// ─── Gateway Tab ────────────────────────────────────────────────────────────

const LOG_POLL_INTERVAL = 600;   // 日志轮询间隔（ms），打开页面时快速加载
const LOG_INITIAL_BATCH = 200;   // 首次拉取条数
const LOG_MAX_BUFFER = 500;      // 前端最多保留条数
const TCP_PROBE_TIMEOUT = 2000;  // TCP 存活检测超时（ms）

function GatewayTab() {
  const [status, setStatus] = React.useState<GatewayStatus | null>(null);
  const [logs, setLogs] = React.useState<string[]>([]);
  // TCP 存活检测状态：checking / alive / dead
  const [liveness, setLiveness] = React.useState<"checking" | "alive" | "dead">("checking");

  // 启动/重启流程的分阶段状态反馈
  type StartPhase = "idle" | "starting" | "waiting" | "success" | "failed";
  const [startPhase, setStartPhase] = React.useState<StartPhase>("idle");
  const [startError, setStartError] = React.useState<string | null>(null);
  const busy = startPhase !== "idle";

  const fetchStatus = async () => {
    try {
      const ipc = await getIpc();
      const s = await ipc.getGatewayStatus();
      setStatus(s);

      // TCP 存活检测：sidecar 报告 running 时，快速验证端口是否真的在监听
      // 注意：Tauri WebView 中 fetch 可能因 CORS/混合内容等限制抛出异常
      // 策略 1：no-cors fetch（不读 body，仅验证 TCP 握手 + HTTP 响应头）
      // 策略 2：失败时 fallback 到 WebSocket 连接探测
      if (s.state === "running" && s.port) {
        let alive = false;
        // 策略 1：no-cors fetch → 只要能拿到响应（即使 opaque），就说明端口在监听
        try {
          await fetch(`http://127.0.0.1:${s.port}/`, {
            mode: "no-cors",
            signal: AbortSignal.timeout(TCP_PROBE_TIMEOUT),
          });
          alive = true;
        } catch (err: any) {
          console.warn(
            `[GatewayTab] fetch liveness 失败: name=${err?.name}, message=${err?.message}, ` +
            `port=${s.port}, timeout=${TCP_PROBE_TIMEOUT}ms`,
          );
          // 策略 2：尝试用 WebSocket 连接探测（OpenClaw Gateway 监听同一端口）
          try {
            alive = await new Promise<boolean>((resolve) => {
              const ws = new WebSocket(`ws://127.0.0.1:${s.port}`);
              const timer = setTimeout(() => { ws.close(); resolve(false); }, TCP_PROBE_TIMEOUT);
              ws.onopen = () => { clearTimeout(timer); ws.close(); resolve(true); };
              ws.onerror = () => { clearTimeout(timer); resolve(false); };
            });
            if (alive) {
              console.log(`[GatewayTab] WS liveness probe 成功 (port=${s.port})`);
            } else {
              console.warn(`[GatewayTab] WS liveness probe 也失败 (port=${s.port})`);
            }
          } catch (wsErr: any) {
            console.warn(`[GatewayTab] WS liveness probe 异常: ${wsErr?.message}`);
          }
        }
        setLiveness(alive ? "alive" : "dead");
      } else {
        setLiveness("dead");
      }
    } catch (err) { console.warn("[SystemPage] GatewayTab.fetchStatus failed:", err);
      // IPC 失败：sidecar 不可用，状态无法获取
      setLiveness("dead");
    }
  };

  // 挂载立即拉 + 每 5s 轮询（解决 sidecar 重启后状态延迟恢复的问题）
  React.useEffect(() => { fetchStatus(); const t = setInterval(fetchStatus, 5000); return () => clearInterval(t); }, []);

  // 轮询日志（增量拉取，只展示当次 Gateway 启动后的条目）
  const lastLogIdRef = React.useRef<number | null>(null);
  const startedAtRef = React.useRef<number>(0);
  const lastEntryCountRef = React.useRef(-1);  // 上次拉取的条目数，抑制空轮询重复日志

  // status 拿到后记录当次启动时间
  React.useEffect(() => {
    if (status?.started_at) {
      startedAtRef.current = status.started_at;
    }
  }, [status?.started_at]);

  React.useEffect(() => {
    if (status?.state !== "running") return;
    // 重置：切换到新 Gateway 时清空旧日志
    setLogs([]);
    lastLogIdRef.current = null;
    lastEntryCountRef.current = -1;

    let active = true;

    const doPoll = async () => {
      if (!active) return;
      try {
        const ipc = await getIpc();
        const args = lastLogIdRef.current !== null
          ? { sinceId: lastLogIdRef.current }
          : { n: LOG_INITIAL_BATCH };
        const result = await ipc.tailGatewayLog(args);
        if (!active) return;
        if (result?.entries && result.entries.length > 0) {
          // 记录最大 id，下次增量拉取
          lastLogIdRef.current = result.max_id;
          // FIX-LOGS-STUCK: 不再用 startedAt 过滤 —— 复用旧 Gateway 进程时，
          // 新 sidecar 写入的 started_at 远晚于实际 Gateway 启动时间，
          // 缓冲区里的真实日志条目时间戳全部小于 started_at → 全部被过滤 → UI 永远空。
          // 直接展示缓冲区所有条目即可（gateway_log 自身已按时间排序 + 上限保护）。
          const filtered = result.entries;
          if (filtered.length === 0) {
            // 仅在条目数变化到 0 时打印一次，抑制稳态空轮询噪声
            if (lastEntryCountRef.current !== 0) {
              console.log(
                `[GatewayTab] doPoll: got ${result.entries.length} entries (no filter applied)`,
              );
            }
            lastEntryCountRef.current = 0;
            return;
          }
          lastEntryCountRef.current = filtered.length;
          const newLines = filtered.map((e: any) => {
            const time = new Date(e.ts * 1000).toLocaleTimeString("zh-CN", { hour12: false });
            return `${time} ${e.level || ""} ${e.text || ""}`;
          });
          // 性能保护：只保留最新 LOG_MAX_BUFFER 条
          setLogs(prev => {
            const merged = [...prev, ...newLines];
            return merged.length > LOG_MAX_BUFFER ? merged.slice(-LOG_MAX_BUFFER) : merged;
          });
        } else {
          // 日志为空：首次轮询打印诊断信息
          if (lastLogIdRef.current === null) {
            console.log(
              `[GatewayTab] doPoll: tailGatewayLog returned ${result?.entries?.length ?? -1} entries, ` +
              `buffer_size=${result?.buffer_size ?? "?"}, max_id=${result?.max_id ?? "?"}`,
            );
          }
        }
      } catch (err: any) {
        // 日志拉取失败（sidecar 不可用等）→ 打印诊断便于排查
        console.warn(`[GatewayTab] doPoll failed:`, err?.message || err);
      }
    };

    // 立即执行首次拉取（不等待 interval，页面打开即加载）
    doPoll();
    // 之后以 LOG_POLL_INTERVAL 频率增量轮询
    const timer = setInterval(doPoll, LOG_POLL_INTERVAL);
    return () => { active = false; clearInterval(timer); };
  }, [status?.state]);

  const handleStart = async () => {
    setStartPhase("starting");
    setStartError(null);
    try {
      const ipc = await getIpc();
      const isRestart = status?.state === "running";
      const result = isRestart
        ? await ipc.restartGateway()
        : await ipc.startGateway();

      if (!result?.success) {
        setStartPhase("failed");
        setStartError(result?.message || "启动失败");
        return;
      }

      // Gateway spawn 成功，等待就绪
      setStartPhase("waiting");
      await new Promise((r) => setTimeout(r, 1500));
      await fetchStatus();

      setStartPhase("success");
      // 3 秒后自动恢复 idle，防止成功提示一直挂着
    } catch (e: any) {
      setStartPhase("failed");
      setStartError(e?.message || String(e) || "启动异常");
    }
  };

  // 综合判定显示状态：sidecar 报告 + TCP 存活检测
  const sidecarState = status?.state ?? "stopped";
  const isLivenessDead = sidecarState === "running" && liveness === "dead";
  const isChecking = sidecarState === "running" && liveness === "checking";

  const state: string = isLivenessDead ? "unresponsive" : sidecarState;
  const dotClass = state === "running" ? "bg-emerald-400"
    : state === "unresponsive" ? "bg-amber-400 animate-pulse"
    : state === "errored" ? "bg-red-400"
    : "bg-muted-foreground/40";
  const stateLabel = state === "running" ? "运行中"
    : state === "unresponsive" ? "无响应"
    : state === "errored" ? "异常"
    : "未运行";

  // 日志区域空状态文案：根据 Gateway 状态给出不同提示
  const logEmptyMessage = (() => {
    if (sidecarState === "running" && isChecking) return "检测 Gateway 连通性...";
    if (sidecarState === "running" && isLivenessDead) return "Gateway 端口无响应（进程可能已退出）";
    if (sidecarState === "running") return "Gateway 运行中，正在加载日志...";
    if (sidecarState === "errored") return "Gateway 异常，暂无日志";
    return "Gateway 未运行，暂无日志";
  })();

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
      <div className={GLASS + " p-4"}>
        <div className="flex items-center gap-3">
          <span className={`flex h-3 w-3 rounded-full ${dotClass}`} />
          <span className="text-sm font-medium">{stateLabel}</span>
          {isLivenessDead && (
            <span className="text-[11px] text-amber-400">(sidecar 报告运行中但端口不通)</span>
          )}
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          PID: {status?.pid ?? "—"} · 端口: {status?.port ?? 19789} · 启动: {status?.started_at ? new Date(status.started_at * 1000).toLocaleString("zh-CN") : "—"}
        </div>
        {state === "errored" && status?.last_error && <div className="mt-2 rounded bg-red-500/10 px-2 py-1 text-xs text-red-400">{status.last_error}</div>}
        <div className="mt-3 flex items-center gap-2">
          <button
            className="rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground shadow-[0_4px_16px_-4px_hsl(var(--primary)/0.5)] disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
            onClick={handleStart}
            disabled={busy}
          >
            {busy ? (
              <>
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                {startPhase === "starting" ? "正在启动..." : "等待就绪..."}
              </>
            ) : (
              state === "running" ? "↻ 重启 Gateway" : state === "unresponsive" ? "↻ 强制重启 Gateway" : "▶ 启动 Gateway"
            )}
          </button>
          <button className="rounded-full border border-white/[0.10] bg-white/[0.05] px-4 py-1.5 text-xs backdrop-blur-md disabled:opacity-40" disabled={state !== "running"} onClick={async () => { const ipc = await getIpc(); try { await ipc.openOpenClawWebUi(); } catch {} }}>
            🌐 OpenClaw Web UI
          </button>
        </div>
        {/* 启动/重启进度反馈 */}
        {startPhase === "success" && (
          <div className="mt-2 rounded bg-emerald-500/10 px-2 py-1 text-xs text-emerald-400 inline-flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Gateway 启动成功，正在连接...
          </div>
        )}
        {startPhase === "failed" && (
          <div className="mt-2 rounded bg-red-500/10 px-2 py-1 text-xs text-red-400 flex items-center gap-2">
            <span>❌ {startError || "启动失败"}</span>
            <button className="underline hover:text-red-300 ml-auto shrink-0" onClick={() => setStartPhase("idle")}>关闭</button>
          </div>
        )}
        {startPhase === "starting" && (
          <div className="mt-2 text-[11px] text-muted-foreground">正在通过 sidecar 启动 Gateway 进程...</div>
        )}
        {startPhase === "waiting" && (
          <div className="mt-2 text-[11px] text-muted-foreground">Gateway 进程已创建，等待端口就绪...</div>
        )}
      </div>
      <div className={GLASS + " flex-1 flex flex-col overflow-hidden p-4"}>
        <LogView logs={logs} emptyMessage={logEmptyMessage} />
      </div>
    </div>
  );
}

// ─── 运行状态 Tab ───────────────────────────────────────────────────────────

function StatusTab() {
  const [deploy, setDeploy] = React.useState<DeployValidationResult | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [dccStatus, setDccStatus] = React.useState<{name: string; port: number | null; mcpListening: boolean; gatewayConnected: boolean}[]>([]);

  const runDeployCheck = async () => {
    setChecking(true);
    try { const ipc = await getIpc(); const v = await ipc.validateDeployments(); setDeploy(v); } catch {} finally { setChecking(false); }
  };

  const refreshDCC = async () => {
    try {
      const ipc = await getIpc();
      const items: {name: string; port: number | null; mcpListening: boolean; gatewayConnected: boolean}[] = [];
      // 先检查 Gateway 是否在运行
      let gatewayRunning = false;
      try {
        const ocStatus = await ipc.getOpenClawStatus();
        gatewayRunning = ocStatus.gateway_running;
      } catch (err) { console.warn("[SystemPage] StatusTab.refreshDCC getOpenClawStatus failed:", err); }

      // 获取 MCP Bridge 状态（一次调用检测所有 DCC）
      let bridgeStatus: any = null;
      if (gatewayRunning) {
        try { bridgeStatus = await ipc.getMCPBridgeStatus(); } catch (err) {
          console.warn("[SystemPage] StatusTab.refreshDCC getMCPBridgeStatus failed:", err);
        }
      }

      // ── Blender ──
      try {
        const p = await ipc.getDCCPort("blender");
        let mcpListening = false;
        let gatewayConnected = false;
        if (gatewayRunning && bridgeStatus) {
          if (bridgeStatus.blenderConnected) {
            gatewayConnected = true;
            mcpListening = true;
          } else {
            try { await fetch(`http://127.0.0.1:${p.port}`, { mode: "no-cors", signal: AbortSignal.timeout(1500) }); mcpListening = true; } catch {}
          }
        } else if (gatewayRunning) {
          try { await fetch(`http://127.0.0.1:${p.port}`, { mode: "no-cors", signal: AbortSignal.timeout(1500) }); mcpListening = true; } catch {}
        } else {
          try { await fetch(`http://127.0.0.1:${p.port}`, { mode: "no-cors", signal: AbortSignal.timeout(1500) }); mcpListening = true; } catch {}
        }
        items.push({ name: "Blender", port: p.port, mcpListening, gatewayConnected });
      } catch { items.push({ name: "Blender", port: null, mcpListening: false, gatewayConnected: false }); }

      // ── Unreal Engine ──
      try {
        const p = await ipc.getDCCPort("unreal");
        let mcpListening = false;
        let gatewayConnected = false;
        if (gatewayRunning && bridgeStatus) {
          if (bridgeStatus.unrealConnected) {
            gatewayConnected = true;
            mcpListening = true;
          } else {
            try { await fetch(`http://127.0.0.1:${p.port}`, { mode: "no-cors", signal: AbortSignal.timeout(1500) }); mcpListening = true; } catch {}
          }
        } else if (gatewayRunning) {
          try { await fetch(`http://127.0.0.1:${p.port}`, { mode: "no-cors", signal: AbortSignal.timeout(1500) }); mcpListening = true; } catch {}
        } else {
          try { await fetch(`http://127.0.0.1:${p.port}`, { mode: "no-cors", signal: AbortSignal.timeout(1500) }); mcpListening = true; } catch {}
        }
        items.push({ name: "Unreal", port: p.port, mcpListening, gatewayConnected });
      } catch { items.push({ name: "Unreal", port: null, mcpListening: false, gatewayConnected: false }); }

      setDccStatus(items);
    } catch (err) { console.warn("[SystemPage] StatusTab.refreshDCC failed:", err); }
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
          <Button variant="outline" size="sm" className="h-6 text-[11px] rounded-full" onClick={refreshDCC}>刷新</Button>
        </div>
        <div className="mt-2 space-y-1.5 text-xs">
          {dccStatus.length === 0 && <div className="text-muted-foreground">点击刷新检测</div>}
          {dccStatus.map((d) => (
            <div key={d.name} className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${d.gatewayConnected ? "bg-emerald-400" : d.mcpListening ? "bg-amber-400" : d.port ? "bg-muted-foreground/40" : "bg-muted-foreground/40"}`} />
              <span>{d.name}</span>
              <span className="text-muted-foreground">
                {d.gatewayConnected ? `Gateway 已连接 · ws://127.0.0.1:${d.port}` : d.mcpListening ? `MCP Server 监听中(${d.port}) · Gateway 未连接` : d.port ? `端口已配置(${d.port}) · MCP Server 未启动` : "未配置"}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-[16px] border border-white/[0.08] bg-white/[0.04] p-4 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">部署校验</span>
          <div className="flex-1" />
          <Button variant="outline" size="sm" className="h-6 text-[11px] rounded-full" onClick={runDeployCheck} disabled={checking}>
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

// ─── 数据管理 Tab（STORY-0041）──────────────────────────────────────────────

const PRESERVE_LABELS: Record<string, string> = {
  preserveProvidersAndAuth: "供应商配置 + API 凭据",
  preserveAgents: "Agent 配置 + 工作空间",
  preservePluginsAndMemory: "插件配置 + Memory",
  preserveMCPServers: "MCP 服务器配置",
  preserveSkills: "Skill",
};

function DataManagementTab() {
  const [backups, setBackups] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [msg, setMsg] = React.useState("");
  const [msgType, setMsgType] = React.useState<"info" | "error">("info");
  const { showConfirm, showForm, DialogUI } = useAppDialog();

  const showMessage = (text: string, type: "info" | "error" = "info") => {
    setMsg(text);
    setMsgType(type);
    setTimeout(() => setMsg(""), 8000);
  };

  const refreshBackups = async () => {
    try {
      const ipc = await getIpc();
      const r = await ipc.listOpenClawBackups();
      setBackups(r.backups || []);
    } catch (e: any) {
      showMessage(`获取备份列表失败: ${e.message}`, "error");
    }
  };

  React.useEffect(() => { refreshBackups(); }, []);

  const handleBackup = async () => {
    const result = await showForm("备份配置", [
      { key: "preserveProvidersAndAuth", label: PRESERVE_LABELS.preserveProvidersAndAuth, defaultValue: "true", type: "checkbox" },
      { key: "preserveAgents", label: PRESERVE_LABELS.preserveAgents, defaultValue: "true", type: "checkbox" },
      { key: "preservePluginsAndMemory", label: PRESERVE_LABELS.preservePluginsAndMemory, defaultValue: "true", type: "checkbox" },
      { key: "preserveMCPServers", label: PRESERVE_LABELS.preserveMCPServers, defaultValue: "true", type: "checkbox" },
      { key: "preserveSkills", label: PRESERVE_LABELS.preserveSkills, defaultValue: "true", type: "checkbox" },
    ], { confirmLabel: "执行备份" });
    if (!result) return;

    setLoading(true);
    try {
      const options: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(result)) {
        options[k] = v === "true";
      }
      const ipc = await getIpc();
      const r = await ipc.backupOpenClaw(options);
      if (r.success) {
        showMessage(`备份完成 — 时间戳: ${r.timestamp}, ${r.items.length} 项, ${(r.total_size_bytes / 1024).toFixed(0)} KB`);
        await refreshBackups();
      } else {
        showMessage(`备份失败: ${r.error}`, "error");
      }
    } catch (e: any) {
      showMessage(`备份异常: ${e.message}`, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async (backup: any) => {
    const ok = await showConfirm(
      `从备份 ${backup.timestamp} 恢复？`,
      `将全新安装 OpenClaw 并恢复以下数据: ${backup.items.map((i: string) => PRESERVE_LABELS[i] || i).join("、")}`
    );
    if (!ok) return;

    setLoading(true);
    try {
      const options: Record<string, boolean> = {};
      for (const item of backup.items) {
        options[item] = true;
      }
      const ipc = await getIpc();
      const r = await ipc.restoreOpenClaw({
        backupTimestamp: backup.timestamp,
        preserveOptions: options,
      });
      if (r.success) {
        showMessage("恢复完成");
        await refreshBackups();
      } else {
        showMessage(`恢复失败: ${r.errors?.map((e: any) => e.item).join(", ") || r.error}`, "error");
      }
    } catch (e: any) {
      showMessage(`恢复异常: ${e.message}`, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (backup: any) => {
    const ok = await showConfirm(`确认删除备份 ${backup.timestamp}？`, "删除后不可恢复。");
    if (!ok) return;
    try {
      const ipc = await getIpc();
      const r = await ipc.deleteOpenClawBackup(backup.timestamp);
      if (r.success) {
        showMessage(`备份 ${backup.timestamp} 已删除`);
        await refreshBackups();
      } else {
        showMessage(`删除失败: ${r.error}`, "error");
      }
    } catch (e: any) {
      showMessage(`删除异常: ${e.message}`, "error");
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="flex h-full flex-col overflow-hidden p-4">
      <DialogUI />
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm font-medium">数据管理</span>
        <div className="flex-1" />
        <Button variant="outline" size="sm" className="h-6 text-[11px] rounded-full" onClick={handleBackup} disabled={loading}>
          {loading ? "备份中..." : "备份数据"}
        </Button>
        <Button variant="outline" size="sm" className="h-6 text-[11px] rounded-full" onClick={refreshBackups} disabled={loading}>
          刷新
        </Button>
      </div>

      {msg && (
        <div className={`mb-3 rounded-lg px-3 py-2 text-xs ${msgType === "error" ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-400"}`}>
          {msg}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {backups.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground pt-8">
            暂无备份。点击「备份数据」创建第一个备份。
          </div>
        ) : (
          <div className="space-y-2">
            {backups.map((b: any) => (
              <div key={b.timestamp} className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">{b.timestamp}</span>
                  <span className="text-[10px] text-muted-foreground">{formatBytes(b.size_bytes)}</span>
                  <div className="flex-1" />
                  <Button variant="outline" size="sm" className="h-5 text-[10px] rounded-full px-2" onClick={() => handleRestore(b)} disabled={loading}>
                    恢复
                  </Button>
                  <Button variant="outline" size="sm" className="h-5 text-[10px] rounded-full px-2 text-red-400" onClick={() => handleDelete(b)} disabled={loading}>
                    删除
                  </Button>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {b.items.map((item: string) => (
                    <span key={item} className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[10px] text-muted-foreground">
                      {PRESERVE_LABELS[item] || item}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
