/**
 * chart-colors.ts — Recharts 图表色板
 *
 * 从 CSS 变量（@artifex-nexus/ui globals.css）派生 8 色调色板，
 * 优先读 document.documentElement computed style，非浏览器环境降级为默认值。
 * 所有视觉值走 token，无硬编码。
 */

/** 色板大小 */
export const CHART_PALETTE_SIZE = 8;

/** 默认深色主题色板（非浏览器环境降级） */
const DARK_DEFAULTS: string[] = [
  "hsl(213, 78%, 65%)",   // primary
  "hsl(228, 78%, 65%)",   // primary +15hue
  "hsl(198, 78%, 65%)",   // primary -15hue
  "hsl(142, 65%, 45%)",   // success
  "hsl(38, 92%, 56%)",    // warning
  "hsl(200, 90%, 60%)",   // info
  "hsl(0, 0%, 64%)",      // muted-foreground
  "hsl(0, 0%, 24%)",      // secondary
];

/** 浏览器环境从 CSS 变量读取色板 */
function readPalette(): string[] {
  if (typeof document === "undefined") return DARK_DEFAULTS;
  const style = getComputedStyle(document.documentElement);
  return [
    `hsl(${style.getPropertyValue("--primary").trim()})`,
    deriveHue(style.getPropertyValue("--primary").trim(), 15),
    deriveHue(style.getPropertyValue("--primary").trim(), -15),
    `hsl(${style.getPropertyValue("--success").trim()})`,
    `hsl(${style.getPropertyValue("--warning").trim()})`,
    `hsl(${style.getPropertyValue("--info").trim()})`,
    `hsl(${style.getPropertyValue("--muted-foreground").trim()})`,
    `hsl(${style.getPropertyValue("--secondary").trim()})`,
  ];
}

/** 从 HSL "H S% L%" 字符串偏移 hue */
function deriveHue(hsl: string, delta: number): string {
  const parts = hsl.trim().split(/\s+/);
  if (parts.length < 1) return hsl;
  const h = parseInt(parts[0], 10);
  if (isNaN(h)) return hsl;
  const newH = (h + delta + 360) % 360;
  return `hsl(${newH}, ${parts[1] || "78%"}, ${parts[2] || "65%"})`;
}

/** 缓存色板，首次读取后复用 */
let _cache: string[] | null = null;

/** 获取图表色板数组，长度 CHART_PALETTE_SIZE */
export function getChartPalette(): string[] {
  if (_cache) return _cache;
  _cache = readPalette();
  return _cache;
}

/**
 * 按索引取颜色，自动 wrap 超过色板长度。
 * 用于 Recharts Cell / fill 属性。
 */
export function chartColor(index: number): string {
  const palette = getChartPalette();
  return palette[index % palette.length];
}
