"use client";

/**
 * NotificationBell — 通知铃铛按钮 + Popover 通知历史
 *
 * 位置：Topbar A3 控制区（面板开关右侧）。
 * 功能：
 *   - 未读计数 Badge（红色圆点 + 数字）
 *   - 点击展开 Popover 显示最近通知列表
 *   - 点击通知条目 → 打开 NotificationDetail 弹窗
 *   - "全部已读" / "清空" 快捷操作
 */

import * as React from "react";
import { Bell, CheckCircle, AlertTriangle, AlertCircle, Info, Check, Trash2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  Button,
  Badge,
  cn,
} from "@artifex-nexus/ui";
import { useNotifications, type AppNotification } from "../../lib/notification-store";
import { NotificationDetail } from "./NotificationDetail";

// ─── 类型配置 ──────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<
  string,
  { icon: React.ElementType; color: string }
> = {
  success: { icon: CheckCircle, color: "text-emerald-400" },
  warning: { icon: AlertTriangle, color: "text-amber-400" },
  error: { icon: AlertCircle, color: "text-red-400" },
  info: { icon: Info, color: "text-sky-400" },
};

// ─── 通知条目 ──────────────────────────────────────────────────────────────

function NotificationItem({
  notification,
  onClick,
}: {
  notification: AppNotification;
  onClick: (n: AppNotification) => void;
}) {
  const config = TYPE_CONFIG[notification.type] || TYPE_CONFIG.info;
  const Icon = config.icon;

  const timeStr = React.useMemo(() => {
    try {
      const d = new Date(notification.timestamp);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffMin = Math.floor(diffMs / 60000);

      if (diffMin < 1) return "刚才";
      if (diffMin < 60) return `${diffMin} 分钟前`;
      const diffHour = Math.floor(diffMin / 60);
      if (diffHour < 24) return `${diffHour} 小时前`;
      const diffDay = Math.floor(diffHour / 24);
      if (diffDay < 7) return `${diffDay} 天前`;
      return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
    } catch {
      return "";
    }
  }, [notification.timestamp]);

  const handleClick = React.useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClick(notification);
    },
    [notification, onClick],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(notification);
        }
      }}
      className={cn(
        "group flex items-start gap-2.5 rounded-lg px-3 py-2 cursor-pointer transition-colors",
        "hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        !notification.read && "bg-accent/25",
      )}
    >
      <Icon className={`h-4 w-4 ${config.color} shrink-0 mt-0.5`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <span className={cn("text-sm font-medium truncate", !notification.read && "text-foreground")}>
            {notification.title}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{timeStr}</span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
          {notification.message}
        </p>
      </div>
      {/* 未读指示点 */}
      {!notification.read && (
        <span className="shrink-0 mt-2 h-1.5 w-1.5 rounded-full bg-primary" />
      )}
    </div>
  );
}

// ─── 主组件 ────────────────────────────────────────────────────────────────

export function NotificationBell() {
  const {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    clearAll,
  } = useNotifications();

  const [open, setOpen] = React.useState(false);
  const [detailNotif, setDetailNotif] = React.useState<AppNotification | null>(null);

  const handleItemClick = React.useCallback(
    (notification: AppNotification) => {
      markAsRead(notification.id);
      setDetailNotif(notification);
    },
    [markAsRead],
  );

  const handleMarkAllRead = React.useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      markAllAsRead();
    },
    [markAllAsRead],
  );

  const handleClearAll = React.useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      clearAll();
    },
    [clearAll],
  );

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 relative"
            aria-label={`通知${unreadCount > 0 ? `（${unreadCount} 条未读）` : ""}`}
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white leading-none">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={6}
          className="w-[360px] p-0"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">通知</span>
              {unreadCount > 0 && (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                  {unreadCount} 未读
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  onClick={handleMarkAllRead}
                >
                  <Check className="h-3 w-3 mr-1" />
                  全部已读
                </Button>
              )}
              {notifications.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                  onClick={handleClearAll}
                >
                  <Trash2 className="h-3 w-3 mr-1" />
                  清空
                </Button>
              )}
            </div>
          </div>

          {/* List */}
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <Bell className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">暂无通知</p>
            </div>
          ) : (
            <ScrollArea className="max-h-[400px]">
              <div className="py-1">
                {notifications.map((n) => (
                  <NotificationItem
                    key={n.id}
                    notification={n}
                    onClick={handleItemClick}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
        </PopoverContent>
      </Popover>

      {/* 详情弹窗 */}
      {detailNotif && (
        <NotificationDetail
          notification={detailNotif}
          open={detailNotif !== null}
          onOpenChange={(v) => {
            if (!v) setDetailNotif(null);
          }}
          onMarkRead={markAsRead}
          onDelete={(id) => {
            // 从 Store 中删除（目前通过 clearAll 做粗糙处理，
            // 后续可增加 deleteNotification action）
          }}
        />
      )}
    </>
  );
}
