/**
 * CalendarHeader — 年月导航 + 今天按钮 + 视图切换
 */

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, cn } from "@artifex-nexus/ui";
import type { CalendarView } from "../../lib/calendar/types";

const WEEKDAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];
const VIEW_OPTIONS: { value: CalendarView; label: string }[] = [
  { value: "month", label: "月" },
  { value: "week", label: "周" },
  { value: "day", label: "日" },
];

interface CalendarHeaderProps {
  currentDate: Date;
  view: CalendarView;
  onDateChange: (date: Date) => void;
  onViewChange: (view: CalendarView) => void;
}

export function CalendarHeader({ currentDate, view, onDateChange, onViewChange }: CalendarHeaderProps) {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const today = new Date();

  const navigate = (dir: -1 | 1) => {
    const d = new Date(currentDate);
    if (view === "month") {
      d.setMonth(d.getMonth() + dir);
    } else if (view === "week") {
      d.setDate(d.getDate() + dir * 7);
    } else {
      d.setDate(d.getDate() + dir);
    }
    onDateChange(d);
  };

  const goToday = () => onDateChange(new Date());

  const titleText = React.useMemo(() => {
    if (view === "month") {
      return `${year}年${month + 1}月`;
    }
    if (view === "week") {
      // 计算周范围
      const dayOfWeek = currentDate.getDay();
      const weekStart = new Date(currentDate);
      weekStart.setDate(currentDate.getDate() - dayOfWeek);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      if (weekStart.getMonth() === weekEnd.getMonth()) {
        return `${year}年${weekStart.getMonth() + 1}月 ${weekStart.getDate()}-${weekEnd.getDate()}日`;
      }
      return `${year}年${weekStart.getMonth() + 1}月${weekStart.getDate()}日 - ${weekEnd.getMonth() + 1}月${weekEnd.getDate()}日`;
    }
    return `${year}年${month + 1}月${currentDate.getDate()}日 ${WEEKDAY_NAMES[currentDate.getDay()]}`;
  }, [currentDate, view]);

  return (
    <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-[120px] text-center text-sm font-medium">{titleText}</span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="ml-2 h-7 text-xs"
          onClick={goToday}
        >
          今天
        </Button>
      </div>

      <div className="flex items-center rounded border border-border">
        {VIEW_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onViewChange(opt.value)}
            className={cn(
              "px-3 py-1 text-xs transition-colors first:rounded-l last:rounded-r",
              view === opt.value
                ? "bg-primary/20 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
