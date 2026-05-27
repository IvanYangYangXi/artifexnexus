/**
 * WeekView — 周视图
 *
 * 7列 × 24行（每小时一行），顶部显示高频任务汇总区。
 * 非高频任务在对应时间槽显示标签条。
 */

import * as React from "react";
import { cn } from "@artifex-nexus/ui";
import type { CalendarTask } from "../../lib/calendar/types";
import { describeCron, formatTime } from "../../lib/calendar/cron-utils";

const WEEKDAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

interface WeekViewProps {
  currentDate: Date;
  selectedDate: Date | null;
  tasks: CalendarTask[];
  highFreqDateSet: Set<string>;
  onDateClick: (date: Date) => void;
  onTaskClick: (task: CalendarTask) => void;
}

export function WeekView({ currentDate, selectedDate, tasks, highFreqDateSet, onDateClick, onTaskClick }: WeekViewProps) {
  const today = new Date();

  // 本周期一 = currentDate - dayOfWeek
  const dayOfWeek = currentDate.getDay();
  const weekStart = new Date(currentDate);
  weekStart.setDate(currentDate.getDate() - dayOfWeek);

  // 7 天的 Date 数组
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  // 按日期和时间槽分组任务
  function getTasksForSlot(date: Date, hour: number): CalendarTask[] {
    return tasks.filter((t) => {
      return t.runTimes.some((rt) => {
        const d = new Date(rt);
        return (
          d.getFullYear() === date.getFullYear() &&
          d.getMonth() === date.getMonth() &&
          d.getDate() === date.getDate() &&
          d.getHours() === hour
        );
      });
    });
  }

  function isToday(d: Date): boolean {
    return d.toDateString() === today.toDateString();
  }

  function isSelectedDate(d: Date): boolean {
    if (!selectedDate) return false;
    return d.toDateString() === selectedDate.toDateString();
  }

  function hasHighFreq(d: Date): boolean {
    return highFreqDateSet.has(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
  }

  return (
    <div className="flex h-full flex-col overflow-auto">
      {/* 列头：星期 */}
      <div className="sticky top-0 z-10 shrink-0 border-b border-border/60 bg-background">
        <div className="grid grid-cols-[48px_repeat(7,1fr)]">
          <div className="py-1 text-center text-[10px] text-muted-foreground border-r border-border/20" />
          {weekDays.map((d, i) => {
            const sel = isSelectedDate(d);
            const hf = hasHighFreq(d);
            return (
              <button
                key={i}
                onClick={() => onDateClick(d)}
                className={cn(
                  "py-1 text-center text-[10px] border-r border-border/20 last:border-r-0 transition-colors hover:bg-accent/10",
                  sel && "bg-accent/20",
                  i === 0 || i === 6 ? "text-muted-foreground/60" : "text-muted-foreground",
                )}
              >
                <div className="flex items-center justify-center gap-0.5">
                  <span>{WEEKDAY_NAMES[i]}</span>
                  {hf && <span className="text-[8px] opacity-60" title="有高频任务">⚡</span>}
                </div>
                <div
                  className={cn(
                    "text-xs font-medium",
                    isToday(d) && "text-primary",
                  )}
                >
                  {d.getDate()}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 时间轴 */}
      <div className="flex-1 overflow-auto">
        <div className="grid grid-cols-[48px_repeat(7,1fr)]">
          {HOURS.map((hour) => (
            <React.Fragment key={hour}>
              {/* 时间标签 */}
              <div className="border-r border-b border-border/20 py-0.5 text-right pr-1.5">
                <span className="text-[9px] text-muted-foreground">
                  {String(hour).padStart(2, "0")}:00
                </span>
              </div>
              {/* 7列时间槽 — 整个格子可点击选择日期 */}
              {weekDays.map((d, colIdx) => {
                const slotTasks = getTasksForSlot(d, hour);
                const sel = isSelectedDate(d);
                return (
                  <button
                    key={colIdx}
                    onClick={() => onDateClick(d)}
                    className={cn(
                      "relative border-r border-b border-border/20 min-h-[32px] p-0.5 transition-colors hover:bg-accent/10",
                      sel && "bg-accent/20",
                      isToday(d) && "bg-primary/[0.03]",
                      colIdx === 6 && "border-r-0",
                    )}
                  >
                    {slotTasks.map((t) => (
                      <WeekTaskBar
                        key={t.id}
                        task={t}
                        onTaskClick={onTaskClick}
                      />
                    ))}
                  </button>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 周视图中的任务条 — 统一布局，灰度底色 */
function WeekTaskBar({
  task,
  onTaskClick,
}: {
  task: CalendarTask;
  onTaskClick: (task: CalendarTask) => void;
}) {
  const scheduleDesc = React.useMemo(() => {
    switch (task.scheduleType) {
      case "interval": return `每${task.interval}`;
      case "cron": return task.cron ? describeCron(task.cron) : "cron";
      case "once": return "单次";
    }
  }, [task]);

  return (
    <div
      className="mb-px flex items-center gap-1 rounded px-1 py-px transition-colors bg-muted/40 hover:ring-1 hover:ring-primary/40"
    >
      <span
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: task.color || undefined }}
      />
      <span
        className="truncate text-[9px] font-medium cursor-pointer hover:underline"
        onClick={(e) => { e.stopPropagation(); onTaskClick(task); }}
        title="点击查看详情"
      >
        {task.title}
      </span>
      <span className="text-[8px] text-muted-foreground shrink-0 ml-auto">
        {scheduleDesc}
      </span>
      <span
        className={cn(
          "shrink-0 rounded px-1 py-px text-[7px] font-medium",
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
