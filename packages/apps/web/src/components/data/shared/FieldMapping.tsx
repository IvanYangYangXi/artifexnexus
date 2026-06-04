/**
 * FieldMapping — 聚合视图字段映射横条
 *
 * 每个聚合型视图顶部 36px 横条，按槽位渲染 Select 下拉 / Checkbox 多选。
 * encoding 变更通过 onEncodingChange 回调触发 dispatch(SET_VIEW_ENCODING)。
 */

import * as React from "react";
import type { Column } from "@artifex-nexus/contracts";
import type { ViewEncoding } from "../DataPage";
import type { Slot } from "./slot-mapping";

// ─── 类型 ──────────────────────────────────────────────────────────────────

export interface FieldMappingProps {
  /** 视图当前槽位列表（含必填/可选） */
  slots: Slot[];
  /** 当前编码映射 */
  encoding: ViewEncoding;
  /** 编码变更回调 */
  onEncodingChange: (enc: ViewEncoding) => void;
  /** 所有可用列 */
  columns: Column[];
  /** 是否支持多选 yAxis（Line 图专用） */
  multiYAxis?: string[];
  /** 多选 yAxis 变更回调 */
  onMultiYAxisChange?: (fields: string[]) => void;
}

// ─── 组件 ──────────────────────────────────────────────────────────────────

export function FieldMapping({
  slots,
  encoding,
  onEncodingChange,
  columns,
  multiYAxis,
  onMultiYAxisChange,
}: FieldMappingProps) {
  /** 单槽位值变更 */
  const handleSlotChange = (slotName: string, value: string) => {
    onEncodingChange({ ...encoding, [slotName]: value });
  };

  return (
    <div className="flex items-center gap-3 border-b border-white/[0.06] bg-white/[0.02] px-3 py-1.5">
      {slots.map((slot) => {
        const value = encoding[slot.name] || "";
        const candidates = columns.filter((c) =>
          slot.acceptTypes.some((t) => t === c.type)
        );

        return (
          <div key={slot.name} className="flex items-center gap-1.5">
            <label
              className={`text-[11px] ${slot.required ? "font-medium text-muted-foreground" : "text-muted-foreground/50"}`}
            >
              {slot.label}
              {slot.required && <span className="ml-0.5 text-red-400">*</span>}
            </label>
            <select
              value={value}
              onChange={(e) => handleSlotChange(slot.name, e.target.value)}
              className="h-6 min-w-[100px] max-w-[180px] truncate rounded border border-white/[0.08] bg-white/[0.04] px-1.5 text-[11px] text-foreground focus:border-primary/40 focus:outline-none"
            >
              <option value="">— 选择 —</option>
              {candidates.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        );
      })}

      {/* Line 图多选 yAxis */}
      {multiYAxis !== undefined && onMultiYAxisChange && (
        <div className="flex items-center gap-2 border-l border-white/[0.08] pl-3">
          <span className="text-[11px] text-muted-foreground/50">多线</span>
          <div className="flex flex-wrap gap-1">
            {columns
              .filter((c) => c.type === "number")
              .map((c) => {
                const checked = multiYAxis.includes(c.name);
                return (
                  <label
                    key={c.name}
                    className={`flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors ${
                      checked ? "bg-primary/15 text-primary" : "bg-white/[0.04] text-muted-foreground hover:bg-white/[0.08]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const next = checked
                          ? multiYAxis.filter((n) => n !== c.name)
                          : [...multiYAxis, c.name];
                        onMultiYAxisChange(next);
                      }}
                      className="h-2.5 w-2.5"
                    />
                    {c.name}
                  </label>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
