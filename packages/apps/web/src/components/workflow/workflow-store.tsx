"use client";

/**
 * WorkflowStore — 全局轻量 store（M11 无持久化，关闭即丢，与 M10 一致）
 *
 * 不引入新依赖（zustand 之类），用 React Context + useReducer 实现。
 */

import * as React from "react";
import type { AWFF, AWFFEdge, AWFFNode } from "../../features/workflow/types";

// ---- Diff 队列 ----

export type AWFFDiff =
  | { kind: "node-update"; nodeId: string; patch: Partial<AWFFNode>; ts: number }
  | { kind: "node-add"; node: AWFFNode; ts: number }
  | { kind: "node-delete"; nodeId: string; ts: number }
  | { kind: "edge-add"; edge: AWFFEdge; ts: number }
  | { kind: "edge-update"; edgeId: string; patch: Partial<AWFFEdge>; ts: number }
  | { kind: "edge-delete"; edgeId: string; ts: number }
  | { kind: "meta-update"; patch: Partial<AWFF["meta"]>; ts: number };

export interface WorkflowState {
  awff: AWFF;
  diffs: AWFFDiff[];
}

type Action =
  | { type: "import"; awff: AWFF }
  | { type: "node-add"; node: AWFFNode }
  | { type: "node-update"; nodeId: string; patch: Partial<AWFFNode> }
  | { type: "node-move"; nodeId: string; position: { x: number; y: number } }
  | { type: "node-delete"; nodeId: string }
  | { type: "edge-add"; edge: AWFFEdge }
  | { type: "edge-update"; edgeId: string; patch: Partial<AWFFEdge> }
  | { type: "edge-delete"; edgeId: string }
  | { type: "meta-update"; patch: Partial<AWFF["meta"]> }
  | { type: "diff-clear" };

const emptyAWFF: AWFF = {
  meta: {
    id: "wf-empty",
    name: "未命名工作流",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    schemaVersion: "0.1.0",
  },
  nodes: [],
  edges: [],
  variables: [],
};

function reducer(state: WorkflowState, action: Action): WorkflowState {
  const ts = Date.now();
  switch (action.type) {
    case "import":
      return { awff: action.awff, diffs: [] };
    case "node-add":
      return {
        awff: { ...state.awff, nodes: [...state.awff.nodes, action.node] },
        diffs: [...state.diffs, { kind: "node-add", node: action.node, ts }],
      };
    case "node-update":
      return {
        awff: {
          ...state.awff,
          nodes: state.awff.nodes.map((n) =>
            n.id === action.nodeId ? ({ ...n, ...action.patch } as AWFFNode) : n,
          ),
        },
        diffs: [...state.diffs, { kind: "node-update", nodeId: action.nodeId, patch: action.patch, ts }],
      };
    case "node-move":
      return {
        awff: {
          ...state.awff,
          nodes: state.awff.nodes.map((n) =>
            n.id === action.nodeId ? { ...n, position: action.position } : n,
          ),
        },
        diffs: [
          ...state.diffs,
          { kind: "node-update", nodeId: action.nodeId, patch: { position: action.position }, ts },
        ],
      };
    case "node-delete":
      return {
        awff: {
          ...state.awff,
          nodes: state.awff.nodes.filter((n) => n.id !== action.nodeId),
          edges: state.awff.edges.filter((e) => e.source !== action.nodeId && e.target !== action.nodeId),
        },
        diffs: [...state.diffs, { kind: "node-delete", nodeId: action.nodeId, ts }],
      };
    case "edge-add":
      return {
        awff: { ...state.awff, edges: [...state.awff.edges, action.edge] },
        diffs: [...state.diffs, { kind: "edge-add", edge: action.edge, ts }],
      };
    case "edge-update":
      return {
        awff: {
          ...state.awff,
          edges: state.awff.edges.map((e) =>
            e.id === action.edgeId ? ({ ...e, ...action.patch } as AWFFEdge) : e,
          ),
        },
        diffs: [
          ...state.diffs,
          { kind: "edge-update", edgeId: action.edgeId, patch: action.patch, ts },
        ],
      };
    case "edge-delete":
      return {
        awff: { ...state.awff, edges: state.awff.edges.filter((e) => e.id !== action.edgeId) },
        diffs: [...state.diffs, { kind: "edge-delete", edgeId: action.edgeId, ts }],
      };
    case "meta-update":
      return {
        awff: { ...state.awff, meta: { ...state.awff.meta, ...action.patch } },
        diffs: [...state.diffs, { kind: "meta-update", patch: action.patch, ts }],
      };
    case "diff-clear":
      return { ...state, diffs: [] };
    default:
      return state;
  }
}

interface Ctx {
  state: WorkflowState;
  dispatch: React.Dispatch<Action>;
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  selectedEdgeId: string | null;
  setSelectedEdgeId: (id: string | null) => void;
}

const WorkflowContext = React.createContext<Ctx | null>(null);

export function WorkflowProvider({ children, initial }: { children: React.ReactNode; initial?: AWFF }) {
  const [state, dispatch] = React.useReducer(reducer, { awff: initial ?? emptyAWFF, diffs: [] });
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = React.useState<string | null>(null);
  const value = React.useMemo<Ctx>(
    () => ({ state, dispatch, selectedNodeId, setSelectedNodeId, selectedEdgeId, setSelectedEdgeId }),
    [state, selectedNodeId, selectedEdgeId],
  );
  return <WorkflowContext.Provider value={value}>{children}</WorkflowContext.Provider>;
}

export function useWorkflow() {
  const ctx = React.useContext(WorkflowContext);
  if (!ctx) throw new Error("useWorkflow must be used within <WorkflowProvider>");
  return ctx;
}
