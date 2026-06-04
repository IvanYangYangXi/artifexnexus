/**
 * stats.ts — 数据列统计纯函数（STORY-0074）
 *
 * 对单列数据计算 min/max/avg/sum/median（数值）、uniqueCount/topValues（文本）、trueRatio（布尔）。
 * 纯函数，零副作用，直接可用于 SummaryBar + 导出统计报告。
 */

import type { Column } from "@artifex-nexus/contracts";

// ---- 类型 ----

export interface ColumnStats {
  column: string;
  type: Column["type"];
  count: number; // 非 null/undefined 值个数
  nullCount: number;
  // 数值
  min?: number;
  max?: number;
  avg?: number;
  sum?: number;
  median?: number;
  // 文本
  uniqueCount?: number;
  topValues?: { value: string; count: number }[];
  // 布尔
  trueRatio?: number;
}

// ---- 纯函数 ----

export function computeStats(
  column: Column,
  rows: Record<string, unknown>[]
): ColumnStats {
  const name = column.name;
  const values = rows
    .map((r) => r[name])
    .filter((v) => v != null) as (string | number | boolean)[];

  const nullCount = rows.length - values.length;
  const base: ColumnStats = {
    column: name,
    type: column.type,
    count: values.length,
    nullCount,
  };

  switch (column.type) {
    case "number":
      return computeNumericStats(base, values as number[]);
    case "string":
      return computeStringStats(base, values as string[]);
    case "boolean":
      return computeBoolStats(base, values as boolean[]);
    default:
      return base;
  }
}

// ---- 内部辅助 ----

function computeNumericStats(
  base: ColumnStats,
  values: number[]
): ColumnStats {
  if (values.length === 0) return base;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[mid - 1]! + sorted[mid]!) / 2
      : sorted[mid]!;
  return {
    ...base,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: values.reduce((s, v) => s + v, 0) / values.length,
    sum: values.reduce((s, v) => s + v, 0),
    median,
  };
}

function computeStringStats(
  base: ColumnStats,
  values: string[]
): ColumnStats {
  if (values.length === 0) return base;
  const freq = new Map<string, number>();
  for (const v of values) freq.set(v, (freq.get(v) ?? 0) + 1);
  const uniqueCount = freq.size;
  const topValues = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([value, count]) => ({ value, count }));
  return { ...base, uniqueCount, topValues };
}

function computeBoolStats(
  base: ColumnStats,
  values: boolean[]
): ColumnStats {
  if (values.length === 0) return base;
  const trueCount = values.filter((v) => v === true).length;
  return { ...base, trueRatio: trueCount / values.length };
}

/** 批量计算多列统计 */
export function computeAllStats(
  columns: Column[],
  rows: Record<string, unknown>[]
): ColumnStats[] {
  return columns.map((col) => computeStats(col, rows));
}
