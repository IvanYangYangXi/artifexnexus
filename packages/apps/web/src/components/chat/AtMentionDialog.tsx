"use client";

/**
 * AtMentionDialog — @提及选择器
 *
 * 弹出对话框，列出所有 Skill/Tool，支持搜索和筛选。
 * 选中后在 C3-钉选区显示标签。
 */

import * as React from "react";
import { Search, Puzzle, Wrench } from "lucide-react";
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, cn } from "@artifex-nexus/ui";
import { ScrollFade } from "../chat/ScrollFade";
import {
  MOCK_SKILLS,
  MOCK_TOOLS,
  type DCC,
  DCC_LABELS,
  SOURCE_LABELS,
} from "../../lib/skillsMock";

const DCC_ICONS: Record<DCC, string> = {
  blender: "B", maya: "M", "3ds_max": "3", unreal_engine: "U", houdini: "H", comfyui: "C", general: "G",
};

export interface MentionItem {
  type: "skill" | "tool";
  id: string;
  name: string;
  /** 所属 Skill 名（Tool 时） */
  parentName?: string;
  icon: string;
}

interface AtMentionDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (item: MentionItem) => void;
}

export function AtMentionDialog({ open, onClose, onSelect }: AtMentionDialogProps) {
  const [search, setSearch] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState<string>("all");
  const [dccFilter, setDccFilter] = React.useState<string>("all");

  // 构建合并列表
  const allItems: MentionItem[] = React.useMemo(() => {
    const items: MentionItem[] = [];

    if (typeFilter === "all" || typeFilter === "skill") {
      for (const s of MOCK_SKILLS) {
        items.push({
          type: "skill",
          id: s.id,
          name: s.name,
          icon: DCC_ICONS[s.targetDCCs[0]] || "🔧",
        });
      }
    }

    if (typeFilter === "all" || typeFilter === "tool") {
      for (const t of MOCK_TOOLS) {
        const skill = MOCK_SKILLS.find((s) => s.id === t.skillId);
        items.push({
          type: "tool",
          id: t.id,
          name: t.name,
          parentName: t.skillName,
          icon: skill ? DCC_ICONS[skill.targetDCCs[0]] : "🔧",
        });
      }
    }

    return items;
  }, [typeFilter]);

  // 筛选
  const filtered = allItems.filter((item) => {
    if (search && !item.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/50" onClick={onClose}>
      <div
        className="w-[480px] max-h-[60vh] rounded-xl border border-border bg-card shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 搜索栏 */}
        <div className="flex items-center gap-2 border-b border-border/60 p-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            className="h-8 flex-1 border-0 bg-transparent text-sm shadow-none focus-visible:ring-0"
            placeholder="搜索 Skill 或 Tool..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-8 w-[80px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              <SelectItem value="skill">Skill</SelectItem>
              <SelectItem value="tool">Tool</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 列表 */}
        <ScrollFade className="flex-1">
          <div className="p-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                无匹配结果
              </div>
            ) : (
              filtered.map((item) => (
                <button
                  key={`${item.type}-${item.id}`}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent/40"
                  onClick={() => {
                    onSelect(item);
                    onClose();
                  }}
                >
                  <span className="text-base">{item.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {item.type === "tool" ? (
                          <span className="font-mono text-xs">{item.name}</span>
                        ) : (
                          item.name
                        )}
                      </span>
                      <span
                        className={cn(
                          "rounded px-1 py-0 text-[9px] font-medium",
                          item.type === "skill"
                            ? "bg-blue-500/15 text-blue-400"
                            : "bg-emerald-500/15 text-emerald-400",
                        )}
                      >
                        {item.type === "skill" ? "Skill" : "Tool"}
                      </span>
                    </div>
                    {item.parentName && (
                      <div className="text-[10px] text-muted-foreground">
                        {item.parentName}
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground">@</span>
                </button>
              ))
            )}
          </div>
        </ScrollFade>

        {/* 底部提示 */}
        <div className="border-t border-border/60 px-3 py-1.5 text-[10px] text-muted-foreground">
          ↑↓ 导航 · Enter 选择 · Esc 关闭
        </div>
      </div>
    </div>
  );
}
