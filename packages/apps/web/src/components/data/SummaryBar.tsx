"use client";

/**
 * SummaryBar — C4 底部摘要栏（STORY-0074 增强版）
 *
 * 对齐 docs/specs/ui/data-view-structure.md §8：
 *   rendering / editing 态：显示行列数 + 最多 5 列的统计摘要。
 *   统计由 features/data/stats.ts 纯函数生成。
 */

import * as React from "react";
import { BarChart3, Hash, Type, ToggleLeft } from "lucide-react";
import { DataPageContext } from "./DataPage";
import { computeAllStats, type ColumnStats } from "../../features/data/stats";

/** 单列统计徽章 */
function StatBadge({ s }: { s: ColumnStats }) {
  if (s.count === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/50">
        <Type className="h-3 w-3" />
        {s.column}: 无数据
      </span>
    );
  }

  switch (s.type) {
    case "number":
      return (
        <span className="inline-flex items-center gap-1 text-[11px]">
          <Hash className="h-3 w-3 text-blue-400/60" />
          <span className="font-medium text-foreground">{s.column}</span>
          <span className="text-muted-foreground">
            min {fmtNum(s.min)} | max {fmtNum(s.max)} | avg {fmtNum(s.avg)}
          </span>
        </span>
      );
    case "string":
      return (
        <span className="inline-flex items-center gap-1 text-[11px]">
          <Type className="h-3 w-3 text-violet-400/60" />
          <span className="font-medium text-foreground">{s.column}</span>
          <span className="text-muted-foreground">
            {s.uniqueCount} unique
            {s.topValues?.[0] && (
              <> | top: &ldquo;{s.topValues[0].value}&rdquo; &times;{s.topValues[0].count}</>
            )}
          </span>
        </span>
      );
    case "boolean":
      return (
        <span className="inline-flex items-center gap-1 text-[11px]">
          <ToggleLeft className="h-3 w-3 text-amber-400/60" />
          <span className="font-medium text-foreground">{s.column}</span>
          <span className="text-muted-foreground">
            true {fmtRatio(s.trueRatio)}
          </span>
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          {s.column}: {s.count} 值
        </span>
      );
  }
}

// ---- 主组件 ----

export function SummaryBar() {
  const { andf, diffs } = React.useContext(DataPageContext);

  if (!andf) return null;

  const { rowCount, columnCount } = andf.meta;

  // 使用 useMemo 避免每帧重计算统计
  const stats = React.useMemo(
    () => computeAllStats(andf.columns, andf.rows),
    [andf],
  );

  // 仅展示最多 5 列（从第 1 列开始），超过截断
  const displayedStats = stats.slice(0, 5);
  const overflow = stats.length > 5 ? stats.length - 5 : 0;

  return (
    <div className="flex items-center gap-3 border-t border-white/[0.06] bg-white/[0.01] px-4 py-1.5">
      <BarChart3 className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />

      {/* 行列基础信息 */}
      <span className="shrink-0 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{rowCount}</span> 行{" "}
        <span className="font-medium text-foreground">{columnCount}</span> 列
      </span>

      {/* 分隔 */}
      <span className="h-3 w-px bg-border/40" />

      {/* 列统计快照（最多 5 列） */}
      <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
        {displayedStats.map((s) => (
          <span key={s.column} className="shrink-0">
            <StatBadge s={s} />
          </span>
        ))}
        {overflow > 0 && (
          <span className="shrink-0 text-[11px] text-muted-foreground/50">
            +{overflow} 列...
          </span>
        )}
      </div>

      {/* Diff 计数（editing 态可见） */}
      {diffs.length > 0 && (
        <span className="ml-auto shrink-0 text-[11px] text-yellow-400/80">
          未保存 {diffs.length} 条修改
        </span>
      )}
    </div>
  );
}

// ---- 格式化辅助 ----

function fmtNum(v?: number): string {
  if (v === undefined || v === null) return "-";
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2).replace(/\.?0+$/, "");
}

function fmtRatio(r?: number): string {
  if (r === undefined) return "-";
  return `${(r * 100).toFixed(0)}%`;
}
