/**
 * point-shapes.tsx — Spatial Plot 坐标点形状组件（STORY-0072）
 *
 * 4 种 SVG 形状：circle / square / triangle / diamond。
 * 所有视觉值走 CSS token，无硬编码。
 */

import * as React from "react";

export type PointShape = "circle" | "square" | "triangle" | "diamond";

interface PointProps {
  shape: PointShape;
  cx: number;
  cy: number;
  radius: number;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
  className?: string;
}

/** 统一形状派发 */
export function PointShapeSvg({
  shape,
  cx,
  cy,
  radius,
  fill,
  stroke,
  strokeWidth = 1.5,
  opacity = 1,
  className,
}: PointProps) {
  switch (shape) {
    case "square":
      return (
        <rect
          x={cx - radius}
          y={cy - radius}
          width={radius * 2}
          height={radius * 2}
          rx={2}
          fill={fill}
          stroke={stroke ?? "hsl(var(--border))"}
          strokeWidth={strokeWidth}
          opacity={opacity}
          className={className}
        />
      );
    case "triangle":
      return (
        <polygon
          points={trianglePoints(cx, cy, radius)}
          fill={fill}
          stroke={stroke ?? "hsl(var(--border))"}
          strokeWidth={strokeWidth}
          opacity={opacity}
          className={className}
        />
      );
    case "diamond":
      return (
        <polygon
          points={diamondPoints(cx, cy, radius)}
          fill={fill}
          stroke={stroke ?? "hsl(var(--border))"}
          strokeWidth={strokeWidth}
          opacity={opacity}
          className={className}
        />
      );
    case "circle":
    default:
      return (
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill={fill}
          stroke={stroke ?? "hsl(var(--border))"}
          strokeWidth={strokeWidth}
          opacity={opacity}
          className={className}
        />
      );
  }
}

// ─── 形状辅助：polygon points ─────────────────────────────────────────────

/** 正三角形（顶点朝上） */
function trianglePoints(cx: number, cy: number, r: number): string {
  const h = r * 1.6; // 稍高一点视觉均衡
  return `${cx},${cy - h} ${cx - r * 1.4},${cy + r * 0.6} ${cx + r * 1.4},${cy + r * 0.6}`;
}

/** 菱形 */
function diamondPoints(cx: number, cy: number, r: number): string {
  const h = r * 1.5;
  const w = r * 1.2;
  return `${cx},${cy - h} ${cx + w},${cy} ${cx},${cy + h} ${cx - w},${cy}`;
}
