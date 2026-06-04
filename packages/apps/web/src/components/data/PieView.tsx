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

// ─── 数据转换：按 label 分组 sum(value) ────────────────────────────────────

interface PieDataPoint {
  name: string;
  value: number;
}

function aggregateForPie(
  rows: Record<string, unknown>[],
  labelField: string,
  valueField: string
): PieDataPoint[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    const label = String(row[labelField] ?? "(空)");
    const v = Number(row[valueField]) || 0;
    map.set(label, (map.get(label) || 0) + v);
  }
  return [...map.entries()].map(([name, value]) => ({ name, value }));
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
  const data = React.useMemo(
    () => (labelField && valueField ? aggregateForPie(rows, labelField, valueField) : []),
    [rows, labelField, valueField],
  );

  if (!labelField || !valueField) {
    return (
      <div className="flex h-full flex-col">
        <FieldMapping slots={slots} encoding={encoding} onEncodingChange={handleEncodingChange} columns={cols} />
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground/50">
          {!labelField ? "请选择标签字段映射" : "请选择数值字段映射"}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <FieldMapping slots={slots} encoding={encoding} onEncodingChange={handleEncodingChange} columns={cols} />
      <div className="flex-1 p-2">
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
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
