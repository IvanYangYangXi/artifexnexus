/**
 * @artifex-nexus/ui — Tailwind v4 preset bridge
 *
 * Tailwind v4 以 CSS `@theme` 作为 token 入口（见 `./globals.css`），
 * 不再有 v3 的 `presets: []` 机制。为兼容 STORY-0031 AC 中"preset 导出"要求，
 * 这里导出一个 v4 风格的元数据对象，消费者可用于：
 *
 *   1) 在 `tailwind.config.ts`（若仍使用 v3 混合方案）的 `content` 字段拼接扫描路径。
 *   2) 读 `stylesheet` 字段拿到全局 CSS 路径，与 `import "@artifex-nexus/ui/globals.css"` 等价。
 *   3) 读 `tokenVars` 以便在代码中类型安全地引用 CSS 变量名。
 *
 * 真正的设计令牌定义在 globals.css 的 `@theme inline {}` 块。
 *
 * Tailwind v4 uses CSS `@theme` as the token entry point (see `./globals.css`);
 * the v3 `presets: []` mechanism no longer exists. To satisfy the STORY-0031 AC
 * requiring a "preset export", this module exports v4-style metadata consumers
 * can use for content globs, stylesheet path, and typed token variable names.
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** 本包源码根目录绝对路径（供消费者做 content 扫描） */
export const UI_SRC_ROOT = resolve(__dirname);

/** 推荐的 Tailwind `content` 扫描路径 */
export const UI_CONTENT_GLOBS = [
  resolve(__dirname, "components/**/*.{ts,tsx}"),
  resolve(__dirname, "lib/**/*.{ts,tsx}"),
  resolve(__dirname, "index.ts"),
];

/** 全局 CSS 路径 —— 与 `import "@artifex-nexus/ui/globals.css"` 效果一致 */
export const UI_STYLESHEET = resolve(__dirname, "globals.css");

/** 所有设计令牌 CSS 变量名（不含 `--` 前缀） */
export const TOKEN_VARS = [
  "background",
  "foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "border",
  "input",
  "ring",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  // 区域专用层级（M3 起）
  "titlebar",
  "titlebar-foreground",
  "sidebar",
  "sidebar-foreground",
  "panel",
  "panel-foreground",
  // 圆角
  "radius",
] as const;

export type TokenVar = (typeof TOKEN_VARS)[number];

/**
 * Tailwind v4 "preset" 元数据对象。
 * 并非 v3 的 `Config` 格式；仅作为 v4 下的分发单元 / 类型索引。
 */
const preset = {
  $schema: "artifex-nexus/ui:tailwind-preset@v4",
  stylesheet: UI_STYLESHEET,
  content: UI_CONTENT_GLOBS,
  tokenVars: TOKEN_VARS,
  srcRoot: UI_SRC_ROOT,
} as const;

export type ArtifexUIPreset = typeof preset;
export default preset;
