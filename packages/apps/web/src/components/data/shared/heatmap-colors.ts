/**
 * heatmap-colors.ts — Scene Heatmap 色阶方案（STORY-0073）
 *
 * 3 种预置色阶：viridis / inferno / blues。
 * 每色阶 9 个 hex 色块，用于 d3-scale scaleSequential 线性插值。
 * 色块来源：matplotlib 经典 perceptually-uniform 色阶。
 */

/** 色阶方案名称 */
export type ColorScaleId = "viridis" | "inferno" | "blues";

/** 色阶定义：hex 颜色数组（9 个色块，均匀分布 [0,1]） */
export type ColorScale = readonly string[];

// ─── 色阶数据 ──────────────────────────────────────────────────────────────

/** viridis：经典黄→绿→蓝→紫 perceptually-uniform 色阶 */
export const VIRIDIS: ColorScale = [
  "#440154", "#482475", "#3B528B", "#2C728E",
  "#21918C", "#28AE80", "#5EC962", "#ADDc30",
  "#FDE725",
];

/** inferno：黑→紫→红→橙→黄，适合强调高密度热点 */
export const INFERNO: ColorScale = [
  "#000004", "#1B0C41", "#4A0C6B", "#781C6D",
  "#A52C60", "#CF4446", "#ED6925", "#FB9B06",
  "#FCFFA4",
];

/** blues：浅蓝→深蓝渐变，适合与水/天空底图搭配 */
export const BLUES: ColorScale = [
  "#F7FBFF", "#DEEBF7", "#C6DBEF", "#9ECAE1",
  "#6BAED6", "#4292C6", "#2171B5", "#08519C",
  "#08306B",
];

// ─── 查找表 ────────────────────────────────────────────────────────────────

/** 名称 → 色阶数组 */
export const COLOR_SCALES: Record<ColorScaleId, ColorScale> = {
  viridis: VIRIDIS,
  inferno: INFERNO,
  blues: BLUES,
};

/** 色阶显示名称 */
export const COLOR_SCALE_LABELS: Record<ColorScaleId, string> = {
  viridis: "Viridis (黄-绿-蓝-紫)",
  inferno: "Inferno (黑-红-橙-黄)",
  blues: "Blues (浅蓝-深蓝)",
};
