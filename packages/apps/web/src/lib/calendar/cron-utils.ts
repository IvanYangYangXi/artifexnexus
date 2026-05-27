/**
 * 日历工具函数：interval 解析 / cron 下次执行时间计算 / 高频判断
 */

/**
 * 解析 interval 字符串为分钟数。
 * 支持格式: "5m", "30m", "1h", "2h30m", "1d"
 */
export function parseInterval(interval: string): number {
  let totalMinutes = 0;
  const daysMatch = interval.match(/(\d+)d/);
  if (daysMatch) totalMinutes += parseInt(daysMatch[1], 10) * 24 * 60;
  const hoursMatch = interval.match(/(\d+)h/);
  if (hoursMatch) totalMinutes += parseInt(hoursMatch[1], 10) * 60;
  const minsMatch = interval.match(/(\d+)m/);
  if (minsMatch) totalMinutes += parseInt(minsMatch[1], 10);
  return totalMinutes || 0;
}

/** 判断是否为高频任务（<= 4h）。高频任务不显示在日历网格中。 */
export function isHighFrequency(interval: string): boolean {
  return parseInterval(interval) <= 240; // 4 小时 = 240 分钟
}

/**
 * 判断 cron 表达式对应的任务是否为高频任务（最小执行间隔 <= 4h）。
 * 分析 minute/hour 字段的步进模式来估算最小间隔。
 */
export function isCronHighFrequency(cron: string): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return false;

  const [minField, hourField] = parts;

  let minInterval = 24 * 60; // 默认：一天一次

  // minute 字段分析
  if (minField.startsWith("*/")) {
    minInterval = Math.min(minInterval, parseInt(minField.slice(2), 10));
  } else if (minField === "*") {
    minInterval = Math.min(minInterval, 1); // 每分钟
  }

  // hour 字段分析
  if (hourField.startsWith("*/")) {
    minInterval = Math.min(minInterval, parseInt(hourField.slice(2), 10) * 60);
  } else if (hourField === "*") {
    minInterval = Math.min(minInterval, 60); // 每小时（分钟字段固定时）
  }

  return minInterval <= 240;
}

/**
 * 将 cron 表达式转换为可读描述。
 * 支持标准 5 段 cron: minute hour dayOfMonth month dayOfWeek
 */
export function describeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return cron;

  const [min, hour, dom, month, dow] = parts;

  // 每天固定时间: "30 2 * * *" → "每天 02:30"
  if (dom === "*" && month === "*" && dow === "*") {
    const h = hour === "*" ? "每小时" : `${hour.padStart(2, "0")}`;
    const m = min === "*" ? "每分钟" : `${min.padStart(2, "0")}`;
    if (hour !== "*" && min !== "*") return `每天 ${h}:${m}`;
    if (hour === "*") {
      if (min.startsWith("*/")) return `每${min.slice(2)}分钟`;
      return `每小时第${min}分`;
    }
  }

  // 每周: "0 2 * * 1" → "每周一 02:00"
  if (dom === "*" && month === "*" && dow !== "*") {
    const dowNames = ["日", "一", "二", "三", "四", "五", "六"];
    const d = parseInt(dow, 10);
    const dayName = dowNames[d % 7] || dow;
    return `每周${dayName} ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  }

  // 每月: "0 2 1 * *" → "每月1日 02:00"
  if (dom !== "*" && month === "*" && dow === "*") {
    return `每月${dom}日 ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  }

  // 间隔: "*/30 * * * *" → "每30分钟"
  if (min.startsWith("*/") && hour === "*" && dom === "*" && month === "*" && dow === "*") {
    return `每${min.slice(2)}分钟`;
  }
  if (hour.startsWith("*/") && dom === "*" && month === "*" && dow === "*") {
    return `每${hour.slice(2)}小时`;
  }

  return cron;
}

/**
 * 计算指定日期内 cron 任务会触发的时间列表。
 * 简化实现：在目标日期的每分钟检查 cron 是否匹配。
 */
export function getCronRunTimes(date: Date, cron: string): Date[] {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return [];

  const [minField, hourField, domField, monthField, dowField] = parts;

  const runTimes: Date[] = [];
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const dayOfWeek = date.getDay();

  // 检查 day-of-month 匹配
  if (domField !== "*") {
    if (!fieldMatches(domField, day)) return [];
  }

  // 检查 month 匹配
  if (monthField !== "*") {
    if (!fieldMatches(monthField, month + 1)) return [];
  }

  // 检查 day-of-week 匹配
  if (dowField !== "*") {
    if (!fieldMatches(dowField, dayOfWeek)) return [];
  }

  // 遍历当天所有可能的时间和分钟
  const hours = fieldMatches(hourField, -1) ? expandField(hourField, 0, 23) : [parseInt(hourField, 10)];
  for (const h of hours) {
    const mins = fieldMatches(minField, -1) ? expandField(minField, 0, 59) : [parseInt(minField, 10)];
    for (const m of mins) {
      const t = new Date(year, month, day, h, m, 0, 0);
      // 如果 cron 有 dow 约束，再次验证
      if (dowField !== "*" && !fieldMatches(dowField, t.getDay())) continue;
      runTimes.push(t);
    }
  }

  return runTimes;
}

function fieldMatches(field: string, value: number): boolean {
  if (field === "*") return true;

  // */N step
  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10);
    return value % step === 0;
  }

  // comma-separated: 1,3,5
  if (field.includes(",")) {
    return field.split(",").some((p) => fieldMatches(p.trim(), value));
  }

  // range: 1-5
  if (field.includes("-")) {
    const [lo, hi] = field.split("-").map(Number);
    return value >= lo && value <= hi;
  }

  return parseInt(field, 10) === value;
}

function expandField(field: string, min: number, max: number): number[] {
  const results: number[] = [];

  if (field === "*") {
    for (let i = min; i <= max; i++) results.push(i);
    return results;
  }

  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10);
    for (let i = min; i <= max; i += step) results.push(i);
    return results;
  }

  if (field.includes(",")) {
    field.split(",").forEach((p) => {
      results.push(...expandField(p.trim(), min, max));
    });
    return results;
  }

  if (field.includes("-")) {
    const [lo, hi] = field.split("-").map(Number);
    for (let i = lo; i <= hi; i++) results.push(i);
    return results;
  }

  return [parseInt(field, 10)];
}

/**
 * 计算 interval 任务在指定日期内的触发时间列表。
 * 从当天 00:00 开始，按 interval 递增，直到 23:59。
 */
export function getIntervalRunTimes(date: Date, intervalMinutes: number): Date[] {
  const times: Date[] = [];
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

  let current = new Date(start.getTime());
  while (current <= end) {
    times.push(new Date(current));
    current = new Date(current.getTime() + intervalMinutes * 60 * 1000);
  }

  return times;
}

/**
 * 格式化时间为 HH:MM
 */
export function formatTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
