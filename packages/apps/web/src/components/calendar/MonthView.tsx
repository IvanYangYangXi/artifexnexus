/**
 * MonthView — 月视图日历网格
 *
 * 7列 × 6行网格，每个日期格内显示任务点/数量标记。
 * 高频任务合并显示，普通任务用色点标记。
 */

import * as React from "react";
import { cn } from "@artifex-nexus/ui";
import type { CalendarTask } from "../../lib/calendar/types";

const WEEKDAY_HEADERS = ["日", "一", "二", "三", "四", "五", "六"];

interface DateTaskCount {
  total: number;
  tasks: CalendarTask[];
}

interface MonthViewProps {
  currentDate: Date;
  selectedDate: Date | null;
  dateTaskCountMap: Map<string, DateTaskCount>;
  highFreqDateSet: Set<string>;
  onDateClick: (date: Date) => void;
}

export function MonthView({ currentDate, selectedDate, dateTaskCountMap, highFreqDateSet, onDateClick }: MonthViewProps) {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const today = new Date();

  // 计算本月天数
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // 本月初是星期几 (0=Sun)
  const firstDayOfWeek = new Date(year, month, 1).getDay();

  // 构建 6 行 × 7 列的日期数组
  const weeks: (number | null)[][] = [];
  let day = 1;

  for (let row = 0; row < 6; row++) {
    const week: (number | null)[] = [];
    for (let col = 0; col < 7; col++) {
      if (row === 0 && col < firstDayOfWeek) {
        // 上月日期
        week.push(null); // 不显示上月日期
      } else if (day > daysInMonth) {
        // 下月日期
        week.push(null);
      } else {
        week.push(day);
        day++;
      }
    }
    weeks.push(week);
    if (day > daysInMonth) break;
  }

  function getDateKey(d: number): string {
    return `${year}-${month}-${d}`;
  }

  function getDateTaskInfo(d: number): DateTaskCount | undefined {
    return dateTaskCountMap.get(getDateKey(d));
  }

  function isToday(d: number): boolean {
    return (
      today.getFullYear() === year &&
      today.getMonth() === month &&
      today.getDate() === d
    );
  }

  function isSelected(d: number): boolean {
    if (!selectedDate) return false;
    return (
      selectedDate.getFullYear() === year &&
      selectedDate.getMonth() === month &&
      selectedDate.getDate() === d
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 列头：日一二三四五六 */}
      <div className="grid grid-cols-7 border-b border-border/60">
        {WEEKDAY_HEADERS.map((h, i) => (
          <div
            key={i}
            className={cn(
              "py-1 text-center text-[10px] font-medium",
              i === 0 || i === 6 ? "text-muted-foreground/60" : "text-muted-foreground",
            )}
          >
            {h}
          </div>
        ))}
      </div>

      {/* 日期网格 */}
      <div className="grid flex-1 grid-cols-7 auto-rows-fr">
        {weeks.flat().map((d, idx) => {
          if (d === null) {
            return <div key={`empty-${idx}`} className="border-b border-r border-border/20" />;
          }

          const info = getDateTaskInfo(d);
          const taskCount = info?.total || 0;

          return (
            <button
              key={d}
              onClick={() => onDateClick(new Date(year, month, d))}
              className={cn(
                "relative flex flex-col border-b border-r border-border/20 p-0.5 text-left transition-colors hover:bg-accent/20",
                isSelected(d) && "bg-accent/30 ring-1 ring-inset ring-primary/40",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded text-[11px] font-medium",
                  isToday(d) && "bg-primary text-primary-foreground",
                )}
              >
                {d}
              </span>

              {/* 高频任务标记 */}
              {highFreqDateSet.has(getDateKey(d)) && (
                <span className="absolute top-0.5 right-0.5 text-[9px] opacity-60" title="有高频任务">
                  ⚡
                </span>
              )}

              {/* 任务标记 */}
              <div className="flex-1 min-h-0">
                {info && taskCount > 0 && (
                  <div className="mt-0.5 flex flex-wrap gap-0.5">
                    {/* 任务色点（最多3个） */}
                    {info.tasks.slice(0, 3).map((t) => (
                      <span
                        key={t.id}
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: t.color || undefined }}
                        title={t.title}
                      />
                    ))}
                    {taskCount > 3 && (
                      <span className="text-[8px] text-muted-foreground leading-none self-center">
                        +{taskCount - 3}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* 选中指示器 */}
              {isSelected(d) && (
                <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2">
                  <span className="inline-block h-1 w-1 rounded-full bg-primary" />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
