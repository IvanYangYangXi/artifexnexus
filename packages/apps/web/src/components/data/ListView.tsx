"use client";

/**
 * ListView — 列表直展视图（STORY-0070）
 *
 * 槽位：primary / secondary / thumbnail / badge + 最多 3 个扩展字段
 * 点击字段进入编辑模式，失焦/Enter 提交，Esc 取消，产出 Diff。
 */

import * as React from "react";
import type { Column } from "@artifex-nexus/contracts";

import { DataPageContext, type DiffChange } from "./DataPage";
import { mapColumnsToSlots } from "./shared/slot-mapping";
import { InlineFieldEditor } from "./shared/InlineFieldEditor";
import { useProgressiveRender } from "./shared/use-progressive-render";
import { uiLog } from "../../lib/ui-log";

type EditingField = { row: number; field: string } | null;

export function ListView() {
  const { andf, dispatch } = React.useContext(DataPageContext);
  const [editing, setEditing] = React.useState<EditingField>(null);

  if (!andf) return null;

  const slots = mapColumnsToSlots("list", andf.columns as Column[]);
  const primaryField = slots.find((s) => s.name === "primary")?.field;
  const secondaryField = slots.find((s) => s.name === "secondary")?.field;
  const thumbnailField = slots.find((s) => s.name === "thumbnail")?.field;
  const badgeField = slots.find((s) => s.name === "badge")?.field;

  const colMap = new Map(andf.columns.map((c) => [c.name, c]));

  const startEdit = (rowIdx: number, field: string) => {
    dispatch({ type: "START_EDIT" });
    setEditing({ row: rowIdx, field });
  };

  const commit = (rowIdx: number, field: string, value: unknown) => {
    dispatch({ type: "APPLY_UPDATE", rowIndex: rowIdx, column: field, value });
    const change: DiffChange = { op: "update", row: rowIdx, column: field, value };
    dispatch({ type: "ADD_DIFF", change });
    dispatch({ type: "CANCEL_EDIT" });
    setEditing(null);
    uiLog.custom("ListView", "fieldEdit", { row: rowIdx, field });
  };

  const cancel = () => {
    dispatch({ type: "CANCEL_EDIT" });
    setEditing(null);
  };

  const colType = (f: string | null | undefined) => colMap.get(f ?? "")?.type ?? "string";

  const { visibleCount, sentinelRef, hasMore } = useProgressiveRender(andf.rows.length, {
    initialChunk: 200,
    chunk: 200,
  });

  return (
    <div className="flex flex-col gap-0.5 p-2">
      {andf.rows.slice(0, visibleCount).map((row, rowIdx) => {
        const primary = primaryField ? row[primaryField] : undefined;
        const secondary = secondaryField ? row[secondaryField] : undefined;
        const thumb = thumbnailField ? row[thumbnailField] : undefined;
        const badge = badgeField ? row[badgeField] : undefined;

        return (
          <div
            key={rowIdx}
            className="flex items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-white/[0.03]"
          >
            {/* 缩略图 */}
            {typeof thumb === "string" && thumb.startsWith("http") && (
              <img
                src={thumb}
                alt=""
                className="h-8 w-8 shrink-0 rounded object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            )}

            {/* 主文本 */}
            <div className="min-w-0 flex-1">
              {primaryField && (
                <ListField
                  value={row[primaryField]}
                  type={colType(primaryField)}
                  editing={editing?.row === rowIdx && editing?.field === primaryField}
                  onStartEdit={() => startEdit(rowIdx, primaryField)}
                  onChange={(v) => commit(rowIdx, primaryField, v)}
                  onCancel={cancel}
                  className="text-sm font-medium text-foreground truncate"
                />
              )}
              {secondaryField && row[secondaryField] != null && (
                <ListField
                  value={row[secondaryField]}
                  type={colType(secondaryField)}
                  editing={editing?.row === rowIdx && editing?.field === secondaryField}
                  onStartEdit={() => startEdit(rowIdx, secondaryField)}
                  onChange={(v) => commit(rowIdx, secondaryField, v)}
                  onCancel={cancel}
                  className="text-xs text-foreground/70 truncate"
                />
              )}
            </div>

            {/* 徽标 */}
            {badgeField && row[badgeField] != null && (
              <ListField
                value={row[badgeField]}
                type={colType(badgeField)}
                editing={editing?.row === rowIdx && editing?.field === badgeField}
                onStartEdit={() => startEdit(rowIdx, badgeField)}
                onChange={(v) => commit(rowIdx, badgeField, v)}
                onCancel={cancel}
                className="rounded bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-foreground/80 shrink-0"
              />
            )}

            {/* 扩展字段 */}
            {slots
              .filter((s) => s.name.startsWith("extra_"))
              .map((s) => {
                const val = row[s.field!];
                if (val === null || val === undefined) return null;
                return (
                  <ListField
                    key={s.name}
                    value={val}
                    type={colType(s.field)}
                    editing={editing?.row === rowIdx && editing?.field === s.field}
                    onStartEdit={() => startEdit(rowIdx, s.field!)}
                    onChange={(v) => commit(rowIdx, s.field!, v)}
                    onCancel={cancel}
                    className="text-[10px] text-foreground/60 shrink-0"
                  />
                );
              })}
          </div>
        );
      })}
      {andf.rows.length === 0 && (
        <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
          无数据
        </div>
      )}
      {hasMore && (
        <div ref={sentinelRef} className="flex items-center justify-center py-3 text-[10px] text-foreground/40">
          加载中… ({visibleCount} / {andf.rows.length})
        </div>
      )}
    </div>
  );
}

// ─── 辅助 ──────────────────────────────────────────────────────────────────

function ListField({
  value,
  type,
  editing,
  onStartEdit,
  onChange,
  onCancel,
  className,
}: {
  value: unknown;
  type: string;
  editing: boolean;
  onStartEdit: () => void;
  onChange: (v: unknown) => void;
  onCancel: () => void;
  className: string;
}) {
  if (editing) {
    return (
      <div className="flex-1">
        <InlineFieldEditor
          type={type}
          value={value}
          onChange={onChange}
          onCancel={onCancel}
          clickOutside
        />
      </div>
    );
  }

  const display: string = value === null || value === undefined ? "" : String(value);
  return (
    <div className={className} onClick={onStartEdit} title="点击编辑">
      {display}
    </div>
  );
}
