/**
 * CalendarPage — 日历面板主页面
 *
 * 聚合显示 Nexus-Tool 定时触发器 + OpenClaw cron 任务。
 * 支持月/周/日三种视图 + 来源/周期双层筛选。
 * 高频任务（<= 4h interval）不在日历网格中显示，仅在底部任务列表展示。
 */

"use client";

import * as React from "react";
import type { CalendarTask, CalendarView, SourceFilter, PeriodFilter } from "../../lib/calendar/types";
import { loadCalendarTasks } from "../../lib/calendar/api";
import { parseInterval } from "../../lib/calendar/cron-utils";
import type { NexusToolItem } from "../../lib/nexus-tool/nexus-tool-api";
import { nexusToolList } from "../../lib/nexus-tool/nexus-tool-api";
import { CalendarHeader } from "./CalendarHeader";
import { CalendarFilterBar } from "./CalendarFilterBar";
import { MonthView } from "./MonthView";
import { WeekView } from "./WeekView";
import { DayView } from "./DayView";
import { TaskListPanel } from "./TaskListPanel";
import { PreviewContext } from "../shell/AppShell";

export function CalendarPage() {
  const today = React.useMemo(() => new Date(), []);
  const [currentDate, setCurrentDate] = React.useState(today);
  const [view, setView] = React.useState<CalendarView>("month");
  const [sourceFilter, setSourceFilter] = React.useState<SourceFilter>("all");
  const [periodFilter, setPeriodFilter] = React.useState<PeriodFilter>("all");
  const [selectedDate, setSelectedDate] = React.useState<Date | null>(null);

  const [tasks, setTasks] = React.useState<CalendarTask[]>([]);
  const [tools, setTools] = React.useState<NexusToolItem[]>([]);
  const [loading, setLoading] = React.useState(true);

  const { setPreview, ensurePanelOpen } = React.useContext(PreviewContext);

  // 初始加载 tool 列表
  React.useEffect(() => {
    (async () => {
      try {
        const result = await nexusToolList({ limit: 200 });
        setTools(result.items);
      } catch { /* silent */ }
    })();
  }, []);

  // 当前月份变化时重新加载任务
  React.useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const loaded = await loadCalendarTasks(currentDate, tools);
        setTasks(loaded);
      } catch { /* silent */ }
      finally { setLoading(false); }
    })();
  }, [currentDate, tools]);

  // ── 筛选 ──────────────────────────────────────────────────────
  const filteredTasks = React.useMemo(() => {
    return tasks.filter((t) => {
      // 来源筛选
      if (sourceFilter !== "all" && t.source !== sourceFilter) return false;
      // 周期筛选
      if (periodFilter !== "all") {
        switch (periodFilter) {
          case "high": if (!t.isHighFreq) return false; break;
          case "normal":
            // 常规 = interval 4h~12h（非高频、非单次）
            if (t.isHighFreq || t.scheduleType === "once") return false;
            if (t.scheduleType === "interval") {
              const mins = parseInterval(t.interval || "0");
              if (mins <= 240 || mins > 12 * 60) return false;
            } else return false;
            break;
          case "low":
            // 低频 = interval > 12h + cron（非高频）
            if (t.isHighFreq || t.scheduleType === "once") return false;
            if (t.scheduleType === "interval") {
              const mins = parseInterval(t.interval || "0");
              if (mins <= 12 * 60) return false;
            } else if (t.scheduleType !== "cron") return false;
            break;
          case "once": if (t.scheduleType !== "once") return false; break;
        }
      }
      return true;
    });
  }, [tasks, sourceFilter, periodFilter]);

  // 日历视图用的任务（排除高频任务）
  const viewTasks = React.useMemo(
    () => filteredTasks.filter((t) => !t.isHighFreq),
    [filteredTasks],
  );

  // 高频任务日期集合（用于日历视图显示 ⚡ 标记）
  const highFreqDateSet = React.useMemo(() => {
    const set = new Set<string>();
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    filteredTasks
      .filter((t) => t.isHighFreq)
      .forEach((t) => {
        t.runTimes.forEach((rt) => {
          const d = new Date(rt);
          if (d.getFullYear() === year && d.getMonth() === month) {
            set.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
          }
        });
      });

    return set;
  }, [filteredTasks, currentDate]);

  // ── 选中日期的任务（包含高频，底部面板用） ────────────────────
  const selectedDateTasks = React.useMemo(() => {
    if (!selectedDate) return [];
    return filteredTasks.filter((t) => {
      return t.runTimes.some((rt) => {
        const d = new Date(rt);
        return (
          d.getFullYear() === selectedDate.getFullYear() &&
          d.getMonth() === selectedDate.getMonth() &&
          d.getDate() === selectedDate.getDate()
        );
      });
    });
  }, [filteredTasks, selectedDate]);

  // ── 计算每个日期的任务数（供月视图使用，排除高频） ──────────
  const dateTaskCountMap = React.useMemo(() => {
    const map = new Map<string, { total: number; tasks: CalendarTask[] }>();
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    viewTasks.forEach((t) => {
      t.runTimes.forEach((rt) => {
        const d = new Date(rt);
        if (d.getFullYear() === year && d.getMonth() === month) {
          const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
          const entry = map.get(key) || { total: 0, tasks: [] };
          entry.total++;
          if (!entry.tasks.find((x) => x.id === t.id)) {
            entry.tasks.push(t);
          }
          map.set(key, entry);
        }
      });
    });

    return map;
  }, [viewTasks, currentDate]);

  // ── 任务点击 → 右侧面板 ──────────────────────────────────────
  const handleTaskClick = React.useCallback(
    (task: CalendarTask) => {
      ensurePanelOpen();
      if (task.source === "nexus-tool" && task.toolId) {
        setPreview({
          kind: "nexus-tool-detail",
          title: task.toolName || task.title,
          data: { toolId: task.toolId, toolName: task.toolName || task.title },
        });
      } else {
        // OpenClaw 任务 / 无 toolId 的 Nexus 任务 → 通用任务详情
        setPreview({
          kind: "calendar-task-detail",
          title: task.title,
          data: { task },
        });
      }
    },
    [setPreview, ensurePanelOpen],
  );

  // ── 日期点击 ──────────────────────────────────────────────────
  const handleDateClick = React.useCallback((date: Date) => {
    setSelectedDate(date);
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Header */}
      <CalendarHeader
        currentDate={currentDate}
        view={view}
        onDateChange={setCurrentDate}
        onViewChange={setView}
      />

      {/* Filter Bar */}
      <CalendarFilterBar
        sourceFilter={sourceFilter}
        periodFilter={periodFilter}
        onSourceChange={setSourceFilter}
        onPeriodChange={setPeriodFilter}
      />

      {/* Calendar Body */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {loading ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            加载中...
          </div>
        ) : view === "month" ? (
          <MonthView
            currentDate={currentDate}
            selectedDate={selectedDate}
            dateTaskCountMap={dateTaskCountMap}
            highFreqDateSet={highFreqDateSet}
            onDateClick={handleDateClick}
          />
        ) : view === "week" ? (
          <WeekView
            currentDate={currentDate}
            selectedDate={selectedDate}
            tasks={viewTasks}
            highFreqDateSet={highFreqDateSet}
            onDateClick={handleDateClick}
            onTaskClick={handleTaskClick}
          />
        ) : (
          <DayView
            currentDate={currentDate}
            tasks={viewTasks}
            highFreqDateSet={highFreqDateSet}
            onDateClick={handleDateClick}
            onTaskClick={handleTaskClick}
          />
        )}
      </div>

      {/* Selected Date Tasks Panel */}
      {selectedDate && (
        <TaskListPanel
          date={selectedDate}
          tasks={selectedDateTasks}
          onTaskClick={handleTaskClick}
          onClose={() => setSelectedDate(null)}
        />
      )}
    </div>
  );
}
