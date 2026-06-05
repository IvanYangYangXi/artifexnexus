"use client";

/**
 * TableView — 表格直展视图（STORY-0070）
 *
 * 对齐 docs/specs/ui/data-view-structure.md §3.1 Table：
 *   - CSS grid 布局 + sticky header
 *   - 单列排序（click 列头切换 asc → desc → none）
 *   - 双击单元格进入编辑模式
 *   - Enter 提交 / Esc 取消，产出 ANDF Diff
 *
 * 性能（2026-06-05）：
 *   - 行数 > 100 自动启用窗口虚拟化（手写，无 react-window 依赖）
 *   - 固定行高 36px，仅渲染可视区 + overscan，支撑 100w+ 行流畅滚动
 */

import * as React from "react";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import type { Column } from "@artifex-nexus/contracts";

import { DataPageContext, type DiffChange } from "./DataPage";
import { InlineFieldEditor } from "./shared/InlineFieldEditor";
import { uiLog } from "../../lib/ui-log";

type SortDir = "asc" | "desc" | null;

const ROW_HEIGHT = 36;
const HEADER_HEIGHT = 36;
/** 行数超过此阈值启用虚拟化 */
const VIRTUALIZE_THRESHOLD = 100;
/** 上下各预渲染的行数 */
const OVERSCAN = 8;

export function TableView() {
  const { andf, dispatch } = React.useContext(DataPageContext);
  const [sortCol, setSortCol] = React.useState<string | null>(null);
  const [sortDir, setSortDir] = React.useState<SortDir>(null);
  const [editingCell, setEditingCell] = React.useState<{
    row: number;
    col: string;
  } | null>(null);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewportH, setViewportH] = React.useState(600);

  // ─── 监听滚动容器尺寸 ─────────────────────────────────────────────────────
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setViewportH(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!andf) return null;
  const allColumns = andf.columns;
  // 列配置：隐藏列不参与渲染
  const columns = allColumns.filter((c) => c.visible !== false);
  const { rows } = andf;

  // ─── 排序（useMemo 避免重复排序） ────────────────────────────────────────
  const sortedRows = React.useMemo(() => {
    const base = rows.map((row, origIdx) => ({ row, origIdx }));
    if (!sortCol || !sortDir) return base;
    const col = columns.find((c) => c.name === sortCol);
    const sorted = [...base].sort((a, b) => {
      const va = a.row[sortCol];
      const vb = b.row[sortCol];
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      const cmp = col?.type === "number" ? Number(va) - Number(vb) : String(va).localeCompare(String(vb));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [rows, columns, sortCol, sortDir]);

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

  // ─── 编辑 ────────────────────────────────────────────────────────────────

  const startEdit = (rowIdx: number, colName: string) => {
    dispatch({ type: "START_EDIT" });
    setEditingCell({ row: rowIdx, col: colName });
  };

  const commitEdit = (rowIdx: number, colName: string, value: unknown) => {
    const oldValue = andf.rows[rowIdx]?.[colName];
    dispatch({ type: "APPLY_UPDATE", rowIndex: rowIdx, column: colName, value });
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

  // ─── 虚拟化窗口计算 ──────────────────────────────────────────────────────
  const total = sortedRows.length;
  const useVirtual = total > VIRTUALIZE_THRESHOLD;
  const startIdx = useVirtual ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN) : 0;
  const visibleCount = useVirtual
    ? Math.ceil(viewportH / ROW_HEIGHT) + OVERSCAN * 2
    : total;
  const endIdx = useVirtual ? Math.min(total, startIdx + visibleCount) : total;
  const topPad = useVirtual ? startIdx * ROW_HEIGHT : 0;
  const bottomPad = useVirtual ? Math.max(0, (total - endIdx) * ROW_HEIGHT) : 0;

  const SortIcon = sortDir === "asc" ? ArrowUp : sortDir === "desc" ? ArrowDown : ArrowUpDown;

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-auto"
      onScroll={(e) => useVirtual && setScrollTop((e.target as HTMLDivElement).scrollTop)}
    >
      <table className="w-full border-collapse text-sm" style={{ tableLayout: "fixed" }}>
        <thead className="sticky top-0 z-10 bg-background" style={{ height: HEADER_HEIGHT }}>
          <tr className="border-b border-white/[0.06]">
            <th
              className="sticky left-0 z-20 bg-background px-3 py-2 text-left text-xs font-medium text-muted-foreground"
              style={{ width: 56 }}
            >
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
                    <ArrowUpDown className="h-3 w-3 opacity-30" />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {topPad > 0 && (
            <tr style={{ height: topPad }} aria-hidden>
              <td colSpan={columns.length + 1} />
            </tr>
          )}
          {sortedRows.slice(startIdx, endIdx).map(({ row, origIdx }) => (
            <tr
              key={origIdx}
              className="border-b border-white/[0.03] transition-colors hover:bg-white/[0.02]"
              style={{ height: ROW_HEIGHT }}
            >
              <td
                className="sticky left-0 z-10 bg-background px-3 text-xs text-foreground/40"
                style={{ width: 56 }}
              >
                {origIdx}
              </td>
              {columns.map((col) => {
                const cellValue = row[col.name];
                const isEditing =
                  editingCell?.row === origIdx && editingCell?.col === col.name;

                return (
                  <td
                    key={col.name}
                    className="px-3 text-xs text-foreground truncate"
                    style={{ maxWidth: 200 }}
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
          {bottomPad > 0 && (
            <tr style={{ height: bottomPad }} aria-hidden>
              <td colSpan={columns.length + 1} />
            </tr>
          )}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
          无数据
        </div>
      )}
      {useVirtual && (
        <div className="pointer-events-none sticky bottom-2 right-2 ml-auto w-fit rounded bg-background/80 px-2 py-0.5 text-[10px] text-foreground/50">
          虚拟化 · 显示 {startIdx + 1}-{endIdx} / 共 {total}
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
