"use client";

import * as React from "react";
import { Search, LayoutGrid, List, Star, ChevronDown, ChevronRight, Play } from "lucide-react";
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@artifex-nexus/ui";
import { ItemCard, formatDate } from "./ItemCard";
import { ScrollFade } from "../chat/ScrollFade";
import { RunToolContext } from "../shell/AppShell";
import {
  MOCK_TOOLS, MOCK_SKILLS, type MockTool, type SkillStatus, type SkillSource, type DCC, type ImplType,
  DCC_LABELS, SOURCE_LABELS, STATUS_LABELS, IMPL_LABELS,
} from "../../lib/skillsMock";

const STATUS_COLORS: Record<SkillStatus, string> = {
  installed: "bg-emerald-500/15 text-emerald-400", not_installed: "bg-muted text-muted-foreground",
  update_available: "bg-amber-500/15 text-amber-400", disabled: "bg-red-500/15 text-red-400",
};
const SOURCE_COLORS: Record<SkillSource, string> = {
  official: "text-blue-400", marketplace: "text-purple-400", user: "text-green-400",
};

export function ToolList() {
  const [search, setSearch] = React.useState("");
  const [dccFilter, setDccFilter] = React.useState("all");
  const [sourceFilter, setSourceFilter] = React.useState("all");
  const [favoritesOnly, setFavoritesOnly] = React.useState(false);
  const [viewMode, setViewMode] = React.useState<"card" | "list">("card");
  const [tools, setTools] = React.useState(MOCK_TOOLS);
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(new Set());
  const { runTool } = React.useContext(RunToolContext);

  const toggleFavorite = (id: string) => {
    setTools((prev) => prev.map((t) => t.id === id ? { ...t, favorited: !t.favorited } : t));
  };

  const filtered = tools
    .filter((t) => {
      if (search && !t.name.includes(search) && !t.description.includes(search)) return false;
      if (dccFilter !== "all" && !t.targetDCCs.includes(dccFilter as DCC)) return false;
      if (sourceFilter !== "all" && t.source !== sourceFilter) return false;
      if (favoritesOnly && !t.favorited) return false;
      return true;
    })
    .sort((a, b) => {
      if (a.favorited !== b.favorited) return a.favorited ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const grouped = new Map<string, MockTool[]>();
  for (const t of filtered) {
    const key = t.skillName;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(t);
  }

  const toggleGroup = (name: string) => {
    setCollapsedGroups((prev) => { const next = new Set(prev); if (next.has(name)) next.delete(name); else next.add(name); return next; });
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-2">
        <div className="relative w-[200px]">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-8 pl-7 text-xs" placeholder="搜索 Tool..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={dccFilter} onValueChange={setDccFilter}>
          <SelectTrigger className="h-8 w-[110px] text-xs"><SelectValue placeholder="软件" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部软件</SelectItem>
            {Object.entries(DCC_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="h-8 w-[100px] text-xs"><SelectValue placeholder="来源" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部来源</SelectItem>
            {Object.entries(SOURCE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant={favoritesOnly ? "default" : "ghost"} size="icon" className="h-8 w-8"
          onClick={() => setFavoritesOnly(!favoritesOnly)}>
          <Star className={`h-4 w-4 ${favoritesOnly ? "fill-current" : ""}`} />
        </Button>
        <div className="flex-1" />
        <Button variant="ghost" size="icon" className="h-8 w-8"
          onClick={() => setViewMode(viewMode === "card" ? "list" : "card")}>
          {viewMode === "card" ? <List className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
        </Button>
      </div>

      <ScrollFade className="flex-1">
        <div className="p-4">
          {Array.from(grouped.entries()).map(([skillName, skillTools]) => {
            const skill = MOCK_SKILLS.find((s) => s.name === skillName);
            const collapsed = collapsedGroups.has(skillName);
            return (
              <div key={skillName} className="mb-4">
                <button className="mb-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-medium hover:bg-accent/30"
                  onClick={() => toggleGroup(skillName)}>
                  {collapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  <span><DCCIconSmall dcc={skill?.targetDCCs[0] || "general"} /> {skillName}</span>
                  <span className="text-xs text-muted-foreground">({skillTools.length} tools)</span>
                </button>
                {!collapsed && (
                  <div className={viewMode === "card" ? "grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" : "flex flex-col"}>
                    {skillTools.map((tool) => (
                      <ItemCard key={tool.id} viewMode={viewMode}
                        icon={<DCCIcon dcc={skill?.targetDCCs[0] || "general"} />}
                        title={tool.name}
                        titleBadge={{ label: IMPL_LABELS[tool.implType] }}
                        source={{ label: SOURCE_LABELS[tool.source], color: SOURCE_COLORS[tool.source] }}
                        status={{ label: STATUS_LABELS[tool.status], color: STATUS_COLORS[tool.status] }}
                        description={tool.description}
                        meta={<>
                          <span className={SOURCE_COLORS[tool.source]}>{SOURCE_LABELS[tool.source]}</span>
                          <span>·</span><span>{tool.version}</span>
                          <span>·</span><span>{tool.author}</span>
                          <span>·</span><span>{tool.modifiedDate}</span>
                          {tool.triggerCount > 0 && <><span>·</span><span>⚡{tool.triggerCount}触发 · {tool.triggerTypes.join("/")}</span></>}
                        </>}
                        actions={<>
                          <Button variant="outline" size="sm" className="h-7 text-xs">详情</Button>
                          {tool.status === "not_installed" && <Button size="sm" className="h-7 text-xs">安装</Button>}
                          {tool.status === "installed" && <>
                            <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => runTool(tool.name)}><Play className="h-3 w-3" />运行</Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleFavorite(tool.id)}>
                              <Star className={`h-3.5 w-3.5 ${tool.favorited ? "fill-amber-400 text-amber-400" : ""}`} />
                            </Button>
                          </>}
                          {tool.status === "update_available" && <>
                            <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => runTool(tool.name)}><Play className="h-3 w-3" />运行</Button>
                            <Button size="sm" className="h-7 text-xs">更新</Button>
                          </>}
                          {tool.source === "user" && <>
                            <Button variant="outline" size="sm" className="h-7 text-xs">发布</Button>
                            <Button variant="outline" size="sm" className="h-7 text-xs text-destructive">删除</Button>
                          </>}
                        </>}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollFade>
    </div>
  );
}

function DCCIcon({ dcc }: { dcc: DCC }) {
  const colors: Record<DCC, string> = { blender: "bg-orange-500/20 text-orange-400", maya: "bg-cyan-500/20 text-cyan-400", max: "bg-yellow-500/20 text-yellow-400", unreal: "bg-sky-500/20 text-sky-400", houdini: "bg-amber-500/20 text-amber-400", comfyui: "bg-purple-500/20 text-purple-400", general: "bg-muted text-muted-foreground" };
  const icons: Record<DCC, string> = { blender: "B", maya: "M", max: "3", unreal: "U", houdini: "H", comfyui: "C", general: "G" };
  return <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold ${colors[dcc] || colors.general}`}>{icons[dcc]}</span>;
}
function DCCIconSmall({ dcc }: { dcc: DCC }) {
  const colors: Record<DCC, string> = { blender: "bg-orange-500/20 text-orange-400", maya: "bg-cyan-500/20 text-cyan-400", max: "bg-yellow-500/20 text-yellow-400", unreal: "bg-sky-500/20 text-sky-400", houdini: "bg-amber-500/20 text-amber-400", comfyui: "bg-purple-500/20 text-purple-400", general: "bg-muted text-muted-foreground" };
  const icons: Record<DCC, string> = { blender: "B", maya: "M", max: "3", unreal: "U", houdini: "H", comfyui: "C", general: "G" };
  return <span className={`inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold ${colors[dcc] || colors.general}`}>{icons[dcc]}</span>;
}
