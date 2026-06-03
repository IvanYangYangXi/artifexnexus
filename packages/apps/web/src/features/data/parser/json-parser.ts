/**
 * JSON 数组解析器 / JSON array → ANDF parser.
 *
 * 输入：对象数组 [{a:1, b:"x"}, ...]
 * 输出：ANDF，列定义从首行对象 key 提取，类型推断走 inferColumnType。
 */

import type { ANDF, ParseResult } from "./types";
import { inferColumnType } from "./infer-type";

/** JSON 解析选项 / JSON parse options */
export interface JSONParserOptions {
  /** 来源标识（用于 meta.source），可选 */
  sourceName?: string;
}

/**
 * 解析 JSON 数组文本为 ANDF / Parse JSON array text into ANDF.
 */
export function parseJSONArray(text: string, opts: JSONParserOptions = {}): ParseResult {
  console.debug("[json-parser] 开始解析 JSON，长度:", text.length, "来源:", opts.sourceName ?? "(未命名)");

  if (text.trim().length === 0) {
    return {
      ok: false,
      error: { code: "EMPTY_FILE", message: "未发现可解析的数据" },
    };
  }

  // JSON 解析
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof SyntaxError ? err.message : String(err);
    console.debug("[json-parser] JSON 解析失败:", msg);
    return {
      ok: false,
      error: { code: "INVALID_JSON", message: `JSON 解析失败: ${msg}` },
    };
  }

  // 校验为数组
  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      error: { code: "NOT_ARRAY", message: "JSON 根元素不是数组，期望 [{...}, ...]" },
    };
  }

  if (parsed.length === 0) {
    return {
      ok: false,
      error: { code: "EMPTY_FILE", message: "JSON 数组为空" },
    };
  }

  // 从首行提取列名（所有对象的 key 并集）
  const allKeys = new Set<string>();
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) {
      return {
        ok: false,
        error: { code: "NOT_ARRAY", message: "JSON 数组元素不是对象，期望 [{...}, ...]" },
      };
    }
    for (const key of Object.keys(item as Record<string, unknown>)) {
      allKeys.add(key);
    }
  }

  const columns = [...allKeys];

  // 收集每列值用于类型推断
  const columnValues = new Map<string, unknown[]>();
  const rows: Record<string, unknown>[] = [];

  for (const item of parsed) {
    const row: Record<string, unknown> = {};
    const obj = item as Record<string, unknown>;
    for (const col of columns) {
      const val = obj[col] ?? null;
      row[col] = val;
      if (!columnValues.has(col)) columnValues.set(col, []);
      columnValues.get(col)!.push(val);
    }
    rows.push(row);
  }

  // 构建 ANDF columns
  const andfColumns = columns.map((name, idx) => {
    const values = columnValues.get(name) ?? [];
    const { type, conflicted } = inferColumnType(values);

    if (conflicted) {
      console.debug("[json-parser] 列", name, "类型推断冲突，退化为 string");
    }

    return {
      name,
      type,
      nullable: true,
      visible: true,
      index: idx,
    };
  });

  const importedAt = new Date().toISOString();

  console.debug("[json-parser] 解析完成:", rows.length, "行", andfColumns.length, "列");

  return {
    ok: true,
    data: {
      meta: {
        source: opts.sourceName,
        importedAt,
        rowCount: rows.length,
        columnCount: andfColumns.length,
      },
      columns: andfColumns as ANDF["columns"],
      rows,
    },
  };
}
