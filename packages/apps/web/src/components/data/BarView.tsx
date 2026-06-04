/**
 * BarView — 柱状图（Recharts）
 *
 * 槽位：xAxis (string|number) + yAxis (number) + color (string, 可选)
 * 按 xAxis 分组，yAxis 聚合 sum；color 字段存在时按颜色分组绘制并列柱。
 * encoding 来自 DataPageContext.encodings["bar"]。
 */

import * as React from "react";
import type { Column } from "@artifex-nexus/contracts";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Cell,
} from "recharts";

import { DataPageContext } from "./DataPage";
import { FieldMapping } from "./shared/FieldMapping";
import { mapColumnsToSlots } from "./shared/slot-mapping";
import { chartColor } from "./shared/chart-colors";

// ─── 数据转换：按 xAxis 分组，yAxis 聚合 sum ──────────────────────────────

interface BarDataPoint {
  name: string;
  [key: string]: number | string;
}

function aggregateForBar(
  rows: Record<string, unknown>[],
  xField: string,
  yField: string,
  colorField: string | null
): BarDataPoint[] {
  const groups = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const xv = String(row[xField] ?? "");
    const cv = colorField ? String(row[colorField] ?? "__") : "__";
    const yv = Number(row[yField]) || 0;
    if (!groups.has(xv)) groups.set(xv, new Map());
    const inner = groups.get(xv)!;
    inner.set(cv, (inner.get(cv) || 0) + yv);
  }

  const result: BarDataPoint[] = [];
  for (const [x, map] of groups) {
    const point: BarDataPoint = { name: x };
    for (const [c, v] of map) point[c] = v;
    result.push(point);
  }
  return result;
}

// ─── 组件 ──────────────────────────────────────────────────────────────────

export function BarView() {
  const { andf, encodings, dispatch } = React.useContext(DataPageContext);
  const cols: Column[] = andf?.columns ?? [];
  const rows = andf?.rows ?? [];

  const slots = React.useMemo(() => mapColumnsToSlots("bar", cols), [cols]);
  const encoding = React.useMemo(() => encodings["bar"] || {}, [encodings]);

  const handleEncodingChange = (enc: Record<string, string>) =>
    dispatch({ type: "SET_VIEW_ENCODING", view: "bar", encoding: enc });

  const xField = encoding["xAxis"];
  const yField = encoding["yAxis"];
  const colorField = encoding["color"] || null;

  // ⚠️ Hooks 必须在所有 early return 之前调用（rules-of-hooks）
  const data = React.useMemo(
    () => (xField && yField ? aggregateForBar(rows, xField, yField, colorField) : []),
    [rows, xField, yField, colorField],
  );
  const colorKeys = colorField
    ? [...new Set(data.map((d) => Object.keys(d).filter((k) => k !== "name")).flat())]
    : [yField || ""];

  // 空映射
  if (!xField || !yField) {
    return (
      <div className="flex h-full flex-col">
        <FieldMapping slots={slots} encoding={encoding} onEncodingChange={handleEncodingChange} columns={cols} />
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground/50">
          {!xField ? "请选择 X 轴字段映射" : "请选择 Y 轴字段映射"}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <FieldMapping slots={slots} encoding={encoding} onEncodingChange={handleEncodingChange} columns={cols} />
      <div className="flex-1 p-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.4)" />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
            <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "var(--radius)",
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }} />
            {colorKeys.map((key, i) => (
              <Bar key={key} dataKey={key} fill={chartColor(i)} radius={[3, 3, 0, 0]}>
                {data.map((_, j) => (
                  <Cell key={j} fill={chartColor(i)} />
                ))}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
