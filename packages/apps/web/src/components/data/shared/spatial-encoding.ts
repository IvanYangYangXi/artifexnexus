/**
 * spatial-encoding.ts — Spatial Plot 编码工具函数（STORY-0072）
 *
 * 提供颜色 / 形状 / 尺寸映射 + 坐标系转换，全部纯函数，不依赖 React。
 * 使用 d3-scale 处理连续/离散色阶。
 *
 * 设计规范对齐 docs/specs/ui/data-view-structure.md §3.3
 */

import { scaleLinear, scaleOrdinal, scaleSequential, type ScaleOrdinal } from "d3-scale";
import type { SpatialEncoding } from "../DataPage";
import { getChartPalette } from "./chart-colors";

// ─── 常量 ──────────────────────────────────────────────────────────────────

/** 默认点半径（px），无 size 映射时使用 */
export const DEFAULT_POINT_RADIUS = 6;

/** 点大小映射默认范围 [minRadius, maxRadius] */
export const DEFAULT_SIZE_RANGE: [number, number] = [3, 20];

/** 可用形状列表 */
export type PointShape = "circle" | "square" | "triangle" | "diamond";

/** 形状渲染顺序（用于分类型 shape 映射的循环） */
export const SHAPE_ORDER: PointShape[] = ["circle", "square", "triangle", "diamond"];

// ─── 颜色编码 ──────────────────────────────────────────────────────────────

/**
 * 创建颜色映射器。
 * - 未绑定 color.field → 返回固定色函数（hsl(var(--primary))）
 * - 绑定 field + ordinal → scaleOrdinal 循环色板
 * - 绑定 field + sequential → scaleSequential 连续渐变
 */
export function createColorMapper(
  andfRows: Record<string, unknown>[],
  encoding: SpatialEncoding,
): (row: Record<string, unknown>) => string {
  const { color } = encoding;
  const palette = getChartPalette();

  // 未绑定 → 默认色
  if (!color?.field) {
    return () => palette[0];
  }

  const values = andfRows.map((r) => String(r[color.field!] ?? ""));

  if (color.scale === "ordinal") {
    const customPalette = color.palette && color.palette.length > 0 ? color.palette : palette;
    const scale = scaleOrdinal<string>().domain([...new Set(values)]).range(customPalette);
    return (row) => scale(String(row[color.field!] ?? "")) ?? palette[0];
  }

  // sequential：数值 → [0,1] → 色板插值
  const nums = values.map(Number).filter((n) => !isNaN(n));
  if (nums.length === 0) return () => palette[0];
  const minVal = Math.min(...nums);
  const maxVal = Math.max(...nums);
  const range = maxVal - minVal || 1;
  return (row) => {
    const v = Number(row[color.field!]);
    if (isNaN(v)) return palette[0];
    const t = (v - minVal) / range;
    // 线性插值：索引 1 到 7（跳过 primary 位置，给更多变化）
    const idx = Math.round(1 + t * 6);
    return palette[idx % palette.length];
  };
}

// ─── 形状编码 ──────────────────────────────────────────────────────────────

/**
 * 创建形状映射器。
 * - 未绑定 shape.field → 返回 "circle"
 * - 绑定 field → 按 mapping 查表，未匹配则循环 SHAPE_ORDER
 */
export function createShapeMapper(
  andfRows: Record<string, unknown>[],
  encoding: SpatialEncoding,
): (row: Record<string, unknown>) => PointShape {
  const { shape } = encoding;
  if (!shape?.field) return () => "circle";

  if (shape.mapping && Object.keys(shape.mapping).length > 0) {
    return (row) => {
      const val = String(row[shape.field!] ?? "");
      return shape.mapping![val] ?? "circle";
    };
  }

  // 无 mapping：按值出现顺序分配形状（循环）
  const uniqueVals = [...new Set(andfRows.map((r) => String(r[shape.field!] ?? "")))];
  const mapping: Record<string, PointShape> = {};
  uniqueVals.forEach((v, i) => {
    mapping[v] = SHAPE_ORDER[i % SHAPE_ORDER.length];
  });
  return (row) => {
    const val = String(row[shape.field!] ?? "");
    return mapping[val] ?? "circle";
  };
}

// ─── 尺寸编码 ──────────────────────────────────────────────────────────────

/**
 * 创建尺寸映射器。
 * - 未绑定 size.field → 返回固定半径 DEFAULT_POINT_RADIUS
 * - 绑定 field → 数值线性映射到 [min, max] 半径范围
 */
export function createSizeMapper(
  andfRows: Record<string, unknown>[],
  encoding: SpatialEncoding,
): (row: Record<string, unknown>) => number {
  const { size } = encoding;
  const [minR, maxR] = size?.range ?? DEFAULT_SIZE_RANGE;

  if (!size?.field) return () => DEFAULT_POINT_RADIUS;

  const nums = andfRows.map((r) => Number(r[size.field!])).filter((n) => !isNaN(n));
  if (nums.length === 0) return () => DEFAULT_POINT_RADIUS;

  const minVal = Math.min(...nums);
  const maxVal = Math.max(...nums);
  if (maxVal === minVal) return () => (minR + maxR) / 2;

  const scale = scaleLinear().domain([minVal, maxVal]).range([minR, maxR]).clamp(true);
  return (row) => {
    const v = Number(row[size.field!]);
    if (isNaN(v)) return DEFAULT_POINT_RADIUS;
    return scale(v);
  };
}

// ─── 缩略图 ────────────────────────────────────────────────────────────────

/**
 * 从行数据中提取缩略图 URL。
 * - 未绑定 thumbnail.field → 返回 null
 * - 绑定 field → 返回字段值（需是有效 URL/dataURL），否则 null
 */
export function getThumbnailUrl(
  row: Record<string, unknown>,
  encoding: SpatialEncoding,
): string | null {
  const field = encoding.thumbnail?.field;
  if (!field) return null;
  const val = row[field];
  if (typeof val !== "string" || val.length === 0) return null;
  // 简单校验：非空字符串即接受（首版不深度校验 URL 格式）
  return val;
}

// ─── 坐标系转换 ────────────────────────────────────────────────────────────

/**
 * 数据坐标 → SVG 像素坐标（显示用）。
 * origin "top-left"（默认）：直接返回 dataX/dataY
 * origin "center"：dataX + svgWidth/2, svgHeight/2 - dataY
 *
 * unitPerPx：数据单位每像素比值。例如 unitPerPx=2 表示 2 个数据单位 = 1px。
 */
export function dataToPixel(
  dataX: number,
  dataY: number,
  bgWidth: number,
  bgHeight: number,
  encoding: SpatialEncoding,
): { px: number; py: number } {
  const { origin, unitPerPx } = encoding.background ?? {};
  const scale = unitPerPx && unitPerPx > 0 ? 1 / unitPerPx : 1;

  if (origin === "center") {
    return {
      px: bgWidth / 2 + dataX * scale,
      py: bgHeight / 2 - dataY * scale,
    };
  }
  // top-left（默认）
  return {
    px: dataX * scale,
    py: dataY * scale,
  };
}

/**
 * SVG 像素坐标 → 数据坐标（拖动反向映射）。
 * 与 dataToPixel 互为逆运算。
 */
export function pixelToData(
  px: number,
  py: number,
  bgWidth: number,
  bgHeight: number,
  encoding: SpatialEncoding,
): { dataX: number; dataY: number } {
  const { origin, unitPerPx } = encoding.background ?? {};
  const scale = unitPerPx && unitPerPx > 0 ? unitPerPx : 1;

  if (origin === "center") {
    return {
      dataX: (px - bgWidth / 2) * scale,
      dataY: (bgHeight / 2 - py) * scale,
    };
  }
  return {
    dataX: px * scale,
    dataY: py * scale,
  };
}

// ─── 视口剔除 ──────────────────────────────────────────────────────────────

/**
 * 根据当前 viewBox 剔除不可见的行索引（> 5000 点时启用）。
 * 不做 Canvas 兜底（首版 < 5000 全量渲染）。
 */
export function filterVisibleIndices(
  rows: Record<string, unknown>[],
  encoding: SpatialEncoding,
  viewBox: { x: number; y: number; width: number; height: number },
  padding: number = 50,
): number[] {
  const result: number[] = [];
  const xField = encoding.x.field;
  const yField = encoding.y.field;
  for (let i = 0; i < rows.length; i++) {
    const x = Number(rows[i][xField]);
    const y = Number(rows[i][yField]);
    if (isNaN(x) || isNaN(y)) continue;
    if (
      x >= viewBox.x - padding &&
      x <= viewBox.x + viewBox.width + padding &&
      y >= viewBox.y - padding &&
      y <= viewBox.y + viewBox.height + padding
    ) {
      result.push(i);
    }
  }
  return result;
}
