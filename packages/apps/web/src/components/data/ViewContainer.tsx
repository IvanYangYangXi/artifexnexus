"use client";

/**
 * ViewContainer — C3 渲染容器
 *
 * 根据 Context 中的 activeView 派发对应视图组件。
 *   - STORY-0070：table / card / list / tree（直展型 4 视图）
 *   - STORY-0071~0073：bar / pie / line / scatter / spatial-plot / scene-heatmap（占位）
 */

import * as React from "react";

import type { ViewType } from "./ViewSwitcher";
import { DataPageContext } from "./DataPage";
import { TableView } from "./TableView";
import { CardView } from "./CardView";
import { ListView } from "./ListView";
import { TreeView } from "./TreeView";

export function ViewContainer() {
  const { state, andf, activeView } = React.useContext(DataPageContext);

  if (state !== "rendering" && state !== "configuring" && state !== "editing") return null;
  if (!andf) return null;

  return (
    <div className="h-full">
      {renderView(activeView)}
    </div>
  );
}

/** 按视图类型派发 */
function renderView(view: ViewType) {
  switch (view) {
    case "table":
      return <TableView />;
    case "card":
      return <CardView />;
    case "list":
      return <ListView />;
    case "tree":
      return <TreeView />;
    default:
      return <ViewPlaceholder view={view} />;
  }
}

// ─── 占位组件 ──────────────────────────────────────────────────────────────

const VIEW_LABELS: Record<string, string> = {
  "bar": "Bar 柱状图",
  "pie": "Pie 饼图",
  "line": "Line 折线图",
  "scatter": "Scatter 散点图",
  "spatial-plot": "Spatial Plot 空间散点",
  "scene-heatmap": "Scene Heatmap 热力图",
};

const VIEW_ICONS: Record<string, string> = {
  "bar": "▊",
  "pie": "◔",
  "line": "╱",
  "scatter": "·",
  "spatial-plot": "✚",
  "scene-heatmap": "▨",
};

function ViewPlaceholder({ view }: { view: ViewType }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-muted-foreground/40">
        <span className="text-5xl">{VIEW_ICONS[view] ?? "?"}</span>
        <p className="text-sm">{VIEW_LABELS[view] ?? view}</p>
        <p className="text-xs text-muted-foreground/30">
          将在后续版本实现
        </p>
      </div>
    </div>
  );
}
