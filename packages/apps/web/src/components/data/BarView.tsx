/**
 * BarView — 柱状图（Recharts）
 *
 * 槽位：xAxis (string|number) + yAxis (number) + color (string, 可选)
 * 按 xAxis 分组，yAxis 聚合 sum；color 字段存在时按颜色分组绘制并列柱。
 * encoding 来自 DataPageContext.encodings["bar"]。
 *
 * 性能（2026-06-05）：
 *   - 聚合维度（xAxis 基数）上限 BAR_MAX_GROUPS=200，超出后按 Y 值 Top-N + "其他"汇总
 *   - 删除冗余 <Cell> 内层循环（原实现是 O(柱数²) 个 Cell DOM，100 柱就是 1w 节点）
 *   - colorKeys 用 Set + 收集器一次循环算出，避免 .map().flat()
 *   - x/color 都是高基数字段时早警告，防 WebView2 假死
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
} from "recharts";

import { DataPageContext } from "./DataPage";
import { FieldMapping } from "./shared/FieldMapping";
import { mapColumnsToSlots } from "./shared/slot-mapping";
import { chartColor } from "./shared/chart-colors";
import { ZoomPanContainer } from "./shared/ZoomPanContainer";

const BAR_MAX_GROUPS = 200;
const BAR_MAX_COLOR_KEYS = 12;

interface BarDataPoint {
  name: string;
  [key: string]: number | string;
}

interface AggregateResult {
  data: BarDataPoint[];
  colorKeys: string[];
  truncatedGroups: number;
  truncatedColors: number;
  totalGroups: number;
}

function aggregateForBar(
  rows: Record<string, unknown>[],
  xField: string,
  yField: string,
  colorField: string | null,
): AggregateResult {
  // 一次遍历：维度聚合 + 颜色键收集
  const groupSums = new Map<string, Map<string, number>>();
  const groupTotal = new Map<string, number>();
  const colorKeySet = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const xv = String(row[xField] ?? "");
    const cv = colorField ? String(row[colorField] ?? "__") : "__";
    const yv = Number(row[yField]);
    const yvSafe = Number.isFinite(yv) ? yv : 0;
    colorKeySet.add(cv);
    if (!groupSums.has(xv)) groupSums.set(xv, new Map());
    const inner = groupSums.get(xv)!;
    inner.set(cv, (inner.get(cv) ?? 0) + yvSafe);
    groupTotal.set(xv, (groupTotal.get(xv) ?? 0) + yvSafe);
  }

  const totalGroups = groupSums.size;
  const totalColors = colorKeySet.size;

  // 颜色键裁剪：Top-N（按贡献排序）
  let colorKeys = [...colorKeySet];
  let truncatedColors = 0;
  if (colorKeys.length > BAR_MAX_COLOR_KEYS) {
    const colorTotal = new Map<string, number>();
    for (const inner of groupSums.values()) {
      for (const [c, v] of inner) colorTotal.set(c, (colorTotal.get(c) ?? 0) + v);
    }
    const sortedColors = colorKeys
      .slice()
      .sort((a, b) => (colorTotal.get(b) ?? 0) - (colorTotal.get(a) ?? 0));
    const keep = new Set(sortedColors.slice(0, BAR_MAX_COLOR_KEYS - 1));
    truncatedColors = totalColors - keep.size;
    // 把不在 keep 里的颜色合并到"其他"
    for (const inner of groupSums.values()) {
      let otherSum = 0;
      for (const [c, v] of [...inner]) {
        if (!keep.has(c)) {
          otherSum += v;
          inner.delete(c);
        }
      }
      if (otherSum !== 0) inner.set("其他", (inner.get("其他") ?? 0) + otherSum);
    }
    colorKeys = [...keep, "其他"];
  }

  // 分组键裁剪：Top-N（按 yField 总和排序，剩余合并为"其他"）
  let entries = [...groupSums.entries()];
  let truncatedGroups = 0;
  if (entries.length > BAR_MAX_GROUPS) {
    entries.sort((a, b) => (groupTotal.get(b[0]) ?? 0) - (groupTotal.get(a[0]) ?? 0));
    const top = entries.slice(0, BAR_MAX_GROUPS - 1);
    const tail = entries.slice(BAR_MAX_GROUPS - 1);
    truncatedGroups = tail.length;
    // 把 tail 合并为"其他"
    const otherInner = new Map<string, number>();
    for (const [, inner] of tail) {
      for (const [c, v] of inner) otherInner.set(c, (otherInner.get(c) ?? 0) + v);
    }
    if (otherInner.size > 0) top.push([`其他(${tail.length})`, otherInner]);
    entries = top;
  }

  const data: BarDataPoint[] = entries.map(([x, map]) => {
    const point: BarDataPoint = { name: x };
    for (const c of colorKeys) point[c] = map.get(c) ?? 0;
    return point;
  });

  return { data, colorKeys, truncatedGroups, truncatedColors, totalGroups };
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

  // 校验字段是否真实存在（用户切换列后旧 encoding 可能指向已删除字段）
  const xFieldValid = !!xField && cols.some((c) => c.name === xField);
  const yFieldValid = !!yField && cols.some((c) => c.name === yField && c.type === "number");
  const colorFieldValid = !colorField || cols.some((c) => c.name === colorField);
  const safeColorField = colorFieldValid ? colorField : null;

  // ⚠️ Hooks 必须在所有 early return 之前调用
  const agg = React.useMemo(
    () =>
      xFieldValid && yFieldValid && xField && yField
        ? aggregateForBar(rows, xField, yField, safeColorField)
        : { data: [], colorKeys: [], truncatedGroups: 0, truncatedColors: 0, totalGroups: 0 },
    [rows, xField, yField, safeColorField, xFieldValid, yFieldValid],
  );

  if (!xFieldValid || !yFieldValid) {
    return (
      <div className="flex h-full flex-col">
        <FieldMapping slots={slots} encoding={encoding} onEncodingChange={handleEncodingChange} columns={cols} />
        <div className="flex flex-1 items-center justify-center text-sm text-foreground/50">
          {!xFieldValid ? "请选择 X 轴字段映射" : "请选择数值类型的 Y 轴字段"}
        </div>
      </div>
    );
  }

  const { data, colorKeys, truncatedGroups, truncatedColors, totalGroups } = agg;

  return (
    <div className="flex h-full flex-col">
      <FieldMapping slots={slots} encoding={encoding} onEncodingChange={handleEncodingChange} columns={cols} />
      {(truncatedGroups > 0 || truncatedColors > 0) && (
        <div className="px-3 py-1 text-[10px] text-amber-400/80">
          {truncatedGroups > 0 && (
            <>
              X 轴维度 {totalGroups.toLocaleString()} 超过 {BAR_MAX_GROUPS}，已取贡献 Top {BAR_MAX_GROUPS - 1}，其余合并为「其他」
              {truncatedColors > 0 ? "；" : ""}
            </>
          )}
          {truncatedColors > 0 && (
            <>
              颜色分组超过 {BAR_MAX_COLOR_KEYS}，已取 Top {BAR_MAX_COLOR_KEYS - 1}，其余合并为「其他」
            </>
          )}
        </div>
      )}
      <div className="flex-1 p-2">
        <ZoomPanContainer>
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
                  color: "hsl(var(--popover-foreground))",
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }} />
              {colorKeys.map((key, i) => (
                <Bar
                  key={key}
                  dataKey={key}
                  fill={chartColor(i)}
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={data.length <= 60}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ZoomPanContainer>
      </div>
    </div>
  );
}
