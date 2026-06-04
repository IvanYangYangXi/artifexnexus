/**
 * slot-mapping.ts — 视图槽位映射工具
 *
 * 对齐 docs/specs/ui/data-view-structure.md §3 视图槽位规则。
 * 每个视图有必填槽位 + 可选槽位，按列名自动匹配。
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

// ─── Table 槽位 ────────────────────────────────────────────────────────────

function tableSlots(cols: Column[]): Slot[] {
  // Table 自动派生列定义，无槽位概念；所有列都是 columns
  return cols.map((c) => ({
    name: c.name,
    label: c.name,
    required: true,
    field: c.name,
    acceptTypes: [c.type],
  }));
}

// ─── Card 槽位 ─────────────────────────────────────────────────────────────

function cardSlots(cols: Column[]): Slot[] {
  const slots: Slot[] = [
    { name: "title", label: "标题", required: true, field: findField(cols, ["title", "name", "label"]), acceptTypes: ["string", "number"] },
    { name: "subtitle", label: "副标题", required: false, field: findField(cols, ["subtitle", "description", "desc", "category"]), acceptTypes: ["string"] },
    { name: "image", label: "图片", required: false, field: findField(cols, ["image", "img", "thumbnail", "thumb_url", "url"]), acceptTypes: ["url"] },
    { name: "description", label: "描述", required: false, field: findField(cols, ["description", "desc", "note", "summary"]), acceptTypes: ["string"] },
    { name: "tags", label: "标签", required: false, field: findField(cols, ["tags", "tag", "type", "category"]), acceptTypes: ["string"] },
  ];
  // 扩展字段：取未被上述 slot 绑定的列，最多 3 个
  return appendExtras(slots, cols, 3);
}

// ─── List 槽位 ─────────────────────────────────────────────────────────────

function listSlots(cols: Column[]): Slot[] {
  const slots: Slot[] = [
    { name: "primary", label: "主文本", required: true, field: findField(cols, ["name", "label", "title", "primary"]), acceptTypes: ["string", "number"] },
    { name: "secondary", label: "副文本", required: true, field: findField(cols, ["description", "desc", "subtitle", "secondary", "summary"]), acceptTypes: ["string"] },
    { name: "thumbnail", label: "缩略图", required: false, field: findField(cols, ["thumbnail", "thumb", "image", "img", "thumb_url"]), acceptTypes: ["url"] },
    { name: "badge", label: "徽标", required: false, field: findField(cols, ["badge", "tag", "type", "status"]), acceptTypes: ["string", "number"] },
  ];
  return appendExtras(slots, cols, 3);
}

// ─── Tree 槽位 ─────────────────────────────────────────────────────────────

function treeSlots(cols: Column[]): Slot[] {
  return [
    { name: "label", label: "节点名", required: true, field: findField(cols, ["name", "label", "title", "id"]), acceptTypes: ["string", "number"] },
    { name: "parentId", label: "父节点", required: true, field: findField(cols, ["parentId", "parent_id", "parent", "pid"]), acceptTypes: ["string", "number"] },
    { name: "expanded", label: "展开", required: false, field: findField(cols, ["expanded", "open"]), acceptTypes: ["boolean"] },
  ];
}

// ─── 公共 ──────────────────────────────────────────────────────────────────

/** 在 columns 中按优先级搜索匹配的字段名 */
function findField(cols: Column[], candidates: string[]): string | null {
  for (const cand of candidates) {
    const found = cols.find((c) => c.name.toLowerCase() === cand.toLowerCase());
    if (found) return found.name;
  }
  return null;
}

/** 追加扩展字段：取未被现有 slot 绑定的列，最多 maxExtras 个 */
function appendExtras(slots: Slot[], cols: Column[], maxExtras: number): Slot[] {
  const bound = new Set(slots.filter((s) => s.field).map((s) => s.field));
  const extras = cols.filter((c) => !bound.has(c.name)).slice(0, maxExtras);
  for (const c of extras) {
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
    default:
      return [];
  }
}
