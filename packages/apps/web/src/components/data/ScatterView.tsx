/**
 * ScatterView — 散点图/气泡图（Recharts）
 *
 * 槽位：x (number) + y (number) + size (number, 可选) + color (string, 可选)
 * color → 按分组上色；size → 气泡半径。
 *
 * 性能（2026-06-05 v3）：
 *   - 数据点抽样到 5000
 *   - color 分组上限 12（防 colorField 高基数时分裂出几万个 <Scatter> 卡崩）
 *   - size 用 ZAxis(range=[64,400]) 真实生效（之前只塞 z 字段没接 ZAxis）
 *   - 外层 ZoomPanContainer 支持缩放平移
 */

import * as React from "react";
import type { Column } from "@artifex-nexus/contracts";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

import { DataPageContext } from "./DataPage";
import { FieldMapping } from "./shared/FieldMapping";
import { mapColumnsToSlots } from "./shared/slot-mapping";
import { chartColor } from "./shared/chart-colors";
import { ZoomPanContainer } from "./shared/ZoomPanContainer";

/** 散点图最大渲染点数 */
const SCATTER_MAX_POINTS = 5000;
/** 颜色分组上限（防 colorField 高基数时分裂出 N 个 Scatter 系列把 SVG 撑爆） */
const SCATTER_MAX_GROUPS = 12;
/** 气泡尺寸的 z 值范围（对应 Recharts ZAxis range，单位是面积 px²） */
const SIZE_RANGE: [number, number] = [60, 600];

function sampleRows(rows: Record<string, unknown>[], maxPoints: number): {
  sampled: Record<string, unknown>[];
  sampledFlag: boolean;
} {
  if (rows.length <= maxPoints) return { sampled: rows, sampledFlag: false };
  const step = rows.length / maxPoints;
  const out: Record<string, unknown>[] = new Array(maxPoints);
  for (let i = 0; i < maxPoints; i++) out[i] = rows[Math.floor(i * step)]!;
  return { sampled: out, sampledFlag: true };
}

interface ScatterDataPoint {
  x: number;
  y: number;
  z: number;
  name: string;
}

interface TransformResult {
  groups: Map<string, ScatterDataPoint[]>;
  hasGroups: boolean;
  truncatedGroups: number;
  totalGroups: number;
}

function transformForScatter(
  rows: Record<string, unknown>[],
  xField: string,
  yField: string,
  sizeField: string | null,
  colorField: string | null,
): TransformResult {
  if (!colorField) {
    const data: ScatterDataPoint[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const x = Number(r[xField]);
      const y = Number(r[yField]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const z = sizeField ? Number(r[sizeField]) : 1;
      data.push({
        x,
        y,
        z: Number.isFinite(z) ? z : 1,
        name: String(r["name"] ?? r["label"] ?? `#${i}`),
      });
    }
    const map = new Map<string, ScatterDataPoint[]>();
    map.set("", data);
    return { groups: map, hasGroups: false, truncatedGroups: 0, totalGroups: 1 };
  }

  // 分组：先一次遍历收集 + 计算每组贡献，再按 Top-N 裁剪
  const map = new Map<string, ScatterDataPoint[]>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const x = Number(row[xField]);
    const y = Number(row[yField]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const key = String(row[colorField] ?? "(空)");
    const z = sizeField ? Number(row[sizeField]) : 1;
    const point: ScatterDataPoint = {
      x,
      y,
      z: Number.isFinite(z) ? z : 1,
      name: String(row["name"] ?? row["label"] ?? `#${i}`),
    };
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(point);
  }

  const totalGroups = map.size;
  if (totalGroups <= SCATTER_MAX_GROUPS) {
    return { groups: map, hasGroups: true, truncatedGroups: 0, totalGroups };
  }

  // 按点数排序取 Top-N，其余合并为"其他"
  const sorted = [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  const top = sorted.slice(0, SCATTER_MAX_GROUPS - 1);
  const tail = sorted.slice(SCATTER_MAX_GROUPS - 1);
  const otherPoints: ScatterDataPoint[] = [];
  for (const [, pts] of tail) otherPoints.push(...pts);
  const out = new Map<string, ScatterDataPoint[]>(top);
  out.set(`其他(${tail.length})`, otherPoints);
  return {
    groups: out,
    hasGroups: true,
    truncatedGroups: tail.length,
    totalGroups,
  };
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

  const xFieldValid = !!xField && cols.some((c) => c.name === xField);
  const yFieldValid = !!yField && cols.some((c) => c.name === yField);

  // Hooks 必须在 early return 之前
  const { sampled: sampledRows, sampledFlag } = React.useMemo(
    () => sampleRows(rows, SCATTER_MAX_POINTS),
    [rows],
  );
  const { groups, hasGroups, truncatedGroups, totalGroups } = React.useMemo(
    () => (xFieldValid && yFieldValid
      ? transformForScatter(sampledRows, xField!, yField!, sizeField, colorField)
      : { groups: new Map<string, ScatterDataPoint[]>(), hasGroups: false, truncatedGroups: 0, totalGroups: 0 }),
    [sampledRows, xField, yField, sizeField, colorField, xFieldValid, yFieldValid],
  );

  if (!xFieldValid || !yFieldValid) {
    return (
      <div className="flex h-full flex-col">
        <FieldMapping slots={slots} encoding={encoding} onEncodingChange={handleEncodingChange} columns={cols} />
        <div className="flex flex-1 items-center justify-center text-sm text-foreground/50">
          {!xFieldValid ? "请选择 X 轴字段映射" : "请选择 Y 轴字段映射"}
        </div>
      </div>
    );
  }

  const keys = [...groups.keys()];

  return (
    <div className="flex h-full flex-col">
      <FieldMapping slots={slots} encoding={encoding} onEncodingChange={handleEncodingChange} columns={cols} />
      {(sampledFlag || truncatedGroups > 0) && (
        <div className="px-3 py-1 text-[10px] text-amber-400/80">
          {sampledFlag && (
            <>数据量 {rows.length.toLocaleString()} 超过 {SCATTER_MAX_POINTS.toLocaleString()}，已抽样 {SCATTER_MAX_POINTS.toLocaleString()} 点{truncatedGroups > 0 ? "；" : ""}</>
          )}
          {truncatedGroups > 0 && (
            <>颜色分组 {totalGroups} 超过 {SCATTER_MAX_GROUPS}，已取 Top {SCATTER_MAX_GROUPS - 1} 类，其余合并为「其他」</>
          )}
        </div>
      )}
      <div className="flex-1 p-2">
        <ZoomPanContainer>
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
              {/* ZAxis：把 z 字段真正映射到点面积；没有 size 字段时 range 退化为单值 */}
              <ZAxis
                dataKey="z"
                range={sizeField ? SIZE_RANGE : [80, 80]}
                name={sizeField ?? ""}
              />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                contentStyle={{
                  backgroundColor: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "var(--radius)",
                  fontSize: 12,
                  color: "hsl(var(--popover-foreground))",
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
                  isAnimationActive={sampledRows.length <= 500}
                />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </ZoomPanContainer>
      </div>
    </div>
  );
}
