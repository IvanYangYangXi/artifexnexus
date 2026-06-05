/**
 * e2e-checklist.test.ts —— EPIC-0011 端到端 checklist
 *
 * 6 场景：基础链 / 暂停继续 / 分支 / 终止 / 错误恢复 / 大图 200 节点
 * 全部用 WorkflowEngine + 默认 executors 跑（不依赖 React Flow / DOM）。
 */

import { describe, expect, it } from "vitest";
import { WorkflowEngine } from "../engine";
import { createDefaultExecutors } from "../node-registry";
import type { AWFF } from "../types";

const META = {
  id: "wf",
  name: "wf",
  createdAt: "2026-06-05T00:00:00Z",
  updatedAt: "2026-06-05T00:00:00Z",
  schemaVersion: "0.1.0" as const,
};
const cap = (o: Partial<{ canPause: boolean; canBranch: boolean; canTerminate: boolean; runtimeUI: "none" | "panel" | "modal" }> = {}) => ({
  canPause: false,
  canBranch: false,
  canTerminate: false,
  runtimeUI: "none" as const,
  ...o,
});

describe("E2E checklist · EPIC-0011", () => {
  it("scenario 1: 4-node basic chain runs to completion", async () => {
    const engine = new WorkflowEngine({ executors: createDefaultExecutors() });
    const w: AWFF = {
      meta: META,
      nodes: [
        { id: "t", kind: "trigger", type: "trigger.on-demand", name: "t", position: { x: 0, y: 0 }, capabilities: cap(), inputs: [], outputs: [{ id: "out", name: "out", dataType: "trigger" }] },
        { id: "tool", kind: "tool", type: "tool.run-tool", name: "tool", position: { x: 1, y: 0 }, capabilities: cap(), inputs: [{ id: "in", name: "in", dataType: "any" }], outputs: [{ id: "result", name: "result", dataType: "object" }], config: { toolId: "echo" } },
        { id: "out1", kind: "output", type: "output.show-result", name: "out1", position: { x: 2, y: 0 }, capabilities: cap({ runtimeUI: "panel" }), inputs: [{ id: "value", name: "value", dataType: "any" }], outputs: [], config: { value: "{{tool.result}}" } },
      ],
      edges: [
        { id: "e1", source: "t", target: "tool", sourceHandle: "out", targetHandle: "in" },
        { id: "e2", source: "tool", target: "out1", sourceHandle: "result", targetHandle: "value" },
      ],
    } as AWFF;
    const r = await engine.run(w);
    expect(r.status).toBe("completed");
    expect(r.executedOrder).toEqual(["t", "tool", "out1"]);
  });

  it("scenario 2: pause + resume on user-choice", async () => {
    const engine = new WorkflowEngine({ executors: createDefaultExecutors() });
    const w: AWFF = {
      meta: META,
      nodes: [
        { id: "t", kind: "trigger", type: "trigger.on-demand", name: "t", position: { x: 0, y: 0 }, capabilities: cap(), inputs: [], outputs: [{ id: "out", name: "out", dataType: "trigger" }] },
        { id: "uc", kind: "user", type: "user.user-choice", name: "uc", position: { x: 1, y: 0 }, capabilities: cap({ canPause: true, canBranch: true, runtimeUI: "panel" }), inputs: [{ id: "items", name: "items", dataType: "array" }], outputs: [{ id: "selected", name: "selected", dataType: "any" }] },
      ],
      edges: [{ id: "e1", source: "t", target: "uc", sourceHandle: "out", targetHandle: "items" }],
    } as AWFF;
    const p = engine.run(w);
    let snap = engine.snapshot();
    let tick = 0;
    while (snap.waitingNodeId !== "uc" && tick++ < 50) {
      await new Promise((r) => setTimeout(r, 5));
      snap = engine.snapshot();
    }
    expect(snap.workflowStatus).toBe("paused");
    engine.resume({ outputs: { selected: "x" } });
    const r = await p;
    expect(r.status).toBe("completed");
    expect(r.nodeStates.uc.outputs?.selected).toBe("x");
  });

  it("scenario 3: branch via condition (true path)", async () => {
    const engine = new WorkflowEngine({ executors: createDefaultExecutors() });
    const w: AWFF = {
      meta: META,
      nodes: [
        { id: "t", kind: "trigger", type: "trigger.on-demand", name: "t", position: { x: 0, y: 0 }, capabilities: cap(), inputs: [], outputs: [{ id: "out", name: "out", dataType: "trigger" }] },
        { id: "c", kind: "control", type: "control.condition", name: "c", position: { x: 1, y: 0 }, capabilities: cap({ canBranch: true }), inputs: [{ id: "value", name: "value", dataType: "any" }], outputs: [{ id: "true", name: "true", dataType: "any" }, { id: "false", name: "false", dataType: "any" }], config: { value: 1 } },
        { id: "y", kind: "data", type: "data.set-variable", name: "y", position: { x: 2, y: 0 }, capabilities: cap(), inputs: [{ id: "value", name: "value", dataType: "any" }], outputs: [{ id: "value", name: "value", dataType: "any" }], config: { name: "y", value: 1 } },
        { id: "n", kind: "data", type: "data.set-variable", name: "n", position: { x: 2, y: 1 }, capabilities: cap(), inputs: [{ id: "value", name: "value", dataType: "any" }], outputs: [{ id: "value", name: "value", dataType: "any" }], config: { name: "n", value: 0 } },
      ],
      edges: [
        { id: "e1", source: "t", target: "c", sourceHandle: "out", targetHandle: "value" },
        { id: "e2", source: "c", target: "y", sourceHandle: "true", targetHandle: "value" },
        { id: "e3", source: "c", target: "n", sourceHandle: "false", targetHandle: "value" },
      ],
    } as AWFF;
    const r = await engine.run(w);
    expect(r.nodeStates.y.status).toBe("done");
    expect(r.nodeStates.n.status).toBe("skipped");
  });

  it("scenario 4: terminate halts subsequent nodes", async () => {
    const engine = new WorkflowEngine({ executors: createDefaultExecutors() });
    const w: AWFF = {
      meta: META,
      nodes: [
        { id: "t", kind: "trigger", type: "trigger.on-demand", name: "t", position: { x: 0, y: 0 }, capabilities: cap(), inputs: [], outputs: [{ id: "out", name: "out", dataType: "trigger" }] },
        { id: "term", kind: "control", type: "control.terminate", name: "term", position: { x: 1, y: 0 }, capabilities: cap({ canTerminate: true }), inputs: [{ id: "in", name: "in", dataType: "any" }], outputs: [] },
        { id: "after", kind: "data", type: "data.set-variable", name: "after", position: { x: 2, y: 0 }, capabilities: cap(), inputs: [{ id: "value", name: "value", dataType: "any" }], outputs: [{ id: "value", name: "value", dataType: "any" }], config: { name: "after", value: 1 } },
      ],
      edges: [
        { id: "e1", source: "t", target: "term", sourceHandle: "out", targetHandle: "in" },
        { id: "e2", source: "term", target: "after", sourceHandle: "out", targetHandle: "value" },
      ],
    } as AWFF;
    const r = await engine.run(w);
    expect(r.status).toBe("terminated");
    expect(r.nodeStates.after.status).toBe("skipped");
  });

  it("scenario 5: error stops execution but engine still returns", async () => {
    const engine = new WorkflowEngine({ executors: createDefaultExecutors() });
    const w: AWFF = {
      meta: META,
      nodes: [
        { id: "t", kind: "trigger", type: "trigger.on-demand", name: "t", position: { x: 0, y: 0 }, capabilities: cap(), inputs: [], outputs: [{ id: "out", name: "out", dataType: "trigger" }] },
        { id: "p", kind: "script", type: "script.run-python", name: "p", position: { x: 1, y: 0 }, capabilities: cap(), inputs: [{ id: "input", name: "input", dataType: "any" }], outputs: [{ id: "stdout", name: "stdout", dataType: "string" }] },
      ],
      edges: [{ id: "e1", source: "t", target: "p", sourceHandle: "out", targetHandle: "input" }],
    } as AWFF;
    const r = await engine.run(w);
    expect(r.status).toBe("error");
    expect(r.nodeStates.p.status).toBe("error");
  });

  it("scenario 6: 200-node linear graph completes within reasonable time", async () => {
    const engine = new WorkflowEngine({ executors: createDefaultExecutors() });
    const N = 200;
    const nodes = [
      {
        id: "t",
        kind: "trigger",
        type: "trigger.on-demand",
        name: "t",
        position: { x: 0, y: 0 },
        capabilities: cap(),
        inputs: [],
        outputs: [{ id: "out", name: "out", dataType: "trigger" }],
      },
      ...Array.from({ length: N }, (_, i) => ({
        id: `d${i}`,
        kind: "data" as const,
        type: "data.set-variable" as const,
        name: `d${i}`,
        position: { x: i + 1, y: 0 },
        capabilities: cap(),
        inputs: [{ id: "value", name: "value", dataType: "any" as const }],
        outputs: [{ id: "value", name: "value", dataType: "any" as const }],
        config: { name: `v${i}`, value: i },
      })),
    ];
    const edges = [
      { id: "e0", source: "t", target: "d0", sourceHandle: "out", targetHandle: "value" },
      ...Array.from({ length: N - 1 }, (_, i) => ({
        id: `e${i + 1}`,
        source: `d${i}`,
        target: `d${i + 1}`,
        sourceHandle: "value",
        targetHandle: "value",
      })),
    ];
    const w = { meta: META, nodes, edges } as AWFF;
    const t0 = Date.now();
    const r = await engine.run(w);
    const elapsed = Date.now() - t0;
    expect(r.status).toBe("completed");
    expect(r.executedOrder.length).toBe(N + 1);
    expect(elapsed).toBeLessThan(2000); // 200 节点 < 2s
  });
});
