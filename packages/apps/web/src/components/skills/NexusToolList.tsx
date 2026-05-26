"use client";

import * as React from "react";
import { Search, LayoutGrid, List, Star, Play, Loader2, AlertCircle, Info, Inbox } from "lucide-react";
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@artifex-nexus/ui";
import { ItemCard } from "./ItemCard";
import { ScrollFade } from "../chat/ScrollFade";
import { PreviewContext } from "../shell/AppShell";
import {
  nexusToolList, nexusToolEnable, nexusToolDisable,
  nexusToolFavorite, nexusToolUnfavorite,
  nexusToolPublish, nexusToolDelete,
  type NexusToolItem,
} from "../../lib/nexus-tool/nexus-tool-api";
import { DCC_LABELS, SOURCE_LABELS } from "../../lib/skillsMock";
import { PublishConfirmDialog, type ToolPublishData, type ToolPublishResult } from "./PublishConfirmDialog";
import { useUiPref } from "../../lib/useUiPref";

const SOURCE_COLORS: Record<string, string> = {
  official: "text-blue-400", marketplace: "text-purple-400", user: "text-green-400",
};

export function NexusToolList() {
  const [search, setSearch] = React.useState("");
  const [dccFilter, setDccFilter] = React.useState("all");
  const [sourceFilter, setSourceFilter] = React.useState("all");
  const [favoritesOnly, setFavoritesOnly] = useUiPref<boolean>("toolFavoritesOnly", false);
  const [viewMode, setViewMode] = useUiPref<"card" | "list">("toolViewMode", "card");
  const [tools, setTools] = React.useState<NexusToolItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [actionLoading, setActionLoading] = React.useState<Set<string>>(new Set());
  const [activeTool, setActiveTool] = React.useState<string | null>(null);

  // ── 发布弹窗状态 ──
  const [publishTarget, setPublishTarget] = React.useState<NexusToolItem | null>(null);
  const [publishBusy, setPublishBusy] = React.useState(false);

  const { setPreview, preview, ensurePanelOpen } = React.useContext(PreviewContext);

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
      // 如果当前详情面板正在预览同一个工具，刷新 preview 以触发重载
      if (preview?.kind === "nexus-tool-detail") {
        const data = preview.data as { toolId?: string; toolName?: string; refreshKey?: number };
        if (data?.toolId === id) {
          setPreview({
            ...preview,
            data: { ...data, refreshKey: Date.now() },
          });
        }
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setActionLoading((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  }, [loadTools, preview, setPreview]);

  const isBusy = (id: string) => actionLoading.has(id);

  /** 计算触发器状态：none=无触发器, active=启用触发, disabled=禁用触发 */
  const triggerState = (tool: NexusToolItem): "none" | "active" | "disabled" => {
    const hasTriggers = tool.triggers && tool.triggers.length > 0;
    if (!hasTriggers) return "none";
    return tool.is_enabled ? "active" : "disabled";
  };

  const TRIGGER_STATE_LABEL: Record<string, string> = {
    active: "启用触发",
    disabled: "禁用触发",
  };
  const TRIGGER_STATE_COLOR: Record<string, string> = {
    active: "bg-emerald-500/15 text-emerald-400",
    disabled: "bg-red-500/15 text-red-400",
  };

  /** 点击工具名/图标 → 在 D5 面板打开详情 */
  const handleToolClick = React.useCallback((tool: NexusToolItem) => {
    setActiveTool(tool.id);
    ensurePanelOpen();
    setPreview({
      kind: "nexus-tool-detail",
      title: tool.name,
      data: { toolId: tool.id, toolName: tool.name },
    });
  }, [setPreview, ensurePanelOpen]);

  const filtered = tools
    .filter((t) => {
      if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (dccFilter !== "all" && !t.software?.some((e) => (typeof e === "string" ? e : e.dcc) === dccFilter)) return false;
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

      {!loading && !error && tools.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <Inbox className="h-12 w-12" />
          <p className="text-sm">暂无 Nexus-Tool</p>
          <p className="text-xs">使用 "Plus" 按钮创建新的 Nexus-Tool</p>
        </div>
      )}

      {loading && tools.length > 0 && (
        <div className="mx-4 h-0.5 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/50" />
        </div>
      )}

      <ScrollFade className="flex-1">
        <div className={viewMode === "card" ? "grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3" : "flex flex-col"}>
          {filtered.map((tool) => (
            <ItemCard key={tool.id} viewMode={viewMode}
              active={activeTool === tool.id}
              icon={<DCCIcon software={(tool.software?.[0] && typeof tool.software[0] === "string") ? tool.software[0] : (tool.software?.[0] as { dcc: string })?.dcc || ""} />}
              title={tool.name}
              onTitleClick={() => handleToolClick(tool)}
              source={{ label: (SOURCE_LABELS as Record<string, string>)[tool.source] || tool.source, color: SOURCE_COLORS[tool.source] || "" }}
              status={triggerState(tool) !== "none" ? {
                label: TRIGGER_STATE_LABEL[triggerState(tool)],
                color: TRIGGER_STATE_COLOR[triggerState(tool)],
              } : undefined}
              description={tool.description}
              meta={<>
                <span>{tool.version}</span>
                <span>·</span><span>{(tool.software?.map((e: unknown) => {
                  const d = typeof e === "string" ? e : (e as { dcc: string }).dcc;
                  return (DCC_LABELS as Record<string, string>)[d] || d;
                }) ?? []).join(", ") || "通用"}</span>
              </>}
              actions={<>
                <Button variant="ghost" size="icon" className="h-7 w-7"
                  onClick={() => handleToolClick(tool)}
                  title="查看详情">
                  <Info className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" className="h-7 text-xs"
                  onClick={() => {
                    setActiveTool(tool.id);
                    ensurePanelOpen();
                    setPreview({
                      kind: "nexus-tool-run",
                      title: `运行: ${tool.name}`,
                      data: { toolId: tool.id },
                    });
                  }}>
                  <Play className="mr-1 h-3 w-3" />运行
                </Button>
                {triggerState(tool) !== "none" && (
                  triggerState(tool) === "active"
                    ? <Button variant="outline" size="sm" className="h-7 text-xs"
                        onClick={() => doAction(tool.id, () => nexusToolDisable(tool.id))}
                        disabled={isBusy(tool.id)}>禁用触发</Button>
                    : <Button variant="outline" size="sm" className="h-7 text-xs"
                        onClick={() => doAction(tool.id, () => nexusToolEnable(tool.id))}
                        disabled={isBusy(tool.id)}>启用触发</Button>
                )}
                {/* 用户源工具 → 发布 */}
                {tool.source === "user" && (
                  <Button variant="outline" size="sm" className="h-7 text-xs text-purple-400 hover:text-purple-300"
                    onClick={() => setPublishTarget(tool)}
                    disabled={isBusy(tool.id)}>
                    发布
                  </Button>
                )}
                {/* 用户源工具 → 删除 */}
                {tool.source === "user" && (
                  <Button variant="outline" size="sm" className="h-7 text-xs text-red-400 hover:text-red-300"
                    onClick={() => doAction(tool.id, () => nexusToolDelete(tool.id))}
                    disabled={isBusy(tool.id)}>
                    删除
                  </Button>
                )}
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

      {/* ── 发布确认弹窗 ── */}
      <PublishConfirmDialog
        kind="tool"
        open={publishTarget !== null}
        onClose={() => setPublishTarget(null)}
        toolData={publishTarget ? {
          name: publishTarget.name,
          currentVersion: publishTarget.version || "",
          currentDescription: publishTarget.description || "",
        } : undefined}
        onConfirmTool={async (result: ToolPublishResult) => {
          if (!publishTarget) return;
          setPublishBusy(true);
          try {
            await nexusToolPublish(publishTarget.id, {
              target: result.target,
              version: result.version,
              description: result.description,
            });
            setPublishTarget(null);
            await loadTools();
          } catch (e) {
            setError(String(e));
          } finally {
            setPublishBusy(false);
          }
        }}
        busy={publishBusy}
      />
    </div>
  );
}

function DCCIcon({ software }: { software: string }) {
  const colors: Record<string, string> = {
    blender: "bg-orange-500/20 text-orange-400", maya: "bg-cyan-500/20 text-cyan-400",
    "3ds_max": "bg-yellow-500/20 text-yellow-400", unreal_engine: "bg-sky-500/20 text-sky-400",
    houdini: "bg-amber-500/20 text-amber-400", comfyui: "bg-purple-500/20 text-purple-400",
    substance_painter: "bg-rose-500/20 text-rose-400", substance_designer: "bg-fuchsia-500/20 text-fuchsia-400",
    unity: "bg-indigo-500/20 text-indigo-400",
    general: "bg-muted text-muted-foreground",
  };
  const icons: Record<string, string> = {
    blender: "B", maya: "M", "3ds_max": "3", unreal_engine: "U", houdini: "H", comfyui: "C",
    substance_painter: "P", substance_designer: "D", unity: "N", general: "G",
  };
  const key = software?.toLowerCase() || "";
  return <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold ${colors[key] || "bg-muted text-muted-foreground"}`}>
    {icons[key] || "?"}
  </span>;
}
