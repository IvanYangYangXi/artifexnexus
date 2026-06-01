"use client";

/**
 * NotificationDetail — 通知详情弹窗
 *
 * 从 NotificationBell 点击通知条目时打开。
 * 显示完整通知内容：类型图标、标题、消息、来源、时间。
 */

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
} from "@artifex-nexus/ui";
import {
  CheckCircle,
  AlertTriangle,
  AlertCircle,
  Info,
} from "lucide-react";
import type { AppNotification } from "../../lib/notification-store";

const TYPE_CONFIG: Record<
  string,
  { icon: React.ElementType; color: string; label: string }
> = {
  success: { icon: CheckCircle, color: "text-emerald-400", label: "成功" },
  warning: { icon: AlertTriangle, color: "text-amber-400", label: "警告" },
  error: { icon: AlertCircle, color: "text-red-400", label: "错误" },
  info: { icon: Info, color: "text-sky-400", label: "信息" },
};

interface NotificationDetailProps {
  notification: AppNotification;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMarkRead?: (id: string) => void;
  onDelete?: (id: string) => void;
}

export function NotificationDetail({
  notification,
  open,
  onOpenChange,
  onMarkRead,
  onDelete,
}: NotificationDetailProps) {
  const config = TYPE_CONFIG[notification.type] || TYPE_CONFIG.info;
  const Icon = config.icon;

  const handleMarkRead = React.useCallback(() => {
    onMarkRead?.(notification.id);
  }, [notification.id, onMarkRead]);

  const handleDelete = React.useCallback(() => {
    onDelete?.(notification.id);
    onOpenChange(false);
  }, [notification.id, onDelete, onOpenChange]);

  const timeStr = React.useMemo(() => {
    try {
      const d = new Date(notification.timestamp);
      return d.toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return notification.timestamp;
    }
  }, [notification.timestamp]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <Icon className={`h-5 w-5 ${config.color} shrink-0`} />
            <DialogTitle className="text-base">{notification.title}</DialogTitle>
          </div>
          <DialogDescription className="pt-1">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${config.color} bg-muted/60`}>
              {config.label}
            </span>
          </DialogDescription>
        </DialogHeader>

        {/* 消息内容 */}
        <div className="my-3 space-y-3">
          <div className="rounded-lg border border-white/[0.06] bg-muted/30 p-3">
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground/85">
              {notification.detail || notification.message}
            </pre>
          </div>

          {/* 元信息 */}
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            {notification.source && (
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground/60">来源</span>
                <code className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[11px]">
                  {notification.source}
                </code>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground/60">时间</span>
              <span>{timeStr}</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          {!notification.read && onMarkRead && (
            <Button variant="outline" size="sm" onClick={handleMarkRead}>
              标记已读
            </Button>
          )}
          {onDelete && (
            <Button variant="outline" size="sm" onClick={handleDelete}>
              删除
            </Button>
          )}
          <Button size="sm" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
