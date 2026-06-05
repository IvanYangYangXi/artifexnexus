"use client";

/**
 * NodePalette — 左侧节点面板，按 kind 分组渲染可拖入节点。
 *
 * 拖动机制：HTML5 DataTransfer，dataType = `application/x-awff-node-type`。
 * NodeCanvas 监听 onDrop 创建新节点。
 */

import * as React from "react";
import { cn } from "@artifex-nexus/ui";
import { NODE_DECLARATIONS, type NodeDeclaration } from "../../features/workflow/node-registry";

const KIND_LABELS: Record<NodeDeclaration["kind"], string> = {
  trigger: "触发器",
  tool: "工具",
  skill: "技能",
  "ai-chat": "AI 对话",
  user: "用户",
  control: "流程控制",
  data: "数据",
  script: "脚本",
  output: "输出",
};

const KIND_ORDER: NodeDeclaration["kind"][] = [
  "trigger",
  "tool",
  "skill",
  "ai-chat",
  "user",
  "control",
  "data",
  "script",
  "output",
];

export function NodePalette() {
  const grouped = React.useMemo(() => {
    const m = new Map<NodeDeclaration["kind"], NodeDeclaration[]>();
    for (const k of KIND_ORDER) m.set(k, []);
    for (const d of NODE_DECLARATIONS) {
      m.get(d.kind)!.push(d);
    }
    return m;
  }, []);

  return (
    <div className="flex h-full w-full flex-col overflow-auto bg-card text-card-foreground">
      <div className="border-b border-border px-3 py-2 text-xs font-semibold text-muted-foreground">
        节点库
      </div>
      <div className="flex-1 space-y-3 p-2">
        {KIND_ORDER.map((kind) => {
          const items = grouped.get(kind) ?? [];
          if (items.length === 0) return null;
          return (
            <div key={kind} className="space-y-1">
              <div className="px-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                {KIND_LABELS[kind]}
              </div>
              {items.map((decl) => (
                <PaletteItem key={decl.type} decl={decl} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PaletteItem({ decl }: { decl: NodeDeclaration }) {
  const onDragStart = React.useCallback(
    (e: React.DragEvent<HTMLButtonElement>) => {
      if (!decl.enabled) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData("application/x-awff-node-type", decl.type);
      e.dataTransfer.effectAllowed = "move";
    },
    [decl],
  );

  return (
    <button
      type="button"
      draggable={decl.enabled}
      onDragStart={onDragStart}
      title={decl.disabledReason ?? decl.description}
      className={cn(
        "w-full rounded-md border border-border bg-background px-2 py-1.5 text-left text-xs",
        decl.enabled
          ? "cursor-grab hover:bg-accent hover:text-accent-foreground"
          : "cursor-not-allowed opacity-50",
      )}
    >
      <div className="font-medium">{decl.label}</div>
      <div className="line-clamp-1 text-[10px] text-muted-foreground">{decl.description}</div>
    </button>
  );
}
