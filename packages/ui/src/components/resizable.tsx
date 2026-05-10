"use client";

/**
 * Resizable — 可拖拽分隔（基于 react-resizable-panels）
 * Resizable panels based on react-resizable-panels
 *
 * 对齐 docs/specs/ui/component-inventory.md §4
 * 主要场景：A/B/C/D 四区横向比例（B 200px / C flex / D 320px）；
 *           D 区内部 D1–D5 多个面板纵向比例。
 *
 * 使用方式：
 *   <ResizablePanelGroup direction="horizontal">
 *     <ResizablePanel defaultSize={20} minSize={10}>B 导航</ResizablePanel>
 *     <ResizableHandle withHandle />
 *     <ResizablePanel defaultSize={60}>C 内容</ResizablePanel>
 *     <ResizableHandle withHandle />
 *     <ResizablePanel defaultSize={20}>D 面板</ResizablePanel>
 *   </ResizablePanelGroup>
 */
import * as React from "react";
import { GripVertical } from "lucide-react";
import * as ResizablePrimitive from "react-resizable-panels";

import { cn } from "../lib/cn";

const ResizablePanelGroup = ({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelGroup>) => (
  <ResizablePrimitive.PanelGroup
    className={cn(
      "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
      className,
    )}
    {...props}
  />
);

const ResizablePanel = ResizablePrimitive.Panel;

const ResizableHandle = ({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle> & {
  withHandle?: boolean;
}) => (
  <ResizablePrimitive.PanelResizeHandle
    className={cn(
      "relative flex w-px items-center justify-center bg-border",
      "after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2",
      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1",
      "data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full",
      "data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:-translate-y-1/2 data-[panel-group-direction=vertical]:after:translate-x-0",
      "[&[data-panel-group-direction=vertical]>div]:rotate-90",
      className,
    )}
    {...props}
  >
    {withHandle && (
      <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border">
        <GripVertical className="h-2.5 w-2.5" />
      </div>
    )}
  </ResizablePrimitive.PanelResizeHandle>
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
