/**
 * 解析器共享类型 / Parser common types.
 */

import type { ArtifexNexusDataFormat, Column, ANDFMeta as Meta } from "@artifex-nexus/contracts";

/** 列类型枚举（与 JSON Schema / contracts 保持一致） */
export type ColumnType = "string" | "number" | "boolean" | "datetime" | "url";

/** 解析结果 / Parse result — 无论成功失败都走 Result 类型，不抛异常 */
export interface ParseResult {
  ok: boolean;
  /** ok=true 时存在 */
  data?: ArtifexNexusDataFormat;
  /** ok=false 时存在 */
  error?: ParseError;
}

/** 解析错误 / Parse error */
export interface ParseError {
  code: string;
  message: string;
  /** CSV 场景下出错行号（1-based，0 表示非行级错误） */
  line?: number;
}

/** Re-export contracts 类型供解析器内部使用 */
export type { ArtifexNexusDataFormat as ANDF, Column, Meta };
