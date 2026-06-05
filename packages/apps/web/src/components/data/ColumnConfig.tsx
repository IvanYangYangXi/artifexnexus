"use client";

/**
 * ColumnConfig — C2 列配置面板
 *
 * 对齐 docs/specs/ui/data-view-structure.md §3.1：
 *   - 列可见性勾选（☑ / ☐，真实生效）
 *   - 列类型展示（含覆盖下拉：string / number / boolean / datetime / url）
 *   - 全选 / 反选
 *
 * 状态通过 DataPage dispatch 写回 andf，确保所有视图响应变化。
 */

import * as React from "react";
import { Columns3 } from "lucide-react";
import { ScrollArea } from "@artifex-nexus/ui";
import type { Column } from "@artifex-nexus/contracts";

import { DataPageContext } from "./DataPage";
import { uiLog } from "../../lib/ui-log";

const TYPE_OPTIONS: Column["type"][] = ["string", "number", "boolean", "datetime", "url"];

export function ColumnConfig() {
  const { andf, dispatch } = React.useContext(DataPageContext);

  if (!andf) return null;

  const columns = andf.columns;
  const visibleCount = columns.filter((c) => c.visible !== false).length;

  const toggleVisible = (name: string, next: boolean) => {
    dispatch({ type: "PATCH_COLUMN", name, patch: { visible: next } });
    uiLog.custom("ColumnConfig", "toggleVisible", { name, visible: next });
  };

  const changeType = (name: string, type: Column["type"]) => {
    dispatch({ type: "PATCH_COLUMN", name, patch: { type } });
    uiLog.custom("ColumnConfig", "changeType", { name, type });
  };

  const toggleAll = (next: boolean) => {
    for (const c of columns) {
      dispatch({ type: "PATCH_COLUMN", name: c.name, patch: { visible: next } });
    }
  };

  return (
    <div className="flex w-[220px] shrink-0 flex-col border-r border-white/[0.06] bg-white/[0.01]">
      {/* 标题 */}
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <Columns3 className="h-3.5 w-3.5 text-foreground/70" />
        <span className="text-xs font-medium text-foreground">列配置</span>
        <span className="ml-auto rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-foreground/70">
          {visibleCount}/{columns.length}
        </span>
      </div>

      {/* 全选 / 反选 */}
      <div className="flex items-center gap-1 border-b border-white/[0.04] px-3 py-1.5">
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[10px] text-foreground/70 hover:bg-white/[0.06] hover:text-foreground"
          onClick={() => toggleAll(true)}
        >
          全选
        </button>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[10px] text-foreground/70 hover:bg-white/[0.06] hover:text-foreground"
          onClick={() => toggleAll(false)}
        >
          全不选
        </button>
      </div>

      {/* 列列表 */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-0.5 p-2">
          {columns.map((col: Column) => {
            const isVisible = col.visible !== false;
            return (
              <div
                key={col.name}
                className="flex flex-col gap-1 rounded-md px-2 py-1.5 transition-colors hover:bg-white/[0.04]"
              >
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 cursor-pointer rounded border-white/[0.12] bg-white/[0.04] accent-primary"
                    checked={isVisible}
                    onChange={(e) => toggleVisible(col.name, e.target.checked)}
                  />
                  <span className={`flex-1 truncate ${isVisible ? "text-foreground" : "text-foreground/40 line-through"}`}>
                    {col.name}
                  </span>
                </label>
                <select
                  value={col.type}
                  onChange={(e) => changeType(col.name, e.target.value as Column["type"])}
                  className="h-5 w-full rounded border border-white/[0.06] bg-white/[0.02] px-1 text-[10px] text-foreground/80 focus:border-primary/40 focus:outline-none"
                >
                  {TYPE_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* 底部说明 */}
      <div className="border-t border-white/[0.06] px-3 py-2">
        <div className="text-[10px] text-foreground/55">
          勾选控制视图显示与字段映射候选；类型可手动覆盖推断结果。
        </div>
      </div>
    </div>
  );
}
