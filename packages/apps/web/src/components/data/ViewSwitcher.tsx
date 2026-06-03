"use client";

/**
 * ViewSwitcher — 视图切换器
 *
 * 对齐 docs/specs/ui/data-view-structure.md §1.1：
 *   10 种视图分 3 组：
 *     直展型：Table / Card / List / Tree
 *     聚合型：Bar / Pie / Line / Scatter
 *     空间型：Spatial Plot / Scene Heatmap
 *
 * STORY-0069 阶段：Tab 结构就位，所有视图渲染 ViewPlaceholder。
 */

import * as React from "react";

import type { ANDF } from "@artifex-nexus/contracts";

/** 视图类型 */
export type ViewType =
  | "table"
  | "card"
  | "list"
  | "tree"
  | "bar"
  | "pie"
  | "line"
  | "scatter"
  | "spatial-plot"
  | "scene-heatmap";

/** 视图分组定义 */
interface ViewGroup {
  label: string;
  views: { id: ViewType; label: string }[];
}

const VIEW_GROUPS: ViewGroup[] = [
  {
    label: "直展型",
    views: [
      { id: "table", label: "Table" },
      { id: "card", label: "Card" },
      { id: "list", label: "List" },
      { id: "tree", label: "Tree" },
    ],
  },
  {
    label: "聚合型",
    views: [
      { id: "bar", label: "Bar" },
      { id: "pie", label: "Pie" },
      { id: "line", label: "Line" },
      { id: "scatter", label: "Scatter" },
    ],
  },
  {
    label: "空间型",
    views: [
      { id: "spatial-plot", label: "Spatial" },
      { id: "scene-heatmap", label: "Heatmap" },
    ],
  },
];

/** ViewSwitcher 对外暴露的 props */
export interface ViewSwitcherProps {
  activeView: ViewType;
  onViewChange: (view: ViewType) => void;
}

export function ViewSwitcher({ activeView, onViewChange }: ViewSwitcherProps) {
  return (
    <div className="flex items-center gap-0.5 border-b border-white/[0.06] bg-white/[0.01] px-3 py-1.5">
      {VIEW_GROUPS.map((group, gi) => (
        <React.Fragment key={group.label}>
          {gi > 0 && (
            <div className="mx-1 h-4 w-px bg-border/40" />
          )}
          <span className="text-[10px] text-muted-foreground/50 mr-0.5">
            {group.label}
          </span>
          {group.views.map((view) => (
            <button
              key={view.id}
              type="button"
              className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                activeView === view.id
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
              }`}
              onClick={() => onViewChange(view.id)}
            >
              {view.label}
            </button>
          ))}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── 独立组件导出（含内部状态封装） ────────────────────────────────────────

/** 带内部 activeView 状态的 ViewSwitcher（嵌入 DataPage 用） */
export function ViewSwitcherStandalone() {
  // STORY-0069 阶段默认选中 table
  const [activeView, setActiveView] = React.useState<ViewType>("table");

  return (
    <ViewSwitcher
      activeView={activeView}
      onViewChange={(v) => {
        setActiveView(v);
      }}
    />
  );
}

// ─── 导出辅助 ──────────────────────────────────────────────────────────────

/**
 * 根据 ANDF 列自动派生默认视图编码（encoding）。
 * 按槽位规则匹配列名：
 *   - pos_x / x / longitude → x 轴
 *   - pos_y / y / latitude → y 轴
 *   - 不匹配的列默认进入 data 槽
 *
 * STORY-0070~0073 各视图会基于此派生真实 encoding。
 */
export function deriveDefaultEncoding(_andf: ANDF): Record<string, unknown> {
  // STORY-0070 实现
  return {};
}
