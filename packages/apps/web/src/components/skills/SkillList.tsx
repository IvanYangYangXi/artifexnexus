"use client";

/**
 * SkillList — Skill 列表（工具栏 + 卡片/列表 + 筛选）
 */

import * as React from "react";
import { Search, LayoutGrid, List, Plus, Pin, PinOff } from "lucide-react";
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@artifex-nexus/ui";
import { ItemCard, formatRelativeTime, RatingMeta } from "./ItemCard";
import { ScrollFade } from "../chat/ScrollFade";
import {
  MOCK_SKILLS,
  type MockSkill,
  type SkillStatus,
  type SkillSource,
  type DCC,
  DCC_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
} from "../../lib/skillsMock";

const DCC_ICONS: Record<DCC, string> = {
  blender: "🎨",
  maya: "🏗️",
  max: "📐",
  unreal: "🎮",
  houdini: "🌊",
  comfyui: "🧩",
  general: "🔧",
};

const STATUS_COLORS: Record<SkillStatus, string> = {
  installed: "bg-emerald-500/15 text-emerald-400",
  not_installed: "bg-muted text-muted-foreground",
  update_available: "bg-amber-500/15 text-amber-400",
  disabled: "bg-red-500/15 text-red-400",
};

const SOURCE_COLORS: Record<SkillSource, string> = {
  official: "text-blue-400",
  marketplace: "text-purple-400",
  user: "text-green-400",
};

export function SkillList() {
  const [search, setSearch] = React.useState("");
  const [dccFilter, setDccFilter] = React.useState<string>("all");
  const [sourceFilter, setSourceFilter] = React.useState<string>("all");
  const [statusFilter, setStatusFilter] = React.useState<string>("all");
  const [sortBy, setSortBy] = React.useState<string>("name");
  const [viewMode, setViewMode] = React.useState<"card" | "list">("card");
  const [skills, setSkills] = React.useState(MOCK_SKILLS);
  const [detailSkill, setDetailSkill] = React.useState<MockSkill | null>(null);

  // 筛选
  const filtered = skills
    .filter((s) => {
      if (search && !s.name.includes(search) && !s.description.includes(search)) return false;
      if (dccFilter !== "all" && !s.targetDCCs.includes(dccFilter as DCC)) return false;
      if (sourceFilter !== "all" && s.source !== sourceFilter) return false;
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "updated") return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      if (sortBy === "rating") return b.rating - a.rating;
      return 0;
    });

  const togglePin = (id: string) => {
    setSkills((prev) =>
      prev.map((s) => (s.id === id ? { ...s, pinned: !s.pinned } : s)),
    );
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* 工具栏 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-2">
        <div className="relative w-[200px]">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 pl-7 text-xs"
            placeholder="搜索 Skill..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={dccFilter} onValueChange={setDccFilter}>
          <SelectTrigger className="h-8 w-[110px] text-xs">
            <SelectValue placeholder="软件" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部软件</SelectItem>
            {Object.entries(DCC_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{DCC_ICONS[k as DCC]} {v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="h-8 w-[100px] text-xs">
            <SelectValue placeholder="来源" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部来源</SelectItem>
            {Object.entries(SOURCE_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-[100px] text-xs">
            <SelectValue placeholder="状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="h-8 w-[100px] text-xs">
            <SelectValue placeholder="排序" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">名称</SelectItem>
            <SelectItem value="updated">最近更新</SelectItem>
            <SelectItem value="rating">评分</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setViewMode(viewMode === "card" ? "list" : "card")}
        >
          {viewMode === "card" ? <List className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
        </Button>
        <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
          <Plus className="h-3 w-3" />
          安装
        </Button>
      </div>

      {/* 列表 */}
      <ScrollFade className="flex-1">
        <div className={cn(
          "p-4",
          viewMode === "card"
            ? "grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
            : "flex flex-col",
        )}>
          {filtered.map((skill) => (
            <ItemCard
              key={skill.id}
              viewMode={viewMode}
              icon={DCC_ICONS[skill.targetDCCs[0]]}
              title={skill.name}
              titleBadge={
                skill.targetDCCs.length > 0
                  ? { label: skill.targetDCCs.map((d) => DCC_LABELS[d]).join(", ") }
                  : undefined
              }
              source={{
                label: SOURCE_LABELS[skill.source],
                color: SOURCE_COLORS[skill.source],
              }}
              status={{
                label: STATUS_LABELS[skill.status],
                color: STATUS_COLORS[skill.status],
              }}
              description={skill.description}
              meta={
                <>
                  <span>{skill.author}</span>
                  <span>·</span>
                  <span>{skill.version}</span>
                  <span>·</span>
                  <span>{formatRelativeTime(skill.updatedAt)}</span>
                  <RatingMeta rating={skill.rating} downloads={skill.downloads} />
                </>
              }
              actions={
                <>
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setDetailSkill(skill)}>
                    详情
                  </Button>
                  {skill.status === "not_installed" && (
                    <Button size="sm" className="h-7 text-xs">安装</Button>
                  )}
                  {skill.status === "installed" && (
                    <>
                      <Button variant="outline" size="sm" className="h-7 text-xs">卸载</Button>
                      <Button variant="outline" size="sm" className="h-7 text-xs">禁用</Button>
                    </>
                  )}
                  {skill.status === "update_available" && (
                    <Button size="sm" className="h-7 text-xs">更新</Button>
                  )}
                  {skill.status === "disabled" && (
                    <Button variant="outline" size="sm" className="h-7 text-xs">启用</Button>
                  )}
                  {(skill.status === "installed" || skill.status === "disabled") && (
                    <Button variant="outline" size="sm" className="h-7 text-xs">卸载</Button>
                  )}
                  {skill.source === "user" && (
                    <Button variant="outline" size="sm" className="h-7 text-xs">发布</Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => togglePin(skill.id)}
                  >
                    {skill.pinned ? (
                      <PinOff className="h-3.5 w-3.5 text-amber-400" />
                    ) : (
                      <Pin className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </>
              }
            />
          ))}
        </div>
      </ScrollFade>

      {/* 详情弹窗 */}
      <Dialog open={!!detailSkill} onOpenChange={() => setDetailSkill(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{detailSkill?.name}</DialogTitle>
            <DialogDescription>
              {detailSkill?.source && SOURCE_LABELS[detailSkill.source]} · {detailSkill?.version} · {detailSkill?.author}
            </DialogDescription>
          </DialogHeader>
          {detailSkill && (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">{detailSkill.description}</p>
              <div className="flex flex-wrap gap-1.5">
                {detailSkill.targetDCCs.map((d) => (
                  <span key={d} className="rounded bg-muted px-2 py-0.5 text-xs">
                    {DCC_ICONS[d]} {DCC_LABELS[d]}
                  </span>
                ))}
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="outline" size="sm" className="text-xs">打开源码目录</Button>
                <Button variant="outline" size="sm" className="text-xs">打开安装目录</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function cn(...args: (string | false | undefined | null)[]): string {
  return args.filter(Boolean).join(" ");
}
