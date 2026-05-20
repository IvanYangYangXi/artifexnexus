"use client";

import * as React from "react";
import { Search, LayoutGrid, List, Plus, Pin, PinOff, Star, Loader2, AlertCircle, Inbox, CheckSquare, Download } from "lucide-react";
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@artifex-nexus/ui";
import { ItemCard } from "./ItemCard";
import { ScrollFade } from "../chat/ScrollFade";
import { PreviewContext } from "../shell/AppShell";
import {
  skillList, skillInstall, skillUninstall, skillEnable, skillDisable,
  skillPin, skillUnpin, skillFavorite, skillUnfavorite,
  skillSync, skillPublish, skillBatch,
  type SkillItem,
} from "../../lib/skill/skill-api";
import { DCC_LABELS, SOURCE_LABELS, type SkillSource } from "../../lib/skillsMock";
import { PublishConfirmDialog, type SkillPublishData, type SkillPublishResult } from "./PublishConfirmDialog";

// layer → source 映射
function layerToSource(layer: string): SkillSource {
  if (layer.startsWith("00_")) return "official";
  if (layer.startsWith("01_")) return "marketplace";
  if (layer.startsWith("02_")) return "user";
  return "user";
}

const SOURCE_COLORS: Record<string, string> = {
  official: "text-blue-400", marketplace: "text-purple-400", user: "text-green-400",
};

// ── localStorage helpers ──────────────────────────────────────────────────────
const VIEW_KEY = "artifex.skills.skillViewMode";
const loadViewPref = (): "card" | "list" => {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === "card" || v === "list") return v;
  } catch { /* ignore */ }
  return "card";
};
const saveViewPref = (val: string) => { try { localStorage.setItem(VIEW_KEY, val); } catch { /* ignore */ } };

export function SkillList() {
  const [search, setSearch] = React.useState("");
  const [dccFilter, setDccFilter] = React.useState("all");
  const [sourceFilter, setSourceFilter] = React.useState("all");
  const [favoritesOnly, setFavoritesOnly] = React.useState(false);
  const [viewMode, setViewMode] = React.useState<"card" | "list">(loadViewPref);
  const [skills, setSkills] = React.useState<SkillItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [actionLoading, setActionLoading] = React.useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [batchInstalling, setBatchInstalling] = React.useState(false);

  // ── 发布弹窗状态 ──
  const [publishTarget, setPublishTarget] = React.useState<SkillItem | null>(null);
  const [publishBusy, setPublishBusy] = React.useState(false);

  const { setPreview } = React.useContext(PreviewContext);

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

  // 操作封装（检查 result.ok）
  const doAction = React.useCallback(async (id: string, action: () => Promise<unknown>) => {
    setActionLoading((prev) => new Set(prev).add(id));
    try {
      const result: any = await action();
      if (result && typeof result === "object" && "ok" in result && !result.ok) {
        setError((result as { message?: string }).message || "操作失败");
        return;
      }
      await loadSkills();
    } catch (e) {
      setError(String(e));
    } finally {
      setActionLoading((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  }, [loadSkills]);

  /** 点击 Skill → 在 D5 右侧面板打开详情 */
  const handleDetail = React.useCallback((name: string) => {
    setPreview({
      kind: "skill-detail",
      title: name,
      data: { skillName: name },
    });
  }, [setPreview]);

  const isBusy = (id: string) => actionLoading.has(id);

  const filtered = skills
    .filter((s) => {
      if (search && !s.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (dccFilter !== "all" && s.software !== dccFilter) {
        // "general" (前端) ↔ "universal" (后端) 互认
        if (!(dccFilter === "general" && s.software === "universal")) {
          return false;
        }
      }
      if (sourceFilter !== "all" && layerToSource(s.layer) !== sourceFilter) return false;
      if (favoritesOnly && !s.favorited) return false;
      return true;
    })
    .sort((a, b) => {
      if (a.favorited !== b.favorited) return a.favorited ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  // ── 多选逻辑 ────────────────────────────────────────────────────────────
  const toggleSelect = React.useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const selectableCount = filtered.filter((s) => !s.installed).length;
  const selectedUninstalledCount = Array.from(selectedIds).filter((id) => {
    const skill = skills.find((s) => s.name === id);
    return skill && !skill.installed;
  }).length;

  const toggleSelectAll = React.useCallback(() => {
    const uninstalled = filtered.filter((s) => !s.installed);
    if (uninstalled.length === 0) return;
    const allSelected = uninstalled.every((s) => selectedIds.has(s.name));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(uninstalled.map((s) => s.name)));
    }
  }, [filtered, selectedIds]);

  const exitSelectMode = React.useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const batchInstall = React.useCallback(async () => {
    const ids = Array.from(selectedIds).filter((id) => {
      const skill = skills.find((s) => s.name === id);
      return skill && !skill.installed;
    });
    if (ids.length === 0) return;
    setBatchInstalling(true);
    try {
      await skillBatch("install", ids);
      await loadSkills();
      exitSelectMode();
    } catch (e) {
      setError(String(e));
    } finally {
      setBatchInstalling(false);
    }
  }, [selectedIds, skills, loadSkills, exitSelectMode]);

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
        {selectMode && (
          <>
            <span className="text-[11px] text-muted-foreground">
              {selectedUninstalledCount}/{selectableCount} 选中
            </span>
            <Button variant="ghost" size="sm" className="h-7 text-xs"
              onClick={toggleSelectAll}
              disabled={selectableCount === 0}>
              全选
            </Button>
            <Button size="sm" className="h-7 text-xs"
              onClick={batchInstall}
              disabled={selectedUninstalledCount === 0 || batchInstalling}>
              {batchInstalling
                ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />安装中</>
                : <><Download className="mr-1 h-3 w-3" />一键安装 ({selectedUninstalledCount})</>}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground"
              onClick={exitSelectMode}>
              取消
            </Button>
          </>
        )}
        {!selectMode && (
          <Button variant="ghost" size="icon" className="h-8 w-8" title="多选安装"
            onClick={() => setSelectMode(true)}>
            <CheckSquare className="h-4 w-4" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-8 w-8" title="刷新"
          onClick={loadSkills} disabled={loading}>
          <Loader2 className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8"
          onClick={() => { const next = viewMode === "card" ? "list" : "card"; setViewMode(next); saveViewPref(next); }}>
          {viewMode === "card" ? <List className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
        </Button>
      </div>

      {loading && skills.length === 0 && (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />加载中...
        </div>
      )}

      {error && (
        <div className="flex items-center justify-center gap-2 px-4 py-2 text-red-400 border-b border-red-500/20 bg-red-500/5">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="text-xs truncate">{error}</span>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground"
            onClick={() => setError(null)}>✕</Button>
        </div>
      )}

      {!loading && !error && skills.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <Inbox className="h-12 w-12" />
          <p className="text-sm">暂无 Skill</p>
          <p className="text-xs">使用 "Plus" 按钮安装或创建新的 Skill</p>
        </div>
      )}

      <ScrollFade className="flex-1">
        <div className={viewMode === "card" ? "grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3" : "flex flex-col"}>
          {filtered.map((skill) => (
            <ItemCard key={skill.name} viewMode={viewMode}
              selected={selectMode ? selectedIds.has(skill.name) : undefined}
              onSelect={selectMode ? (() => toggleSelect(skill.name)) : undefined}
              onTitleClick={() => handleDetail(skill.name)}
              icon={<DCCIcon software={skill.software} />}
              title={skill.display_name || skill.name}
              titleBadge={skill.validation_error || !skill.has_manifest ? { label: "⚠", className: "text-amber-400 border-amber-400/30 bg-amber-400/10" } : undefined}
              source={{ label: SOURCE_LABELS[layerToSource(skill.layer)] || layerToSource(skill.layer), color: SOURCE_COLORS[layerToSource(skill.layer)] }}
              status={{
                label: !skill.installed ? "未安装" : skill.enabled ? "已安装" : "已禁用",
                color: !skill.installed
                  ? "bg-amber-500/15 text-amber-400"
                  : skill.enabled
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-red-500/15 text-red-400",
              }}
              description={skill.description || skill.tags?.join(", ") || ""}
              meta={<>
                <span>{skill.version}</span>
                <span>·</span><span>{skill.software}</span>
              </>}
              actions={(!selectMode || skill.installed) ? <>
                {/* 详情 — 始终显示 */}
                <Button variant="outline" size="sm" className="h-7 text-xs"
                  onClick={() => handleDetail(skill.name)} disabled={isBusy(skill.name)}>
                  详情
                </Button>

                {/* 未安装 → 安装 */}
                {!skill.installed && (
                  <Button size="sm" className="h-7 text-xs"
                    onClick={() => doAction(skill.name, () => skillInstall(skill.name))}
                    disabled={isBusy(skill.name)}>
                    安装
                  </Button>
                )}

                {/* 已安装但已禁用 → 启用 */}
                {skill.installed && !skill.enabled && (
                  <Button size="sm" className="h-7 text-xs"
                    onClick={() => doAction(skill.name, () => skillEnable(skill.name))}
                    disabled={isBusy(skill.name)}>
                    启用
                  </Button>
                )}

                {/* 已安装且已启用 → 禁用 */}
                {skill.installed && skill.enabled && (
                  <Button variant="outline" size="sm" className="h-7 text-xs"
                    onClick={() => doAction(skill.name, () => skillDisable(skill.name))}
                    disabled={isBusy(skill.name)}>
                    禁用
                  </Button>
                )}

                {/* 已安装 → 钉选/取消钉选 */}
                {skill.installed && (
                  <Button variant="ghost" size="icon" className="h-7 w-7"
                    onClick={() => doAction(skill.name, () => skill.pinned ? skillUnpin(skill.name) : skillPin(skill.name))}
                    disabled={isBusy(skill.name)}
                    title={skill.pinned ? "取消钉选" : "钉选"}>
                    {skill.pinned ? <PinOff className="h-3.5 w-3.5 text-amber-400" /> : <Pin className="h-3.5 w-3.5" />}
                  </Button>
                )}

                {/* 已安装 → 卸载 */}
                {skill.installed && (
                  <Button variant="outline" size="sm" className="h-7 text-xs text-red-400 hover:text-red-300"
                    onClick={() => doAction(skill.name, () => skillUninstall(skill.name))}
                    disabled={isBusy(skill.name)}>
                    卸载
                  </Button>
                )}

                {/* 已安装 + 非用户层 → 同步（从官方/市场同步最新版本） */}
                {skill.installed && !skill.layer.startsWith("02_") && (
                  <Button variant="outline" size="sm" className="h-7 text-xs"
                    onClick={() => doAction(skill.name, () => skillSync(skill.name))}
                    disabled={isBusy(skill.name)}>
                    同步
                  </Button>
                )}

                {/* 已安装 + 用户层 → 发布（发布到团队/官方） */}
                {skill.installed && skill.layer.startsWith("02_") && (
                  <Button variant="outline" size="sm" className="h-7 text-xs text-purple-400 hover:text-purple-300"
                    onClick={() => setPublishTarget(skill)}
                    disabled={isBusy(skill.name)}>
                    发布
                  </Button>
                )}

                <div className="flex-1" />

                {/* 收藏 — 始终显示 */}
                <Button variant="ghost" size="icon" className="h-7 w-7"
                  onClick={() => doAction(skill.name, () => skill.favorited ? skillUnfavorite(skill.name) : skillFavorite(skill.name))}
                  disabled={isBusy(skill.name)}
                  title={skill.favorited ? "取消收藏" : "收藏"}>
                  <Star className={`h-3.5 w-3.5 ${skill.favorited ? "fill-amber-400 text-amber-400" : ""}`} />
                </Button>
              </> : null}
            />
          ))}
        </div>
      </ScrollFade>

      {/* ── 发布确认弹窗 ── */}
      <PublishConfirmDialog
        kind="skill"
        open={publishTarget !== null}
        onClose={() => setPublishTarget(null)}
        skillData={publishTarget ? {
          name: publishTarget.name,
          version: publishTarget.version || "unknown",
        } : undefined}
        onConfirmSkill={async (result: SkillPublishResult) => {
          if (!publishTarget) return;
          setPublishBusy(true);
          try {
            const res = await skillPublish(publishTarget.name, {
              source_layer: "02_user",
              target_layer: result.targetLayer,
            });
            if (!res.ok) {
              setError("发布失败: " + JSON.stringify(res));
              return;
            }
            setPublishTarget(null);
            await loadSkills();
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
  };
  const icons: Record<string, string> = {
    blender: "B", maya: "M", "3ds_max": "3", unreal_engine: "U", houdini: "H", comfyui: "C",
    substance_painter: "P", substance_designer: "D", unity: "N",
  };
  const key = software?.toLowerCase() || "";
  return <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold ${colors[key] || "bg-muted text-muted-foreground"}`}>
    {icons[key] || "?"}
  </span>;
}
