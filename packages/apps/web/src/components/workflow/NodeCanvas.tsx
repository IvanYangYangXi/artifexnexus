"use client";

/**
 * NodeCanvas — React Flow 画布
 *
 *  - 接 useWorkflow 的 awff.nodes / awff.edges
 *  - 节点拖入 / 拖动 / 删除 / 连线 → dispatch
 *  - 类型不兼容连线 → onConnect 直接拒绝（返回 undefined 即可）
 */

import * as React from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge as RFEdge,
  type Node as RFNode,
  type NodeChange,
  type NodeProps,
  type OnConnect,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useWorkflow } from "./workflow-store";
import { useEngine } from "./engine-context";
import { getDeclaration, newNodeFromDeclaration } from "../../features/workflow/node-registry";
import type { AWFFEdge, AWFFNode, PortDataType } from "../../features/workflow/types";

const flowStyle: React.CSSProperties = { width: "100%", height: "100%" };

// P2-5: 自定义节点视图 —— 按 kind / status 上色，runtime UI 用 ring + pulse
type AwffNodeData = {
  label: string;
  kind: string;
  type: string;
  status: string;
  hasInputs: boolean;
  hasOutputs: boolean;
};

const KIND_COLOR: Record<string, string> = {
  trigger: "border-l-[hsl(var(--info))]",
  tool: "border-l-[hsl(var(--primary))]",
  skill: "border-l-[hsl(var(--primary))]",
  "ai-chat": "border-l-[hsl(var(--info))]",
  user: "border-l-[hsl(var(--warning))]",
  control: "border-l-[hsl(var(--warning))]",
  data: "border-l-[hsl(var(--success))]",
  script: "border-l-[hsl(var(--destructive))]",
  output: "border-l-[hsl(var(--success))]",
};

const STATUS_RING: Record<string, string> = {
  pending: "",
  running: "ring-2 ring-[hsl(var(--info))] animate-pulse",
  waiting: "ring-2 ring-[hsl(var(--warning))]",
  branched: "ring-2 ring-[hsl(var(--info))]",
  done: "ring-2 ring-[hsl(var(--success))]",
  skipped: "opacity-50",
  error: "ring-2 ring-[hsl(var(--destructive))]",
};

function AwffNodeView({ data }: NodeProps) {
  const d = data as unknown as AwffNodeData;
  const kindColor = KIND_COLOR[d.kind] ?? "border-l-border";
  const statusRing = STATUS_RING[d.status] ?? "";
  return (
    <div
      className={`min-w-[140px] rounded-md border border-border border-l-4 bg-card px-2 py-1.5 text-xs shadow-sm ${kindColor} ${statusRing}`}
    >
      {d.hasInputs ? <Handle type="target" position={Position.Left} /> : null}
      <div className="font-medium leading-tight">{d.label}</div>
      <div className="text-[10px] text-muted-foreground">{d.kind} · {d.status}</div>
      {d.hasOutputs ? <Handle type="source" position={Position.Right} /> : null}
    </div>
  );
}

const nodeTypes = { awff: AwffNodeView } as const;

function awffNodeToRF(node: AWFFNode, status?: string): RFNode {
  return {
    id: node.id,
    position: node.position,
    data: {
      label: node.name,
      kind: node.kind,
      type: node.type,
      status: status ?? "pending",
      hasInputs: node.inputs.length > 0,
      hasOutputs: node.outputs.length > 0,
    },
    type: "awff",
  };
}

function awffEdgeToRF(edge: AWFFEdge): RFEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    label: edge.label,
  };
}

/** 端口类型兼容矩阵：any 通配；trigger/control 仅与同名匹配；其余按字面 */
function portTypesCompatible(a: PortDataType, b: PortDataType): boolean {
  if (a === "any" || b === "any") return true;
  return a === b;
}

function CanvasInner() {
  const { state, dispatch, setSelectedNodeId, setSelectedEdgeId } = useWorkflow();
  const { snapshot } = useEngine();

  const rfNodes = React.useMemo(
    () =>
      state.awff.nodes.map((n) => awffNodeToRF(n, snapshot.nodeStates[n.id]?.status)),
    [state.awff.nodes, snapshot.nodeStates],
  );
  const rfEdges = React.useMemo(() => state.awff.edges.map(awffEdgeToRF), [state.awff.edges]);

  const onNodesChange = React.useCallback(
    (changes: NodeChange[]) => {
      for (const ch of changes) {
        // P1-3: 节流策略——只在拖动结束（dragging===false）时写 store，
        // 避免拖动中高频 Diff；显式判 false 防止 select-only 事件命中。
        if (ch.type === "position" && ch.position && ch.dragging === false) {
          dispatch({ type: "node-move", nodeId: ch.id, position: ch.position });
        } else if (ch.type === "select") {
          if (ch.selected) setSelectedNodeId(ch.id);
        } else if (ch.type === "remove") {
          dispatch({ type: "node-delete", nodeId: ch.id });
        }
      }
      // P1-2: 删除 forceTick + applyNodeChanges 死代码（rfNodes 已由 useMemo 派生）
    },
    [dispatch, setSelectedNodeId],
  );

  const onConnect: OnConnect = React.useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target || !conn.sourceHandle || !conn.targetHandle) return;
      const src = state.awff.nodes.find((n) => n.id === conn.source);
      const tgt = state.awff.nodes.find((n) => n.id === conn.target);
      if (!src || !tgt) return;
      const srcPort = src.outputs.find((p) => p.id === conn.sourceHandle);
      const tgtPort = tgt.inputs.find((p) => p.id === conn.targetHandle);
      if (!srcPort || !tgtPort) return;
      if (!portTypesCompatible(srcPort.dataType, tgtPort.dataType)) {
        // eslint-disable-next-line no-console
        console.warn("[awff] reject incompatible edge:", srcPort.dataType, "→", tgtPort.dataType);
        return;
      }
      const edge: AWFFEdge = {
        id: `e_${conn.source}_${conn.sourceHandle}__${conn.target}_${conn.targetHandle}_${Date.now()}`,
        source: conn.source,
        target: conn.target,
        sourceHandle: conn.sourceHandle,
        targetHandle: conn.targetHandle,
      };
      dispatch({ type: "edge-add", edge });
    },
    [state.awff.nodes, dispatch],
  );

  const onDragOver = React.useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("application/x-awff-node-type")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = React.useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData("application/x-awff-node-type");
      if (!type) return;
      const decl = getDeclaration(type);
      if (!decl || !decl.enabled) return;
      const bounds = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
      const position = { x: e.clientX - bounds.left, y: e.clientY - bounds.top };
      const id = `${type.split(".").pop()}_${Math.random().toString(36).slice(2, 7)}`;
      const node = newNodeFromDeclaration(decl, id, position);
      dispatch({ type: "node-add", node });
    },
    [dispatch],
  );

  return (
    <div style={flowStyle} onDrop={onDrop} onDragOver={onDragOver}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onNodeClick={(_, n) => setSelectedNodeId(n.id)}
        onEdgeClick={(_, e) => setSelectedEdgeId(e.id)}
        onPaneClick={() => {
          setSelectedNodeId(null);
          setSelectedEdgeId(null);
        }}
        fitView
      >
        <Background />
        <MiniMap zoomable pannable />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export function NodeCanvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
