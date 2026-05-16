"use client";

/**
 * ToolDetailPanel — Nexus-Tool 详情面板（4 标签页）
 *
 * 对齐 ArtClaw ToolDetailDialog 的四个区：
 *   1. 基本信息（Info）— 名称/版本/作者/描述/目标 DCC/实现方式
 *   2. 参数（Params）— 输入参数编辑 + 输出参数预览
 *   3. 预设（Presets）— 参数预设的保存/加载/删除
 *   4. 触发器（Triggers）— 事件触发规则的增删改+启用开关
 *
 * 数据来源：nexusToolDetail(id) 返回的 NexusToolDetail（含 manifest）。
 */

import * as React from "react";
import {
  Info,
  Sliders,
  Save,
  Zap,
  Play,
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
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { Button, Badge, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, cn } from "@artifex-nexus/ui";
import { ScrollFade } from "../chat/ScrollFade";
import {
  nexusToolDetail,
  nexusToolRun,
  nexusToolSavePresets,
  nexusToolSaveTriggers,
  type NexusToolDetail,
  type NexusToolParam,
  type NexusToolPreset,
  type NexusToolTrigger,
} from "../../lib/nexus-tool/nexus-tool-api";
import {
  SOURCE_LABELS,
  DCC_LABELS,
} from "../../lib/skillsMock";

// ─── 类型 ──────────────────────────────────────────────────────────────────

type TabId = "info" | "params" | "presets" | "triggers";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "info", label: "基本信息", icon: <Info className="h-3.5 w-3.5" /> },
  { id: "params", label: "参数", icon: <Sliders className="h-3.5 w-3.5" /> },
  { id: "presets", label: "预设", icon: <Save className="h-3.5 w-3.5" /> },
  { id: "triggers", label: "触发器", icon: <Zap className="h-3.5 w-3.5" /> },
];

const SOURCE_COLORS: Record<string, string> = {
  official: "text-blue-400 bg-blue-500/10",
  marketplace: "text-purple-400 bg-purple-500/10",
  user: "text-green-400 bg-green-500/10",
};

const IMPL_LABELS: Record<string, string> = {
  script: "脚本",
  skill_wrapper: "Skill 包装",
  composite: "组合",
};

const PARAM_TYPE_LABELS: Record<string, string> = {
  string: "字符串",
  number: "数字",
  boolean: "布尔",
  select: "下拉选择",
  object: "对象",
};

// ─── 主组件 ────────────────────────────────────────────────────────────────

interface ToolDetailPanelProps {
  toolId: string;
  /** 运行回调（打开 Chat + 预输入工具名） */
  onRun?: (toolName: string) => void;
  /** 数据刷新后回调（供父组件更新 D5 标题等） */
  onLoaded?: (detail: NexusToolDetail) => void;
  /** 紧凑模式（D5 侧面板用） */
  compact?: boolean;
}

export function ToolDetailPanel({ toolId, onRun, onLoaded, compact }: ToolDetailPanelProps) {
  const [activeTab, setActiveTab] = React.useState<TabId>("info");
  const [detail, setDetail] = React.useState<NexusToolDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  /** 当前参数值 — 由 ParamsTab 编辑、PresetsTab 保存 */
  const [paramValues, setParamValues] = React.useState<Record<string, unknown>>({});

  const loadDetail = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const d = await nexusToolDetail(toolId);
      setDetail(d);
      // 从 manifest inputs 初始化参数默认值
      const defaults: Record<string, unknown> = {};
      (d.inputs || []).forEach((p) => { defaults[p.id] = p.default; });
      setParamValues(defaults);
      onLoaded?.(d);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [toolId, onLoaded]);

  const handleChangeParam = React.useCallback((id: string, value: unknown) => {
    setParamValues(prev => ({ ...prev, [id]: value }));
  }, []);

  React.useEffect(() => { loadDetail(); }, [loadDetail]);

  // 运行工具
  const handleRun = React.useCallback(async () => {
    if (!detail) return;
    if (onRun) {
      onRun(detail.name);
    } else {
      try {
        await nexusToolRun(detail.id);
        await loadDetail();
      } catch (e) {
        setError(String(e));
      }
    }
  }, [detail, onRun, loadDetail]);

  // ─── 预设操作 ────────────────────────────────────────────────────────

  const handleSavePreset = React.useCallback(async (preset: NexusToolPreset) => {
    if (!detail) return;
    setSaving(true);
    try {
      const presets = [...(detail.presets || []), preset];
      await nexusToolSavePresets(detail.id, presets);
      await loadDetail();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [detail, loadDetail]);

  const handleDeletePreset = React.useCallback(async (presetId: string) => {
    if (!detail) return;
    setSaving(true);
    try {
      const presets = (detail.presets || []).filter(p => p.id !== presetId);
      await nexusToolSavePresets(detail.id, presets);
      await loadDetail();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [detail, loadDetail]);

  // ─── 触发器操作 ──────────────────────────────────────────────────────

  const handleSaveTriggers = React.useCallback(async (triggers: NexusToolTrigger[]) => {
    if (!detail) return;
    setSaving(true);
    try {
      await nexusToolSaveTriggers(detail.id, triggers);
      await loadDetail();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [detail, loadDetail]);

  // ─── 渲染 ────────────────────────────────────────────────────────────

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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Tab 栏 */}
      <div className="flex shrink-0 border-b border-border/60 bg-muted/20">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px",
              activeTab === tab.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground/80",
              compact && "px-2 py-1.5 text-[11px]",
            )}
          >
            {tab.icon}
            {tab.label}
            {/* 参数/预设/触发器数量徽标 */}
            {tab.id === "params" && (detail.inputs?.length || detail.outputs?.length) ? (
              <span className="ml-0.5 rounded bg-muted px-1 text-[10px]">
                {(detail.inputs?.length || 0) + (detail.outputs?.length || 0)}
              </span>
            ) : null}
            {tab.id === "presets" && detail.presets?.length ? (
              <span className="ml-0.5 rounded bg-muted px-1 text-[10px]">{detail.presets.length}</span>
            ) : null}
            {tab.id === "triggers" && detail.triggers?.length ? (
              <span className="ml-0.5 rounded bg-muted px-1 text-[10px]">{detail.triggers.length}</span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <ScrollFade className="flex-1">
        <div className="p-3">
          {activeTab === "info" && <InfoTab detail={detail} onRun={handleRun} compact={compact} />}
          {activeTab === "params" && <ParamsTab detail={detail} onRun={handleRun} compact={compact} paramValues={paramValues} onChangeParam={handleChangeParam} onError={setError} />}
          {activeTab === "presets" && <PresetsTab detail={detail} onSave={handleSavePreset} onDelete={handleDeletePreset} saving={saving} compact={compact} paramValues={paramValues} />}
          {activeTab === "triggers" && <TriggersTab detail={detail} onSave={handleSaveTriggers} saving={saving} compact={compact} />}
        </div>
      </ScrollFade>

      {/* 底栏：运行按钮 */}
      <div className="flex shrink-0 items-center gap-2 border-t border-border/60 px-3 py-2">
        <Button size="sm" className="flex-1 h-8 text-xs" onClick={handleRun}>
          <Play className="mr-1.5 h-3.5 w-3.5" />
          运行
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={loadDetail} title="刷新">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Tab 1: 基本信息
// ═══════════════════════════════════════════════════════════════════════════

function InfoTab({ detail, onRun, compact }: { detail: NexusToolDetail; onRun: () => void; compact?: boolean }) {
  return (
    <div className="space-y-4">
      {/* 标题行 */}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-lg font-bold text-primary">
          {detail.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{detail.name}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-mono text-muted-foreground">v{detail.version}</span>
            {detail.source && (
              <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", SOURCE_COLORS[detail.source] || "text-muted-foreground bg-muted")}>
                {(SOURCE_LABELS as Record<string, string>)[detail.source] || detail.source}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 描述 */}
      {detail.description && (
        <p className="text-xs leading-relaxed text-muted-foreground">{detail.description}</p>
      )}

      {/* 元信息网格 */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <InfoField label="作者" value={detail.author || "—"} />
        <InfoField label="实现方式" value={IMPL_LABELS[detail.implementation_type] || detail.implementation_type || "—"} />
        <InfoField label="创建日期" value={detail.created_at?.slice(0, 10) || "—"} />
        <InfoField label="更新日期" value={detail.updated_at?.slice(0, 10) || "—"} />
      </div>

      {/* 目标 DCC */}
      {detail.target_dccs && detail.target_dccs.length > 0 && (
        <div>
          <div className="mb-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">目标软件</div>
          <div className="flex flex-wrap gap-1">
            {detail.target_dccs.map((dcc) => (
              <span key={dcc} className="rounded bg-muted px-2 py-0.5 text-[11px]">
                {(DCC_LABELS as Record<string, string>)[dcc] || dcc}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 实现细节 */}
      {detail.implementation && (
        <div>
          <div className="mb-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">执行入口</div>
          <div className="space-y-1 rounded bg-muted/30 p-2 font-mono text-[11px]">
            <div><span className="text-muted-foreground">type:</span> {detail.implementation.type || "—"}</div>
            <div><span className="text-muted-foreground">entry:</span> {detail.implementation.entry || "—"}</div>
            <div><span className="text-muted-foreground">fn:</span> {detail.implementation.function || "—"}</div>
          </div>
        </div>
      )}

      {/* 工具路径 */}
      {detail.nexus_tool_path && (
        <div>
          <div className="mb-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">工具路径</div>
          <div className="flex items-center gap-1.5 rounded bg-muted/30 px-2 py-1.5 font-mono text-[10px] text-muted-foreground break-all">
            <ExternalLink className="h-3 w-3 shrink-0" />
            {detail.nexus_tool_path}
          </div>
        </div>
      )}

      {/* 统计 */}
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span>使用 {detail.use_count || 0} 次</span>
        <span>·</span>
        <span>{detail.inputs?.length || 0} 个输入参数</span>
        <span>·</span>
        <span>{detail.outputs?.length || 0} 个输出</span>
        <span>·</span>
        <span>{detail.presets?.length || 0} 个预设</span>
        <span>·</span>
        <span>{detail.triggers?.length || 0} 个触发器</span>
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
// Tab 2: 参数
// ═══════════════════════════════════════════════════════════════════════════

function ParamsTab({ detail, onRun, compact, paramValues, onChangeParam, onError }: {
  detail: NexusToolDetail;
  onRun: () => void;
  compact?: boolean;
  paramValues: Record<string, unknown>;
  onChangeParam: (id: string, value: unknown) => void;
  onError: (msg: string | null) => void;
}) {
  const handleRunWithParams = async () => {
    try {
      await nexusToolRun(detail.id, paramValues);
    } catch (e) {
      onError(String(e));
    }
  };

  return (
    <div className="space-y-4">
      {/* ── 输入参数 ── */}
      {detail.inputs && detail.inputs.length > 0 && (
        <ParamSection title="输入参数" defaultOpen>
          {detail.inputs.map((param) => (
            <ParamRow
              key={param.id}
              param={param}
              value={paramValues[param.id]}
              onChange={(v) => onChangeParam(param.id, v)}
              compact={compact}
            />
          ))}
        </ParamSection>
      )}

      {/* ── 输出参数 ── */}
      {detail.outputs && detail.outputs.length > 0 && (
        <ParamSection title="输出参数" defaultOpen={false}>
          {detail.outputs.map((out) => (
            <div key={out.id} className="flex items-center gap-2 py-1.5 text-xs">
              <span className="w-2 h-2 rounded-full bg-blue-400/30 shrink-0" />
              <span className="font-medium min-w-[60px]">{out.name}</span>
              <span className="text-[10px] rounded bg-muted/30 px-1.5 py-0.5 text-muted-foreground">{out.type}</span>
            </div>
          ))}
        </ParamSection>
      )}

      {(!detail.inputs || detail.inputs.length === 0) && (!detail.outputs || detail.outputs.length === 0) && (
        <div className="py-6 text-center text-xs text-muted-foreground">
          <Sliders className="mx-auto mb-2 h-5 w-5 opacity-40" />
          此工具没有定义参数
        </div>
      )}

      {/* 运行按钮（带当前参数） */}
      {detail.inputs && detail.inputs.length > 0 && (
        <Button size="sm" variant="outline" className="w-full text-xs" onClick={handleRunWithParams}>
          <Play className="mr-1.5 h-3.5 w-3.5" />
          用当前参数运行
        </Button>
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
      {open && <div className="space-y-0.5 pl-4">{children}</div>}
    </div>
  );
}

function ParamRow({ param, value, onChange, compact }: {
  param: NexusToolParam;
  value: unknown;
  onChange: (v: unknown) => void;
  compact?: boolean;
}) {
  const [focused, setFocused] = React.useState(false);

  return (
    <div className={cn(
      "group rounded border border-transparent px-2 py-1.5 transition-colors",
      focused && "border-primary/20 bg-primary/[0.02]",
    )}>
      <div className="flex items-center gap-2">
        <span className="flex-1 min-w-0">
          <span className="text-xs font-medium">{param.name}</span>
          {param.required && <span className="ml-1 text-[10px] text-red-400">*</span>}
          <span className="ml-1.5 text-[10px] rounded bg-muted/30 px-1 py-0 text-muted-foreground">{param.type}</span>
        </span>
        <div className="shrink-0">
          {param.type === "boolean" ? (
            <button
              onClick={() => onChange(!value)}
              className={cn(
                "flex h-5 w-9 items-center rounded-full transition-colors",
                value ? "bg-primary/60" : "bg-muted",
              )}
            >
              <span className={cn(
                "h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
                value ? "translate-x-4.5 ml-0.5" : "translate-x-0.5",
              )} />
            </button>
          ) : param.type === "select" && param.options ? (
            <select
              value={String(value ?? param.default ?? param.options[0])}
              onChange={(e) => onChange(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              className="h-6 rounded border border-border/60 bg-muted/20 px-1.5 text-[11px] font-mono focus:outline-none focus:border-primary/40"
            >
              {param.options.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          ) : param.type === "number" ? (
            <input
              type="number"
              value={value as number ?? param.default ?? ""}
              onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              className="h-6 w-24 rounded border border-border/60 bg-muted/20 px-1.5 text-[11px] font-mono focus:outline-none focus:border-primary/40"
            />
          ) : (
            <input
              type="text"
              value={String(value ?? param.default ?? "")}
              onChange={(e) => onChange(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              className="h-6 rounded border border-border/60 bg-muted/20 px-1.5 text-[11px] font-mono focus:outline-none focus:border-primary/40 w-32"
            />
          )}
        </div>
      </div>
      {param.description && (
        <p className="mt-0.5 text-[10px] text-muted-foreground/70 leading-relaxed">{param.description}</p>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Tab 3: 预设
// ═══════════════════════════════════════════════════════════════════════════

function PresetsTab({ detail, onSave, onDelete, saving, compact, paramValues }: {
  detail: NexusToolDetail;
  onSave: (preset: NexusToolPreset) => Promise<void>;
  onDelete: (presetId: string) => Promise<void>;
  saving: boolean;
  compact?: boolean;
  paramValues: Record<string, unknown>;
}) {
  const [newPresetName, setNewPresetName] = React.useState("");
  const [savingNow, setSavingNow] = React.useState(false);

  const presets = detail.presets || [];

  const handleSave = async () => {
    const name = newPresetName.trim();
    if (!name) return;
    setSavingNow(true);
    try {
      const preset: NexusToolPreset = {
        id: `preset_${Date.now()}`,
        name,
        values: { ...paramValues },
        created_at: new Date().toISOString(),
      };
      await onSave(preset);
      setNewPresetName("");
    } finally {
      setSavingNow(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* 新建预设 */}
      <div className="flex gap-2">
        <Input
          className="h-7 flex-1 text-xs"
          placeholder="预设名称..."
          value={newPresetName}
          onChange={(e) => setNewPresetName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
        />
        <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={!newPresetName.trim() || savingNow}>
          {savingNow ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Plus className="mr-1 h-3 w-3" />}
          保存
        </Button>
      </div>

      {/* 预设列表 */}
      {presets.length === 0 ? (
        <div className="py-6 text-center text-xs text-muted-foreground">
          <Save className="mx-auto mb-2 h-5 w-5 opacity-40" />
          暂无预设。设置好参数后，输入名称并点击"保存"。
        </div>
      ) : (
        <div className="space-y-1">
          {presets.map((preset) => (
            <div key={preset.id} className="flex items-center gap-2 rounded border border-border/40 bg-muted/10 px-2 py-1.5 group hover:border-border/60">
              <Save className="h-3 w-3 text-amber-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{preset.name}</div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {Object.keys(preset.values).length} 个参数
                  {preset.created_at && ` · ${preset.created_at.slice(0, 10)}`}
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => onDelete(preset.id)} title="删除预设">
                <Trash2 className="h-3 w-3 text-red-400" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Tab 4: 触发器
// ═══════════════════════════════════════════════════════════════════════════

const EVENT_OPTIONS = [
  { value: "file.save.post", label: "文件保存后" },
  { value: "file.save.pre", label: "文件保存前" },
  { value: "file.open.post", label: "文件打开后" },
  { value: "file.open.pre", label: "文件打开前" },
  { value: "scene.new", label: "新建场景" },
  { value: "object.select", label: "选择对象" },
];

const EXEC_MODES = [
  { value: "notify", label: "仅通知" },
  { value: "autorun", label: "自动执行" },
  { value: "prompt", label: "询问后执行" },
];

function TriggersTab({ detail, onSave, saving, compact }: {
  detail: NexusToolDetail;
  onSave: (triggers: NexusToolTrigger[]) => Promise<void>;
  saving: boolean;
  compact?: boolean;
}) {
  const [triggers, setTriggers] = React.useState<NexusToolTrigger[]>(detail.triggers || []);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [isNew, setIsNew] = React.useState(false);

  // 编辑态数据
  const [editName, setEditName] = React.useState("");
  const [editEvent, setEditEvent] = React.useState("file.save.post");
  const [editDcc, setEditDcc] = React.useState(detail.target_dccs?.[0] || "blender");
  const [editMode, setEditMode] = React.useState("notify");
  const [editUseDefault, setEditUseDefault] = React.useState(false);

  const resetEdit = () => {
    setEditName("");
    setEditEvent("file.save.post");
    setEditDcc(detail.target_dccs?.[0] || "blender");
    setEditMode("notify");
    setEditUseDefault(false);
    setEditingId(null);
    setIsNew(false);
  };

  const startNew = () => {
    resetEdit();
    setIsNew(true);
    setEditingId("__new__");
  };

  const startEdit = (t: NexusToolTrigger) => {
    setEditName(t.name);
    setEditEvent(t.trigger.event);
    setEditDcc(t.trigger.dcc);
    setEditMode(t.execution.mode);
    setEditUseDefault(t.useDefaultFilters);
    setEditingId(t.id);
    setIsNew(false);
  };

  const handleSaveEdit = async () => {
    const name = editName.trim();
    if (!name) return;

    let updated: NexusToolTrigger[];
    if (isNew) {
      const newTrigger: NexusToolTrigger = {
        id: crypto.randomUUID ? crypto.randomUUID() : `trigger_${Date.now()}`,
        name,
        enabled: false,
        trigger: { type: "event", event: editEvent, dcc: editDcc },
        execution: { mode: editMode },
        useDefaultFilters: editUseDefault,
      };
      updated = [...triggers, newTrigger];
    } else {
      updated = triggers.map((t) =>
        t.id === editingId
          ? { ...t, name, trigger: { ...t.trigger, event: editEvent, dcc: editDcc }, execution: { mode: editMode }, useDefaultFilters: editUseDefault }
          : t,
      );
    }

    setTriggers(updated);
    resetEdit();
    await onSave(updated);
  };

  const handleDelete = async (id: string) => {
    const updated = triggers.filter((t) => t.id !== id);
    setTriggers(updated);
    await onSave(updated);
  };

  const handleToggle = async (id: string) => {
    const updated = triggers.map((t) =>
      t.id === id ? { ...t, enabled: !t.enabled } : t,
    );
    setTriggers(updated);
    await onSave(updated);
  };

  const isEditing = editingId !== null;

  return (
    <div className="space-y-3">
      {/* 添加按钮 */}
      {!isEditing && (
        <Button variant="outline" size="sm" className="w-full text-xs" onClick={startNew}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          添加触发器
        </Button>
      )}

      {/* 编辑表单 */}
      {isEditing && (
        <div className="rounded border border-primary/30 bg-primary/[0.02] p-3 space-y-2">
          <div className="flex items-center gap-2 mb-1">
            <Zap className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-xs font-medium">{isNew ? "新建触发器" : "编辑触发器"}</span>
          </div>

          <div>
            <label className="text-[10px] text-muted-foreground">名称</label>
            <Input className="h-7 text-xs mt-0.5" placeholder="触发器名称" value={editName}
              onChange={(e) => setEditName(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground">DCC</label>
              <select value={editDcc} onChange={(e) => setEditDcc(e.target.value)}
                className="mt-0.5 h-7 w-full rounded border border-border/60 bg-muted/20 px-1.5 text-xs focus:outline-none focus:border-primary/40">
                {(detail.target_dccs || ["blender", "unreal_engine", "maya", "3ds_max", "houdini", "comfyui"]).map((d) => (
                  <option key={d} value={d}>{(DCC_LABELS as Record<string, string>)[d] || d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">事件</label>
              <select value={editEvent} onChange={(e) => setEditEvent(e.target.value)}
                className="mt-0.5 h-7 w-full rounded border border-border/60 bg-muted/20 px-1.5 text-xs focus:outline-none focus:border-primary/40">
                {EVENT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground">执行方式</label>
              <select value={editMode} onChange={(e) => setEditMode(e.target.value)}
                className="mt-0.5 h-7 w-full rounded border border-border/60 bg-muted/20 px-1.5 text-xs focus:outline-none focus:border-primary/40">
                {EXEC_MODES.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end pb-0.5">
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="checkbox" checked={editUseDefault} onChange={(e) => setEditUseDefault(e.target.checked)}
                  className="h-3 w-3 rounded border-border" />
                <span className="text-[10px]">使用默认过滤</span>
              </label>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <Button size="sm" className="h-7 text-xs" onClick={handleSaveEdit} disabled={!editName.trim() || saving}>
              <Check className="mr-1 h-3 w-3" />
              保存
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={resetEdit}>
              <X className="mr-1 h-3 w-3" />
              取消
            </Button>
          </div>
        </div>
      )}

      {/* 触发器列表 */}
      {triggers.length === 0 && !isEditing ? (
        <div className="py-6 text-center text-xs text-muted-foreground">
          <Zap className="mx-auto mb-2 h-5 w-5 opacity-40" />
          暂无触发器。添加触发器以在特定事件发生时自动执行此工具。
        </div>
      ) : (
        <div className="space-y-1">
          {triggers.map((t) => (
            <div key={t.id} className={cn(
              "flex items-center gap-2 rounded border px-2 py-1.5 group transition-colors",
              t.enabled ? "border-amber-500/30 bg-amber-500/[0.04]" : "border-border/40 bg-muted/10 hover:border-border/60",
            )}>
              <button onClick={() => handleToggle(t.id)} className="shrink-0">
                {t.enabled
                  ? <ToggleRight className="h-4 w-4 text-amber-400" />
                  : <ToggleLeft className="h-4 w-4 text-muted-foreground/50" />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{t.name}</div>
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span>{(DCC_LABELS as Record<string, string>)[t.trigger.dcc] || t.trigger.dcc}</span>
                  <span>·</span>
                  <span>{EVENT_OPTIONS.find(o => o.value === t.trigger.event)?.label || t.trigger.event}</span>
                  <span>·</span>
                  <span className={cn(t.enabled && "text-amber-400/80")}>
                    {EXEC_MODES.find(o => o.value === t.execution.mode)?.label || t.execution.mode}
                  </span>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => startEdit(t)} title="编辑">
                <Sliders className="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => handleDelete(t.id)} title="删除">
                <Trash2 className="h-3 w-3 text-red-400" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
