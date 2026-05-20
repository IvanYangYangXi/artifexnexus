"use client";

import * as React from "react";

/** 标签编辑器：badge 展示 + 输入框添加 + x 删除，内部用逗号分隔字符串。 */
export function TagEditor({ tags, onChange }: { tags: string; onChange: (v: string) => void }) {
  const [input, setInput] = React.useState("");
  const tagList = tags.split(",").map(t => t.trim()).filter(Boolean);

  const addTag = () => {
    const v = input.trim();
    if (v && !tagList.includes(v)) {
      onChange([...tagList, v].join(", "));
    }
    setInput("");
  };

  const removeTag = (idx: number) => {
    onChange(tagList.filter((_, i) => i !== idx).join(", "));
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1">
        {tagList.map((tag, i) => (
          <span key={i} className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary font-mono">
            {tag}
            <button onClick={() => removeTag(i)} className="ml-0.5 hover:text-red-400 transition-colors">&times;</button>
          </span>
        ))}
      </div>
      <div className="flex gap-1">
        <input
          className="h-6 flex-1 rounded border border-white/[0.08] bg-white/[0.04] px-2 text-[10px] focus:outline-none focus:border-primary/40 transition-colors"
          placeholder="添加标签..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
        />
        <button onClick={addTag} className="h-6 rounded bg-primary/20 px-2 text-[10px] text-primary hover:bg-primary/30 transition-colors">+</button>
      </div>
    </div>
  );
}
