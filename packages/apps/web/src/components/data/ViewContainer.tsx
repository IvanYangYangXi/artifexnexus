"use client";

/**
 * ViewContainer — C3 渲染容器
 *
 * 根据当前选中视图类型，渲染对应组件。
 * STORY-0069 阶段：10 视图全部为 ViewPlaceholder。
 * STORY-0070~0073 逐步替换为真实视图组件。
 */

import * as React from "react";

import type { ViewType } from "./ViewSwitcher";
import { DataPageContext } from "./DataPage";

/** 当前选中视图（独立 state，不跨组件共享直到 STORY-0070） */
export function ViewContainer() {
  const { state, andf } = React.useContext(DataPageContext);
  // 内部 state：当前视图（STORY-0069 默认 table）
  const [activeView] = React.useState<ViewType>("table");

  if (state !== "rendering" && state !== "configuring") return null;
  if (!andf) return null;

  return (
    <div className="flex h-full items-center justify-center p-4">
      <ViewPlaceholder view={activeView} />
    </div>
  );
}

// ─── 占位组件 ──────────────────────────────────────────────────────────────

const VIEW_LABELS: Record<ViewType, string> = {
  "table": "Table 表格",
  "card": "Card 卡片",
  "list": "List 列表",
  "tree": "Tree 树形",
  "bar": "Bar 柱状图",
  "pie": "Pie 饼图",
  "line": "Line 折线图",
  "scatter": "Scatter 散点图",
  "spatial-plot": "Spatial Plot 空间散点",
  "scene-heatmap": "Scene Heatmap 热力图",
};

const VIEW_ICONS: Record<ViewType, string> = {
  "table": "#",
  "card": "▣",
  "list": "≡",
  "tree": "└",
  "bar": "▊",
  "pie": "◔",
  "line": "╱",
  "scatter": "·",
  "spatial-plot": "✚",
  "scene-heatmap": "▨",
};

/** 视图占位组件：图标 + 名称 + 提示 */
function ViewPlaceholder({ view }: { view: ViewType }) {
  return (
    <div className="flex flex-col items-center gap-3 text-muted-foreground/40">
      <span className="text-5xl">{VIEW_ICONS[view]}</span>
      <p className="text-sm">{VIEW_LABELS[view]}</p>
      <p className="text-xs text-muted-foreground/30">
        将在后续版本实现
      </p>
    </div>
  );
}
