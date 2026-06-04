/**
 * heatmap-kde.ts — Scene Heatmap KDE 密度计算（STORY-0073）
 *
 * 对齐 docs/specs/ui/data-view-structure.md §6.2：
 *   1. 底图区域 → N×N 网格
 *   2. 数据点累加到所属单元
 *   3. 高斯核平滑（带宽 = bandwidth 像素）
 *   4. 密度归一化 [0,1]
 *
 * 所有计算纯 CPU，返回密度矩阵供 SVG <rect> 着色。
 */

import type { HeatmapEncoding } from "../DataPage";
import { dataToPixel } from "./spatial-encoding";

// ─── 常量 ──────────────────────────────────────────────────────────────────

/** 默认网格分辨率 */
export const DEFAULT_GRID_SIZE = 64;

// ─── 网格密度计算 ──────────────────────────────────────────────────────────

/**
 * KDE 密度矩阵计算结果。
 * density: N×N 归一化密度值矩阵 [0, 1]
 * cellW / cellH: 每个网格单元的像素尺寸
 */
export interface DensityGrid {
  density: Float64Array;
  gridSize: number;
  cellW: number;
  cellH: number;
  minDensity: number;
  maxDensity: number;
}

/**
 * 主计算入口：根据行数据 + 编码 + 底图尺寸计算密度矩阵。
 *
 * @param rows 数据行（Record<string, unknown>[]）
 * @param encoding 热力图编码（含 x.field / y.field / bandwidth）
 * @param imgW 底图宽度（像素）
 * @param imgH 底图高度（像素）
 * @param gridSize 网格分辨率，默认 64
 */
export function computeDensityGrid(
  rows: Record<string, unknown>[],
  encoding: HeatmapEncoding,
  imgW: number,
  imgH: number,
  gridSize: number = DEFAULT_GRID_SIZE,
): DensityGrid {
  const cellW = imgW / gridSize;
  const cellH = imgH / gridSize;
  const N = gridSize;

  // ── Step 1: 网格计数 ─────────────────────────────────────────────────
  const counts = new Float64Array(N * N);
  const xField = encoding.x.field;
  const yField = encoding.y.field;

  // 复用 SpatialPlot 的 dataToPixel，确保两视图坐标系一致（origin / unitPerPx 统一）
  const spatialEnc = {
    x: encoding.x,
    y: encoding.y,
    background: encoding.background,
  };

  for (let r = 0; r < rows.length; r++) {
    const dx = Number(rows[r][xField]);
    const dy = Number(rows[r][yField]);
    if (isNaN(dx) || isNaN(dy)) continue;
    const { px, py } = dataToPixel(dx, dy, imgW, imgH, spatialEnc);
    const col = clamp(Math.floor(px * gridSize / imgW), 0, N - 1);
    const row = clamp(Math.floor(py * gridSize / imgH), 0, N - 1);
    counts[row * N + col] += 1;
  }

  // ── Step 2: 高斯核平滑 ───────────────────────────────────────────────
  const sigma = encoding.bandwidth / Math.max(cellW, cellH); // 带宽转网格单位
  const kernelRadius = Math.ceil(3 * sigma); // 3σ 外权重 ≈ 0，跳过
  const kernel = buildGaussianKernel(sigma, kernelRadius);

  const smoothed = new Float64Array(N * N);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      let sum = 0;
      for (let kr = -kernelRadius; kr <= kernelRadius; kr++) {
        const nr = r + kr;
        if (nr < 0 || nr >= N) continue;
        for (let kc = -kernelRadius; kc <= kernelRadius; kc++) {
          const nc = c + kc;
          if (nc < 0 || nc >= N) continue;
          sum += counts[nr * N + nc] * kernel[kr + kernelRadius][kc + kernelRadius];
        }
      }
      smoothed[r * N + c] = sum;
    }
  }

  // ── Step 3: 归一化 ───────────────────────────────────────────────────
  let minVal = Infinity;
  let maxVal = -Infinity;
  for (let i = 0; i < N * N; i++) {
    if (smoothed[i] < minVal) minVal = smoothed[i];
    if (smoothed[i] > maxVal) maxVal = smoothed[i];
  }
  const range = maxVal - minVal;
  const density = new Float64Array(N * N);
  if (range > 0) {
    for (let i = 0; i < N * N; i++) {
      density[i] = (smoothed[i] - minVal) / range;
    }
  }
  // range === 0：全零，density 保持全 0

  return { density, gridSize: N, cellW, cellH, minDensity: minVal, maxDensity: maxVal };
}

// ─── 高斯核 ────────────────────────────────────────────────────────────────

/**
 * 构建高斯核权重矩阵。
 * kernel[r][c] = exp(-dist² / (2 * sigma²))
 *
 * @param sigma 标准差（网格单位）
 * @param radius 核半径（网格单元数）
 */
function buildGaussianKernel(sigma: number, radius: number): number[][] {
  const size = 2 * radius + 1;
  const kernel: number[][] = [];
  let totalWeight = 0;

  for (let r = 0; r < size; r++) {
    kernel[r] = [];
    const dy = r - radius;
    for (let c = 0; c < size; c++) {
      const dx = c - radius;
      const dist2 = dx * dx + dy * dy;
      const w = Math.exp(-dist2 / (2 * sigma * sigma));
      kernel[r][c] = w;
      totalWeight += w;
    }
  }

  // 归一化核权重，保证 density 语义正确
  if (totalWeight > 0) {
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        kernel[r][c] /= totalWeight;
      }
    }
  }

  return kernel;
}

// ─── 插值 ──────────────────────────────────────────────────────────────────

/**
 * 线性插值两个 hex 颜色。
 * @param a 起始颜色 hex
 * @param b 结束颜色 hex
 * @param t [0,1] 插值参数
 */
export function interpolateHex(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bv = Math.round(ab + (bb - ab) * t);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bv.toString(16).padStart(2, "0")}`;
}

/**
 * 在色阶数组中按 t ∈ [0,1] 查找颜色。
 * 色阶数组有 N 个色块，每个色块占据 1/(N-1) 的长度。
 */
export function colorFromScale(scale: readonly string[], t: number): string {
  if (scale.length === 0) return "#000000";
  if (scale.length === 1) return scale[0];
  const idx = t * (scale.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, scale.length - 1);
  return interpolateHex(scale[lo], scale[hi], idx - lo);
}

// ─── 辅助 ──────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
