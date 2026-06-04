"use client";

/**
 * TableView — 表格直展视图（STORY-0070）
 *
 * 对齐 docs/specs/ui/data-view-structure.md §3.1 Table：
 *   - CSS grid 布局 + sticky header
 *   - 单列排序（click 列头切换 asc → desc → none）
 *   - 双击单元格进入编辑模式
 *   - Enter 提交 / Esc 取消，产出 ANDF Diff
 */

import * as React from "react";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import type { Column } from "@artifex-nexus/contracts";

import { DataPageContext, type DiffChange } from "./DataPage";
import { InlineFieldEditor } from "./shared/InlineFieldEditor";
import { uiLog } from "../../lib/ui-log";

type SortDir = "asc" | "desc" | null;

export function TableView() {
  const { andf, dispatch } = React.useContext(DataPageContext);
  const [sortCol, setSortCol] = React.useState<string | null>(null);
  const [sortDir, setSortDir] = React.useState<SortDir>(null);
  const [editingCell, setEditingCell] = React.useState<{
    row: number;
    col: string;
  } | null>(null);

  if (!andf) return null;
  const { columns, rows } = andf;

  // ─── 排序 ────────────────────────────────────────────────────────────────

  const handleSort = (colName: string) => {
    if (sortCol === colName) {
      const next: SortDir = sortDir === "asc" ? "desc" : sortDir === "desc" ? null : "asc";
      setSortDir(next);
      if (next === null) setSortCol(null);
    } else {
      setSortCol(colName);
      setSortDir("asc");
    }
  };

  let sortedRows: Array<{ row: Record<string, unknown>; origIdx: number }> =
    rows.map((row, origIdx) => ({ row, origIdx }));
  if (sortCol && sortDir) {
    const col = columns.find((c) => c.name === sortCol);
    sortedRows = [...sortedRows].sort((a, b) => {
      const va = a.row[sortCol];
      const vb = b.row[sortCol];
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      const cmp = col?.type === "number" ? Number(va) - Number(vb) : String(va).localeCompare(String(vb));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }

  // ─── 编辑 ────────────────────────────────────────────────────────────────

  const startEdit = (rowIdx: number, colName: string) => {
    dispatch({ type: "START_EDIT" });
    setEditingCell({ row: rowIdx, col: colName });
  };

  const commitEdit = (rowIdx: number, colName: string, value: unknown) => {
    const oldValue = andf.rows[rowIdx]?.[colName];
    // 先应用更新
    dispatch({ type: "APPLY_UPDATE", rowIndex: rowIdx, column: colName, value });
    // 再入队 Diff
    const change: DiffChange = { op: "update", row: rowIdx, column: colName, value };
    dispatch({ type: "ADD_DIFF", change });
    dispatch({ type: "CANCEL_EDIT" });
    setEditingCell(null);
    uiLog.custom("TableView", "cellEdit", { row: rowIdx, col: colName, old: oldValue, new: value });
  };

  const cancelEdit = () => {
    dispatch({ type: "CANCEL_EDIT" });
    setEditingCell(null);
  };

  // ─── 渲染 ────────────────────────────────────────────────────────────────

  const SortIcon = sortDir === "asc" ? ArrowUp : sortDir === "desc" ? ArrowDown : ArrowUpDown;

  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-background">
          <tr className="border-b border-white/[0.06]">
            <th className="sticky left-0 z-20 bg-background px-3 py-2 text-left text-xs font-medium text-muted-foreground w-12">
              #
            </th>
            {columns.map((col) => (
              <th
                key={col.name}
                className="cursor-pointer select-none px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => handleSort(col.name)}
              >
                <span className="inline-flex items-center gap-1">
                  {col.name}
                  {sortCol === col.name ? (
                    <SortIcon className="h-3 w-3 text-primary" />
                  ) : (
                    <ArrowUpDown className="h-3 w-3 opacity-0 group-hover:opacity-30" />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map(({ row, origIdx }) => (
            <tr
              key={origIdx}
              className="border-b border-white/[0.03] transition-colors hover:bg-white/[0.02]"
            >
              <td className="sticky left-0 z-10 bg-background px-3 py-2 text-xs text-muted-foreground/50">
                {origIdx}
              </td>
              {columns.map((col) => {
                const cellValue = row[col.name];
                const isEditing =
                  editingCell?.row === origIdx && editingCell?.col === col.name;

                return (
                  <td
                    key={col.name}
                    className="px-3 py-2 text-xs text-foreground max-w-[200px] truncate"
                    onDoubleClick={() => {
                      if (col.type !== "boolean") startEdit(origIdx, col.name);
                    }}
                  >
                    {isEditing ? (
                      <InlineFieldEditor
                        type={col.type}
                        value={cellValue}
                        onChange={(v) => commitEdit(origIdx, col.name, v)}
                        onCancel={cancelEdit}
                      />
                    ) : (
                      <span className="cursor-default">
                        {formatCell(cellValue, col)}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
          无数据
        </div>
      )}
    </div>
  );
}

// ─── 辅助 ──────────────────────────────────────────────────────────────────

function formatCell(value: unknown, _col: Column): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "✓" : "✗";
  return String(value);
}
