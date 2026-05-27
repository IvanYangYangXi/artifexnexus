/**
 * DayView — 日视图
 *
 * 单列 24 小时时间轴，左侧时间标签，右侧任务卡片。
 * 高频任务在顶部汇总区显示，不产生海量卡片。
 */

import * as React from "react";
import { cn } from "@artifex-nexus/ui";
import type { CalendarTask } from "../../lib/calendar/types";
import { describeCron, formatTime } from "../../lib/calendar/cron-utils";

const HOURS = Array.from({ length: 24 }, (_, i) => i);

interface DayViewProps {
  currentDate: Date;
  tasks: CalendarTask[];
  highFreqDateSet: Set<string>;
  onDateClick: (date: Date) => void;
  onTaskClick: (task: CalendarTask) => void;
}

export function DayView({ currentDate, tasks, highFreqDateSet, onDateClick, onTaskClick }: DayViewProps) {
  // 按小时分组任务
  function getTasksForHour(hour: number): CalendarTask[] {
    return tasks.filter((t) => {
      return t.runTimes.some((rt) => {
        const d = new Date(rt);
        return (
          d.getFullYear() === currentDate.getFullYear() &&
          d.getMonth() === currentDate.getMonth() &&
          d.getDate() === currentDate.getDate() &&
          d.getHours() === hour
        );
      });
    });
  }

  return (
    <div className="flex h-full flex-col overflow-auto">
      {/* 日期标题 — 可点击选择 */}
      <button
        onClick={() => onDateClick(currentDate)}
        className="shrink-0 border-b border-border/60 px-3 py-2 text-left hover:bg-accent/10 transition-colors"
      >
        <span className="text-sm font-medium">
          {currentDate.getFullYear()}年{currentDate.getMonth() + 1}月{currentDate.getDate()}日
        </span>
        <span className="ml-2 text-xs text-muted-foreground">
          {tasks.length} 个任务
        </span>
        {highFreqDateSet.has(
          `${currentDate.getFullYear()}-${currentDate.getMonth()}-${currentDate.getDate()}`
        ) && (
          <span className="ml-1 text-xs opacity-60" title="该日期有高频任务">
            ⚡ 高频任务
          </span>
        )}
      </button>

      {/* 时间轴 */}
      <div className="flex-1 overflow-auto">
        {HOURS.map((hour) => {
          const hourTasks = getTasksForHour(hour);
          return (
            <div
              key={hour}
              className={cn(
                "flex min-h-[40px] border-b border-border/10",
                hourTasks.length > 0 && "bg-accent/5",
              )}
            >
              {/* 时间标签 */}
              <div className="w-12 shrink-0 border-r border-border/10 py-1 pr-2 text-right">
                <span className="text-[9px] text-muted-foreground">
                  {String(hour).padStart(2, "0")}:00
                </span>
              </div>
              {/* 任务卡片区 */}
              <div className="flex-1 py-1 px-2">
                {hourTasks.map((t) => (
                  <TaskCard key={t.id} task={t} onClick={() => onTaskClick(t)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 日视图中的任务卡片 — 统一布局 */
function TaskCard({ task, onClick }: { task: CalendarTask; onClick: () => void }) {
  const scheduleDesc = React.useMemo(() => {
    switch (task.scheduleType) {
      case "interval": return `每${task.interval}`;
      case "cron": return task.cron ? describeCron(task.cron) : "cron";
      case "once": return task.runAt ? formatTime(new Date(task.runAt)) : "单次";
    }
  }, [task]);

  const times = task.runTimes
    .map((rt) => new Date(rt))
    .filter((d) => {
      const first = new Date(task.runTimes[0]);
      return d.getHours() === first.getHours();
    })
    .map((d) => formatTime(d));

  return (
    <div
      onClick={onClick}
      className={cn(
        "mb-1 flex items-center gap-2 rounded px-2 py-1 text-[10px] cursor-pointer",
        "border border-border/30 hover:ring-1 hover:ring-primary/40 transition-shadow",
      )}
      style={{
        borderLeftColor: task.color || undefined,
        borderLeftWidth: 2,
      }}
    >
      <span
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: task.color || undefined }}
      />
      <span className="font-medium truncate">{task.title}</span>
      <span className="text-[9px] text-muted-foreground shrink-0">
        {scheduleDesc}
      </span>
      <span className="text-muted-foreground shrink-0 ml-auto">
        {times.join(", ")}
      </span>
      <span
        className={cn(
          "rounded px-1 py-px text-[8px] shrink-0 font-medium",
          task.enabled
            ? "bg-emerald-400/20 text-emerald-400"
            : "bg-muted text-muted-foreground",
        )}
      >
        {task.enabled ? "启用" : "禁用"}
      </span>
    </div>
  );
}
