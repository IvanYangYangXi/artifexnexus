"use client";

import * as React from "react";

/**
 * TagEditor — badge 展示 + 输入框添加（任意标签） + x 删除
 *
 * Props:
 *   tags        — 当前标签，逗号分隔字符串
 *   onChange    — 标签变更回调，同样用逗号分隔字符串
 *   suggestions — 可选：候选标签列表（输入时前缀匹配展示下拉推荐）
 *   className   — 可选：附加类名
 */
export function TagEditor({
  tags,
  onChange,
  suggestions = [],
  className,
}: {
  tags: string;
  onChange: (v: string) => void;
  suggestions?: string[];
  className?: string;
}) {
  const [input, setInput] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const tagList = tags.split(",").map(t => t.trim()).filter(Boolean);

  // 计算推荐列表：前缀匹配 + 排除已添加的
  const filtered = React.useMemo(() => {
    if (!input.trim()) return [];
    const q = input.trim().toLowerCase();
    return suggestions
      .filter(s => s.toLowerCase().includes(q) && !tagList.includes(s))
      .slice(0, 8);
  }, [input, suggestions, tagList]);

  const addTag = (val?: string) => {
    const v = (val ?? input).trim();
    if (v && !tagList.includes(v)) {
      onChange([...tagList, v].join(", "));
    }
    setInput("");
    setOpen(false);
  };

  const removeTag = (idx: number) => {
    onChange(tagList.filter((_, i) => i !== idx).join(", "));
  };

  // 点击外部关闭下拉
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={containerRef} className={`space-y-1.5 ${className ?? ""}`}>
      {/* 已添加的标签 */}
      {tagList.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tagList.map((tag, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary font-mono"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(i)}
                className="ml-0.5 hover:text-red-400 transition-colors leading-none"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      {/* 输入行 */}
      <div className="relative">
        <div className="flex gap-1">
          <input
            ref={inputRef}
            className="h-6 flex-1 rounded border border-white/[0.08] bg-white/[0.04] px-2 text-[10px] focus:outline-none focus:border-primary/40 transition-colors"
            placeholder="输入标签后回车或点击 +"
            value={input}
            onChange={e => {
              setInput(e.target.value);
              setOpen(true);
            }}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); addTag(); }
              if (e.key === "Escape") { setOpen(false); }
              if (e.key === "," || e.key === "Tab") {
                e.preventDefault();
                if (input.trim()) addTag();
              }
            }}
            onFocus={() => { if (input.trim()) setOpen(true); }}
          />
          <button
            type="button"
            onClick={() => addTag()}
            className="h-6 rounded bg-primary/20 px-2 text-[10px] text-primary hover:bg-primary/30 transition-colors"
          >
            +
          </button>
        </div>

        {/* 推荐下拉 */}
        {open && filtered.length > 0 && (
          <ul className="absolute left-0 right-0 top-full z-50 mt-0.5 rounded border border-border/60 bg-card shadow-lg overflow-hidden">
            {filtered.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  className="w-full px-2 py-1 text-left text-[11px] hover:bg-primary/10 hover:text-primary transition-colors font-mono"
                  onMouseDown={e => {
                    e.preventDefault(); // 阻止 input blur
                    addTag(s);
                  }}
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
