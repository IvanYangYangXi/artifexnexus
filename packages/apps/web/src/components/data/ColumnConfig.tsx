"use client";

/**
 * ColumnConfig — C2 列配置面板
 *
 * 对齐 docs/specs/ui/data-view-structure.md §3.1：
 *   - 列勾选 visible（☑ / ☐）
 *   - 列类型展示（只读标签）
 *   - 类型覆盖下拉（STORY-0070 实现）
 *
 * STORY-0069 阶段：显示列名 + 类型 + 可见性勾选（基础版）
 */

import * as React from "react";
import { Columns3 } from "lucide-react";
import { ScrollArea } from "@artifex-nexus/ui";
import type { Column } from "@artifex-nexus/contracts";

import { DataPageContext } from "./DataPage";

export function ColumnConfig() {
  const { andf } = React.useContext(DataPageContext);

  if (!andf) return null;

  const columns = andf.columns;

  return (
    <div className="flex w-[200px] shrink-0 flex-col border-r border-white/[0.06] bg-white/[0.01]">
      {/* 标题 */}
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <Columns3 className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">列配置</span>
        <span className="ml-auto rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {columns.length}
        </span>
      </div>

      {/* 列列表 */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-0.5 p-2">
          {columns.map((col: Column) => (
            <label
              key={col.name}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-white/[0.04]"
            >
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-white/[0.12] bg-white/[0.04] accent-primary"
                defaultChecked={col.visible !== false}
                disabled
              />
              <span className="flex-1 truncate text-foreground">
                {col.name}
              </span>
              <span className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {col.type}
              </span>
            </label>
          ))}
        </div>
      </ScrollArea>

      {/* 分隔 + 列类型说明 */}
      <div className="border-t border-white/[0.06] px-3 py-2">
        <div className="text-[10px] text-muted-foreground/60">
          列类型显示为推断结果，
          <br />
          覆盖功能将在后续版本实现。
        </div>
      </div>
    </div>
  );
}
