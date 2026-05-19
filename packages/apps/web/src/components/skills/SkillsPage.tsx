"use client";

/**
 * SkillsPage — 技能模块主页面（Skill Tab + Tool Tab）
 *
 * 对齐 docs/specs/ui/web-chat-structure.md §5
 */

import * as React from "react";
import { Search, LayoutGrid, List, Plus, Puzzle, Wrench } from "lucide-react";
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tabs, TabsList, TabsTrigger } from "@artifex-nexus/ui";
import { SkillList } from "./SkillList";
import { NexusToolList } from "./NexusToolList";

// ── localStorage helpers ──────────────────────────────────────────────────────
const TAB_KEY = "artifex.skills.activeTab";
const loadTabPref = (): "nexus_tools" | "skills" => {
  try {
    const v = localStorage.getItem(TAB_KEY);
    if (v === "nexus_tools" || v === "skills") return v;
  } catch { /* SSR / 无权限 */ }
  return "nexus_tools";
};
const saveTabPref = (val: string) => { try { localStorage.setItem(TAB_KEY, val); } catch { /* ignore */ } };

export function SkillsPage() {
  const [activeTab, setActiveTab] = React.useState<"nexus_tools" | "skills">(loadTabPref);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* 顶部 Tab 栏 */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3">
        <Tabs value={activeTab} onValueChange={(v) => { const t = v as "nexus_tools" | "skills"; setActiveTab(t); saveTabPref(t); }}>
          <TabsList className="h-7">
            <TabsTrigger value="nexus_tools" className="h-6 gap-1 text-xs">
              <Wrench className="h-3 w-3" />
              Nexus-Tool
            </TabsTrigger>
            <TabsTrigger value="skills" className="h-6 gap-1 text-xs">
              <Puzzle className="h-3 w-3" />
              Skill
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Tab 内容 */}
      {activeTab === "nexus_tools" ? <NexusToolList /> : <SkillList />}
    </div>
  );
}
