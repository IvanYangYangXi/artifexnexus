"use client";

/**
 * SummaryBar — C4 底部摘要：节点 / 边 / 状态计数
 */

import * as React from "react";
import { useWorkflow } from "./workflow-store";
import { useEngine } from "./engine-context";

export function SummaryBar() {
  const { state } = useWorkflow();
  const { snapshot } = useEngine();
  const counts = React.useMemo(() => {
    const c = { pending: 0, running: 0, waiting: 0, branched: 0, done: 0, skipped: 0, error: 0 };
    // P2-6: 显式 switch，避免 keyof typeof unsafe cast
    for (const s of Object.values(snapshot.nodeStates)) {
      switch (s.status) {
        case "pending":
          c.pending++;
          break;
        case "running":
          c.running++;
          break;
        case "waiting":
          c.waiting++;
          break;
        case "branched":
          c.branched++;
          break;
        case "done":
          c.done++;
          break;
        case "skipped":
          c.skipped++;
          break;
        case "error":
          c.error++;
          break;
      }
    }
    return c;
  }, [snapshot.nodeStates]);

  return (
    <div className="flex h-8 items-center gap-3 border-t border-border bg-card px-3 text-[11px] text-muted-foreground">
      <span>节点 {state.awff.nodes.length}</span>
      <span>边 {state.awff.edges.length}</span>
      <span>变量 {state.awff.variables?.length ?? 0}</span>
      <div className="flex-1" />
      <span>状态：</span>
      <span>pending {counts.pending}</span>
      <span>running {counts.running}</span>
      <span>waiting {counts.waiting}</span>
      <span>done {counts.done}</span>
      <span>error {counts.error}</span>
      <span>skipped {counts.skipped}</span>
    </div>
  );
}
