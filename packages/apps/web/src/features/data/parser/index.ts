/**
 * 数据解析器入口 / Data parser entry.
 *
 * 导出 CSV / JSON 解析器 + 通用类型。
 */

export type { ANDF, Column, Meta, ParseResult, ParseError, ColumnType } from "./types";
export { parseCSV } from "./csv-parser";
export type { CSVParserOptions } from "./csv-parser";
export { parseJSONArray } from "./json-parser";
export type { JSONParserOptions } from "./json-parser";
export { inferCellType, inferColumnType } from "./infer-type";
