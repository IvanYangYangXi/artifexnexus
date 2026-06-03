/**
 * JSON 解析器单元测试 / JSON parser unit tests.
 */
import { describe, it, expect } from "vitest";
import { parseJSONArray } from "../parser/json-parser";
import type { Column } from "../parser/types";

describe("parseJSONArray", () => {
  // ---- 验收标准 #5: [{x:1, y:"a"}] → x:number / y:string ----
  it('[{x:1, y:"a"}] → x:number / y:string', () => {
    const result = parseJSONArray('[{"x":1,"y":"a"},{"x":2,"y":"b"}]');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const cols = result.data!.columns;
    const xCol = cols.find((c: Column) => c.name === "x")!;
    const yCol = cols.find((c: Column) => c.name === "y")!;
    expect(xCol.type).toBe("number");
    expect(yCol.type).toBe("string");

    expect(result.data!.rows).toEqual([
      { x: 1, y: "a" },
      { x: 2, y: "b" },
    ]);
  });

  // ---- 错误用例 ----
  it("空字符串 → EMPTY_FILE", () => {
    const result = parseJSONArray("");
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("EMPTY_FILE");
  });

  it("无效 JSON → INVALID_JSON", () => {
    const result = parseJSONArray("{invalid}");
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("INVALID_JSON");
  });

  it("非数组 JSON → NOT_ARRAY", () => {
    const result = parseJSONArray('{"a":1}');
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("NOT_ARRAY");
  });

  it("空数组 → EMPTY_FILE", () => {
    const result = parseJSONArray("[]");
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("EMPTY_FILE");
  });

  it("数组元素非对象 → NOT_ARRAY", () => {
    const result = parseJSONArray('[1, 2, 3]');
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("NOT_ARRAY");
  });

  // ---- 类型推断 ----
  it("boolean 类型推断", () => {
    const result = parseJSONArray('[{"flag":true},{"flag":false}]');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data!.columns[0]!.type).toBe("boolean");
  });

  it("datetime 类型推断", () => {
    const result = parseJSONArray('[{"dt":"2026-06-03T12:00:00Z"},{"dt":"2026-01-15"}]');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data!.columns[0]!.type).toBe("datetime");
  });

  it("url 类型推断", () => {
    const result = parseJSONArray('[{"link":"https://example.com"},{"link":"http://test.io"}]');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data!.columns[0]!.type).toBe("url");
  });

  // ---- 列并集 ----
  it("不同行不同 key → 列取并集，缺值填 null", () => {
    const result = parseJSONArray('[{"a":1},{"a":2,"b":"x"},{"c":3}]');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data!.meta.columnCount).toBe(3);
    expect(result.data!.columns.map((c: Column) => c.name).sort()).toEqual(["a", "b", "c"]);
    expect(result.data!.rows[0]).toEqual({ a: 1, b: null, c: null });
  });

  // ---- sourceName ----
  it("sourceName 写入 meta.source", () => {
    const result = parseJSONArray('[{"a":1}]', { sourceName: "data.json" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data!.meta.source).toBe("data.json");
  });

  // ---- null 值 ----
  it("null 值保留为 null", () => {
    const result = parseJSONArray('[{"a":null,"b":"hello"}]');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data!.rows[0]).toEqual({ a: null, b: "hello" });
  });
});
