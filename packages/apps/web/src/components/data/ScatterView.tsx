/**
 * ScatterView — 散点图/气泡图（Recharts）
 *
 * 槽位：x (number) + y (number) + size (number, 可选) + color (string, 可选)
 * color → 按分组上色；size → 气泡半径。
 * encoding 来自 DataPageContext.encodings["scatter"]。
 */

import * as React from "react";
import type { Column } from "@artifex-nexus/contracts";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

import { DataPageContext } from "./DataPage";
import { FieldMapping } from "./shared/FieldMapping";
import { mapColumnsToSlots } from "./shared/slot-mapping";
import { chartColor } from "./shared/chart-colors";

// ─── 数据变换：按 color 分组，size 映射为 z ───────────────────────────────

interface ScatterDataPoint {
  x: number;
  y: number;
  z: number;
  name: string;
  [key: string]: unknown;
}

function transformForScatter(
  rows: Record<string, unknown>[],
  xField: string,
  yField: string,
  sizeField: string | null,
  colorField: string | null
): { groups: Map<string, ScatterDataPoint[]>; hasGroups: boolean } {
  if (!colorField) {
    // 无分组 → 单一散点系列
    const data: ScatterDataPoint[] = rows
      .map((row, i) => ({
        x: Number(row[xField]) || 0,
        y: Number(row[yField]) || 0,
        z: sizeField ? (Number(row[sizeField]) || 8) : 8,
        name: String(row["name"] ?? row["label"] ?? `#${i}`),
      }))
      .filter((d) => !isNaN(d.x) && !isNaN(d.y));
    const map = new Map<string, ScatterDataPoint[]>();
    map.set("", data);
    return { groups: map, hasGroups: false };
  }

  // 有分组 → 按 key 拆系列
  const map = new Map<string, ScatterDataPoint[]>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const key = String(row[colorField] ?? "其他");
    const d: ScatterDataPoint = {
      x: Number(row[xField]) || 0,
      y: Number(row[yField]) || 0,
      z: sizeField ? (Number(row[sizeField]) || 8) : 8,
      name: String(row["name"] ?? row["label"] ?? `#${i}`),
    };
    if (isNaN(d.x) || isNaN(d.y)) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(d);
  }
  return { groups: map, hasGroups: true };
}

// ─── 组件 ──────────────────────────────────────────────────────────────────

export function ScatterView() {
  const { andf, encodings, dispatch } = React.useContext(DataPageContext);
  const cols: Column[] = andf?.columns ?? [];
  const rows = andf?.rows ?? [];

  const slots = React.useMemo(() => mapColumnsToSlots("scatter", cols), [cols]);
  const encoding = React.useMemo(() => encodings["scatter"] || {}, [encodings]);

  const handleEncodingChange = (enc: Record<string, string>) =>
    dispatch({ type: "SET_VIEW_ENCODING", view: "scatter", encoding: enc });

  const xField = encoding["x"];
  const yField = encoding["y"];
  const sizeField = encoding["size"] || null;
  const colorField = encoding["color"] || null;

  // ⚠️ Hooks 必须在所有 early return 之前调用（rules-of-hooks）
  const { groups, hasGroups } = React.useMemo(
    () => (xField && yField
      ? transformForScatter(rows, xField, yField, sizeField, colorField)
      : { groups: new Map<string, ScatterDataPoint[]>(), hasGroups: false }),
    [rows, xField, yField, sizeField, colorField],
  );

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

  const keys = [...groups.keys()];

  return (
    <div className="flex h-full flex-col">
      <FieldMapping slots={slots} encoding={encoding} onEncodingChange={handleEncodingChange} columns={cols} />
      <div className="flex-1 p-2">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.4)" />
            <XAxis
              dataKey="x"
              type="number"
              name={xField}
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            />
            <YAxis
              dataKey="y"
              type="number"
              name={yField}
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              contentStyle={{
                backgroundColor: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "var(--radius)",
                fontSize: 12,
              }}
            />
            {hasGroups && <Legend wrapperStyle={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }} />}
            {keys.map((key, i) => (
              <Scatter
                key={key}
                name={hasGroups ? key : yField}
                data={groups.get(key)!}
                fill={chartColor(i)}
                opacity={0.7}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
