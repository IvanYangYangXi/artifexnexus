"use client";

/**
 * Inspector 分页 —— 通过 @artifex-nexus/ui 的 InspectorPanel 渲染
 */

import * as React from "react";
import { Button, Input, InspectorPanel, Textarea, type InspectorTab } from "@artifex-nexus/ui";

import { useWorkflow } from "./workflow-store";
import { useEngine } from "./engine-context";

function NodeInspector() {
  const { state, dispatch, selectedNodeId } = useWorkflow();
  const node = state.awff.nodes.find((n) => n.id === selectedNodeId);
  // P0-3: JSON 编辑器形状校验 + 错误提示
  const [draft, setDraft] = React.useState<string>("");
  const [jsonError, setJsonError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDraft(JSON.stringify(node?.config ?? {}, null, 2));
    setJsonError(null);
  }, [node?.id, node?.config]);

  if (!node) return <div className="text-muted-foreground">未选中节点。</div>;

  const onConfigChange = (text: string) => {
    setDraft(text);
    try {
      const cfg = JSON.parse(text);
      if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) {
        setJsonError("配置必须是 JSON 对象（不能是数组 / 字符串 / 数字）");
        return;
      }
      setJsonError(null);
      dispatch({ type: "node-update", nodeId: node.id, patch: { config: cfg } });
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : "JSON 解析失败");
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-muted-foreground">名称</label>
        <Input
          value={node.name}
          onChange={(e) => dispatch({ type: "node-update", nodeId: node.id, patch: { name: e.target.value } })}
        />
      </div>
      <div>
        <label className="text-xs text-muted-foreground">类型</label>
        <Input value={node.type} disabled />
      </div>
      <div>
        <label className="text-xs text-muted-foreground">配置（JSON）</label>
        <Textarea rows={6} value={draft} onChange={(e) => onConfigChange(e.target.value)} />
        {jsonError ? (
          <div className="mt-1 text-[11px] text-destructive">{jsonError}</div>
        ) : null}
      </div>
      <Button variant="destructive" size="sm" onClick={() => dispatch({ type: "node-delete", nodeId: node.id })}>
        删除节点
      </Button>
    </div>
  );
}

function EdgeInspector() {
  const { state, dispatch, selectedEdgeId } = useWorkflow();
  const edge = state.awff.edges.find((e) => e.id === selectedEdgeId);
  if (!edge) return <div className="text-muted-foreground">未选中连线。</div>;
  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        {edge.source}.{edge.sourceHandle} → {edge.target}.{edge.targetHandle}
      </div>
      <div>
        <label className="text-xs text-muted-foreground">标签（用于分支）</label>
        <Input
          value={edge.label ?? ""}
          onChange={(ev) =>
            // P0-2: 用 edge-update 而不是 edge-add，避免复制 edge
            dispatch({ type: "edge-update", edgeId: edge.id, patch: { label: ev.target.value } })
          }
        />
      </div>
      <Button variant="destructive" size="sm" onClick={() => dispatch({ type: "edge-delete", edgeId: edge.id })}>
        删除连线
      </Button>
    </div>
  );
}

function MetaInspector() {
  const { state, dispatch } = useWorkflow();
  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-muted-foreground">工作流名称</label>
        <Input
          value={state.awff.meta.name}
          onChange={(e) => dispatch({ type: "meta-update", patch: { name: e.target.value } })}
        />
      </div>
      <div>
        <label className="text-xs text-muted-foreground">描述</label>
        <Textarea
          rows={3}
          value={state.awff.meta.description ?? ""}
          onChange={(e) => dispatch({ type: "meta-update", patch: { description: e.target.value } })}
        />
      </div>
      <div className="text-xs text-muted-foreground">
        schemaVersion: {state.awff.meta.schemaVersion} · {state.awff.nodes.length} 节点 · {state.awff.edges.length} 边
      </div>
    </div>
  );
}

function RuntimePanelContent() {
  const { snapshot, resume } = useEngine();
  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">工作流状态：{snapshot.workflowStatus}</div>
      {snapshot.currentNodeId ? (
        <div className="text-xs">当前节点：{snapshot.currentNodeId}</div>
      ) : null}
      {snapshot.waitingNodeId ? (
        <div className="space-y-2 rounded-md border border-border bg-background p-2">
          <div className="text-xs text-muted-foreground">等待用户输入：{snapshot.waitingNodeId}</div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => resume({ outputs: { selected: "Yes" } })}>
              提交（mock: Yes）
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => resume({ outputs: { selected: "No" }, selectedBranch: "false" })}
            >
              提交（mock: No）
            </Button>
          </div>
        </div>
      ) : null}
      <div className="space-y-1">
        {Object.entries(snapshot.nodeStates).map(([id, st]) => (
          <div key={id} className="flex justify-between text-xs">
            <span>{id}</span>
            <span className="text-muted-foreground">
              {st.status}
              {st.error ? ` · ${st.error}` : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function WorkflowInspector() {
  const tabs: InspectorTab[] = [
    { id: "node", label: "节点", content: <NodeInspector /> },
    { id: "edge", label: "连线", content: <EdgeInspector /> },
    { id: "meta", label: "元数据", content: <MetaInspector /> },
    { id: "runtime", label: "运行时", content: <RuntimePanelContent /> },
  ];
  return <InspectorPanel tabs={tabs} defaultActiveId="node" />;
}
