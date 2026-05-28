/**
 * 日历数据 API：聚合 Nexus-Tool 触发器 + OpenClaw cron 任务
 */

import type { CalendarTask } from "./types";
import type { NexusToolItem, NexusToolTrigger, ScheduleConfig } from "../nexus-tool/nexus-tool-api";
import { nexusToolList } from "../nexus-tool/nexus-tool-api";
import { parseInterval, isHighFrequency, isCronHighFrequency, getCronRunTimes, getIntervalRunTimes } from "./cron-utils";
import type { OpenClawCronJob } from "../../ipc/openclaw";

// ─── 颜色映射 ──────────────────────────────────────────────────────────────────

const NEXUS_COLORS = {
  enabled: "#3b82f6",   // blue-500
  disabled: "#6b7280",  // gray-500
};

const OPENCLAW_COLORS = {
  enabled: "#22c55e",   // green-500
  disabled: "#6b7280",  // gray-500（已执行完的单次任务不需要引起关注）
};

// ─── 核心导出函数 ──────────────────────────────────────────────────────────────

/**
 * 获取指定日期的所有日历任务（聚合两个数据源）。
 * @param date 目标日期
 * @param cachedTools 可选传入已加载的 tool 列表，避免重复请求
 */
export async function loadCalendarTasks(
  date: Date,
  cachedTools?: NexusToolItem[],
): Promise<CalendarTask[]> {
  const tasks: CalendarTask[] = [];

  // 1. 加载 Nexus-Tool 定时触发器
  const tools = cachedTools ?? (await loadNexusTools());
  const nexusTasks = extractNexusToolTasks(tools, date);
  tasks.push(...nexusTasks);

  // 2. 加载 OpenClaw cron 任务
  try {
    const openclawTasks = await loadOpenClawTasks(date);
    tasks.push(...openclawTasks);
  } catch {
    // OpenClaw cron 读取失败时静默降级
  }

  return tasks;
}

/** 加载所有 Nexus-Tool（含触发器） */
async function loadNexusTools(): Promise<NexusToolItem[]> {
  try {
    const result = await nexusToolList({ limit: 200 });
    return result.items;
  } catch {
    return [];
  }
}

/** 从 Nexus-Tool 列表中提取定时触发器任务 */
function extractNexusToolTasks(tools: NexusToolItem[], date: Date): CalendarTask[] {
  const tasks: CalendarTask[] = [];

  for (const tool of tools) {
    if (!tool.triggers || tool.triggers.length === 0) continue;

    for (const trigger of tool.triggers) {
      if (trigger.triggerType !== "schedule") continue;
      if (!trigger.enabled) {
        // 禁用的触发器也显示，但标记 disabled
      }
      if (!trigger.scheduleConfig) continue;

      const task = buildNexusTask(tool, trigger, date);
      if (task) tasks.push(task);
    }
  }

  return tasks;
}

function buildNexusTask(
  tool: NexusToolItem,
  trigger: NexusToolTrigger,
  date: Date,
): CalendarTask | null {
  const config = trigger.scheduleConfig!;
  const runTimes = computeRunTimes(config, date);
  const intervalMins = config.interval ? parseInterval(config.interval) : 0;

  return {
    id: `nexus:${tool.id}:${trigger.id}`,
    title: trigger.name || tool.name,
    source: "nexus-tool",
    scheduleType: config.type,
    interval: config.interval,
    cron: config.cron,
    runAt: config.runAt,
    toolId: tool.id,
    toolName: tool.name,
    enabled: trigger.enabled,
    runTimes: runTimes.map((t) => t.toISOString()),
    isHighFreq: isTaskHighFrequency(config),
    color: trigger.enabled ? NEXUS_COLORS.enabled : NEXUS_COLORS.disabled,
  };
}

/** 判断 ScheduleConfig 是否为高频任务（interval || cron 均处理） */
function isTaskHighFrequency(config: ScheduleConfig): boolean {
  if (config.type === "interval") {
    return isHighFrequency(config.interval || "");
  }
  if (config.type === "cron" && config.cron) {
    return isCronHighFrequency(config.cron);
  }
  return false;
}

/** 计算 ScheduleConfig 在指定月份的**所有**执行时间列表 */
function computeRunTimes(config: ScheduleConfig, date: Date): Date[] {
  const year = date.getFullYear();
  const month = date.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  switch (config.type) {
    case "interval": {
      const mins = parseInterval(config.interval || "0");
      if (mins <= 0) return [];
      const allTimes: Date[] = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const dayDate = new Date(year, month, d);
        allTimes.push(...getIntervalRunTimes(dayDate, mins));
      }
      return allTimes;
    }
    case "cron": {
      if (!config.cron) return [];
      const allTimes: Date[] = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const dayDate = new Date(year, month, d);
        allTimes.push(...getCronRunTimes(dayDate, config.cron));
      }
      return allTimes;
    }
    case "once": {
      if (!config.runAt) return [];
      const runDate = new Date(config.runAt);
      if (
        runDate.getFullYear() === year &&
        runDate.getMonth() === month
      ) {
        return [runDate];
      }
      return [];
    }
  }
}

// ─── OpenClaw Cron 任务 ────────────────────────────────────────────────────────

/** 读取 OpenClaw cron jobs 文件并转换为 CalendarTask */
async function loadOpenClawTasks(date: Date): Promise<CalendarTask[]> {
  try {
    const { readOpenClawCronJobs } = await import("../../ipc/openclaw");
    const result = await readOpenClawCronJobs();
    if (!result.ok || !result.jobs) return [];

    return result.jobs.map((job) => buildOpenClawTask(job, date));
  } catch {
    return [];
  }
}

function buildOpenClawTask(job: OpenClawCronJob, date: Date): CalendarTask {
  const schedule = job.schedule;
  if (!schedule) {
    // 无 schedule 的 job 仍显示但有提示
    return {
      id: `openclaw:${job.id}`,
      title: job.name || job.id,
      source: "openclaw",
      scheduleType: "cron",
      enabled: job.enabled !== false,
      runTimes: [],
      isHighFreq: false,
      color: OPENCLAW_COLORS.disabled,
      jobId: job.id,
    };
  }

  const isCron = schedule.kind === "cron";
  const isAt = schedule.kind === "at";

  const enabled = job.enabled !== false;
  const cron = isCron ? (schedule.expr || "") : "";
  const runAt = isAt ? (schedule.at || undefined) : undefined;

  // 计算当月所有 runTimes
  let runTimes: Date[] = [];
  const year = date.getFullYear();
  const month = date.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  if (isCron && schedule.expr) {
    for (let d = 1; d <= daysInMonth; d++) {
      const dayDate = new Date(year, month, d);
      runTimes.push(...getCronRunTimes(dayDate, schedule.expr));
    }
  } else if (isAt && schedule.at) {
    const at = new Date(schedule.at);
    if (
      at.getFullYear() === year &&
      at.getMonth() === month
    ) {
      runTimes = [at];
    }
  }

  return {
    id: `openclaw:${job.id}`,
    title: job.name || job.id,
    source: "openclaw",
    scheduleType: isAt ? "once" : "cron",
    cron: cron || undefined,
    runAt,
    enabled,
    runTimes: runTimes.map((t) => t.toISOString()),
    isHighFreq: isCron && schedule.expr ? isCronHighFrequency(schedule.expr) : false,
    color: enabled ? OPENCLAW_COLORS.enabled : OPENCLAW_COLORS.disabled,
    jobId: job.id,
    agentId: job.agentId,
    sessionKey: job.sessionKey,
  };
}
