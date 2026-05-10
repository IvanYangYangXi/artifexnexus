"use client";

/**
 * ItemCard / ItemListRow — 通用 Skill/Tool 卡片和列表行组件
 *
 * 对齐 docs/specs/ui/web-chat-structure.md §5
 * Skill 和 Tool 复用同一套组件，通过 props 区分
 */

import * as React from "react";
import { Star, Download } from "lucide-react";
import { Badge, Button, cn } from "@artifex-nexus/ui";

export interface ItemCardProps {
  /** 图标（emoji 或 ReactNode） */
  icon: React.ReactNode;
  /** 主标题 */
  title: string;
  /** 标题旁的标签（如 DCC 标签、实现类型标签） */
  titleBadge?: { label: string; variant?: "default" | "secondary" | "outline" };
  /** 来源 */
  source: { label: string; color: string };
  /** 状态 */
  status: { label: string; color: string };
  /** 描述 */
  description: string;
  /** 元信息行 */
  meta: React.ReactNode;
  /** 操作按钮 */
  actions: React.ReactNode;
  /** 是否选中（批量模式） */
  selected?: boolean;
  onSelect?: () => void;
  /** 视图模式 */
  viewMode: "card" | "list";
}

export function ItemCard(props: ItemCardProps) {
  if (props.viewMode === "list") {
    return <ItemListRow {...props} />;
  }
  return <ItemCardView {...props} />;
}

// ─── 卡片视图 ──────────────────────────────────────────────────────────────

function ItemCardView({
  icon,
  title,
  titleBadge,
  source,
  status,
  description,
  meta,
  actions,
  selected,
  onSelect,
}: ItemCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-4 transition-colors",
        selected
          ? "border-primary/40 bg-primary/[0.04]"
          : "border-border hover:border-white/[0.12]",
      )}
    >
      {/* 第一行：图标 + 标题 + 来源 + 状态 */}
      <div className="flex items-start gap-3">
        {onSelect && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onSelect}
            className="mt-0.5 h-3.5 w-3.5 rounded border-border"
          />
        )}
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/50 text-base">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{title}</span>
            {titleBadge && (
              <Badge variant="secondary" className="text-[10px]">
                {titleBadge.label}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={cn("text-[10px]", source.color)}>{source.label}</span>
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-medium",
              status.color,
            )}
          >
            {status.label}
          </span>
        </div>
      </div>

      {/* 第二行：描述 */}
      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>

      {/* 第三行：元信息 */}
      <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
        {meta}
      </div>

      {/* 第四行：操作按钮 */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2.5">
        {actions}
      </div>
    </div>
  );
}

// ─── 列表视图 ──────────────────────────────────────────────────────────────

function ItemListRow({
  icon,
  title,
  titleBadge,
  source,
  status,
  description,
  meta,
  actions,
  selected,
  onSelect,
}: ItemCardProps) {
  return (
    <div
      className={cn(
        "border-b border-border/40 transition-colors hover:bg-accent/20",
        selected && "bg-primary/[0.04]",
      )}
    >
      {/* 第一行：元信息 */}
      <div className="flex items-center gap-2 px-3 pt-2 text-[10px] text-muted-foreground">
        {meta}
      </div>

      {/* 第二行：图标 + 标题 + 来源 + 状态 + 按钮 */}
      <div className="flex items-center gap-2 px-3 pb-2">
        {onSelect && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onSelect}
            className="h-3.5 w-3.5 rounded border-border"
          />
        )}
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-muted/50 text-xs">
          {icon}
        </div>
        <span className="truncate text-xs font-semibold">{title}</span>
        {titleBadge && (
          <Badge variant="secondary" className="text-[9px]">
            {titleBadge.label}
          </Badge>
        )}
        <span className={cn("text-[10px]", source.color)}>{source.label}</span>
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
            status.color,
          )}
        >
          {status.label}
        </span>
        <div className="flex-1" />
        <div className="flex shrink-0 items-center gap-1">
          {actions}
        </div>
      </div>

      {/* 第三行：描述（与按钮同行时省略） */}
      <div className="px-3 pb-2">
        <p className="truncate text-[11px] text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}

// ─── 辅助 ──────────────────────────────────────────────────────────────────

/** 格式化相对时间 */
export function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天前`;
  return `${Math.floor(days / 30)}月前`;
}

/** 评分+下载量元信息 */
export function RatingMeta({ rating, downloads }: { rating: number; downloads: number }) {
  return (
    <>
      {rating > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
          {rating}
        </span>
      )}
      {downloads > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <Download className="h-2.5 w-2.5" />↓{downloads >= 1000 ? `${(downloads / 1000).toFixed(1)}k` : downloads}
        </span>
      )}
    </>
  );
}
