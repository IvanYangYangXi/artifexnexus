"use client";

/**
 * WorkflowToolbar — C1 顶部工具栏
 *  - 工作流名称（只读，编辑在 Inspector.meta）
 *  - 运行 / 暂停 / 终止
 *  - 导出 AWFF / 导出 Diff
 *  - 导入 AWFF（覆盖当前画布）
 */

import * as React from "react";
import { Button, Input } from "@artifex-nexus/ui";
import { Pause, Play, Square, Download, Upload, FileJson } from "lucide-react";

import { useWorkflow } from "./workflow-store";
import { useEngine } from "./engine-context";
import type { AWFF } from "../../features/workflow/types";

function downloadJSON(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function WorkflowToolbar() {
  const { state, dispatch } = useWorkflow();
  const { run, pause, terminate, isRunning, snapshot } = useEngine();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const onImport = (f: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const awff = JSON.parse(String(reader.result)) as AWFF;
        dispatch({ type: "import", awff });
      } catch {
        // ignore
      }
    };
    reader.readAsText(f);
  };

  const isWaiting = !!snapshot.waitingNodeId;
  const isError = snapshot.workflowStatus === "error";

  return (
    <div className="flex h-10 items-center gap-2 border-b border-border bg-card px-3 text-xs">
      <Input
        value={state.awff.meta.name}
        onChange={(e) => dispatch({ type: "meta-update", patch: { name: e.target.value } })}
        className="h-7 max-w-xs text-xs"
      />
      <div className="flex-1" />
      <Button size="sm" variant="default" onClick={run} disabled={isRunning && !isWaiting}>
        <Play className="mr-1 h-3 w-3" /> 运行
      </Button>
      <Button size="sm" variant="secondary" onClick={pause} disabled={!isRunning || isWaiting}>
        <Pause className="mr-1 h-3 w-3" /> 暂停
      </Button>
      <Button size="sm" variant="destructive" onClick={terminate} disabled={!isRunning && !isWaiting}>
        <Square className="mr-1 h-3 w-3" /> 终止
      </Button>
      <div className="mx-2 h-4 w-px bg-border" />
      <Button
        size="sm"
        variant="ghost"
        onClick={() => downloadJSON(`${state.awff.meta.name || "workflow"}.awff.json`, state.awff)}
      >
        <Download className="mr-1 h-3 w-3" /> 导出
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => downloadJSON(`${state.awff.meta.name || "workflow"}.diff.json`, state.diffs)}
      >
        <FileJson className="mr-1 h-3 w-3" /> Diff
      </Button>
      <Button size="sm" variant="ghost" onClick={() => fileInputRef.current?.click()}>
        <Upload className="mr-1 h-3 w-3" /> 导入
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImport(f);
          e.target.value = "";
        }}
      />
      <div className="ml-2 text-muted-foreground">
        状态：{snapshot.workflowStatus}
        {isError ? " · 见运行时面板" : ""}
      </div>
    </div>
  );
}
