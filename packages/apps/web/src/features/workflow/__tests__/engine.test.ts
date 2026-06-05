/**
 * engine.test.ts —— 串行执行 / 暂停 / 分支 / 终止 / 错误 / 循环依赖
 */
import { afterEach, describe, expect, it } from "vitest";
import { WorkflowEngine } from "../engine";
import { createDefaultExecutors } from "../node-registry";
import type { AWFF, NodeExecutor } from "../types";

const META = {
  id: "wf",
  name: "wf",
  createdAt: "2026-06-05T00:00:00Z",
  updatedAt: "2026-06-05T00:00:00Z",
  schemaVersion: "0.1.0" as const,
};

const cap = (overrides: Partial<{ canPause: boolean; canBranch: boolean; canTerminate: boolean; runtimeUI: "none" | "panel" | "modal" }> = {}) => ({
  canPause: false,
  canBranch: false,
  canTerminate: false,
  runtimeUI: "none" as const,
  ...overrides,
});

afterEach(() => {
  // nothing
});

function fixture4Chain(): AWFF {
  return {
    meta: META,
    nodes: [
      { id: "t", kind: "trigger", type: "trigger.on-demand", name: "t", position: { x: 0, y: 0 }, capabilities: cap(), inputs: [], outputs: [{ id: "out", name: "trigger", dataType: "trigger" }] },
      { id: "tool", kind: "tool", type: "tool.run-tool", name: "tool", position: { x: 1, y: 0 }, capabilities: cap(), inputs: [{ id: "in", name: "in", dataType: "any" }], outputs: [{ id: "result", name: "result", dataType: "object" }], config: { toolId: "fs.list_files", params: { path: "{{vars.workspace}}" } } },
      { id: "uc", kind: "user", type: "user.user-choice", name: "uc", position: { x: 2, y: 0 }, capabilities: cap({ canPause: true, canBranch: true, runtimeUI: "panel" }), inputs: [{ id: "items", name: "items", dataType: "array" }], outputs: [{ id: "selected", name: "selected", dataType: "string" }] },
      { id: "skill", kind: "skill", type: "skill.run-skill", name: "skill", position: { x: 3, y: 0 }, capabilities: cap(), inputs: [{ id: "input", name: "input", dataType: "any" }], outputs: [{ id: "result", name: "result", dataType: "any" }], config: { skillName: "summarize", params: { text: "{{uc.selected}}" } } },
    ],
    edges: [
      { id: "e1", source: "t", target: "tool", sourceHandle: "out", targetHandle: "in" },
      { id: "e2", source: "tool", target: "uc", sourceHandle: "result", targetHandle: "items" },
      { id: "e3", source: "uc", target: "skill", sourceHandle: "selected", targetHandle: "input" },
    ],
    variables: [{ name: "workspace", type: "string", default: "D:/proj" }],
  } as AWFF;
}

describe("WorkflowEngine", () => {
  it("runs a 4-node chain with pause + resume", async () => {
    const engine = new WorkflowEngine({ executors: createDefaultExecutors() });
    const w = fixture4Chain();
    const promise = engine.run(w);

    // 等待 user-choice 进入 waiting 态
    let snap = engine.snapshot();
    let tick = 0;
    while (snap.waitingNodeId !== "uc" && tick++ < 50) {
      await new Promise((r) => setTimeout(r, 5));
      snap = engine.snapshot();
    }
    expect(snap.waitingNodeId).toBe("uc");
    expect(snap.workflowStatus).toBe("paused");

    engine.resume({ outputs: { selected: "alpha.txt" } });
    const result = await promise;

    expect(result.status).toBe("completed");
    expect(result.executedOrder).toEqual(["t", "tool", "uc", "skill"]);
    expect(result.nodeStates.uc.status).toBe("done");
    expect(result.nodeStates.skill.status).toBe("done");
    // 模板解析：tool 的 params.path 应被替换
    expect((result.nodeStates.tool.outputs?.result as { params: { path: string } }).params.path).toBe("D:/proj");
  });

  it("supports terminate via control.terminate node", async () => {
    const engine = new WorkflowEngine({ executors: createDefaultExecutors() });
    const w: AWFF = {
      meta: META,
      nodes: [
        { id: "t", kind: "trigger", type: "trigger.on-demand", name: "t", position: { x: 0, y: 0 }, capabilities: cap(), inputs: [], outputs: [{ id: "out", name: "out", dataType: "trigger" }] },
        { id: "term", kind: "control", type: "control.terminate", name: "term", position: { x: 1, y: 0 }, capabilities: cap({ canTerminate: true }), inputs: [{ id: "in", name: "in", dataType: "any" }], outputs: [] },
        { id: "after", kind: "data", type: "data.set-variable", name: "after", position: { x: 2, y: 0 }, capabilities: cap(), inputs: [{ id: "value", name: "value", dataType: "any" }], outputs: [{ id: "value", name: "value", dataType: "any" }], config: { name: "x", value: 1 } },
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

  it("propagates branch via condition node, skipping the other side", async () => {
    const engine = new WorkflowEngine({ executors: createDefaultExecutors() });
    const w: AWFF = {
      meta: META,
      nodes: [
        { id: "t", kind: "trigger", type: "trigger.on-demand", name: "t", position: { x: 0, y: 0 }, capabilities: cap(), inputs: [], outputs: [{ id: "out", name: "out", dataType: "trigger" }] },
        { id: "cond", kind: "control", type: "control.condition", name: "cond", position: { x: 1, y: 0 }, capabilities: cap({ canBranch: true }), inputs: [{ id: "value", name: "value", dataType: "any" }], outputs: [
          { id: "true", name: "true", dataType: "any" },
          { id: "false", name: "false", dataType: "any" },
        ], config: { value: true } },
        { id: "yes", kind: "data", type: "data.set-variable", name: "yes", position: { x: 2, y: 0 }, capabilities: cap(), inputs: [{ id: "value", name: "value", dataType: "any" }], outputs: [{ id: "value", name: "value", dataType: "any" }], config: { name: "yes", value: 1 } },
        { id: "no", kind: "data", type: "data.set-variable", name: "no", position: { x: 2, y: 1 }, capabilities: cap(), inputs: [{ id: "value", name: "value", dataType: "any" }], outputs: [{ id: "value", name: "value", dataType: "any" }], config: { name: "no", value: 0 } },
      ],
      edges: [
        { id: "e1", source: "t", target: "cond", sourceHandle: "out", targetHandle: "value" },
        { id: "e2", source: "cond", target: "yes", sourceHandle: "true", targetHandle: "value" },
        { id: "e3", source: "cond", target: "no", sourceHandle: "false", targetHandle: "value" },
      ],
    } as AWFF;
    const r = await engine.run(w);
    expect(r.status).toBe("completed");
    expect(r.nodeStates.cond.status).toBe("branched");
    expect(r.nodeStates.yes.status).toBe("done");
    expect(r.nodeStates.no.status).toBe("skipped");
  });

  it("captures node error and stops further execution", async () => {
    const failExec: NodeExecutor = async () => ({ error: "boom" });
    const engine = new WorkflowEngine({
      executors: {
        ...createDefaultExecutors(),
        "tool.run-tool": failExec,
      },
    });
    const w: AWFF = {
      meta: META,
      nodes: [
        { id: "t", kind: "trigger", type: "trigger.on-demand", name: "t", position: { x: 0, y: 0 }, capabilities: cap(), inputs: [], outputs: [{ id: "out", name: "out", dataType: "trigger" }] },
        { id: "x", kind: "tool", type: "tool.run-tool", name: "x", position: { x: 1, y: 0 }, capabilities: cap(), inputs: [{ id: "in", name: "in", dataType: "any" }], outputs: [{ id: "result", name: "result", dataType: "any" }], config: { toolId: "any" } },
        { id: "y", kind: "data", type: "data.set-variable", name: "y", position: { x: 2, y: 0 }, capabilities: cap(), inputs: [{ id: "value", name: "value", dataType: "any" }], outputs: [{ id: "value", name: "value", dataType: "any" }], config: { name: "y", value: 1 } },
      ],
      edges: [
        { id: "e1", source: "t", target: "x", sourceHandle: "out", targetHandle: "in" },
        { id: "e2", source: "x", target: "y", sourceHandle: "result", targetHandle: "value" },
      ],
    } as AWFF;
    const r = await engine.run(w);
    expect(r.status).toBe("error");
    expect(r.nodeStates.x.status).toBe("error");
    expect(r.nodeStates.y.status).toBe("pending"); // 未执行
  });

  it("rejects on cycle", async () => {
    const engine = new WorkflowEngine({ executors: createDefaultExecutors() });
    const w: AWFF = {
      meta: META,
      nodes: [
        { id: "a", kind: "data", type: "data.set-variable", name: "a", position: { x: 0, y: 0 }, capabilities: cap(), inputs: [], outputs: [{ id: "out", name: "out", dataType: "any" }] },
        { id: "b", kind: "data", type: "data.set-variable", name: "b", position: { x: 1, y: 0 }, capabilities: cap(), inputs: [{ id: "in", name: "in", dataType: "any" }], outputs: [{ id: "out", name: "out", dataType: "any" }] },
      ],
      edges: [
        { id: "e1", source: "a", target: "b", sourceHandle: "out", targetHandle: "in" },
        { id: "e2", source: "b", target: "a", sourceHandle: "out", targetHandle: "in" },
      ],
    } as AWFF;
    await expect(engine.run(w)).rejects.toThrow(/cycle/);
  });
});
