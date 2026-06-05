/**
 * topology.test.ts
 */
import { describe, expect, it } from "vitest";
import { topoSort, TopologyError } from "../topology";
import type { AWFF } from "../types";

const META = {
  id: "t",
  name: "t",
  createdAt: "2026-06-05T00:00:00Z",
  updatedAt: "2026-06-05T00:00:00Z",
  schemaVersion: "0.1.0" as const,
};

function awff(nodes: { id: string }[], edges: { id: string; source: string; target: string }[]): AWFF {
  return {
    meta: META,
    nodes: nodes.map((n) => ({
      id: n.id,
      kind: "data",
      type: "data.set-variable",
      name: n.id,
      position: { x: 0, y: 0 },
      capabilities: { canPause: false, canBranch: false, canTerminate: false, runtimeUI: "none" },
      inputs: [],
      outputs: [],
    })),
    edges: edges.map((e) => ({ ...e, sourceHandle: "out", targetHandle: "in" })),
  } as AWFF;
}

describe("topoSort", () => {
  it("orders a 4-node chain", () => {
    const w = awff(
      [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
      [
        { id: "1", source: "a", target: "b" },
        { id: "2", source: "b", target: "c" },
        { id: "3", source: "c", target: "d" },
      ],
    );
    expect(topoSort(w).order).toEqual(["a", "b", "c", "d"]);
  });

  it("detects a 3-node cycle", () => {
    const w = awff(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      [
        { id: "1", source: "a", target: "b" },
        { id: "2", source: "b", target: "c" },
        { id: "3", source: "c", target: "a" },
      ],
    );
    expect(() => topoSort(w)).toThrow(TopologyError);
  });

  it("detects a self-loop", () => {
    const w = awff([{ id: "a" }], [{ id: "1", source: "a", target: "a" }]);
    expect(() => topoSort(w)).toThrow(TopologyError);
  });

  it("rejects edges referencing unknown nodes", () => {
    const w = awff([{ id: "a" }], [{ id: "1", source: "a", target: "b" }]);
    expect(() => topoSort(w)).toThrow(TopologyError);
  });

  it("orders parallel branches deterministically (by node array order)", () => {
    const w = awff(
      [{ id: "root" }, { id: "x" }, { id: "y" }],
      [
        { id: "1", source: "root", target: "x" },
        { id: "2", source: "root", target: "y" },
      ],
    );
    expect(topoSort(w).order).toEqual(["root", "x", "y"]);
  });

  it("handles disconnected components", () => {
    const w = awff(
      [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
      [
        { id: "1", source: "a", target: "b" },
        { id: "2", source: "c", target: "d" },
      ],
    );
    const order = topoSort(w).order;
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("c")).toBeLessThan(order.indexOf("d"));
  });
});
