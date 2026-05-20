"use client";

/**
 * ToolDetailPanel — Nexus-Tool 详情面板（5 标签页）
 *
 *   1. 基本信息（Info）— 全字段可编辑（名称/描述/作者/版本/DCC/实现方式）
 *   2. 脚本参数（Params）— 参数名/类型/默认值/描述/必填 可编辑 + list/dict 多输入框
 *   3. 筛选条件（Filters）— DCC 选择 + ObjectTypePicker + 路径规则（分页）
 *   4. 触发器（Triggers）— 事件触发规则的增删改+启用开关
 *
 * 底部操作栏：[刷新] [另存为实例] [保存修改]
 */

import * as React from "react";
import {
  Info,
  Sliders,
  Save,
  Zap,
  Plus,
  Trash2,
  Check,
  X,
  RefreshCw,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Copy,
  Filter,
  GitBranch,
} from "lucide-react";
import { Button, Input, cn } from "@artifex-nexus/ui";
import { invoke } from "@tauri-apps/api/core";
import { ScrollFade } from "../chat/ScrollFade";
import { DCCStatusContext } from "../shell/AppShell";
import { FiltersTab } from "./FiltersTab";
import TriggerRuleEditor, { type TriggerFormData } from "./TriggerRuleEditor";
import { getEventLabel, hasDCCEvents } from "../../lib/nexus-tool/dcc-events";
import {
  nexusToolDetail,
  nexusToolUpdate,
  nexusToolSaveTriggers,
  nexusToolSaveAsInstance,
  nexusToolList,
  type NexusToolDetail,
  type NexusToolParam,
  type DCCEntry,
  type NexusToolTrigger,
  type FilterConfig,
  type TriggerType,
  type ExecutionMode,
} from "../../lib/nexus-tool/nexus-tool-api";
import {
  SOURCE_LABELS,
  DCC_LABELS,
} from "../../lib/skillsMock";

// ─── 类型 ──────────────────────────────────────────────────────────────────

type TabId = "info" | "params" | "filters" | "triggers";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "info", label: "基本信息", icon: <Info className="h-3.5 w-3.5" /> },
  { id: "params", label: "脚本参数", icon: <Sliders className="h-3.5 w-3.5" /> },
  { id: "filters", label: "筛选条件", icon: <Filter className="h-3.5 w-3.5" /> },
  { id: "triggers", label: "触发器", icon: <Zap className="h-3.5 w-3.5" /> },
];

const SOURCE_COLORS: Record<string, string> = {
  official: "text-blue-400 bg-blue-500/10",
  marketplace: "text-purple-400 bg-purple-500/10",
  user: "text-green-400 bg-green-500/10",
};

const PARAM_TYPE_OPTIONS = [
  { value: "string", label: "字符串" },
  { value: "number", label: "数字" },
  { value: "boolean", label: "布尔" },
  { value: "select", label: "下拉选择" },
  { value: "object", label: "对象" },
  { value: "list", label: "列表" },
  { value: "dict", label: "字典" },
];

// ─── 主组件 ────────────────────────────────────────────────────────────────

interface ToolDetailPanelProps {
  toolId: string;
  /** 数据刷新后回调 */
  onLoaded?: (detail: NexusToolDetail) => void;
  /** 紧凑模式（D5 侧面板用） */
  compact?: boolean;
  /** 外部变动通知 */
  refreshKey?: number;
}

export function ToolDetailPanel({ toolId, onLoaded, compact, refreshKey }: ToolDetailPanelProps) {
  const [activeTab, setActiveTab] = React.useState<TabId>("info");
  const [detail, setDetail] = React.useState<NexusToolDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [saveMsg, setSaveMsg] = React.useState<string | null>(null);

  // ── 编辑态 ────────────────────────────────────────────────────────────

  const [editedName, setEditedName] = React.useState("");
  const [editedDescription, setEditedDescription] = React.useState("");
  const [editedAuthor, setEditedAuthor] = React.useState("");
  const [editedVersion, setEditedVersion] = React.useState("");
  const [editedSoftware, setEditedSoftware] = React.useState<DCCEntry[]>([]);
  const [editedInputs, setEditedInputs] = React.useState<NexusToolParam[]>([]);
  const [editedFilters, setEditedFilters] = React.useState<FilterConfig>({});
  const [triggers, setTriggers] = React.useState<NexusToolTrigger[]>([]);

  // ── 另存为实例 ────────────────────────────────────────────────────────

  const [showSaveAs, setShowSaveAs] = React.useState(false);
  const [saveAsName, setSaveAsName] = React.useState("");
  const [saveAsDesc, setSaveAsDesc] = React.useState("");

  // ── 加载详情 ──────────────────────────────────────────────────────────

  const loadDetail = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setSaveMsg(null);
      const d = await nexusToolDetail(toolId);
      setDetail(d);

      setEditedName(d.name);
      setEditedDescription(d.description || "");
      setEditedAuthor(d.author || "");
      setEditedVersion(d.version);
      setEditedSoftware(d.software || []);
      setEditedInputs(d.inputs?.map((p) => ({ ...p })) || []);
      setEditedFilters(d.default_filters || {});
      setTriggers(d.triggers || []);
      setDirty(false);
      setShowSaveAs(false);

      onLoaded?.(d);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [toolId, onLoaded, refreshKey]);

  React.useEffect(() => { loadDetail(); }, [loadDetail]);

  const markDirty = React.useCallback(() => setDirty(true), []);
  const fieldCls =
    "h-7 rounded-[12px] border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-3 text-xs focus:outline-none focus:border-primary/40 transition-colors font-mono";

  // ── 保存修改 ──────────────────────────────────────────────────────────

  const handleSave = React.useCallback(async () => {
    if (!detail) return;
    setSaving(true);
    setError(null);
    try {
      const savedFilters = {
        ...editedFilters,
        path: editedFilters.path?.filter((r) => r.pattern.trim()),
      };
      const manifestPatch: Record<string, unknown> = {
        inputs: editedInputs,
        outputs: detail.outputs || [],
        triggers,
        defaultFilters: savedFilters,
        implementation: detail.implementation || {},
      };
      await nexusToolUpdate(detail.id, {
        name: editedName,
        description: editedDescription,
        author: editedAuthor,
        version: editedVersion,
        software: editedSoftware,
        manifest: manifestPatch,
      });
      setDirty(false);
      setSaveMsg("保存成功");
      setTimeout(() => setSaveMsg(null), 2000);
      await loadDetail();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [detail, editedName, editedDescription, editedAuthor, editedVersion,
      editedSoftware, editedInputs, editedFilters,
      triggers, loadDetail]);

  // ── 另存为实例 ────────────────────────────────────────────────────────

  const handleSaveAsInstance = React.useCallback(async () => {
    if (!detail) return;
    const baseName = saveAsName.trim();
    if (!baseName) return;

    setSaving(true);
    setError(null);
    try {
      // 检查同名工具，自动编号避免冲突
      let finalName = baseName;
      try {
        const existing = await nexusToolList({ search: finalName, limit: 50 });
        const existingNames = new Set(existing.items.map((t) => t.name));
        if (existingNames.has(finalName)) {
          let counter = 2;
          while (existingNames.has(`${baseName}-${String(counter).padStart(2, "0")}`)) {
            counter++;
          }
          finalName = `${baseName}-${String(counter).padStart(2, "0")}`;
        }
      } catch {
        // list 失败不阻塞，直接尝试创建
      }

      await nexusToolSaveAsInstance({
        name: finalName,
        description: saveAsDesc.trim() || editedDescription,
        inputs: editedInputs,
        outputs: detail.outputs || [],
        filters: editedFilters,
        triggers,
        implementation: detail.implementation,
        parentId: detail.id,
        parentName: detail.name,
        parentPath: detail.nexus_tool_path,
        software: editedSoftware,
        version: editedVersion,
      });
      setShowSaveAs(false);
      setSaveAsName("");
      setSaveAsDesc("");
      setSaveMsg(`实例 "${finalName}" 已创建`);
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [detail, saveAsName, saveAsDesc, editedDescription, editedInputs,
      editedFilters, triggers, editedSoftware, editedVersion]);

  // ── 触发器操作（保持现有逻辑）─────────────────────────────────────────

  const handleSaveTriggers = React.useCallback(async (t: NexusToolTrigger[]) => {
    if (!detail) return;
    setSaving(true);
    try {
      await nexusToolSaveTriggers(detail.id, t);
      setTriggers(t);
      markDirty();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [detail, markDirty]);

  // ── 渲染 ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center p-6 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />加载中...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-4 text-red-400">
        <AlertCircle className="h-5 w-5" />
        <span className="text-xs">加载失败: {error}</span>
        <Button variant="outline" size="sm" onClick={loadDetail}>重试</Button>
      </div>
    );
  }

  if (!detail) {
    return <div className="p-4 text-xs text-muted-foreground">工具不存在</div>;
  }

  const isInstance = !!(detail.instance_of);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Tab 栏 */}
      <div className="flex shrink-0 border-b border-border/60 bg-muted/20 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors border-b-2 -mb-px",
              activeTab === tab.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground/80",
              compact && "px-2 py-1.5 text-[11px]",
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.id === "params" && editedInputs.length > 0 && (
              <span className="ml-0.5 rounded bg-muted px-1 text-[10px]">{editedInputs.length}</span>
            )}
            {tab.id === "filters" && editedFilters.path?.length ? (
              <span className="ml-0.5 rounded bg-muted px-1 text-[10px]">{editedFilters.path.length}</span>
            ) : null}
            {tab.id === "triggers" && triggers.length > 0 && (
              <span className="ml-0.5 rounded bg-muted px-1 text-[10px]">{triggers.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* 提示条 */}
      {saveMsg && (
        <div className="flex shrink-0 items-center gap-2 bg-emerald-500/10 border-b border-emerald-500/20 px-3 py-1.5">
          <Check className="h-3 w-3 text-emerald-400" />
          <span className="text-[11px] text-emerald-400">{saveMsg}</span>
        </div>
      )}

      {/* Tab 内容 */}
      <ScrollFade className="flex-1">
        <div className="p-3">
          {activeTab === "info" && (
            <InfoTab
              detail={detail}
              isInstance={isInstance}
              editedName={editedName} setEditedName={(v) => { setEditedName(v); markDirty(); }}
              editedDescription={editedDescription} setEditedDescription={(v) => { setEditedDescription(v); markDirty(); }}
              editedAuthor={editedAuthor} setEditedAuthor={(v) => { setEditedAuthor(v); markDirty(); }}
              editedVersion={editedVersion} setEditedVersion={(v) => { setEditedVersion(v); markDirty(); }}
              editedSoftware={editedSoftware} setEditedSoftware={(v) => { setEditedSoftware(v); markDirty(); }}
              inputsCount={editedInputs.length}
              triggersCount={triggers.length}
              compact={compact}
            />
          )}
          {activeTab === "params" && (
            <ParamsTab
              isInstance={isInstance}
              inputs={editedInputs}
              onChange={(v) => { setEditedInputs(v); markDirty(); }}
              outputs={detail.outputs}
              compact={compact}
            />
          )}
          {activeTab === "filters" && (
            <FiltersTab
              filters={editedFilters}
              onChange={(v) => { setEditedFilters(v); markDirty(); }}
              software={editedSoftware.length > 0 ? editedSoftware : detail.software || []}
              compact={compact}
            />
          )}
          {activeTab === "triggers" && (
            <TriggersTab
              detail={detail}
              triggers={triggers}
              onSave={handleSaveTriggers}
              saving={saving}
              compact={compact}
              toolEnabled={detail.is_enabled}
            />
          )}
        </div>
      </ScrollFade>

      {/* 底部操作栏 */}
      <div className="flex shrink-0 items-center gap-2 border-t border-border/60 px-3 py-2">
        {/* 另存为实例 — 内联表单 */}
        {showSaveAs ? (
          <div className="flex flex-1 flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <Input
                className="h-7 flex-1 text-xs"
                placeholder="实例名称"
                value={saveAsName}
                onChange={(e) => setSaveAsName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveAsInstance()}
                autoFocus
              />
              <Input
                className="h-7 flex-1 text-xs"
                placeholder="描述（可选）"
                value={saveAsDesc}
                onChange={(e) => setSaveAsDesc(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveAsInstance()}
              />
            </div>
            <div className="flex justify-end gap-1.5">
              <Button variant="outline" size="sm" className="h-6 text-[11px]" onClick={() => setShowSaveAs(false)}>
                取消
              </Button>
              <Button size="sm" className="h-6 text-[11px]" onClick={handleSaveAsInstance} disabled={!saveAsName.trim() || saving}>
                {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Copy className="mr-1 h-3 w-3" />}
                创建实例
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={loadDetail} title="刷新">
              <RefreshCw className="mr-1 h-3 w-3" />
              刷新
            </Button>
            <div className="flex-1" />
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => {
              setSaveAsName(editedName + " (实例)");
              setSaveAsDesc("");
              setShowSaveAs(true);
            }}>
              <GitBranch className="mr-1 h-3 w-3" />
              另存为实例
            </Button>
            <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={!dirty || saving}>
              {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Save className="mr-1 h-3 w-3" />}
              保存修改
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Tab 1: 基本信息（全可编辑）
// ═══════════════════════════════════════════════════════════════════════════

function InfoTab({
  detail, isInstance,
  editedName, setEditedName,
  editedDescription, setEditedDescription,
  editedAuthor, setEditedAuthor,
  editedVersion, setEditedVersion,
  editedSoftware, setEditedSoftware,
  inputsCount, triggersCount,
  compact,
}: {
  detail: NexusToolDetail;
  isInstance: boolean;
  editedName: string; setEditedName: (v: string) => void;
  editedDescription: string; setEditedDescription: (v: string) => void;
  editedAuthor: string; setEditedAuthor: (v: string) => void;
  editedVersion: string; setEditedVersion: (v: string) => void;
  editedSoftware: DCCEntry[]; setEditedSoftware: (v: DCCEntry[] | ((prev: DCCEntry[]) => DCCEntry[])) => void;
  inputsCount: number; triggersCount: number;
  compact?: boolean;
}) {
  const fieldCls =
    "h-7 rounded-[12px] border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-3 text-xs focus:outline-none focus:border-primary/40 transition-colors w-full appearance-none";
  const selectCls =
    "h-8 w-full rounded-md border border-input bg-input px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring [color-scheme:dark] [&_option]:bg-card [&_option]:text-foreground";
  const labelCls = "text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1";

  const toggleDCC = (dcc: string) => {
    if (editedSoftware.some((e) => e.dcc === dcc)) {
      setEditedSoftware(editedSoftware.filter((e) => e.dcc !== dcc));
    } else {
      setEditedSoftware([...editedSoftware, { dcc }]);
    }
  };

  const updateDCCVersion = (dcc: string, field: "minVersion" | "maxVersion", value: string) => {
    setEditedSoftware((prev) =>
      prev.map((e) => (e.dcc === dcc ? { ...e, [field]: value } : e))
    );
  };

  return (
    <div className="space-y-4">
      {/* 实例标签 */}
      {isInstance && (
        <div className="rounded border border-amber-500/30 bg-amber-500/[0.04] px-3 py-2.5 space-y-1">
          <div className="flex items-center gap-2">
            <GitBranch className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-xs font-medium text-amber-400">工具实例</span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            <span>父级工具: </span>
            <span className="text-amber-300/80 font-mono">{detail.parent_name || detail.instance_of}</span>
          </div>
          {detail.parent_path && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60 font-mono break-all">
              <ExternalLink className="h-2.5 w-2.5 shrink-0" />
              {detail.parent_path}
            </div>
          )}
        </div>
      )}

      {/* 标题图标 */}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-lg font-bold text-primary">
          {editedName.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{editedName}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-mono text-muted-foreground">v{editedVersion}</span>
            {detail.source && (
              <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", SOURCE_COLORS[detail.source] || "text-muted-foreground bg-muted")}>
                {(SOURCE_LABELS as Record<string, string>)[detail.source] || detail.source}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── 可编辑字段 ── */}

      <div>
        <div className={labelCls}>名称</div>
        <input value={editedName} onChange={(e) => setEditedName(e.target.value)} className={fieldCls} />
      </div>

      <div>
        <div className={labelCls}>描述</div>
        <textarea
          value={editedDescription}
          onChange={(e) => setEditedDescription(e.target.value)}
          rows={3}
          className="w-full rounded border border-border/60 bg-muted/20 px-2 py-1.5 text-xs focus:outline-none focus:border-primary/40 transition-colors resize-y"
        />
      </div>

      <div>
        <div className={labelCls}>作者</div>
        <input value={editedAuthor} onChange={(e) => setEditedAuthor(e.target.value)} placeholder="作者名称" className={fieldCls} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className={labelCls}>版本</div>
          <input value={editedVersion} onChange={(e) => setEditedVersion(e.target.value)} className={fieldCls} />
        </div>
        <div>
          <div className={labelCls}>来源</div>
          <div className={cn("flex h-7 items-center px-2 rounded bg-muted/10 border border-border/30 text-xs text-muted-foreground")}>
            {(SOURCE_LABELS as Record<string, string>)[detail.source] || detail.source}
          </div>
        </div>
      </div>

      {/* 目标 DCC */}
      <div>
        <div className={labelCls}>目标软件</div>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(DCC_LABELS).map(([dcc, label]) => {
            const active = editedSoftware.some((e) => e.dcc === dcc);
            return (
              <button
                key={dcc}
                onClick={() => toggleDCC(dcc)}
                className={cn(
                  "px-2 py-0.5 rounded text-[11px] border transition-colors",
                  active
                    ? "bg-primary/15 text-primary border-primary/30"
                    : "bg-muted/20 text-muted-foreground border-border/40 hover:border-border/60",
                )}
              >
                {label as string}
              </button>
            );
          })}
        </div>
        {/* 每个选中 DCC 的版本号输入 */}
        {editedSoftware.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {editedSoftware.map((entry) => (
              <div key={entry.dcc} className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground w-20 shrink-0 truncate">
                  {(DCC_LABELS as Record<string, string>)[entry.dcc] || entry.dcc}
                </span>
                <input
                  className={fieldCls}
                  placeholder="最低版本"
                  value={entry.minVersion || ""}
                  onChange={(e) => updateDCCVersion(entry.dcc, "minVersion", e.target.value)}
                />
                <span className="text-[10px] text-muted-foreground shrink-0">~</span>
                <input
                  className={fieldCls}
                  placeholder="最高版本"
                  value={entry.maxVersion || ""}
                  onChange={(e) => updateDCCVersion(entry.dcc, "maxVersion", e.target.value)}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 只读信息 */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <InfoField label="创建日期" value={detail.created_at?.slice(0, 10) || "—"} />
        <InfoField label="更新日期" value={detail.updated_at?.slice(0, 10) || "—"} />
      </div>

      {detail.implementation && (
        <div>
          <div className={labelCls}>执行入口</div>
          <div className="space-y-1 rounded bg-muted/30 p-2 font-mono text-[11px]">
            <div><span className="text-muted-foreground">type:</span> {detail.implementation.type || "—"}</div>
            <div><span className="text-muted-foreground">entry:</span> {detail.implementation.entry || "—"}</div>
            <div><span className="text-muted-foreground">fn:</span> {detail.implementation.function || "—"}</div>
          </div>
        </div>
      )}

      {detail.nexus_tool_path && (
        <div>
          <div className={labelCls}>工具路径</div>
          <button
            onClick={async () => {
              try {
                await invoke("shell_open_path", { path: detail.nexus_tool_path });
              } catch (e) {
                console.error("打开工具路径失败:", e);
              }
            }}
            className="flex w-full items-center gap-1.5 rounded-[12px] border border-white/[0.08] bg-white/[0.04] backdrop-blur-md px-2 py-1.5 font-mono text-[10px] text-muted-foreground break-all hover:border-primary/40 hover:text-foreground transition-colors text-left"
          >
            <ExternalLink className="h-3 w-3 shrink-0" />
            {detail.nexus_tool_path}
          </button>
        </div>
      )}

      {/* 统计 */}
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span>使用 {detail.use_count || 0} 次</span>
        <span>·</span>
        <span>{inputsCount} 个输入参数</span>
        <span>·</span>
        <span>{detail.outputs?.length || 0} 个输出</span>
        <span>·</span>
        <span>{triggersCount} 个触发器</span>
      </div>
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-muted/20 px-2 py-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="truncate text-[11px]">{value}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Tab 2: 脚本参数（全可编辑）
// ═══════════════════════════════════════════════════════════════════════════

function ParamsTab({
  isInstance, inputs, onChange, outputs, compact,
}: {
  isInstance: boolean;
  inputs: NexusToolParam[];
  onChange: (inputs: NexusToolParam[]) => void;
  outputs?: { id: string; name: string; type: string }[];
  compact?: boolean;
}) {
  const addParam = () => {
    const id = `param_${Date.now()}`;
    onChange([...inputs, { id, name: "", type: "string", required: false, default: "", description: "" }]);
  };

  const updateParam = (idx: number, patch: Partial<NexusToolParam>) => {
    const updated = [...inputs];
    updated[idx] = { ...updated[idx], ...patch };
    onChange(updated);
  };

  const removeParam = (idx: number) => {
    onChange(inputs.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-3">
      {/* ── 输入参数 ── */}
      {inputs.length > 0 && (
        <ParamSection title="输入参数" defaultOpen>
          {inputs.map((param, idx) => (
            <EditableParamRow
              key={param.id}
              param={param}
              idx={idx}
              isInstance={isInstance}
              onUpdate={(patch) => updateParam(idx, patch)}
              onRemove={() => removeParam(idx)}
              compact={compact}
            />
          ))}
        </ParamSection>
      )}

      {/* 添加按钮 */}
      <Button variant="outline" size="sm" className="w-full text-xs" onClick={addParam}>
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        添加参数
      </Button>

      {/* ── 输出参数 ── */}
      {outputs && outputs.length > 0 && (
        <ParamSection title="输出参数" defaultOpen={false}>
          {outputs.map((out) => (
            <div key={out.id} className="flex items-center gap-2 py-1.5 text-xs">
              <span className="w-2 h-2 rounded-full bg-blue-400/30 shrink-0" />
              <span className="font-medium min-w-[60px]">{out.name}</span>
              <span className="text-[10px] rounded bg-muted/30 px-1.5 py-0.5 text-muted-foreground">{out.type}</span>
            </div>
          ))}
        </ParamSection>
      )}

      {inputs.length === 0 && (!outputs || outputs.length === 0) && (
        <div className="py-6 text-center text-xs text-muted-foreground">
          <Sliders className="mx-auto mb-2 h-5 w-5 opacity-40" />
          此工具没有定义参数
        </div>
      )}
    </div>
  );
}

function ParamSection({ title, defaultOpen, children }: { title: string; defaultOpen: boolean; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 pb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground/80 transition-colors"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {title}
      </button>
      {open && <div className="space-y-1 pl-4">{children}</div>}
    </div>
  );
}

function EditableParamRow({
  param, idx, isInstance, onUpdate, onRemove, compact,
}: {
  param: NexusToolParam;
  idx: number;
  isInstance: boolean;
  onUpdate: (patch: Partial<NexusToolParam>) => void;
  onRemove: () => void;
  compact?: boolean;
}) {
  const inputCls =
    "h-6 rounded border border-border/60 bg-muted/20 px-1.5 text-[11px] font-mono focus:outline-none focus:border-primary/40";
  const selectCls =
    "h-6 rounded-md border border-input bg-input px-1.5 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring [color-scheme:dark] [&_option]:bg-card [&_option]:text-foreground";

  // 解析 list/dict 默认值
  const parseListDefault = (): string[] => {
    try {
      const v = param.default;
      if (Array.isArray(v)) return v.map(String);
      if (typeof v === "string" && v.startsWith("[")) return JSON.parse(v) as string[];
    } catch { /* ignore */ }
    return [];
  };

  const parseDictDefault = (): Array<{ key: string; val: string }> => {
    try {
      const v = param.default;
      if (typeof v === "object" && v !== null && !Array.isArray(v)) {
        return Object.entries(v as Record<string, unknown>).map(([k, val]) => ({ key: k, val: String(val) }));
      }
      if (typeof v === "string" && v.startsWith("{")) {
        const obj = JSON.parse(v) as Record<string, unknown>;
        return Object.entries(obj).map(([k, val]) => ({ key: k, val: String(val) }));
      }
    } catch { /* ignore */ }
    return [];
  };

  const listItems = param.type === "list" ? parseListDefault() : [];
  const dictItems = param.type === "dict" ? parseDictDefault() : [];

  const updateListDefault = (items: string[]) => {
    onUpdate({ default: items });
  };

  const updateDictDefault = (items: Array<{ key: string; val: string }>) => {
    const obj: Record<string, string> = {};
    items.forEach(({ key, val }) => { if (key) obj[key] = val; });
    onUpdate({ default: obj });
  };

  return (
    <div className="rounded border border-border/40 bg-muted/5 px-2 py-1.5 space-y-1.5 group">
      {/* 行1: 参数名 + 类型标签 + 必填 + 删除 */}
      <div className="flex items-center gap-1.5">
        <input
          value={param.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="参数名"
          className={cn(inputCls, "flex-1")}
        />
        <span
          className={cn(
            "inline-flex items-center shrink-0 h-6 px-2 rounded-[8px] text-[10px] font-mono",
            "bg-primary/10 text-primary/80 border border-primary/20",
          )}
        >
          {PARAM_TYPE_OPTIONS.find((o) => o.value === param.type)?.label || param.type}
        </span>
        <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={param.required}
            onChange={(e) => onUpdate({ required: e.target.checked })}
            className="w-3 h-3 rounded accent-primary"
          />
          必填
        </label>
        <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0" onClick={onRemove} title="删除参数">
          <Trash2 className="h-3 w-3 text-red-400" />
        </Button>
      </div>

      {/* 行2: 默认值（根据类型不同显示不同编辑器） */}
      {param.type === "list" ? (
        <div className="pl-1 space-y-1">
          <div className="text-[10px] text-muted-foreground">值列表:</div>
          {listItems.map((item, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                value={item}
                onChange={(e) => {
                  const next = [...listItems];
                  next[i] = e.target.value;
                  updateListDefault(next);
                }}
                className={cn(inputCls, "flex-1")}
                placeholder={`项 ${i + 1}`}
              />
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => {
                updateListDefault(listItems.filter((_, j) => j !== i));
              }}>
                <X className="h-2.5 w-2.5 text-muted-foreground" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" className="h-5 text-[10px]" onClick={() => updateListDefault([...listItems, ""])}>
            <Plus className="mr-0.5 h-2.5 w-2.5" />添加项
          </Button>
        </div>
      ) : param.type === "dict" ? (
        <div className="pl-1 space-y-1">
          <div className="text-[10px] text-muted-foreground">键值对:</div>
          {dictItems.map((item, i) => (
            <div key={i} className="flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground shrink-0">K:</span>
              <input
                value={item.key}
                onChange={(e) => {
                  const next = [...dictItems];
                  next[i] = { ...next[i], key: e.target.value };
                  updateDictDefault(next);
                }}
                className={cn(inputCls, "flex-1")}
                placeholder="键"
              />
              <span className="text-[10px] text-muted-foreground shrink-0">V:</span>
              <input
                value={item.val}
                onChange={(e) => {
                  const next = [...dictItems];
                  next[i] = { ...next[i], val: e.target.value };
                  updateDictDefault(next);
                }}
                className={cn(inputCls, "flex-1")}
                placeholder="值"
              />
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => {
                updateDictDefault(dictItems.filter((_, j) => j !== i));
              }}>
                <X className="h-2.5 w-2.5 text-muted-foreground" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" className="h-5 text-[10px]" onClick={() => updateDictDefault([...dictItems, { key: "", val: "" }])}>
            <Plus className="mr-0.5 h-2.5 w-2.5" />添加键值对
          </Button>
        </div>
      ) : param.type === "boolean" ? (
        <div className="flex items-center gap-2 pl-1">
          <span className="text-[10px] text-muted-foreground">默认值:</span>
          <ToggleSwitch
            size="xs"
            checked={!!param.default}
            onChange={(v) => onUpdate({ default: v })}
          />
        </div>
      ) : param.type === "select" && param.options ? (
        <div className="flex items-center gap-2 pl-1">
          <span className="text-[10px] text-muted-foreground shrink-0">默认:</span>
          <select
            value={String(param.default ?? param.options[0] ?? "")}
            onChange={(e) => onUpdate({ default: e.target.value })}
            className={cn(selectCls, "w-32 flex-1")}
          >
            {(param.options || []).map((opt: string) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      ) : (
        <div className="flex items-center gap-2 pl-1">
          <span className="text-[10px] text-muted-foreground shrink-0">默认值:</span>
          <input
            type={param.type === "number" ? "number" : "text"}
            value={param.type === "number" ? (param.default as number ?? "") : String(param.default ?? "")}
            onChange={(e) => {
              const raw = e.target.value;
              if (param.type === "number") {
                onUpdate({ default: raw === "" ? undefined : Number(raw) });
              } else {
                onUpdate({ default: raw });
              }
            }}
            className={cn(inputCls, "flex-1")}
            placeholder="无默认值"
          />
        </div>
      )}

      {/* 行3: 描述 */}
      <div className="flex items-center gap-2 pl-1">
        <span className="text-[10px] text-muted-foreground shrink-0">描述:</span>
        <input
          value={param.description || ""}
          onChange={(e) => onUpdate({ description: e.target.value || undefined })}
          className={cn(inputCls, "flex-1")}
          placeholder="参数说明"
        />
      </div>

      {/* 实例专属：使用源参数 */}
      {isInstance && (
        <div className="pl-1 pt-0.5">
          <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={param.useSourceDefault === true}
              onChange={(e) => onUpdate({ useSourceDefault: e.target.checked })}
              className="w-3 h-3 rounded accent-amber-400"
            />
            使用源参数默认值（继承父工具当前设定）
          </label>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Tab 3: 触发器
// ═══════════════════════════════════════════════════════════════════════════

const TRIGGER_TYPE_LABELS: Record<TriggerType, string> = {
  event: "事件触发",
  schedule: "定时触发",
  watch: "文件监听",
};

const EXEC_MODE_LABELS: Record<ExecutionMode, string> = {
  silent: "静默",
  notify: "通知",
};

/** 调度配置 → 友好标签 */
function scheduleLabel(sc: { type: string; interval?: string; cron?: string; runAt?: string }): string {
  switch (sc.type) {
    case "interval": return sc.interval ? `每${sc.interval}执行` : "定时间隔";
    case "cron":      return sc.cron ? `Cron: ${sc.cron}` : "Cron 定时";
    case "once":      return sc.runAt ? `单次: ${sc.runAt.replace("T", " ")}` : "单次执行";
    default:          return sc.type;
  }
}

function TriggersTab({ detail, triggers, onSave, saving, toolEnabled = true }: {
  detail: NexusToolDetail;
  triggers: NexusToolTrigger[];
  onSave: (triggers: NexusToolTrigger[]) => Promise<void>;
  saving: boolean;
  compact?: boolean;
  toolEnabled?: boolean;
}) {
  const { dccStatus } = React.useContext(DCCStatusContext);
  const [localTriggers, setLocalTriggers] = React.useState<NexusToolTrigger[]>(triggers);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [showNew, setShowNew] = React.useState(false);

  React.useEffect(() => { setLocalTriggers(triggers); }, [triggers]);

  const dccList = detail.software?.length ? detail.software : [{ dcc: "blender" }, { dcc: "unreal_engine" }, { dcc: "maya" }, { dcc: "3ds_max" }, { dcc: "houdini" }, { dcc: "comfyui" }];

  // 判断是否有目标 DCC 已连接
  const hasConnectedDCC = React.useMemo(() => {
    return dccList.some((e) => {
      const dcc = typeof e === "string" ? e : e.dcc;
      const status = dccStatus.find((s) => s.name.toLowerCase() === dcc.toLowerCase());
      return status?.connected ?? false;
    });
  }, [dccList, dccStatus]);

  const defaultFilters = detail.default_filters;

  // ── 新建 ──
  const handleCreate = (data: TriggerFormData) => {
    const newTrigger: NexusToolTrigger = {
      id: crypto.randomUUID ? crypto.randomUUID() : `trigger_${Date.now()}`,
      name: data.name,
      enabled: data.isEnabled,
      triggerType: data.triggerType,
      dcc: data.dcc,
      eventType: data.eventType,
      executionMode: data.executionMode,
      useDefaultFilters: data.useDefaultFilters,
      conditions: data.conditions,
      scheduleConfig: data.scheduleConfig,
    };
    const updated = [...localTriggers, newTrigger];
    setLocalTriggers(updated);
    setShowNew(false);
    onSave(updated);
  };

  // ── 更新 ──
  const handleUpdate = (id: string, data: TriggerFormData) => {
    const updated = localTriggers.map((t) =>
      t.id === id
        ? {
            ...t,
            name: data.name,
            enabled: data.isEnabled,
            triggerType: data.triggerType,
            dcc: data.dcc,
            eventType: data.eventType,
            executionMode: data.executionMode,
            useDefaultFilters: data.useDefaultFilters,
            conditions: data.conditions,
            scheduleConfig: data.scheduleConfig,
          }
        : t,
    );
    setLocalTriggers(updated);
    setEditingId(null);
    onSave(updated);
  };

  // ── 删除 ──
  const handleDelete = async (id: string) => {
    const updated = localTriggers.filter((t) => t.id !== id);
    setLocalTriggers(updated);
    if (editingId === id) setEditingId(null);
    await onSave(updated);
  };

  // ── 启用/禁用 ──
  const handleToggle = async (id: string) => {
    const updated = localTriggers.map((t) =>
      t.id === id ? { ...t, enabled: !t.enabled } : t,
    );
    setLocalTriggers(updated);
    await onSave(updated);
  };

  // ── TriggerFormData ← NexusToolTrigger ──
  const triggerToForm = (t: NexusToolTrigger): TriggerFormData => ({
    name: t.name,
    triggerType: t.triggerType,
    dcc: t.dcc,
    eventType: t.eventType,
    executionMode: t.executionMode,
    useDefaultFilters: t.useDefaultFilters,
    conditions: t.conditions || {},
    isEnabled: t.enabled,
    scheduleConfig: t.scheduleConfig || { type: "interval", interval: "30m" },
  });

  const hasInlineFilter = (t: NexusToolTrigger) => {
    const c = t.conditions;
    return c && (c.path?.length || c.fileRules?.length || c.sceneRules?.length || c.typeFilter?.types?.length);
  };

  return (
    <div className="space-y-3">
      {!toolEnabled && (
        <div className="flex items-center gap-2 rounded border border-red-500/20 bg-red-500/[0.04] px-3 py-2">
          <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
          <span className="text-xs text-red-300/80">触发器总闸已关闭，所有触发器暂停生效</span>
        </div>
      )}

      {/* 触发器需要 DCC 插件支持提示 — 仅在没有已连接的 DCC 时显示 */}
      {!hasConnectedDCC && localTriggers.length > 0 && (
        <div className="flex items-start gap-2 rounded border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2">
          <Info className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-300/80">
            <p className="font-medium mb-0.5">触发器需要 DCC 插件支持</p>
            <p className="text-[11px] text-muted-foreground">
              触发器通过 DCC 插件（Blender Addon / Maya Plugin 等）中的事件钩子（如 <code className="text-[10px] bg-muted/30 px-1 rounded">bpy.app.handlers.save_post</code>）来监听 DCC 事件。
              请确保目标 DCC 已安装最新版 Artifex Nexus 插件，插件启动后会自动注册触发钩子。
            </p>
          </div>
        </div>
      )}

      {/* ── 触发器列表 ── */}
      {localTriggers.length > 0 ? (
        <div className="space-y-1.5">
          {localTriggers.map((t) => {
            const dccLabel = (DCC_LABELS as Record<string, string>)[t.dcc] || t.dcc;
            const eventLabel = hasDCCEvents(t.dcc) ? getEventLabel(t.dcc, t.eventType) : t.eventType;
            const typeLabel = TRIGGER_TYPE_LABELS[t.triggerType] || t.triggerType;
            const modeLabel = EXEC_MODE_LABELS[t.executionMode] || t.executionMode;
            const isEditing = editingId === t.id;

            return (
              <div key={t.id}>
                {/* 行 */}
                <div
                  className={cn(
                    "flex items-start gap-2 p-2 rounded border transition-colors group",
                    !toolEnabled
                      ? "border-border/30 bg-muted/5 opacity-60"
                      : t.enabled
                        ? "border-amber-500/30 bg-amber-500/[0.04] hover:border-amber-500/50"
                        : "border-border/40 bg-muted/10 hover:border-border/60",
                  )}
                >
                  {/* 启用 toggle — 用 div 避免嵌套 button（ToggleSwitch 内部是 button） */}
                  <div
                    onClick={() => handleToggle(t.id)}
                    title={t.enabled ? "点击禁用" : "点击启用"}
                    className="mt-0.5 shrink-0 cursor-pointer"
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleToggle(t.id);
                      }
                    }}
                  >
                    <ToggleSwitch
                      checked={t.enabled}
                      size="sm"
                    />
                  </div>

                  {/* 内容 */}
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => setEditingId(isEditing ? null : t.id)}
                  >
                    <div className="text-xs font-medium truncate">{t.name || "未命名"}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <span className="px-1.5 py-0.5 rounded bg-muted/30 text-[9px]">{typeLabel}</span>
                      {dccLabel && <span>{dccLabel}</span>}
                      {eventLabel && <span>{eventLabel}</span>}
                      <span className={cn(toolEnabled && t.enabled && "text-amber-400/80")}>{modeLabel}</span>
                    </div>
                    {(hasInlineFilter(t) || t.scheduleConfig) && (
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {hasInlineFilter(t) && <span>🔍 内联筛选</span>}
                        {t.scheduleConfig && (
                          <span className="ml-2">
                            ⏱ {scheduleLabel(t.scheduleConfig)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 操作 */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button
                      variant="ghost" size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100"
                      onClick={() => setEditingId(isEditing ? null : t.id)}
                      title="编辑"
                    >
                      <Sliders className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost" size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100"
                      onClick={() => handleDelete(t.id)}
                      title="删除"
                    >
                      <Trash2 className="h-3 w-3 text-red-400" />
                    </Button>
                  </div>
                </div>

                {/* 内联编辑器 */}
                {isEditing && (
                  <div className="mt-2 mb-1">
                    <TriggerRuleEditor
                      initialData={triggerToForm(t)}
                      software={dccList}
                      defaultFilters={defaultFilters}
                      onSave={(data) => handleUpdate(t.id, data)}
                      onCancel={() => setEditingId(null)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        !showNew && (
          <div className="py-6 text-center text-xs text-muted-foreground">
            <Zap className="mx-auto mb-2 h-5 w-5 opacity-40" />
            暂无触发规则
          </div>
        )
      )}

      {/* ── 新建编辑器 ── */}
      {showNew ? (
        <TriggerRuleEditor
          software={dccList}
          defaultFilters={defaultFilters}
          onSave={handleCreate}
          onCancel={() => setShowNew(false)}
        />
      ) : (
        <Button
          variant="outline" size="sm"
          className="w-full text-xs"
          onClick={() => { setShowNew(true); setEditingId(null); }}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          添加规则
        </Button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 共享组件：ToggleSwitch（统一开关 UI，StyleE 风格）
// ═══════════════════════════════════════════════════════════════════════════

export function ToggleSwitch({
  checked,
  onChange,
  disabled,
  size = "md",
}: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
  size?: "xs" | "sm" | "md";
}) {
  const dims = 
    size === "xs"
      ? { track: "w-7 h-3.5", thumb: "h-2.5 w-2.5", txOn: "translate-x-3.5", txOff: "translate-x-0.5" }
    : size === "sm"
      ? { track: "w-8 h-4", thumb: "h-3 w-3", txOn: "translate-x-4", txOff: "translate-x-0.5" }
      : { track: "w-9 h-5", thumb: "h-3.5 w-3.5", txOn: "translate-x-4", txOff: "translate-x-0.5" };

  const handleClick = () => {
    if (!disabled && onChange) onChange(!checked);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full transition-colors",
        dims.track,
        checked
          ? "bg-emerald-500/60 hover:bg-emerald-500/70"
          : "bg-muted-foreground/25 hover:bg-muted-foreground/35",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      <span
        className={cn(
          "rounded-full bg-white shadow-sm transition-transform",
          dims.thumb,
          checked ? dims.txOn : dims.txOff,
        )}
      />
    </button>
  );
}
