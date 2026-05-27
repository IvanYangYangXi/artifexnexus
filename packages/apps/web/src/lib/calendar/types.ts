/**
 * 日历任务统一数据模型
 *
 * 聚合两类定时任务：
 *   1. Nexus-Tool 定时触发器（triggerType="schedule"）
 *   2. OpenClaw cron jobs（~/.artifexnexus/.openclaw/state/cron/jobs.json）
 */

export type TaskSource = "nexus-tool" | "openclaw";
export type ScheduleType = "interval" | "cron" | "once";

export interface CalendarTask {
  id: string;
  title: string;
  source: TaskSource;
  scheduleType: ScheduleType;
  /** 间隔字符串（only for interval），如 30m, 1h, 2h30m */
  interval?: string;
  /** cron 表达式（only for cron），如 0 *&#47;6 * * * * */
  cron?: string;
  /** 单次执行时间 ISO datetime（only for once） */
  runAt?: string;
  /** Nexus-Tool 专属字段 */
  toolId?: string;
  toolName?: string;
  /** 任务启用状态 */
  enabled: boolean;
  /** 计算出的指定日期内的执行时间列表（ISO datetime[]） */
  runTimes: string[];
  /** 是否为高频任务（interval <= 4h），不在日历视图中显示 */
  isHighFreq: boolean;
  /** 颜色标识 */
  color: string;
  /** OpenClaw 专属：cron job ID（用于过滤关联的对话） */
  jobId?: string;
  /** OpenClaw 专属：agent ID */
  agentId?: string;
  /** OpenClaw 专属：关联的 session key */
  sessionKey?: string;
}

/** 视图模式 */
export type CalendarView = "month" | "week" | "day";

/** 来源筛选 */
export type SourceFilter = "all" | "nexus-tool" | "openclaw";

/** 周期筛选 */
export type PeriodFilter = "all" | "high" | "normal" | "low" | "once";
