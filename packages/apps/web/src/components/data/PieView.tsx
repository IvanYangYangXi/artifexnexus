/**
 * PieView — 饼图/环形图（Recharts）
 *
 * 槽位：label (string) + value (number)
 * 自动按 label 分组 sum(value) 聚合，一扇区一标签。
 * encoding 来自 DataPageContext.encodings["pie"]。
 */

import * as React from "react";
import type { Column } from "@artifex-nexus/contracts";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

import { DataPageContext } from "./DataPage";
import { FieldMapping } from "./shared/FieldMapping";
import { mapColumnsToSlots } from "./shared/slot-mapping";
import { chartColor } from "./shared/chart-colors";
import { ZoomPanContainer } from "./shared/ZoomPanContainer";

// ─── 数据转换：按 label 分组 sum(value) ────────────────────────────────────

interface PieDataPoint {
  name: string;
  value: number;
}

const PIE_MAX_SLICES = 30;

interface AggregateResult {
  data: PieDataPoint[];
  truncated: number;
  totalSlices: number;
}

function aggregateForPie(
  rows: Record<string, unknown>[],
  labelField: string,
  valueField: string,
): AggregateResult {
  const map = new Map<string, number>();
  for (const row of rows) {
    const label = String(row[labelField] ?? "(空)");
    const v = Number(row[valueField]);
    map.set(label, (map.get(label) ?? 0) + (Number.isFinite(v) ? v : 0));
  }
  const entries = [...map.entries()];
  const totalSlices = entries.length;
  if (totalSlices <= PIE_MAX_SLICES) {
    return {
      data: entries.map(([name, value]) => ({ name, value })),
      truncated: 0,
      totalSlices,
    };
  }
  // 按值排序，保留 Top N-1，其余合并为"其他"
  entries.sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, PIE_MAX_SLICES - 1);
  const tail = entries.slice(PIE_MAX_SLICES - 1);
  const otherValue = tail.reduce((s, [, v]) => s + v, 0);
  return {
    data: [
      ...top.map(([name, value]) => ({ name, value })),
      { name: `其他(${tail.length})`, value: otherValue },
    ],
    truncated: tail.length,
    totalSlices,
  };
}

// ─── 组件 ──────────────────────────────────────────────────────────────────

export function PieView() {
  const { andf, encodings, dispatch } = React.useContext(DataPageContext);
  const cols: Column[] = andf?.columns ?? [];
  const rows = andf?.rows ?? [];

  const slots = React.useMemo(() => mapColumnsToSlots("pie", cols), [cols]);
  const encoding = React.useMemo(() => encodings["pie"] || {}, [encodings]);

  const handleEncodingChange = (enc: Record<string, string>) =>
    dispatch({ type: "SET_VIEW_ENCODING", view: "pie", encoding: enc });

  const labelField = encoding["label"];
  const valueField = encoding["value"];

  // ⚠️ Hooks 必须在所有 early return 之前调用（rules-of-hooks）
  const agg = React.useMemo(
    () =>
      labelField && valueField
        ? aggregateForPie(rows, labelField, valueField)
        : { data: [], truncated: 0, totalSlices: 0 },
    [rows, labelField, valueField],
  );

  if (!labelField || !valueField) {
    return (
      <div className="flex h-full flex-col">
        <FieldMapping slots={slots} encoding={encoding} onEncodingChange={handleEncodingChange} columns={cols} />
        <div className="flex flex-1 items-center justify-center text-sm text-foreground/50">
          {!labelField ? "请选择标签字段映射" : "请选择数值字段映射"}
        </div>
      </div>
    );
  }

  const { data, truncated, totalSlices } = agg;

  return (
    <div className="flex h-full flex-col">
      <FieldMapping slots={slots} encoding={encoding} onEncodingChange={handleEncodingChange} columns={cols} />
      {truncated > 0 && (
        <div className="px-3 py-1 text-[10px] text-amber-400/80">
          扇区数 {totalSlices.toLocaleString()} 超过 {PIE_MAX_SLICES}，已取 Top {PIE_MAX_SLICES - 1}，其余合并为「其他」
        </div>
      )}
      <div className="flex-1 p-2">
        <ZoomPanContainer>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="40%"
              outerRadius="75%"
              paddingAngle={2}
              label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ""} (${((percent ?? 0) * 100).toFixed(0)}%)`}
              labelLine={{ stroke: "hsl(var(--muted-foreground) / 0.4)", strokeWidth: 1 }}
              isAnimationActive={data.length <= 30}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={chartColor(i)} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "var(--radius)",
                fontSize: 12,
                color: "hsl(var(--popover-foreground))",
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }} />
          </PieChart>
        </ResponsiveContainer>
        </ZoomPanContainer>
      </div>
    </div>
  );
}
