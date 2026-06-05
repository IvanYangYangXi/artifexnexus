"use client";

/**
 * WorkflowPage — M11 工作流模块根入口
 *
 * 布局：
 *   ┌─────────────────────────────────────────────────────┐
 *   │ Toolbar (C1)                                         │
 *   ├──────────┬──────────────────────────────┬───────────┤
 *   │ Palette  │ NodeCanvas (C3)              │ Inspector │
 *   │ (C2)     │                              │ (C5)      │
 *   ├──────────┴──────────────────────────────┴───────────┤
 *   │ SummaryBar (C4)                                      │
 *   └─────────────────────────────────────────────────────┘
 */

import * as React from "react";
import { WorkflowProvider } from "./workflow-store";
import { EngineProvider } from "./engine-context";
import { WorkflowToolbar } from "./WorkflowToolbar";
import { NodePalette } from "./NodePalette";
import { NodeCanvas } from "./NodeCanvas";
import { WorkflowInspector } from "./WorkflowInspector";
import { SummaryBar } from "./SummaryBar";

export function WorkflowPage() {
  return (
    <WorkflowProvider>
      <EngineProvider>
        <div className="flex h-full w-full flex-col overflow-hidden">
          <WorkflowToolbar />
          <div className="flex min-h-0 flex-1">
            <div className="w-56 shrink-0 border-r border-border">
              <NodePalette />
            </div>
            <div className="min-w-0 flex-1">
              <NodeCanvas />
            </div>
            <div className="w-80 shrink-0 border-l border-border">
              <WorkflowInspector />
            </div>
          </div>
          <SummaryBar />
        </div>
      </EngineProvider>
    </WorkflowProvider>
  );
}
