/**
 * TriggerRuleEditor — 触发器规则编辑器
 *
 * 从 ArtClaw ToolManager 移植并适配 Nexus 主题。
 * 支持三种触发类型：事件 / 定时 / 监听
 * 内联筛选条件复用 FiltersTab compact 组件。
 */

import * as React from "react";
import { X, Plus, Trash2 } from "lucide-react";
import { Button, Input, cn } from "@artifex-nexus/ui";
import { FiltersTab } from "./FiltersTab";
import { ToggleSwitch } from "./ToolDetailPanel";
import { DCC_EVENTS, getEventLabel, hasDCCEvents } from "../../lib/nexus-tool/dcc-events";
import { DCC_LABELS } from "../../lib/skillsMock";
import type {
  TriggerType,
  ExecutionMode,
  FilterConfig,
  ScheduleConfig,
} from "../../lib/nexus-tool/nexus-tool-api";

// ── Types ──────────────────────────────────────────────────────────────────

export interface TriggerFormData {
  name: string;
  triggerType: TriggerType;
  dcc: string;
  eventType: string;
  executionMode: ExecutionMode;
  useDefaultFilters: boolean;
  conditions: FilterConfig;
  isEnabled: boolean;
  scheduleConfig: ScheduleConfig;
  /** 文件监听轮询周期（秒），仅 triggerType=watch 时使用；undefined = 跟随全局默认 */
  pollIntervalSec?: number;
}

interface TriggerRuleEditorProps {
  initialData?: TriggerFormData;
  software: (string | { dcc: string })[];
  defaultFilters?: FilterConfig;
  onSave?: (data: TriggerFormData) => void;
  onChange?: (data: TriggerFormData) => void;
  onCancel?: () => void;
}

// ── Constants ──────────────────────────────────────────────────────────────

const TRIGGER_TYPES: { value: TriggerType; label: string }[] = [
  { value: "event",    label: "事件触发" },
  { value: "schedule", label: "定时触发" },
  { value: "watch",    label: "文件监听" },
];

const EXECUTION_MODES: { value: ExecutionMode; label: string; desc: string }[] = [
  { value: "silent", label: "静默",   desc: "气泡通知，5 秒后自动消失" },
  { value: "notify", label: "通知",   desc: "弹窗提示，需手动关闭" },
];

const SCHEDULE_TYPES: { value: string; label: string }[] = [
  { value: "interval", label: "定时间隔" },
  { value: "cron",     label: "Cron 表达式" },
  { value: "once",     label: "单次执行" },
];

const DEFAULT_FORM: TriggerFormData = {
  name: "",
  triggerType: "event",
  dcc: "",
  eventType: "",
  executionMode: "notify",
  useDefaultFilters: true,
  conditions: {},
  isEnabled: true,
  scheduleConfig: { type: "interval", interval: "30m" },
  pollIntervalSec: undefined,
};

// ── Component ──────────────────────────────────────────────────────────────

export default function TriggerRuleEditor({
  initialData,
  software,
  defaultFilters,
  onSave,
  onChange,
  onCancel,
}: TriggerRuleEditorProps) {
  const [form, setForm] = React.useState<TriggerFormData>(() => ({
    ...DEFAULT_FORM,
    ...initialData,
  }));

  // 通知父组件（跳过首次渲染）
  const isFirstRender = React.useRef(true);
  React.useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    onChange?.(form);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  const updateField = <K extends keyof TriggerFormData>(key: K, value: TriggerFormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const updateFields = (patch: Partial<TriggerFormData>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  };

  // 按 DCC 获取事件列表
  const availableEvents = form.dcc ? (DCC_EVENTS[form.dcc] ?? []) : [];

  // 内联筛选条件变更
  const handleFilterChange = (filters: FilterConfig) => {
    setForm((prev) => ({ ...prev, conditions: filters }));
  };

  const inputCls =
    "w-full px-3 py-1.5 rounded-[12px] border border-white/[0.08] bg-white/[0.04] backdrop-blur-md text-foreground text-xs focus:border-primary/40 focus:outline-none placeholder:text-muted-foreground transition-colors";
  const selectCls =
    "h-8 w-full rounded-md border border-input bg-input px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring [color-scheme:dark] [&_option]:bg-card [&_option]:text-foreground";

  return (
    <div className="bg-muted/5 border border-border/50 rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-foreground">触发规则编辑器</h3>
        {onCancel && (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onCancel}>
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div className="space-y-3">
        {/* ── 名称 ── */}
        <FieldRow label="规则名称">
          <Input
            className="h-7 text-xs"
            value={form.name}
            onChange={(e) => updateField("name", e.target.value)}
            placeholder="输入规则名称"
          />
        </FieldRow>

        {/* ── 触发类型 ── */}
        <FieldRow label="触发类型">
          <div className="flex gap-1.5 flex-wrap">
            {TRIGGER_TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => {
                  const patch: Partial<TriggerFormData> = { triggerType: t.value };
                  if (t.value === "schedule" && !form.scheduleConfig) {
                    patch.scheduleConfig = { type: "interval", interval: "30m" };
                  }
                  updateFields(patch);
                }}
                className={cn(
                  "px-3 py-1 rounded text-xs transition-colors",
                  form.triggerType === t.value
                    ? "bg-primary/20 text-primary border border-primary/40"
                    : "bg-muted/30 text-muted-foreground hover:text-foreground border border-transparent",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </FieldRow>

        {/* ── 事件类字段 ── */}
        {form.triggerType === "event" && (
          <>
            <FieldRow label="DCC 软件">
              <select
                value={form.dcc}
                onChange={(e) => updateFields({ dcc: e.target.value, eventType: "" })}
                className={selectCls}
              >
                <option value="">选择 DCC</option>
                <option value="general">通用（系统监测）</option>
                {software.map((d) => (typeof d === "string" ? d : d.dcc)).filter(hasDCCEvents).map((dcc) => (
                  <option key={dcc} value={dcc}>
                    {(DCC_LABELS as Record<string, string>)[dcc] || dcc}
                  </option>
                ))}
              </select>
            </FieldRow>

            {form.dcc && (
              <FieldRow label="事件类型">
                <select
                  value={form.eventType}
                  onChange={(e) => updateField("eventType", e.target.value)}
                  className={selectCls}
                >
                  <option value="">选择事件类型</option>
                  {availableEvents.map((evt) => (
                    <option key={evt.event} value={evt.event}>
                      {evt.label}
                    </option>
                  ))}
                </select>
              </FieldRow>
            )}
          </>
        )}

        {/* ── 定时类字段 ── */}
        {form.triggerType === "schedule" && (
          <>
            <FieldRow label="调度类型">
              <div className="flex gap-1.5 flex-wrap">
                {SCHEDULE_TYPES.map((t) => (
                  <button
                    key={t.value}
                    onClick={() =>
                      updateField("scheduleConfig", { ...form.scheduleConfig, type: t.value as ScheduleConfig["type"] })
                    }
                    className={cn(
                      "px-3 py-1 rounded text-xs transition-colors",
                      form.scheduleConfig.type === t.value
                        ? "bg-primary/20 text-primary border border-primary/40"
                        : "bg-muted/30 text-muted-foreground hover:text-foreground border border-transparent",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </FieldRow>

            {form.scheduleConfig.type === "interval" && (
              <FieldRow label="执行间隔">
                <Input
                  className="h-7 text-xs"
                  value={form.scheduleConfig.interval ?? ""}
                  onChange={(e) =>
                    updateField("scheduleConfig", { ...form.scheduleConfig, interval: e.target.value })
                  }
                  placeholder="例: 30m, 1h, 2h30m"
                />
              </FieldRow>
            )}

            {form.scheduleConfig.type === "cron" && (
              <FieldRow label="Cron 表达式">
                <Input
                  className="h-7 text-xs"
                  value={form.scheduleConfig.cron ?? ""}
                  onChange={(e) =>
                    updateField("scheduleConfig", { ...form.scheduleConfig, cron: e.target.value })
                  }
                  placeholder="例: 0 2 * * * (每天凌晨2点)"
                />
              </FieldRow>
            )}

            {form.scheduleConfig.type === "once" && (
              <FieldRow label="执行时间">
                <input
                  type="datetime-local"
                  value={form.scheduleConfig.runAt ?? ""}
                  onChange={(e) =>
                    updateField("scheduleConfig", { ...form.scheduleConfig, runAt: e.target.value })
                  }
                  className={inputCls}
                />
              </FieldRow>
            )}
          </>
        )}

        {/* ── 监听提示 + 轮询周期 ── */}
        {form.triggerType === "watch" && (
          <>
            <div className="text-[11px] text-muted-foreground px-2 py-1.5 bg-muted/10 rounded border border-border/40">
              💡 监听路径请在下方「筛选条件」中设置，支持路径变量
            </div>
            <FieldRow label="轮询周期（秒）">
              <div className="flex items-center gap-2">
                <Input
                  className="h-7 w-24 text-xs font-mono"
                  type="number"
                  min={1}
                  max={300}
                  value={form.pollIntervalSec ?? ""}
                  placeholder="跟随默认"
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === "") {
                      updateField("pollIntervalSec", undefined);
                    } else {
                      const v = parseInt(raw, 10);
                      if (Number.isFinite(v)) {
                        updateField("pollIntervalSec", Math.max(1, Math.min(300, v)));
                      }
                    }
                  }}
                />
                <span className="text-[10px] text-muted-foreground">
                  范围 1~300；留空使用全局默认（设置 → 常规）
                </span>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                此触发器多久检查一次文件变化。频繁监听的工具调小（如 1~3s），低频检查的工具调大（如 30~60s）以降低 CPU 占用。
              </p>
            </FieldRow>
          </>
        )}

        {/* ── 执行模式 ── */}
        <FieldRow label="执行模式">
          <div className="flex gap-1.5 flex-wrap">
            {EXECUTION_MODES.map((m) => (
              <button
                key={m.value}
                title={m.desc}
                onClick={() => updateField("executionMode", m.value)}
                className={cn(
                  "px-3 py-1 rounded text-xs transition-colors",
                  form.executionMode === m.value
                    ? "bg-primary/20 text-primary border border-primary/40"
                    : "bg-muted/30 text-muted-foreground hover:text-foreground border border-transparent",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {EXECUTION_MODES.find((m) => m.value === form.executionMode)?.desc}
          </p>
        </FieldRow>

        {/* ── 筛选条件（事件/监听共用） ── */}
        {(form.triggerType === "event" || form.triggerType === "watch") && (
          <FieldRow label="筛选条件">
            <div className="border rounded-lg p-3 bg-muted/5 space-y-2">
              {/* 使用默认筛选 toggle */}
              {defaultFilters && (
                <div className="flex items-center gap-2 pb-2 border-b border-border/30">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.useDefaultFilters}
                      onChange={(e) => updateField("useDefaultFilters", e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-border accent-primary"
                    />
                    <span className="text-xs">使用工具默认筛选条件</span>
                  </label>
                  {form.useDefaultFilters && defaultFilters.path && defaultFilters.path.length > 0 && (
                    <span className="text-[10px] text-muted-foreground ml-auto truncate max-w-[200px]">
                      {defaultFilters.path.map((p) => p.pattern).join(", ")}
                    </span>
                  )}
                </div>
              )}

              {/* 自定义筛选（复用 FiltersTab） */}
              {!form.useDefaultFilters && (
                <FiltersTab
                  filters={form.conditions}
                  onChange={handleFilterChange}
                  software={software.map((d) => typeof d === "string" ? { dcc: d } : d as { dcc: string })}
                  compact
                />
              )}
            </div>
          </FieldRow>
        )}

        {/* ── 启用状态 ── */}
        <FieldRow label="启用状态">
          <label className="flex items-center gap-2 cursor-pointer pt-0.5">
            <ToggleSwitch
              size="xs"
              checked={form.isEnabled}
              onChange={(v) => updateField("isEnabled", v)}
            />
            <span className="text-xs">{form.isEnabled ? "已启用" : "已禁用"}</span>
          </label>
        </FieldRow>
      </div>

      {/* ── 操作按钮 ── */}
      <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/30">
        <Button size="sm" className="h-7 text-xs" onClick={() => onSave?.(form)}>
          保存规则
        </Button>
        {onCancel && (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onCancel}>
            取消
          </Button>
        )}
      </div>
    </div>
  );
}

// ── 辅助组件 ────────────────────────────────────────────────────────────────

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-muted-foreground mb-1">{label}</label>
      {children}
    </div>
  );
}
