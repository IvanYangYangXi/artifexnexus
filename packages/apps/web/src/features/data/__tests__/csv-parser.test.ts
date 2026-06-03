/**
 * CSV 解析器单元测试 / CSV parser unit tests.
 */
import { describe, it, expect } from "vitest";
import { parseCSV } from "../parser/csv-parser";

describe("parseCSV", () => {
  // ---- 验收标准 #4: name/n/b 类型推断 ----
  it("name, n, b → string / number / boolean", () => {
    const result = parseCSV("name,n,b\nfoo,1,true\nbar,2,false");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { columns, rows, meta } = result.data!;
    expect(meta.rowCount).toBe(2);
    expect(meta.columnCount).toBe(3);

    expect(columns[0]!.name).toBe("name");
    expect(columns[0]!.type).toBe("string");
    expect(columns[1]!.name).toBe("n");
    expect(columns[1]!.type).toBe("number");
    expect(columns[2]!.name).toBe("b");
    expect(columns[2]!.type).toBe("boolean");

    expect(rows).toEqual([
      { name: "foo", n: 1, b: true },
      { name: "bar", n: 2, b: false },
    ]);
  });

  // ---- 类型推断 ----
  it("datetime 推断（ISO 8601）", () => {
    const result = parseCSV("t\n2026-06-03\n2026-01-15T12:00:00Z");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data!.columns[0]!.type).toBe("datetime");
  });

  it("url 推断", () => {
    const result = parseCSV("link\nhttps://example.com\nhttp://test.io");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data!.columns[0]!.type).toBe("url");
  });

  it("类型冲突退化为 string", () => {
    const result = parseCSV("val\n42\nhello\n99");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data!.columns[0]!.type).toBe("string");
  });

  it("科学计数法 number", () => {
    const result = parseCSV("x\n1.5e3\n2E-4");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data!.columns[0]!.type).toBe("number");
  });

  // ---- 错误用例 ----
  it("表头空 → EMPTY_HEADER", () => {
    const result = parseCSV(",\n1,2");
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("EMPTY_HEADER");
  });

  it("全空文件 → EMPTY_FILE", () => {
    const result = parseCSV("");
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("EMPTY_FILE");
  });

  it("仅表头无数据 → EMPTY_FILE", () => {
    const result = parseCSV("a,b,c");
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("EMPTY_FILE");
  });

  it("行列数不齐 → 跳过该行，解析继续", () => {
    const result = parseCSV("a,b\n1,2\n3\n4,5");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 第 3 行 ("3") 列数不对，跳过
    expect(result.data!.meta.rowCount).toBe(2);
  });

  it("空值处理为 null", () => {
    const result = parseCSV("a,b\n1,\n,2");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data!.rows[0]).toEqual({ a: 1, b: null });
    expect(result.data!.rows[1]).toEqual({ a: null, b: 2 });
  });

  it("UTF-8 BOM 跳过", () => {
    const bom = "\ufeffname,val\nhello,42";
    const result = parseCSV(bom);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data!.columns[0]!.name).toBe("name");
  });

  // ---- TSV 支持 ----
  it("TSV 制表符分隔", () => {
    const result = parseCSV("name\tx\ty\nfoo\t1\t2");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data!.meta.columnCount).toBe(3);
    expect(result.data!.rows[0]).toEqual({ name: "foo", x: 1, y: 2 });
  });

  it("引号包裹含逗号的字段", () => {
    const result = parseCSV('name,desc\n"Rock","big, heavy"');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data!.rows[0]).toEqual({ name: "Rock", desc: "big, heavy" });
  });

  // ---- sourceName ----
  it("sourceName 写入 meta.source", () => {
    const result = parseCSV("a\n1", { sourceName: "test.csv" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data!.meta.source).toBe("test.csv");
  });
});
