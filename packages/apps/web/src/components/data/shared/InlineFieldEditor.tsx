"use client";

/**
 * InlineFieldEditor — 内联字段编辑组件（共享）
 *
 * 按列类型派发输入控件：
 *   string → text input
 *   number → number input
 *   boolean → checkbox
 *   datetime → datetime-local input
 *   url → text input
 *
 * 提交：Enter / 失焦 → onChange
 * 取消：Esc → onCancel
 * 关闭入口：点击外部 → onCancel（仅在 clickOutside=true 时生效）
 */

import * as React from "react";

const EDITOR_STYLES =
  "w-full rounded border border-primary/40 bg-background px-1.5 py-0.5 text-sm text-foreground outline-none ring-1 ring-primary/20";

export interface InlineFieldEditorProps {
  type: string;
  value: unknown;
  onChange: (value: unknown) => void;
  onCancel: () => void;
  clickOutside?: boolean;
}

export function InlineFieldEditor({
  type,
  value,
  onChange,
  onCancel,
  clickOutside = false,
}: InlineFieldEditorProps) {
  // datetime 的 draft 用 "YYYY-MM-DDTHH:mm" 16 字符截断
  const initialDraft =
    type === "datetime" && typeof value === "string" && value.length >= 16
      ? value.slice(0, 16)
      : value == null
        ? ""
        : String(value);
  const [draft, setDraft] = React.useState<string>(initialDraft);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // 自动聚焦
  React.useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // 点击外部关闭
  React.useEffect(() => {
    if (!clickOutside) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onCancel();
      }
    };
    // 延迟绑定避免触发当前 click 事件
    const timer = setTimeout(() => document.addEventListener("click", handleClick), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handleClick);
    };
  }, [clickOutside, onCancel]);

  /** 将 draft 字符串按 type 解析后提交 */
  const commitDraft = React.useCallback(
    (raw: string) => {
      if (type === "number") {
        const n = Number(raw);
        if (!isNaN(n)) onChange(n);
        else onCancel();
      } else if (type === "boolean") {
        onChange(raw === "true");
      } else {
        // string / url / datetime 直接以字符串提交
        onChange(raw);
      }
    },
    [type, onChange, onCancel],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      commitDraft(draft);
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  const handleBlur = () => {
    commitDraft(draft);
  };

  // 各分支共享：渲染输入控件主体，由外层 wrapper 包裹
  const renderInput = () => {
    switch (type) {
      case "boolean":
        return (
          <input
            type="checkbox"
            ref={inputRef as React.Ref<HTMLInputElement>}
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onCancel();
            }}
            className="h-4 w-4 accent-primary"
          />
        );

      case "number":
        return (
          <input
            ref={inputRef}
            type="number"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            className={EDITOR_STYLES}
            step="any"
          />
        );

      case "datetime":
        return (
          <input
            ref={inputRef}
            type="datetime-local"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            className={EDITOR_STYLES}
          />
        );

      case "string":
      case "url":
      default:
        return (
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            className={EDITOR_STYLES}
          />
        );
    }
  };

  // 统一外层 wrapper：让 clickOutside 在所有类型分支都能命中 containerRef
  return <div ref={containerRef}>{renderInput()}</div>;
}
