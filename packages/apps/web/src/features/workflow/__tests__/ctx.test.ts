/**
 * ctx.test.ts —— 模板解析器
 */
import { describe, expect, it } from "vitest";
import { resolve } from "../ctx";
import type { RunCtx } from "../types";

const ctx: RunCtx = {
  vars: { workspace: "D:/proj", count: 3 },
  nodeOutputs: {
    n1: { result: { items: ["a", "b"] } },
    n2: { selected: "alpha" },
  },
};

describe("ctx.resolve", () => {
  it("returns raw JS value when whole string is a single expression", () => {
    expect(resolve("{{vars.count}}", ctx)).toBe(3);
    expect(resolve("{{n1.result}}", ctx)).toEqual({ items: ["a", "b"] });
  });

  it("interpolates inside string", () => {
    expect(resolve("path={{vars.workspace}}/x", ctx)).toBe("path=D:/proj/x");
  });

  it("recurses into objects and arrays", () => {
    const r = resolve(
      { p: "{{vars.workspace}}", arr: ["{{n2.selected}}", 7] },
      ctx,
    );
    expect(r).toEqual({ p: "D:/proj", arr: ["alpha", 7] });
  });

  it("returns undefined for missing path (single expr)", () => {
    expect(resolve("{{vars.missing}}", ctx)).toBeUndefined();
  });

  it("renders empty string for missing path inside template", () => {
    expect(resolve("x={{vars.missing}}!", ctx)).toBe("x=!");
  });

  it("preserves non-string scalars", () => {
    expect(resolve(42, ctx)).toBe(42);
    expect(resolve(true, ctx)).toBe(true);
    expect(resolve(null, ctx)).toBeNull();
  });
});
