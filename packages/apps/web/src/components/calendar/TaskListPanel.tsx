/**
 * TaskListPanel — 底部选中日期的任务列表（可折叠）
 */

import * as React from "react";
import { X, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@artifex-nexus/ui";
import type { CalendarTask } from "../../lib/calendar/types";
import { TaskItem } from "./TaskItem";

interface TaskListPanelProps {
  date: Date;
  tasks: CalendarTask[];
  onTaskClick: (task: CalendarTask) => void;
  onClose: () => void;
}

export function TaskListPanel({ date, tasks, onTaskClick, onClose }: TaskListPanelProps) {
  const [collapsed, setCollapsed] = React.useState(false);

  const highFreqTasks = tasks.filter((t) => t.isHighFreq);
  const normalTasks = tasks.filter((t) => !t.isHighFreq);

  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

  return (
    <div className="shrink-0 border-t border-border bg-panel/50">
      {/* Header — div+role 避免嵌套 button */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setCollapsed(!collapsed)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCollapsed(!collapsed); } }}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left hover:bg-accent/20 transition-colors cursor-pointer"
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        )}
        <span className="text-xs font-medium">
          {dateStr}
        </span>
        <span className="text-[10px] text-muted-foreground">
          共 {tasks.length} 个任务
          {highFreqTasks.length > 0 && ` (含 ${highFreqTasks.length} 个高频)`}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="ml-auto flex h-5 w-5 items-center justify-center rounded hover:bg-muted/50"
        >
          <X className="h-3 w-3 text-muted-foreground" />
        </button>
      </div>

      {/* Task List */}
      {!collapsed && (
        <div className="max-h-[180px] overflow-y-auto border-t border-border/30">
          {tasks.length === 0 && (
            <div className="py-3 text-center text-[10px] text-muted-foreground">
              该日期无匹配任务
            </div>
          )}

          {/* 高频任务先显示（折叠到汇总行） */}
          {highFreqTasks.length > 0 && (
            <div className="border-b border-border/20 px-3 py-1">
              <HighFreqGroup tasks={highFreqTasks} onTaskClick={onTaskClick} />
            </div>
          )}

          {/* 普通任务 */}
          {normalTasks.map((t) => (
            <TaskItem key={t.id} task={t} onClick={() => onTaskClick(t)} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 高频任务汇总组 */
function HighFreqGroup({
  tasks,
  onTaskClick,
}: {
  tasks: CalendarTask[];
  onTaskClick: (task: CalendarTask) => void;
}) {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 py-1 text-[10px] hover:text-foreground transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-amber-400" />
        ) : (
          <ChevronRight className="h-3 w-3 text-amber-400" />
        )}
        <span className="text-amber-400 font-medium">⚡ 高频任务 ×{tasks.length}</span>
        <span className="text-muted-foreground">
          {tasks.map((t) => t.title).join(" · ")}
        </span>
      </button>
      {expanded && (
        <div className="ml-5 border-l border-amber-400/20 pl-2">
          {tasks.map((t) => (
            <TaskItem key={t.id} task={t} onClick={() => onTaskClick(t)} compact />
          ))}
        </div>
      )}
    </div>
  );
}
