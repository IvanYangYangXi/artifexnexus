/**
 * TaskItem — 单个任务行
 */

import * as React from "react";
import { cn } from "@artifex-nexus/ui";
import type { CalendarTask } from "../../lib/calendar/types";
import { describeCron, formatTime } from "../../lib/calendar/cron-utils";

interface TaskItemProps {
  task: CalendarTask;
  onClick: () => void;
  compact?: boolean;
}

export function TaskItem({ task, onClick, compact = false }: TaskItemProps) {
  const scheduleDesc = React.useMemo(() => {
    switch (task.scheduleType) {
      case "interval":
        return `每${task.interval}`;
      case "cron":
        return task.cron ? describeCron(task.cron) : "cron";
      case "once":
        return task.runAt ? formatTime(new Date(task.runAt)) : "单次";
    }
  }, [task]);

  const isNexusTool = task.source === "nexus-tool";

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
        "border-b border-border/10 last:border-b-0",
        "cursor-pointer hover:bg-accent/20",
      )}
    >
      {/* 来源色点 */}
      <span
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: task.color || undefined }}
        title={task.source === "nexus-tool" ? "Nexus-Tool" : "OpenClaw"}
      />

      {/* 标题 & 描述 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">{task.title}</span>
          {isNexusTool && task.toolName && task.toolName !== task.title && (
            <span className={cn(
              "truncate rounded bg-muted/40 px-1",
              compact ? "text-[9px]" : "text-[10px] font-medium text-foreground/60",
            )}>
              {task.toolName}
            </span>
          )}
        </div>
        {!compact && (
          <div className="text-[9px] text-muted-foreground">
            {scheduleDesc}
          </div>
        )}
      </div>

      {/* 调度周期 */}
      {compact && (
        <span className="text-[9px] text-muted-foreground shrink-0">
          {scheduleDesc}
        </span>
      )}

      {/* 启用状态 */}
      <span
        className={cn(
          "shrink-0 rounded px-1.5 py-px text-[8px] font-medium",
          task.enabled
            ? "bg-emerald-400/15 text-emerald-400"
            : "bg-muted text-muted-foreground",
        )}
      >
        {task.enabled ? "启用" : "禁用"}
      </span>

      {/* 高频标记 */}
      {task.isHighFreq && (
        <span className="shrink-0 text-[9px] text-amber-400" title="高频任务">
          ⚡
        </span>
      )}

      {/* 来源标签 */}
      {!compact && (
        <span className="shrink-0 rounded bg-muted/30 px-1 py-px text-[8px] text-muted-foreground">
          {task.source === "nexus-tool" ? "Nexus" : "OpenClaw"}
        </span>
      )}
    </button>
  );
}
