/**
 * stats.ts 单元测试（STORY-0074）
 */
import { describe, it, expect } from "vitest";
import { computeStats, computeAllStats } from "../stats";
import type { Column } from "@artifex-nexus/contracts";

// ---- numeric ----

describe("computeStats — number", () => {
  const col: Column = { name: "weight", type: "number" };
  const rows = [
    { weight: 3 },
    { weight: 1 },
    { weight: 5 },
    { weight: 7 },
    { weight: 2 },
  ];

  it("min / max / avg / sum / median", () => {
    const s = computeStats(col, rows);
    expect(s.min).toBe(1);
    expect(s.max).toBe(7);
    expect(s.avg).toBeCloseTo(3.6);
    expect(s.sum).toBe(18);
    expect(s.median).toBe(3);
  });

  it("count / nullCount", () => {
    const s = computeStats(col, rows);
    expect(s.count).toBe(5);
    expect(s.nullCount).toBe(0);
  });
});

describe("computeStats — number with nulls", () => {
  const col: Column = { name: "val", type: "number" };
  const rows = [{ val: 10 }, { val: null }, { val: 20 }, {}, { val: 30 }];

  it("skips null/undefined in count", () => {
    const s = computeStats(col, rows);
    expect(s.count).toBe(3);
    expect(s.nullCount).toBe(2);
    expect(s.min).toBe(10);
    expect(s.max).toBe(30);
  });
});

describe("computeStats — number single element", () => {
  const col: Column = { name: "x", type: "number" };
  const rows = [{ x: 42 }];

  it("median = value, min = max = value", () => {
    const s = computeStats(col, rows);
    expect(s.median).toBe(42);
    expect(s.min).toBe(42);
    expect(s.max).toBe(42);
  });
});

// ---- empty ----

describe("computeStats — empty column", () => {
  const col: Column = { name: "empty", type: "number" };
  const rows: Record<string, unknown>[] = [];

  it("returns base stats without computed fields", () => {
    const s = computeStats(col, rows);
    expect(s.count).toBe(0);
    expect(s.nullCount).toBe(0);
    expect(s.min).toBeUndefined();
    expect(s.max).toBeUndefined();
    expect(s.avg).toBeUndefined();
  });
});

describe("computeStats — all nulls", () => {
  const col: Column = { name: "n", type: "number" };
  const rows = [{ n: null }, { n: null }];

  it("count=0 nullCount=2, no computed fields", () => {
    const s = computeStats(col, rows);
    expect(s.count).toBe(0);
    expect(s.nullCount).toBe(2);
    expect(s.min).toBeUndefined();
  });
});

// ---- string ----

describe("computeStats — string", () => {
  const col: Column = { name: "color", type: "string" };
  const rows = [
    { color: "red" },
    { color: "blue" },
    { color: "red" },
    { color: "green" },
    { color: "red" },
  ];

  it("uniqueCount + topValues", () => {
    const s = computeStats(col, rows);
    expect(s.uniqueCount).toBe(3);
    expect(s.topValues).toEqual([
      { value: "red", count: 3 },
      { value: "blue", count: 1 },
      { value: "green", count: 1 },
    ]);
  });
});

// ---- boolean ----

describe("computeStats — boolean", () => {
  const col: Column = { name: "active", type: "boolean" };
  const rows = [
    { active: true },
    { active: false },
    { active: true },
    { active: true },
  ];

  it("trueRatio = 3/4", () => {
    const s = computeStats(col, rows);
    expect(s.trueRatio).toBeCloseTo(0.75);
    expect(s.count).toBe(4);
  });
});

// ---- computeAllStats ----

describe("computeAllStats", () => {
  const cols: Column[] = [
    { name: "a", type: "number" },
    { name: "b", type: "string" },
    { name: "c", type: "boolean" },
  ];
  const rows = [
    { a: 1, b: "x", c: true },
    { a: 3, b: "y", c: false },
  ];

  it("returns stats array matching column order", () => {
    const all = computeAllStats(cols, rows);
    expect(all).toHaveLength(3);
    expect(all[0]!.column).toBe("a");
    expect(all[1]!.column).toBe("b");
    expect(all[2]!.column).toBe("c");
    expect(all[0]!.min).toBe(1);
    expect(all[1]!.uniqueCount).toBe(2);
    expect(all[2]!.trueRatio).toBeCloseTo(0.5);
  });
});
