"use client";

/**
 * EncodingBar — Spatial Plot 编码映射栏 + 底图上传按钮（STORY-0072）
 *
 * 展示在 SpatialPlotView 顶部，包含：
 * - 底图上传/更换按钮
 * - x/y 坐标字段选择
 * - color/shape/size/thumbnail 编码维度字段选择
 */

import * as React from "react";
import type { SpatialEncoding, DataAction } from "../DataPage";
import { uiLog } from "../../../lib/ui-log";

interface EncodingBarProps {
  encoding: SpatialEncoding;
  columns: { name: string; type: string }[];
  dispatch: React.Dispatch<DataAction>;
}

export function EncodingBar({ encoding, columns, dispatch }: EncodingBarProps) {
  const visible = columns.filter((c) => (c as { visible?: boolean }).visible !== false);
  const fieldOptions = visible.map((c) => ({ value: c.name, label: `${c.name} (${c.type})` }));
  const numericFieldOptions = visible
    .filter((c) => c.type === "number")
    .map((c) => ({ value: c.name, label: c.name }));

  const updateField = (key: keyof SpatialEncoding, value: string) => {
    if (key === "x" || key === "y") {
      dispatch({
        type: "SET_SPATIAL_ENCODING",
        encoding: { ...encoding, [key]: { field: value } },
      });
    } else {
      dispatch({
        type: "SET_SPATIAL_ENCODING",
        encoding: {
          ...encoding,
          [key]: value
            ? { ...(encoding[key] as Record<string, unknown>), field: value }
            : undefined,
        },
      });
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <BgButton encoding={encoding} dispatch={dispatch} />
      <CoordSysControls encoding={encoding} dispatch={dispatch} />
      <FieldSelect label="X" value={encoding.x.field} options={numericFieldOptions} allowEmpty onChange={(v) => updateField("x", v)} />
      <FieldSelect label="Y" value={encoding.y.field} options={numericFieldOptions} allowEmpty onChange={(v) => updateField("y", v)} />
      <FieldSelect label="颜色" value={encoding.color?.field ?? ""} options={fieldOptions} allowEmpty onChange={(v) => {
        dispatch({
          type: "SET_SPATIAL_ENCODING",
          encoding: { ...encoding, color: v ? { field: v, scale: encoding.color?.scale ?? "ordinal" } : undefined },
        });
      }} />
      <FieldSelect label="形状" value={encoding.shape?.field ?? ""} options={fieldOptions} allowEmpty onChange={(v) => {
        dispatch({ type: "SET_SPATIAL_ENCODING", encoding: { ...encoding, shape: v ? { field: v } : undefined } });
      }} />
      <FieldSelect label="大小" value={encoding.size?.field ?? ""} options={numericFieldOptions} allowEmpty onChange={(v) => {
        dispatch({
          type: "SET_SPATIAL_ENCODING",
          encoding: { ...encoding, size: v ? { field: v, range: encoding.size?.range ?? [3, 20] } : undefined },
        });
      }} />
      <FieldSelect label="缩略图" value={encoding.thumbnail?.field ?? ""} options={fieldOptions} allowEmpty onChange={(v) => {
        dispatch({ type: "SET_SPATIAL_ENCODING", encoding: { ...encoding, thumbnail: v ? { field: v } : undefined } });
      }} />
      <TooltipFieldsPicker encoding={encoding} columns={visible} dispatch={dispatch} />
    </div>
  );
}

// ─── 坐标系参数（origin + unitPerPx） ──────────────────────────────────────

function CoordSysControls({
  encoding,
  dispatch,
}: {
  encoding: SpatialEncoding;
  dispatch: React.Dispatch<DataAction>;
}) {
  const origin = encoding.background?.origin ?? "top-left";
  const unitPerPx = encoding.background?.unitPerPx ?? 1;
  const updateBg = (patch: Partial<NonNullable<SpatialEncoding["background"]>>) => {
    dispatch({
      type: "SET_SPATIAL_ENCODING",
      encoding: {
        ...encoding,
        background: {
          src: encoding.background?.src ?? "",
          origin: encoding.background?.origin ?? "top-left",
          ...encoding.background,
          ...patch,
        },
      },
    });
  };
  return (
    <div className="flex items-center gap-2 rounded border border-white/[0.06] bg-white/[0.02] px-2 py-1">
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-foreground/60">原点</span>
        <select
          className="rounded border border-white/[0.06] bg-white/[0.04] px-1 py-0.5 text-[11px] text-foreground focus:border-primary/40 focus:outline-none"
          value={origin}
          onChange={(e) => updateBg({ origin: e.target.value as "top-left" | "center" })}
        >
          <option value="top-left">左上 (top-left)</option>
          <option value="center">居中 (center)</option>
        </select>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-foreground/60" title="一个像素对应多少数据单位；默认 1 即 1px = 1 单位">单位/px</span>
        <input
          type="number"
          step="0.01"
          min="0.001"
          value={unitPerPx}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v > 0) updateBg({ unitPerPx: v });
          }}
          className="h-5 w-14 rounded border border-white/[0.06] bg-white/[0.04] px-1 text-[11px] text-foreground focus:border-primary/40 focus:outline-none"
        />
      </div>
    </div>
  );
}

// ─── 底图上传按钮 ──────────────────────────────────────────────────────────

function BgButton({
  encoding,
  dispatch,
}: {
  encoding: SpatialEncoding;
  dispatch: React.Dispatch<DataAction>;
}) {
  const fileRef = React.useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      dispatch({
        type: "SET_SPATIAL_ENCODING",
        encoding: {
          ...encoding,
          background: { src: reader.result as string, origin: encoding.background?.origin ?? "top-left" },
        },
      });
      uiLog.custom("SpatialPlot", "bgUploaded", { name: file.name, size: file.size });
    };
    reader.readAsDataURL(file);
  };

  return (
    <>
      <button
        type="button"
        className="flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-xs text-foreground/80 transition-colors hover:bg-white/[0.08] hover:text-foreground"
        onClick={() => fileRef.current?.click()}
        title={encoding.background?.src ? "更换底图" : "上传底图（可选）"}
      >
        {encoding.background?.src ? "换底图" : "上传底图"}
      </button>
      {encoding.background?.src && (
        <button
          type="button"
          className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-xs text-foreground/60 hover:bg-white/[0.08] hover:text-foreground"
          onClick={() => {
            dispatch({
              type: "SET_SPATIAL_ENCODING",
              encoding: { ...encoding, background: undefined },
            });
          }}
          title="移除底图"
        >
          移除
        </button>
      )}
      <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleFile} />
    </>
  );
}

// ─── 字段下拉选择器 ────────────────────────────────────────────────────────

function FieldSelect({
  label,
  value,
  options,
  allowEmpty,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  allowEmpty?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-muted-foreground/60">{label}:</span>
      <select
        className="rounded border border-white/[0.06] bg-white/[0.02] px-1.5 py-0.5 text-xs text-foreground outline-none focus:border-primary/40"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {allowEmpty && <option value="">--</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

// ─── tooltip 扩展字段多选 ──────────────────────────────────────────────────

function TooltipFieldsPicker({
  encoding,
  columns,
  dispatch,
}: {
  encoding: SpatialEncoding;
  columns: { name: string; type: string }[];
  dispatch: React.Dispatch<DataAction>;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const selected = encoding.tooltipFields ?? [];

  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const toggle = (name: string) => {
    const next = selected.includes(name)
      ? selected.filter((n) => n !== name)
      : [...selected, name];
    dispatch({
      type: "SET_SPATIAL_ENCODING",
      encoding: { ...encoding, tooltipFields: next },
    });
  };

  return (
    <div ref={ref} className="relative flex items-center gap-1">
      <span className="text-[10px] text-muted-foreground/60">Tooltip:</span>
      <button
        type="button"
        className="rounded border border-white/[0.06] bg-white/[0.02] px-1.5 py-0.5 text-xs text-foreground outline-none hover:border-primary/40"
        onClick={() => setOpen((v) => !v)}
        title="选择悬停时显示的扩展字段"
      >
        {selected.length === 0 ? "未选择" : `${selected.length} 字段`}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-48 w-44 overflow-y-auto rounded-md border border-white/[0.08] bg-popover p-2 shadow-lg">
          {columns.length === 0 && (
            <div className="text-[10px] text-muted-foreground/60">无可选字段</div>
          )}
          {columns.map((c) => (
            <label key={c.name} className="flex cursor-pointer items-center gap-1.5 py-0.5 text-xs text-foreground hover:bg-white/[0.04]">
              <input
                type="checkbox"
                className="rounded"
                checked={selected.includes(c.name)}
                onChange={() => toggle(c.name)}
              />
              <span className="truncate">{c.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
