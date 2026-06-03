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
 * 状态机：empty → importing → configuring → rendering → error
 * 视图共 10 种槽位，STORY-0069 阶段均为占位。
 */

import * as React from "react";
import type { ANDF } from "@artifex-nexus/contracts";

import { ImportDropzone } from "./ImportDropzone";
import { ColumnConfig } from "./ColumnConfig";
import { ViewSwitcherStandalone } from "./ViewSwitcher";
import { ViewContainer } from "./ViewContainer";
import { SummaryBar } from "./SummaryBar";
import { uiLog } from "../../lib/ui-log";

// ─── 类型定义 ──────────────────────────────────────────────────────────────

/** 数据模块页面状态 */
export type DataState = "empty" | "importing" | "configuring" | "rendering" | "error";

/** Action 类型 */
type DataAction =
  | { type: "START_IMPORT" }
  | { type: "IMPORT_OK"; andf: ANDF }
  | { type: "IMPORT_ERROR"; message: string }
  | { type: "CONFIGURE_DONE" }
  | { type: "BACK_TO_CONFIG" }
  | { type: "RESET" };

/** Context 值 */
export interface DataPageContextValue {
  andf: ANDF | null;
  state: DataState;
  errorMessage: string;
  dispatch: React.Dispatch<DataAction>;
}

// ─── Context ───────────────────────────────────────────────────────────────

export const DataPageContext = React.createContext<DataPageContextValue>({
  andf: null,
  state: "empty",
  errorMessage: "",
  dispatch: () => {},
});

// ─── Reducer ───────────────────────────────────────────────────────────────

interface DataReducerState {
  andf: ANDF | null;
  state: DataState;
  errorMessage: string;
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
      return { ...state, state: "configuring", andf: action.andf, errorMessage: "" };
    case "IMPORT_ERROR":
      uiLog.error("DataPage", "importError", { message: action.message });
      return { ...state, state: "error", errorMessage: action.message };
    case "CONFIGURE_DONE":
      return { ...state, state: "rendering" };
    case "BACK_TO_CONFIG":
      return { ...state, state: "configuring" };
    case "RESET":
      return { andf: null, state: "empty", errorMessage: "" };
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
          {/* C2 列配置面板（仅 configuring / rendering 态可见） */}
          {(ctx.state === "configuring" || ctx.state === "rendering") && (
            <ColumnConfig />
          )}

          {/* C3 视图区 + C4 */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* C3 视图切换器 + 渲染容器 */}
            <div className="flex-1 overflow-hidden">
              <MainContent />
            </div>

            {/* C4 Summary Bar */}
            {ctx.state === "rendering" && <SummaryBar />}
          </div>
        </div>
      </div>
    </DataPageContext.Provider>
  );
}

// ─── 子组件 ────────────────────────────────────────────────────────────────

/** C1 顶栏：状态标签 + 导入/导出按钮 */
function TopBar() {
  const { state, dispatch, andf, errorMessage } = React.useContext(DataPageContext);

  const handleReset = () => dispatch({ type: "RESET" });

  const stateLabel: Record<DataState, string> = {
    empty: "未加载数据",
    importing: "导入中...",
    configuring: "配置中",
    rendering: "渲染中",
    error: "错误",
  };

  const stateColor: Record<DataState, string> = {
    empty: "text-muted-foreground",
    importing: "text-amber-400",
    configuring: "text-blue-400",
    rendering: "text-emerald-400",
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

      {/* 导出按钮（仅 rendering 态可见） */}
      {state === "rendering" && andf && (
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground"
            onClick={() => {
              /* STORY-0074 实现 */
            }}
          >
            导出 CSV
          </button>
          <button
            type="button"
            className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground"
            onClick={() => {
              /* STORY-0074 实现 */
            }}
          >
            导出 ANDF
          </button>
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
  const { state } = React.useContext(DataPageContext);

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

  return (
    <div className="flex h-full flex-col">
      {/* 视图切换器 */}
      <ViewSwitcherStandalone />

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
