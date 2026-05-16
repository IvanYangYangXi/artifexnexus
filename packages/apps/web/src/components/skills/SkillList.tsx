"use client";

import * as React from "react";
import { Search, LayoutGrid, List, Plus, Pin, PinOff, Star, Loader2, AlertCircle } from "lucide-react";
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@artifex-nexus/ui";
import { ItemCard } from "./ItemCard";
import { ScrollFade } from "../chat/ScrollFade";
import {
  skillList, skillInstall, skillUninstall, skillEnable, skillDisable,
  skillPin, skillUnpin, skillFavorite, skillUnfavorite, skillDetail,
  type SkillItem,
} from "../../lib/skill/skill-api";
import { DCC_LABELS, SOURCE_LABELS } from "../../lib/skillsMock";

// layer → source 映射
function layerToSource(layer: string): string {
  if (layer.startsWith("00_")) return "official";
  if (layer.startsWith("01_")) return "marketplace";
  if (layer.startsWith("02_")) return "user";
  return "user";
}

const SOURCE_COLORS: Record<string, string> = {
  official: "text-blue-400", marketplace: "text-purple-400", user: "text-green-400",
};

export function SkillList() {
  const [search, setSearch] = React.useState("");
  const [dccFilter, setDccFilter] = React.useState("all");
  const [sourceFilter, setSourceFilter] = React.useState("all");
  const [favoritesOnly, setFavoritesOnly] = React.useState(false);
  const [viewMode, setViewMode] = React.useState<"card" | "list">("card");
  const [skills, setSkills] = React.useState<SkillItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [detailSkill, setDetailSkill] = React.useState<SkillItem | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [actionLoading, setActionLoading] = React.useState<Set<string>>(new Set());

  // 加载列表
  const loadSkills = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await skillList({ page: 1, limit: 200 });
      setSkills(result.items);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { loadSkills(); }, [loadSkills]);

  // 操作封装（支持乐观更新 + 静默重取）
  const doAction = React.useCallback(async (id: string, action: () => Promise<unknown>) => {
    setActionLoading((prev) => new Set(prev).add(id));
    try {
      await action();
      await loadSkills();
    } catch (e) {
      setError(String(e));
    } finally {
      setActionLoading((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  }, [loadSkills]);

  const handleDetail = React.useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const detail = await skillDetail(id);
      // detail.entry has SkillEntry data, convert to SkillItem for display
      const item: SkillItem = {
        ...detail.entry,
        enabled: detail.config.enabled,
        pinned: detail.config.pinned,
        favorited: detail.config.favorited,
      };
      setDetailSkill(item);
    } catch (e) {
      setError(String(e));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const isBusy = (id: string) => actionLoading.has(id);

  const filtered = skills
    .filter((s) => {
      if (search && !s.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (dccFilter !== "all" && s.software !== dccFilter) return false;
      if (sourceFilter !== "all" && layerToSource(s.layer) !== sourceFilter) return false;
      if (favoritesOnly && !s.favorited) return false;
      return true;
    })
    .sort((a, b) => {
      if (a.favorited !== b.favorited) return a.favorited ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-2">
        <div className="relative w-[200px]">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-8 pl-7 text-xs" placeholder="搜索 Skill..." value={search} onChange={(e) => setSearch(e.target.value)} />
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
        <Button variant="ghost" size="icon" className="h-8 w-8" title="刷新"
          onClick={loadSkills} disabled={loading}>
          <Loader2 className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8"
          onClick={() => setViewMode(viewMode === "card" ? "list" : "card")}>
          {viewMode === "card" ? <List className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
        </Button>
      </div>

      {loading && skills.length === 0 && (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />加载中...
        </div>
      )}

      {error && skills.length === 0 && (
        <div className="flex flex-1 items-center justify-center gap-2 text-red-400">
          <AlertCircle className="h-5 w-5" />
          <span className="text-sm">sidecar 未就绪或加载失败</span>
          <Button variant="outline" size="sm" onClick={loadSkills}>重试</Button>
        </div>
      )}

      <ScrollFade className="flex-1">
        <div className={viewMode === "card" ? "grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3" : "flex flex-col"}>
          {filtered.map((skill) => (
            <ItemCard key={skill.name} viewMode={viewMode}
              icon={<DCCIcon software={skill.software} />}
              title={skill.display_name || skill.name}
              source={{ label: SOURCE_LABELS[layerToSource(skill.layer)] || layerToSource(skill.layer), color: SOURCE_COLORS[layerToSource(skill.layer)] }}
              status={{
                label: skill.enabled ? "已安装" : "已禁用",
                color: skill.enabled ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400",
              }}
              description={skill.category}
              meta={<>
                <span>{skill.version}</span>
                <span>·</span><span>{skill.software}</span>
              </>}
              actions={<>
                <Button variant="outline" size="sm" className="h-7 text-xs"
                  onClick={() => handleDetail(skill.name)} disabled={isBusy(skill.name)}>
                  详情
                </Button>
                {!skill.enabled && <Button size="sm" className="h-7 text-xs"
                  onClick={() => doAction(skill.name, () => skillEnable(skill.name))} disabled={isBusy(skill.name)}>启用</Button>}
                {skill.enabled && <>
                  <Button variant="outline" size="sm" className="h-7 text-xs"
                    onClick={() => doAction(skill.name, () => skillDisable(skill.name))} disabled={isBusy(skill.name)}>禁用</Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7"
                    onClick={() => doAction(skill.name, () => skill.pinned ? skillUnpin(skill.name) : skillPin(skill.name))}
                    disabled={isBusy(skill.name)}>
                    {skill.pinned ? <PinOff className="h-3.5 w-3.5 text-amber-400" /> : <Pin className="h-3.5 w-3.5" />}
                  </Button>
                </>}
                <div className="flex-1" />
                <Button variant="ghost" size="icon" className="h-7 w-7"
                  onClick={() => doAction(skill.name, () => skill.favorited ? skillUnfavorite(skill.name) : skillFavorite(skill.name))}
                  disabled={isBusy(skill.name)}>
                  <Star className={`h-3.5 w-3.5 ${skill.favorited ? "fill-amber-400 text-amber-400" : ""}`} />
                </Button>
              </>}
            />
          ))}
        </div>
      </ScrollFade>

      <Dialog open={!!detailSkill} onOpenChange={() => setDetailSkill(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader><DialogTitle>{detailSkill?.display_name || detailSkill?.name}</DialogTitle>
            <DialogDescription>{layerToSource(detailSkill?.layer || "")} · {detailSkill?.version} · {detailSkill?.software}</DialogDescription>
          </DialogHeader>
          {detailSkill && <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">{detailSkill.category}</p>
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded bg-muted px-2 py-0.5 text-xs">{detailSkill.software}</span>
              <span className="rounded bg-muted px-2 py-0.5 text-xs">{detailSkill.version}</span>
              <span className="rounded bg-muted px-2 py-0.5 text-xs">优先级 {detailSkill.priority}</span>
            </div>
          </div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DCCIcon({ software }: { software: string }) {
  const colors: Record<string, string> = {
    blender: "bg-orange-500/20 text-orange-400", maya: "bg-cyan-500/20 text-cyan-400",
    "3ds_max": "bg-yellow-500/20 text-yellow-400", unreal_engine: "bg-sky-500/20 text-sky-400",
    houdini: "bg-amber-500/20 text-amber-400", comfyui: "bg-purple-500/20 text-purple-400",
  };
  const icons: Record<string, string> = {
    blender: "B", maya: "M", "3ds_max": "3", unreal_engine: "U", houdini: "H", comfyui: "C",
  };
  const key = software?.toLowerCase() || "";
  return <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold ${colors[key] || "bg-muted text-muted-foreground"}`}>
    {icons[key] || "?"}
  </span>;
}
