"use client";

/**
 * CardView — 卡片直展视图（STORY-0070）
 *
 * 槽位：title / subtitle / image / description / tags + 最多 3 个扩展字段
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

export function CardView() {
  const { andf, dispatch } = React.useContext(DataPageContext);
  const [editing, setEditing] = React.useState<EditingField>(null);

  if (!andf) return null;

  const slots = mapColumnsToSlots("card", andf.columns as Column[]);
  const titleField = slots.find((s) => s.name === "title")?.field;
  const subtitleField = slots.find((s) => s.name === "subtitle")?.field;
  const imageField = slots.find((s) => s.name === "image")?.field;
  const descField = slots.find((s) => s.name === "description")?.field;
  const tagsField = slots.find((s) => s.name === "tags")?.field;

  const colMap = new Map(andf.columns.map((c) => [c.name, c]));

  const startEdit = (rowIdx: number, field: string) => {
    dispatch({ type: "START_EDIT" });
    setEditing({ row: rowIdx, field });
  };

  const commitEdit = (rowIdx: number, field: string, value: unknown) => {
    dispatch({ type: "APPLY_UPDATE", rowIndex: rowIdx, column: field, value });
    const change: DiffChange = { op: "update", row: rowIdx, column: field, value };
    dispatch({ type: "ADD_DIFF", change });
    dispatch({ type: "CANCEL_EDIT" });
    setEditing(null);
    uiLog.custom("CardView", "fieldEdit", { row: rowIdx, field });
  };

  const cancelEdit = () => {
    dispatch({ type: "CANCEL_EDIT" });
    setEditing(null);
  };

  const { visibleCount, sentinelRef, hasMore } = useProgressiveRender(andf.rows.length, {
    initialChunk: 120,
    chunk: 120,
  });

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4 p-4">
      {andf.rows.slice(0, visibleCount).map((row, rowIdx) => {
        const title = titleField ? String(row[titleField] ?? "") : undefined;
        const subtitle = subtitleField ? String(row[subtitleField] ?? "") : undefined;
        const image = imageField ? row[imageField] : undefined;
        const desc = descField ? String(row[descField] ?? "") : undefined;
        const tags = tagsField ? String(row[tagsField as string] ?? "").split(/[,;]/) : [];
        const colType = (f: string | null | undefined) => colMap.get(f ?? "")?.type ?? "string";

        return (
          <div
            key={rowIdx}
            className="flex flex-col gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.04]"
          >
            {/* 图片 */}
            {typeof image === "string" && image.startsWith("http") && (
              <div className="mb-1 overflow-hidden rounded-md">
                <img
                  src={image}
                  alt=""
                  className="h-32 w-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              </div>
            )}

            {/* 标题 */}
            {titleField != null ? (
              <EditableField
                label=""
                value={String(row[titleField] ?? "")}
                type={colType(titleField)}
                editing={editing?.row === rowIdx && editing?.field === titleField}
                onStartEdit={() => startEdit(rowIdx, titleField)}
                onChange={(v) => commitEdit(rowIdx, titleField, v)}
                onCancel={cancelEdit}
                className="text-sm font-semibold text-foreground"
              />
            ) : null}

            {/* 副标题 */}
            {subtitleField && row[subtitleField] != null && (
              <EditableField
                label=""
                value={row[subtitleField] as string | number | boolean | null}
                type={colType(subtitleField)}
                editing={editing?.row === rowIdx && editing?.field === subtitleField}
                onStartEdit={() => startEdit(rowIdx, subtitleField)}
                onChange={(v) => commitEdit(rowIdx, subtitleField, v)}
                onCancel={cancelEdit}
                className="text-xs text-foreground/70"
              />
            )}

            {/* 描述 */}
            {descField && row[descField] != null && (
              <EditableField
                label=""
                value={row[descField] as string | number | boolean | null}
                type={colType(descField)}
                editing={editing?.row === rowIdx && editing?.field === descField}
                onStartEdit={() => startEdit(rowIdx, descField)}
                onChange={(v) => commitEdit(rowIdx, descField, v)}
                onCancel={cancelEdit}
                className="text-xs text-foreground/65 line-clamp-2"
              />
            )}

            {/* 标签 */}
            {tags.length > 0 && tags[0] !== "" && (
              <div className="mt-1 flex flex-wrap gap-1">
                {tags.map((t, ti) => (
                  <span
                    key={ti}
                    className="rounded bg-primary/[0.12] px-1.5 py-0.5 text-[10px] text-primary"
                  >
                    {t.trim()}
                  </span>
                ))}
              </div>
            )}

            {/* 扩展字段 */}
            {slots
              .filter((s) => s.name.startsWith("extra_"))
              .map((s) => {
                const val = row[s.field!];
                if (val === null || val === undefined) return null;
                return (
                  <EditableField
                    key={s.name}
                    label={s.label}
                    value={val as string | number | boolean | null}
                    type={colType(s.field)}
                    editing={editing?.row === rowIdx && editing?.field === s.field}
                    onStartEdit={() => startEdit(rowIdx, s.field!)}
                    onChange={(v) => commitEdit(rowIdx, s.field!, v)}
                    onCancel={cancelEdit}
                    className="text-xs text-foreground/60"
                  />
                );
              })}
          </div>
        );
      })}

      {andf.rows.length === 0 && (
        <div className="col-span-full flex h-32 items-center justify-center text-xs text-muted-foreground">
          无数据
        </div>
      )}
      {hasMore && (
        <div
          ref={sentinelRef}
          className="col-span-full flex items-center justify-center py-3 text-[10px] text-foreground/40"
        >
          加载中… ({visibleCount} / {andf.rows.length})
        </div>
      )}
    </div>
  );
}

// ─── 辅助 ──────────────────────────────────────────────────────────────────

function EditableField({
  label,
  value,
  type,
  editing,
  onStartEdit,
  onChange,
  onCancel,
  className,
}: {
  label: string;
  value: string | number | boolean | null;
  type: string;
  editing: boolean;
  onStartEdit: () => void;
  onChange: (v: unknown) => void;
  onCancel: () => void;
  className: string;
}) {
  if (editing) {
    return (
      <div className="flex items-center gap-1">
        {label && <span className="text-[10px] text-foreground/55">{label}:</span>}
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

  const displayStr: string = value == null ? "" : typeof value === "boolean" ? (value ? "✓" : "✗") : String(value);
  return (
    <div className={className} onClick={onStartEdit} title="点击编辑">
      {label && <span className="mr-1 text-[10px] text-foreground/55">{label}:</span>}
      {displayStr}
    </div>
  );
}
