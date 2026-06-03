/**
 * CSV 解析器 / CSV → ANDF parser.
 *
 * 支持：
 * - UTF-8（含 BOM 自动跳过）
 * - 逗号 / TSV 自动检测（首行 tab 占比 > 逗号 → TSV 模式）
 * - 行列数不齐 → 跳过该行 + warning
 * - 类型推断 → boolean → number → datetime → url → string
 */

import type { ANDF, ParseResult } from "./types";
import { inferColumnType } from "./infer-type";

/** CSV 解析选项 / CSV parse options */
export interface CSVParserOptions {
  /** 文件来源名（用于 meta.source），可选 */
  sourceName?: string;
}

/**
 * 解析 CSV 文本为 ANDF / Parse CSV text into ANDF.
 */
export function parseCSV(text: string, opts: CSVParserOptions = {}): ParseResult {
  console.debug("[csv-parser] 开始解析 CSV，长度:", text.length, "来源:", opts.sourceName ?? "(未命名)");

  // 去除 UTF-8 BOM
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
    console.debug("[csv-parser] 检测到 UTF-8 BOM，已跳过");
  }

  if (text.trim().length === 0) {
    return {
      ok: false,
      error: { code: "EMPTY_FILE", message: "未发现可解析的数据" },
    };
  }

  // 行分割（支持 \n 和 \r\n）
  const rawLines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (rawLines.length === 0) {
    return {
      ok: false,
      error: { code: "EMPTY_FILE", message: "未发现可解析的数据" },
    };
  }

  // 分隔符自动检测：首行 tab 占比 > 逗号 → TSV
  const delimiter = detectDelimiter(rawLines[0]!);

  // 解析表头
  const headerLine = rawLines[0]!;
  const headers = parseLine(headerLine, delimiter);

  if (headers.length === 0 || headers.every((h) => h.trim() === "")) {
    return {
      ok: false,
      error: { code: "EMPTY_HEADER", message: "表头为空，请检查首行" },
    };
  }

  console.debug("[csv-parser] 表头:", headers, "分隔符:", delimiter === "\t" ? "TAB" : "COMMA");

  // 解析数据行
  const dataLines = rawLines.slice(1);
  const rows: Record<string, unknown>[] = [];
  const columnValues: Map<number, unknown[]> = new Map();

  for (let i = 0; i < dataLines.length; i++) {
    const fields = parseLine(dataLines[i]!, delimiter);

    if (fields.length !== headers.length) {
      console.debug("[csv-parser] 行", i + 1, "列数不齐 (期望", headers.length, "实际", fields.length, ")，跳过");
      continue;
    }

    const row: Record<string, unknown> = {};
    for (let j = 0; j < headers.length; j++) {
      const raw = fields[j]!.trim();
      const parsed = parseCellValue(raw);
      row[headers[j]!] = parsed;

      // 收集用于类型推断
      if (!columnValues.has(j)) columnValues.set(j, []);
      columnValues.get(j)!.push(parsed);
    }
    rows.push(row);
  }

  if (rows.length === 0) {
    return {
      ok: false,
      error: { code: "EMPTY_FILE", message: "未发现可解析的数据行" },
    };
  }

  // 构建 columns
  const columns = headers.map((name, idx) => {
    const values = columnValues.get(idx) ?? [];
    const { type, conflicted } = inferColumnType(values);

    if (conflicted) {
      console.debug("[csv-parser] 列", name, "类型推断冲突，退化为 string");
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

  console.debug("[csv-parser] 解析完成:", rows.length, "行", columns.length, "列");

  return {
    ok: true,
    data: {
      meta: {
        source: opts.sourceName,
        importedAt,
        rowCount: rows.length,
        columnCount: columns.length,
      },
      columns: columns as ANDF["columns"],
      rows,
    },
  };
}

/** 检测 CSV 分隔符：首行 tab 数 > 逗号数 → TSV */
function detectDelimiter(firstLine: string): string {
  const tabs = firstLine.split("\t").length - 1;
  const commas = firstLine.split(",").length - 1;
  return tabs > commas ? "\t" : ",";
}

/** 按分隔符解析一行（处理引号包裹字段） */
function parseLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;

    if (ch === '"') {
      // 引号内的双引号 "" → 转义为一个引号
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/** 解析单个单元格为正确的 JS 类型 */
function parseCellValue(raw: string): unknown {
  const trimmed = raw.trim();

  // 空字符串留作 null（列定义 nullable=true）
  if (trimmed === "") return null;

  // 引号包裹的字符串，去除外层引号
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }

  // boolean
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;

  // number
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  return trimmed;
}
