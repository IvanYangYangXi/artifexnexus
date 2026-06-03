"use client";

/**
 * SummaryBar — C4 底部摘要栏
 *
 * 对齐 docs/specs/ui/data-view-structure.md §8：
 *   渲染态显示数据概览（行数 / 列数 / 数值统计概要）
 *
 * STORY-0069 阶段：仅显示基础行数 + 列数。
 * STORY-0074 加入数值统计（min / max / avg / unique）。
 */

import * as React from "react";
import { BarChart3 } from "lucide-react";
import { DataPageContext } from "./DataPage";

export function SummaryBar() {
  const { andf } = React.useContext(DataPageContext);

  if (!andf) return null;

  const { rowCount, columnCount } = andf.meta;

  return (
    <div className="flex items-center gap-3 border-t border-white/[0.06] bg-white/[0.01] px-4 py-1.5">
      <BarChart3 className="h-3.5 w-3.5 text-muted-foreground/40" />
      <span className="text-xs text-muted-foreground">
        Summary — 共{" "}
        <span className="font-medium text-foreground">{rowCount}</span> 行，{" "}
        <span className="font-medium text-foreground">{columnCount}</span> 列
      </span>
      {/* 后续 story 扩展：min/max/avg/unique */}
    </div>
  );
}
