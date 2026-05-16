"use client";

import * as React from "react";
import { Search, LayoutGrid, List, Star, Play, Loader2, AlertCircle, PinOff, Pin } from "lucide-react";
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@artifex-nexus/ui";
import { ItemCard } from "./ItemCard";
import { ScrollFade } from "../chat/ScrollFade";
import {
  nexusToolList, nexusToolEnable, nexusToolDisable,
  nexusToolPin, nexusToolUnpin, nexusToolFavorite, nexusToolUnfavorite,
  nexusToolRun,
  type NexusToolItem,
} from "../../lib/nexus-tool/nexus-tool-api";
import { DCC_LABELS, SOURCE_LABELS } from "../../lib/skillsMock";

const SOURCE_COLORS: Record<string, string> = {
  official: "text-blue-400", marketplace: "text-purple-400", user: "text-green-400",
};

const IMPL_LABELS: Record<string, string> = {
  skill_wrapper: "包装", script: "脚本", composite: "组合",
};

export function NexusToolList() {
  const [search, setSearch] = React.useState("");
  const [dccFilter, setDccFilter] = React.useState("all");
  const [sourceFilter, setSourceFilter] = React.useState("all");
  const [favoritesOnly, setFavoritesOnly] = React.useState(false);
  const [viewMode, setViewMode] = React.useState<"card" | "list">("card");
  const [tools, setTools] = React.useState<NexusToolItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [actionLoading, setActionLoading] = React.useState<Set<string>>(new Set());

  const loadTools = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await nexusToolList({ page: 1, limit: 200 });
      setTools(result.items);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { loadTools(); }, [loadTools]);

  const doAction = React.useCallback(async (id: string, action: () => Promise<unknown>) => {
    setActionLoading((prev) => new Set(prev).add(id));
    try {
      await action();
      await loadTools();
    } catch (e) {
      setError(String(e));
    } finally {
      setActionLoading((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  }, [loadTools]);

  const isBusy = (id: string) => actionLoading.has(id);

  const filtered = tools
    .filter((t) => {
      if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (dccFilter !== "all" && !t.target_dccs?.includes(dccFilter)) return false;
      if (sourceFilter !== "all" && t.source !== sourceFilter) return false;
      if (favoritesOnly && !t.is_favorited) return false;
      return true;
    })
    .sort((a, b) => {
      if (a.is_favorited !== b.is_favorited) return a.is_favorited ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-2">
        <div className="relative w-[200px]">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-8 pl-7 text-xs" placeholder="搜索 Nexus-Tool..." value={search} onChange={(e) => setSearch(e.target.value)} />
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
          onClick={loadTools} disabled={loading}>
          <Loader2 className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8"
          onClick={() => setViewMode(viewMode === "card" ? "list" : "card")}>
          {viewMode === "card" ? <List className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
        </Button>
      </div>

      {loading && tools.length === 0 && (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />加载中...
        </div>
      )}

      {error && tools.length === 0 && (
        <div className="flex flex-1 items-center justify-center gap-2 text-red-400">
          <AlertCircle className="h-5 w-5" />
          <span className="text-sm">sidecar 未就绪或加载失败</span>
          <Button variant="outline" size="sm" onClick={loadTools}>重试</Button>
        </div>
      )}

      <ScrollFade className="flex-1">
        <div className={viewMode === "card" ? "grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3" : "flex flex-col"}>
          {filtered.map((tool) => (
            <ItemCard key={tool.id} viewMode={viewMode}
              icon={<DCCIcon software={tool.target_dccs?.[0] || ""} />}
              title={tool.name}
              source={{ label: SOURCE_LABELS[tool.source] || tool.source, color: SOURCE_COLORS[tool.source] || "" }}
              status={{
                label: tool.is_enabled ? "已启用" : "已禁用",
                color: tool.is_enabled ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400",
              }}
              description={tool.description}
              meta={<>
                <span>{tool.version}</span>
                <span>·</span><span>{IMPL_LABELS[tool.implementation_type] || tool.implementation_type}</span>
                <span>·</span><span>{tool.target_dccs?.join(", ") || "通用"}</span>
              </>}
              actions={<>
                <Button variant="outline" size="sm" className="h-7 text-xs"
                  onClick={() => doAction(tool.id, () => nexusToolRun(tool.id))}
                  disabled={isBusy(tool.id)}>
                  <Play className="mr-1 h-3 w-3" />运行
                </Button>
                {tool.is_enabled
                  ? <Button variant="outline" size="sm" className="h-7 text-xs"
                      onClick={() => doAction(tool.id, () => nexusToolDisable(tool.id))}
                      disabled={isBusy(tool.id)}>禁用</Button>
                  : <Button size="sm" className="h-7 text-xs"
                      onClick={() => doAction(tool.id, () => nexusToolEnable(tool.id))}
                      disabled={isBusy(tool.id)}>启用</Button>}
                <Button variant="ghost" size="icon" className="h-7 w-7"
                  onClick={() => doAction(tool.id, () => tool.is_pinned ? nexusToolUnpin(tool.id) : nexusToolPin(tool.id))}
                  disabled={isBusy(tool.id)}>
                  {tool.is_pinned ? <PinOff className="h-3.5 w-3.5 text-amber-400" /> : <Pin className="h-3.5 w-3.5" />}
                </Button>
                <div className="flex-1" />
                <Button variant="ghost" size="icon" className="h-7 w-7"
                  onClick={() => doAction(tool.id, () => tool.is_favorited ? nexusToolUnfavorite(tool.id) : nexusToolFavorite(tool.id))}
                  disabled={isBusy(tool.id)}>
                  <Star className={`h-3.5 w-3.5 ${tool.is_favorited ? "fill-amber-400 text-amber-400" : ""}`} />
                </Button>
              </>}
            />
          ))}
        </div>
      </ScrollFade>
    </div>
  );
}

function DCCIcon({ software }: { software: string }) {
  const colors: Record<string, string> = {
    blender: "bg-orange-500/20 text-orange-400", maya: "bg-cyan-500/20 text-cyan-400",
    max: "bg-yellow-500/20 text-yellow-400", unreal: "bg-sky-500/20 text-sky-400",
    houdini: "bg-amber-500/20 text-amber-400", comfyui: "bg-purple-500/20 text-purple-400",
    general: "bg-muted text-muted-foreground",
  };
  const icons: Record<string, string> = {
    blender: "B", maya: "M", max: "3", unreal: "U", houdini: "H", comfyui: "C", general: "G",
  };
  const key = software?.toLowerCase() || "";
  return <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold ${colors[key] || "bg-muted text-muted-foreground"}`}>
    {icons[key] || "?"}
  </span>;
}
