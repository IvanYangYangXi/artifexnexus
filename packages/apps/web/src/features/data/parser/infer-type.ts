/**
 * 类型推断纯函数 / Type inference for ANDF columns.
 *
 * 推断顺序：boolean → number → datetime → url → string
 * 同一列所有非空值类型一致 → 该类型；冲突 → 退化为 string。
 */

import type { ColumnType } from "./types";

/** 推断单个值的类型 / Infer type for a single cell value */
export function inferCellType(value: unknown): ColumnType {
  if (value === null || value === undefined || value === "") {
    return "string";
  }

  const str = String(value).trim();

  // 1. boolean — 仅 "true" / "false"（不区分大小写）
  if (str === "true" || str === "false") {
    return "boolean";
  }

  // 2. number — 科学计数法支持
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(str)) {
    return "number";
  }

  // 3. datetime — ISO 8601: yyyy-MM-dd [THH:mm:ss[±HH:mm|Z]]
  const dtPattern = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)?)?$/;
  if (dtPattern.test(str) && !isNaN(Date.parse(str))) {
    return "datetime";
  }

  // 4. url — http:// 或 https:// 开头
  if (/^https?:\/\//i.test(str)) {
    return "url";
  }

  // 5. 兜底 string
  return "string";
}

/**
 * 推断一列的类型 / Infer column type from all values.
 * 取所有非空值的推断结果，若全部一致则为该类型，否则退化为 string。
 */
export function inferColumnType(values: unknown[]): { type: ColumnType; conflicted: boolean } {
  const types = values
    .filter((v) => v !== null && v !== undefined && v !== "")
    .map((v) => inferCellType(v));

  if (types.length === 0) {
    return { type: "string", conflicted: false };
  }

  const unique = new Set(types);
  if (unique.size === 1) {
    return { type: types[0]!, conflicted: false };
  }

  return { type: "string", conflicted: true };
}
