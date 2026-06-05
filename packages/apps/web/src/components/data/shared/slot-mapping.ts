/**
 * slot-mapping.ts — 视图槽位映射工具
 *
 * 对齐 docs/specs/ui/data-view-structure.md §3 视图槽位规则。
 * 每个视图有必填槽位 + 可选槽位，按列名自动匹配。
 *
 * 2026-06-05：
 *   - 所有 slots 函数先按 column.visible 过滤（隐藏列不参与映射）
 *   - findField 在候选名都未命中时 **fallback 到第一个类型兼容的可见列**
 *     （之前是 null，导致 CSV 列名不规范时 Card/List 只显示标题字段）
 */

import type { Column } from "@artifex-nexus/contracts";

// ─── 类型定义 ──────────────────────────────────────────────────────────────

/** 单个槽位：孔名 + 绑定的字段名（null = 未绑定） */
export interface Slot {
  name: string;
  label: string;
  required: boolean;
  /** 绑定的列名，null 表示需用户手动指定 */
  field: string | null;
  /** 该槽位接受的数据类型 */
  acceptTypes: string[];
}

/** 视图槽位定义 */
export interface ViewSlots {
  view: string;
  slots: Slot[];
}

/** 过滤掉隐藏列（visible === false） */
function visibleCols(cols: Column[]): Column[] {
  return cols.filter((c) => c.visible !== false);
}

// ─── Table 槽位 ────────────────────────────────────────────────────────────

function tableSlots(cols: Column[]): Slot[] {
  // Table 自动派生列定义，无槽位概念；所有可见列都是 columns
  return visibleCols(cols).map((c) => ({
    name: c.name,
    label: c.name,
    required: true,
    field: c.name,
    acceptTypes: [c.type],
  }));
}

// ─── Card 槽位 ─────────────────────────────────────────────────────────────

function cardSlots(cols: Column[]): Slot[] {
  const vis = visibleCols(cols);
  const used = new Set<string>();
  const pick = (acceptTypes: string[], candidates: string[]): string | null => {
    const f = findOrFallback(vis, acceptTypes, candidates, used);
    if (f) used.add(f);
    return f;
  };
  const slots: Slot[] = [
    { name: "title", label: "标题", required: true, field: pick(["string", "number"], ["title", "name", "label"]), acceptTypes: ["string", "number"] },
    { name: "subtitle", label: "副标题", required: false, field: pick(["string"], ["subtitle", "description", "desc", "category"]), acceptTypes: ["string"] },
    { name: "image", label: "图片", required: false, field: pick(["url"], ["image", "img", "thumbnail", "thumb_url", "url"]), acceptTypes: ["url"] },
    { name: "description", label: "描述", required: false, field: pick(["string"], ["description", "desc", "note", "summary"]), acceptTypes: ["string"] },
    { name: "tags", label: "标签", required: false, field: pick(["string"], ["tags", "tag", "type", "category"]), acceptTypes: ["string"] },
  ];
  // 扩展字段：所有未被绑定的可见列（不再限 3 个，让用户能看到完整信息）
  return appendExtras(slots, vis, Infinity);
}

// ─── List 槽位 ─────────────────────────────────────────────────────────────

function listSlots(cols: Column[]): Slot[] {
  const vis = visibleCols(cols);
  const used = new Set<string>();
  const pick = (acceptTypes: string[], candidates: string[]): string | null => {
    const f = findOrFallback(vis, acceptTypes, candidates, used);
    if (f) used.add(f);
    return f;
  };
  const slots: Slot[] = [
    { name: "primary", label: "主文本", required: true, field: pick(["string", "number"], ["name", "label", "title", "primary"]), acceptTypes: ["string", "number"] },
    { name: "secondary", label: "副文本", required: true, field: pick(["string"], ["description", "desc", "subtitle", "secondary", "summary"]), acceptTypes: ["string"] },
    { name: "thumbnail", label: "缩略图", required: false, field: pick(["url"], ["thumbnail", "thumb", "image", "img", "thumb_url"]), acceptTypes: ["url"] },
    { name: "badge", label: "徽标", required: false, field: pick(["string", "number"], ["badge", "tag", "type", "status"]), acceptTypes: ["string", "number"] },
  ];
  return appendExtras(slots, vis, Infinity);
}

// ─── Tree 槽位 ─────────────────────────────────────────────────────────────

function treeSlots(cols: Column[]): Slot[] {
  const vis = visibleCols(cols);
  return [
    { name: "label", label: "节点名", required: true, field: findOrFallback(vis, ["string", "number"], ["name", "label", "title", "id"]), acceptTypes: ["string", "number"] },
    { name: "parentId", label: "父节点", required: true, field: findField(vis, ["parentId", "parent_id", "parent", "pid"]), acceptTypes: ["string", "number"] },
    { name: "expanded", label: "展开", required: false, field: findField(vis, ["expanded", "open"]), acceptTypes: ["boolean"] },
  ];
}

// ─── 公共 ──────────────────────────────────────────────────────────────────

/** 在 columns 中按优先级搜索匹配的字段名（严格名字匹配） */
function findField(cols: Column[], candidates: string[]): string | null {
  for (const cand of candidates) {
    const found = cols.find((c) => c.name.toLowerCase() === cand.toLowerCase());
    if (found) return found.name;
  }
  return null;
}

/**
 * 严格名字匹配失败时，回退到「第一个类型兼容且未被使用」的可见列。
 * 这是 Card/List 视图能在任意 CSV 上"开箱即用"显示数据的关键。
 */
function findOrFallback(
  cols: Column[],
  acceptTypes: string[],
  candidates: string[],
  used: Set<string> = new Set(),
): string | null {
  const named = findField(cols, candidates);
  if (named && !used.has(named)) return named;
  const fallback = cols.find((c) => acceptTypes.includes(c.type) && !used.has(c.name));
  return fallback?.name ?? null;
}

/** 追加扩展字段：取未被现有 slot 绑定的列，最多 maxExtras 个（Infinity 表示全部） */
function appendExtras(slots: Slot[], cols: Column[], maxExtras: number): Slot[] {
  const bound = new Set(slots.filter((s) => s.field).map((s) => s.field));
  const extras = cols.filter((c) => !bound.has(c.name));
  const sliced = Number.isFinite(maxExtras) ? extras.slice(0, maxExtras) : extras;
  for (const c of sliced) {
    slots.push({
      name: `extra_${c.name}`,
      label: c.name,
      required: false,
      field: c.name,
      acceptTypes: [c.type],
    });
  }
  return slots;
}

// ─── 聚合型槽位 ──────────────────────────────────────────────────────────

/** Bar：必填 xAxis (string|number) + yAxis (number) */
function barSlots(cols: Column[]): Slot[] {
  const vis = visibleCols(cols);
  return [
    { name: "xAxis", label: "X 轴", required: true, field: findOrFallback(vis, ["string", "number"], ["name", "label", "title", "x"]), acceptTypes: ["string", "number"] },
    { name: "yAxis", label: "Y 轴(数值)", required: true, field: findOrFallback(vis, ["number"], ["value", "count", "y", "weight", "amount"]), acceptTypes: ["number"] },
    { name: "color", label: "分组颜色", required: false, field: findField(vis, ["category", "type", "group"]), acceptTypes: ["string"] },
  ];
}

/** Pie：必填 label (string) + value (number)；自动按 label 分组 sum(value) */
function pieSlots(cols: Column[]): Slot[] {
  const vis = visibleCols(cols);
  return [
    { name: "label", label: "标签", required: true, field: findOrFallback(vis, ["string"], ["name", "label", "title", "category", "type"]), acceptTypes: ["string"] },
    { name: "value", label: "数值", required: true, field: findOrFallback(vis, ["number"], ["value", "count", "weight", "amount", "y"]), acceptTypes: ["number"] },
  ];
}

/** Line：必填 xAxis + yAxis（支持多选数值列 = 多线） */
function lineSlots(cols: Column[]): Slot[] {
  const vis = visibleCols(cols);
  return [
    { name: "xAxis", label: "X 轴", required: true, field: findOrFallback(vis, ["string", "number", "datetime"], ["name", "label", "title", "x", "date", "time"]), acceptTypes: ["string", "number", "datetime"] },
    { name: "yAxis", label: "Y 轴(数值)", required: true, field: findOrFallback(vis, ["number"], ["value", "count", "y", "weight", "amount"]), acceptTypes: ["number"] },
  ];
}

/** Scatter：必填 x (number) + y (number)；可选 size / color */
function scatterSlots(cols: Column[]): Slot[] {
  const vis = visibleCols(cols);
  const used = new Set<string>();
  const pick = (types: string[], names: string[]): string | null => {
    const f = findOrFallback(vis, types, names, used);
    if (f) used.add(f);
    return f;
  };
  return [
    { name: "x", label: "X 轴", required: true, field: pick(["number"], ["x", "pos_x", "longitude"]), acceptTypes: ["number"] },
    { name: "y", label: "Y 轴", required: true, field: pick(["number"], ["y", "pos_y", "latitude"]), acceptTypes: ["number"] },
    { name: "size", label: "气泡大小", required: false, field: findField(vis, ["size", "weight", "radius"]), acceptTypes: ["number"] },
    { name: "color", label: "颜色分组", required: false, field: findField(vis, ["color", "category", "type", "group"]), acceptTypes: ["string"] },
  ];
}

// ─── Spatial Plot 槽位（STORY-0072）─────────────────────────────────────

function spatialPlotSlots(cols: Column[]): Slot[] {
  const vis = visibleCols(cols);
  return [
    { name: "x", label: "X 坐标", required: true, field: findField(vis, ["x", "pos_x", "longitude"]), acceptTypes: ["number"] },
    { name: "y", label: "Y 坐标", required: true, field: findField(vis, ["y", "pos_y", "latitude"]), acceptTypes: ["number"] },
    { name: "color", label: "颜色", required: false, field: findField(vis, ["color", "category", "type", "group"]), acceptTypes: ["string", "number"] },
    { name: "shape", label: "形状", required: false, field: findField(vis, ["shape", "type", "category"]), acceptTypes: ["string"] },
    { name: "size", label: "尺寸", required: false, field: findField(vis, ["size", "weight", "radius"]), acceptTypes: ["number"] },
    { name: "thumbnail", label: "缩略图", required: false, field: findField(vis, ["thumbnail", "thumb", "thumb_url", "image", "img", "url"]), acceptTypes: ["url"] },
    { name: "tooltip", label: "扩展字段", required: false, field: null, acceptTypes: ["string", "number"] },
  ];
}

// ──────────────────────────────────────────────────────────────────────────

/** 主入口：根据视图类型 + 列生成槽位列表 */
export function mapColumnsToSlots(view: string, cols: Column[]): Slot[] {
  switch (view) {
    case "table":
      return tableSlots(cols);
    case "card":
      return cardSlots(cols);
    case "list":
      return listSlots(cols);
    case "tree":
      return treeSlots(cols);
    case "bar":
      return barSlots(cols);
    case "pie":
      return pieSlots(cols);
    case "line":
      return lineSlots(cols);
    case "scatter":
      return scatterSlots(cols);
    case "spatial-plot":
      return spatialPlotSlots(cols);
    case "scene-heatmap":
      return heatmapSlots(cols);
    default:
      return [];
  }
}

// ─── Scene Heatmap 槽位（STORY-0073）───────────────────────────────────

function heatmapSlots(cols: Column[]): Slot[] {
  const vis = visibleCols(cols);
  return [
    { name: "x", label: "X 坐标", required: true, field: findField(vis, ["x", "pos_x", "longitude"]), acceptTypes: ["number"] },
    { name: "y", label: "Y 坐标", required: true, field: findField(vis, ["y", "pos_y", "latitude"]), acceptTypes: ["number"] },
    { name: "bandwidth", label: "带宽", required: false, field: null, acceptTypes: ["number"] },
    { name: "opacity", label: "透明度", required: false, field: null, acceptTypes: ["number"] },
    { name: "colorScale", label: "色阶", required: false, field: null, acceptTypes: ["string"] },
  ];
}
