"use client";

/**
 * DataPage — 数据模块主壳（STORY-0069）
 *
 * 对齐 docs/specs/ui/data-view-structure.md：
 *   C1 顶栏（状态/导入/导出）
 *   C2 列配置面板
 *   C3 视图区 = 视图切换器 + 渲染容器
 *   C4 Summary Bar
 *
 * 状态机：empty → importing → configuring → rendering ⇄ editing → error
 * 视图共 10 种槽位，直展型 4 视图（STORY-0070）+ 聚合型/空间型占位。
 */

import * as React from "react";
import type { ANDF } from "@artifex-nexus/contracts";

import { ImportDropzone } from "./ImportDropzone";
import { ColumnConfig } from "./ColumnConfig";
import { ViewSwitcher, type ViewType } from "./ViewSwitcher";
import { ViewContainer } from "./ViewContainer";
import { SummaryBar } from "./SummaryBar";
import { uiLog } from "../../lib/ui-log";

// ─── 类型定义 ──────────────────────────────────────────────────────────────

/** 数据模块页面状态 */
export type DataState = "empty" | "importing" | "configuring" | "rendering" | "editing" | "error";

/** ANDF Diff 变更记录 */
export interface DiffChange {
  op: "update" | "move" | "delete";
  row: number;
  column?: string;
  value?: unknown;
  rowId?: string;
  toParent?: string;
  toIndex?: number;
}

/** ANDF Diff 容器 */
export interface ANDFDiff {
  type: "andf-diff/v1";
  changes: DiffChange[];
}

/** 视图字段编码：slotName → columnName */
export type ViewEncoding = Record<string, string>;

/** 空间视图编码类型（STORY-0072） */
export interface SpatialEncoding {
  /** 底图（dataURL + 坐标系参数） */
  background?: { src: string; origin: "top-left" | "center"; unitPerPx?: number };
  /** X 坐标字段 */
  x: { field: string };
  /** Y 坐标字段 */
  y: { field: string };
  /** 颜色编码 */
  color?: { field?: string; scale: "ordinal" | "sequential"; palette?: string[] };
  /** 形状编码 */
  shape?: { field?: string; mapping?: Record<string, "circle" | "square" | "triangle" | "diamond"> };
  /** 尺寸编码（minPx, maxPx） */
  size?: { field?: string; range: [number, number] };
  /** 缩略图编码 */
  thumbnail?: { field?: string };
  /** 悬停时显示的额外字段 */
  tooltipFields?: string[];
}

/** 热力图编码类型（STORY-0073），复用 SpatialEncoding 的底图+坐标系 */
export interface HeatmapEncoding {
  /** 底图（复用 SpatialEncoding.background 结构） */
  background?: { src: string; origin: "top-left" | "center"; unitPerPx?: number };
  /** X 坐标字段 */
  x: { field: string };
  /** Y 坐标字段 */
  y: { field: string };
  /** 高斯核带宽（像素） */
  bandwidth: number;
  /** 色块透明度 */
  opacity: number;
  /** 色阶方案 */
  colorScale: "viridis" | "inferno" | "blues";
  /** 是否叠加显示坐标点 */
  showPoints: boolean;
}

/** Action 类型 */
export type DataAction =
  | { type: "START_IMPORT" }
  | { type: "IMPORT_OK"; andf: ANDF }
  | { type: "IMPORT_ERROR"; message: string }
  | { type: "CONFIGURE_DONE" }
  | { type: "BACK_TO_CONFIG" }
  | { type: "SET_VIEW"; view: ViewType }
  | { type: "SET_VIEW_ENCODING"; view: ViewType; encoding: ViewEncoding }
  | { type: "SET_SPATIAL_ENCODING"; encoding: SpatialEncoding }
  | { type: "SET_HEATMAP_ENCODING"; encoding: HeatmapEncoding }
  | { type: "START_EDIT" }
  | { type: "CANCEL_EDIT" }
  | { type: "ADD_DIFF"; change: DiffChange }
  | { type: "CLEAR_DIFFS" }
  | { type: "APPLY_UPDATE"; rowIndex: number; column: string; value: unknown }
  | { type: "RESET" };

/** Context 值 */
export interface DataPageContextValue {
  andf: ANDF | null;
  state: DataState;
  errorMessage: string;
  activeView: ViewType;
  diffs: DiffChange[];
  /** 每个视图独立的字段编码映射（STORY-0071 聚合视图字段映射） */
  encodings: Record<string, ViewEncoding>;
  /** 空间视图编码（STORY-0072），与简单视图编码分离以保持类型安全 */
  spatialEncoding: SpatialEncoding | null;
  /** 热力图编码（STORY-0073） */
  heatmapEncoding: HeatmapEncoding | null;
  dispatch: React.Dispatch<DataAction>;
}

// ─── Context ───────────────────────────────────────────────────────────────

export const DataPageContext = React.createContext<DataPageContextValue>({
  andf: null,
  state: "empty",
  errorMessage: "",
  activeView: "table",
  diffs: [],
  encodings: {},
  spatialEncoding: null,
  heatmapEncoding: null,
  dispatch: () => {},
});

// ─── Reducer ───────────────────────────────────────────────────────────────

interface DataReducerState {
  andf: ANDF | null;
  state: DataState;
  errorMessage: string;
  activeView: ViewType;
  diffs: DiffChange[];
  encodings: Record<string, ViewEncoding>;
  spatialEncoding: SpatialEncoding | null;
  heatmapEncoding: HeatmapEncoding | null;
}

function dataReducer(state: DataReducerState, action: DataAction): DataReducerState {
  switch (action.type) {
    case "START_IMPORT":
      return { ...state, state: "importing", errorMessage: "" };
    case "IMPORT_OK":
     uiLog.custom("DataPage", "importSuccess", {
        rows: action.andf.meta.rowCount,
        cols: action.andf.meta.columnCount,
      });
      return { ...state, state: "configuring", andf: action.andf, errorMessage: "", activeView: "table", diffs: [], encodings: {}, spatialEncoding: null, heatmapEncoding: null };
    case "IMPORT_ERROR":
      uiLog.error("DataPage", "importError", { message: action.message });
      return { ...state, state: "error", errorMessage: action.message };
    case "CONFIGURE_DONE":
      return { ...state, state: "rendering" };
    case "BACK_TO_CONFIG":
      return { ...state, state: "configuring" };
    case "SET_VIEW":
      return { ...state, activeView: action.view };
    case "SET_VIEW_ENCODING":
      return { ...state, encodings: { ...state.encodings, [action.view]: action.encoding } };
    case "SET_SPATIAL_ENCODING":
      return { ...state, spatialEncoding: action.encoding };
    case "SET_HEATMAP_ENCODING":
      return { ...state, heatmapEncoding: action.encoding };
    case "START_EDIT":
      return { ...state, state: "editing" };
    case "CANCEL_EDIT":
      return { ...state, state: "rendering" };
    case "ADD_DIFF":
      return { ...state, diffs: [...state.diffs, action.change], state: "rendering" };
    case "CLEAR_DIFFS":
      return { ...state, diffs: [] };
    case "APPLY_UPDATE": {
      if (!state.andf) return state;
      const newRows = [...state.andf.rows];
      newRows[action.rowIndex] = {
        ...newRows[action.rowIndex],
        [action.column]: action.value,
      };
      return {
        ...state,
        andf: { ...state.andf, rows: newRows },
      };
    }
    case "RESET":
      return { andf: null, state: "empty", errorMessage: "", activeView: "table", diffs: [], encodings: {}, spatialEncoding: null, heatmapEncoding: null };
    default:
      return state;
  }
}

// ─── 组件 ──────────────────────────────────────────────────────────────────

export function DataPage() {
  const [ctx, dispatch] = React.useReducer(dataReducer, {
    andf: null,
    state: "empty",
    errorMessage: "",
    activeView: "table",
    diffs: [],
    encodings: {},
    spatialEncoding: null,
    heatmapEncoding: null,
  });

  const contextValue: DataPageContextValue = React.useMemo(
    () => ({ ...ctx, dispatch }),
    [ctx, dispatch],
  );

  return (
    <DataPageContext.Provider value={contextValue}>
      <div className="flex h-full w-full flex-col bg-background text-foreground">
        {/* C1 顶栏 */}
        <TopBar />

        {/* 主内容区：C2 列配置 + C3 视图区 + C4 SummaryBar */}
        <div className="flex flex-1 overflow-hidden">
          {/* C2 列配置面板（configuring / rendering / editing 态可见） */}
          {(ctx.state === "configuring" || ctx.state === "rendering" || ctx.state === "editing") && (
            <ColumnConfig />
          )}

          {/* C3 视图区 + C4 */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* C3 视图切换器 + 渲染容器 */}
            <div className="flex-1 overflow-hidden">
              <MainContent />
            </div>

            {/* C4 Summary Bar（rendering / editing 态可见，数据范围未变） */}
            {(ctx.state === "rendering" || ctx.state === "editing") && <SummaryBar />}
          </div>
        </div>
      </div>
    </DataPageContext.Provider>
  );
}

// ─── 子组件 ────────────────────────────────────────────────────────────────

/** C1 顶栏：状态标签 + 导入/导出按钮 */
function TopBar() {
  const { state, dispatch, andf, errorMessage, diffs } = React.useContext(DataPageContext);

  const handleReset = () => dispatch({ type: "RESET" });

  /** CSV 导出 */
  const handleExportCSV = React.useCallback(() => {
    if (!andf) return;
    const cols = andf.columns.map((c) => c.name);
    const header = cols.map((c) => `"${c}"`).join(",");
    const body = andf.rows.map((row) =>
      cols.map((c) => {
        const v = row[c];
        if (v === null || v === undefined) return "";
        const s = String(v);
        return s.includes(",") || s.includes("\n") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(",")
    ).join("\n");
    const csv = header + "\n" + body;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "export.csv";
    a.click();
    URL.revokeObjectURL(url);
    uiLog.custom("TopBar", "exportCSV", { rows: andf.rows.length, cols: cols.length });
  }, [andf]);

  /** ANDF JSON 导出（STORY-0074） */
  const handleExportANDF = React.useCallback(() => {
    if (!andf) return;
    const payload = { columns: andf.columns, rows: andf.rows, meta: andf.meta };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "data.andf.json";
    a.click();
    URL.revokeObjectURL(url);
    uiLog.custom("TopBar", "exportANDF", { rows: andf.rows.length, cols: andf.columns.length });
  }, [andf]);

  /** Diff 导出 */
  const handleExportDiff = React.useCallback(() => {
    if (diffs.length === 0) return;
    const payload: ANDFDiff = { type: "andf-diff/v1", changes: diffs };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "andf-diff.json";
    a.click();
    URL.revokeObjectURL(url);
    uiLog.custom("TopBar", "exportDiff", { count: diffs.length });
  }, [diffs]);

  const stateLabel: Record<DataState, string> = {
    empty: "未加载数据",
    importing: "导入中...",
    configuring: "配置中",
    rendering: "渲染中",
    editing: "编辑中",
    error: "错误",
  };

  const stateColor: Record<DataState, string> = {
    empty: "text-muted-foreground",
    importing: "text-amber-400",
    configuring: "text-blue-400",
    rendering: "text-emerald-400",
    editing: "text-yellow-400",
    error: "text-red-400",
  };

  return (
    <div className="flex items-center gap-3 border-b border-white/[0.06] bg-white/[0.01] px-4 py-2">
      {/* 状态标签 */}
      <span className={`text-xs font-medium ${stateColor[state]}`}>
        {stateLabel[state]}
      </span>

      {/* 分隔 */}
      <div className="h-3 w-px bg-border/60" />

      {/* 导入按钮 */}
      <ImportDropzone />

      {/* 导出按钮（仅 rendering / editing 态可见） */}
      {(state === "rendering" || state === "editing") && andf && (
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground"
            onClick={handleExportANDF}
          >
            导出 ANDF
          </button>
          <button
            type="button"
            className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground"
            onClick={handleExportCSV}
          >
            导出 CSV
          </button>
          {diffs.length > 0 && (
            <button
              type="button"
              className="rounded-md border border-yellow-400/20 bg-yellow-400/[0.06] px-2.5 py-1 text-xs text-yellow-400 transition-colors hover:bg-yellow-400/[0.12]"
              onClick={handleExportDiff}
            >
              导出 Diff ({diffs.length})
            </button>
          )}
        </div>
      )}

      {/* 错误态操作 */}
      {state === "error" && (
        <div className="ml-auto flex items-center gap-2">
          <span className="max-w-[400px] truncate text-xs text-red-400">
            {errorMessage}
          </span>
          <button
            type="button"
            className="rounded-md border border-white/[0.08] px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={handleReset}
          >
            返回
          </button>
        </div>
      )}
    </div>
  );
}

/** C3 主内容：视图切换器 + 渲染容器 */
function MainContent() {
  const { state, activeView, dispatch } = React.useContext(DataPageContext);

  if (state === "empty") {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <DatabasePlaceholder className="h-12 w-12 opacity-20" />
          <p className="text-sm">请导入 CSV 或 JSON 数据开始</p>
        </div>
      </div>
    );
  }

  if (state === "importing") {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm">正在解析数据...</p>
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <p className="text-sm">数据加载失败，请重新导入</p>
        </div>
      </div>
    );
  }

  // configuring / rendering / editing → 显示视图切换器 + 渲染容器
  return (
    <div className="flex h-full flex-col">
      {/* 视图切换器 */}
      <ViewSwitcher
        activeView={activeView}
        onViewChange={(v) => dispatch({ type: "SET_VIEW", view: v })}
      />

      {/* 渲染容器 */}
      <div className="flex-1 overflow-auto">
        <ViewContainer />
      </div>
    </div>
  );
}

/** 空态数据库图标（内联 SVG，避免额外依赖） */
function DatabasePlaceholder({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  );
}
