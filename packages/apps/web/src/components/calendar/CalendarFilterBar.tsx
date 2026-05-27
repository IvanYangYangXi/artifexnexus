/**
 * CalendarFilterBar — 来源筛选 + 周期筛选
 */

import * as React from "react";
import { cn } from "@artifex-nexus/ui";
import type { SourceFilter, PeriodFilter } from "../../lib/calendar/types";

interface SourceOption {
  value: SourceFilter;
  label: string;
  color: string;
}

const SOURCE_OPTIONS: SourceOption[] = [
  { value: "all", label: "全部来源", color: "" },
  { value: "nexus-tool", label: "Nexus-Tool", color: "bg-blue-500" },
  { value: "openclaw", label: "OpenClaw", color: "bg-green-500" },
];

interface PeriodOption {
  value: PeriodFilter;
  label: string;
}

const PERIOD_OPTIONS: PeriodOption[] = [
  { value: "all", label: "全部周期" },
  { value: "high", label: "高频 (≤4h)" },
  { value: "normal", label: "常规 (4h-12h)" },
  { value: "low", label: "低频 (>12h)" },
  { value: "once", label: "单次执行" },
];

interface CalendarFilterBarProps {
  sourceFilter: SourceFilter;
  periodFilter: PeriodFilter;
  onSourceChange: (f: SourceFilter) => void;
  onPeriodChange: (f: PeriodFilter) => void;
}

export function CalendarFilterBar({
  sourceFilter,
  periodFilter,
  onSourceChange,
  onPeriodChange,
}: CalendarFilterBarProps) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-1.5">
      {/* 来源筛选 */}
      <span className="text-[10px] text-muted-foreground shrink-0">来源:</span>
      <div className="flex items-center gap-0.5">
        {SOURCE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onSourceChange(opt.value)}
            className={cn(
              "flex items-center gap-1 rounded px-2 py-0.5 text-[10px] transition-colors",
              sourceFilter === opt.value
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.color && (
              <span className={cn("inline-block h-1.5 w-1.5 rounded-full", opt.color)} />
            )}
            {opt.label}
          </button>
        ))}
      </div>

      <span className="h-3 w-px bg-border mx-1" />

      {/* 周期筛选 */}
      <span className="text-[10px] text-muted-foreground shrink-0">周期:</span>
      <div className="flex items-center gap-0.5 overflow-x-auto">
        {PERIOD_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onPeriodChange(opt.value)}
            className={cn(
              "rounded px-2 py-0.5 text-[10px] transition-colors whitespace-nowrap",
              periodFilter === opt.value
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
