// 事件/日志面板：底部可折叠，显示安装过程中的日志流。
// Event/Log panel: collapsible bottom panel showing install log stream.
// 按 UI spec §5.6 设计。

import { useState, useRef, useEffect, useCallback } from "react";
import styles from "./LogPanel.module.css";

/** 日志条目 */
export interface LogEntry {
  /** ISO 时间戳 */
  time: string;
  /** 关联的安装项 id */
  itemId: string;
  /** 关联的子项 label（可选） */
  childLabel?: string;
  /** 日志级别 */
  level: "info" | "warn" | "error";
  /** 消息内容 */
  message: string;
}

/** 日志面板 props */
interface LogPanelProps {
  entries: LogEntry[];
  onClear: () => void;
  onRetry?: (itemId: string) => void;
}

/** 格式化时间为 HH:MM:SS */
function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
}

/** 级别徽章颜色 */
const LEVEL_COLORS: Record<LogEntry["level"], string> = {
  info: "#2563eb",
  warn: "#d97706",
  error: "#dc2626",
};

const LEVEL_LABELS: Record<LogEntry["level"], string> = {
  info: "信息",
  warn: "警告",
  error: "错误",
};

function LogPanel({ entries, onClear, onRetry }: LogPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [followTail, setFollowTail] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部（跟随最新行）
  useEffect(() => {
    if (followTail && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [entries, followTail]);

  const handleScroll = useCallback(() => {
    if (!listRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    // 如果用户手动滚到接近底部，恢复跟随
    setFollowTail(scrollHeight - scrollTop - clientHeight < 40);
  }, []);

  const handleCopyAll = useCallback(() => {
    const text = entries
      .map(
        (e) =>
          `[${formatTime(e.time)}] [${e.itemId}${e.childLabel ? `/${e.childLabel}` : ""}] ${LEVEL_LABELS[e.level]}: ${e.message}`,
      )
      .join("\n");
    navigator.clipboard.writeText(text).catch(console.error);
  }, [entries]);

  return (
    <div className={`${styles.panel} ${collapsed ? styles.collapsed : ""}`}>
      {/* 标题条 */}
      <div className={styles.header} onClick={() => setCollapsed(!collapsed)}>
        <span className={styles.headerTitle}>
          {collapsed ? "▶" : "▼"} 事件 / 日志
          {entries.length > 0 && (
            <span className={styles.count}>{entries.length}</span>
          )}
        </span>
        {!collapsed && (
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.headerBtn}
              onClick={(e) => {
                e.stopPropagation();
                setFollowTail(!followTail);
              }}
              title={followTail ? "取消跟随" : "跟随最新"}
            >
              {followTail ? "📌" : "📍"}
            </button>
            <button
              type="button"
              className={styles.headerBtn}
              onClick={(e) => {
                e.stopPropagation();
                handleCopyAll();
              }}
              title="复制全部"
            >
              📋
            </button>
            <button
              type="button"
              className={styles.headerBtn}
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              title="清空"
            >
              🗑
            </button>
          </div>
        )}
      </div>

      {/* 日志列表 */}
      {!collapsed && (
        <div className={styles.list} ref={listRef} onScroll={handleScroll}>
          {entries.length === 0 ? (
            <div className={styles.empty}>暂无日志</div>
          ) : (
            entries.map((entry, i) => (
              <div key={i} className={styles.entry}>
                <span className={styles.entryTime}>
                  {formatTime(entry.time)}
                </span>
                <span className={styles.entrySource}>
                  [{entry.itemId}
                  {entry.childLabel ? `/${entry.childLabel}` : ""}]
                </span>
                <span
                  className={styles.entryLevel}
                  style={{ color: LEVEL_COLORS[entry.level] }}
                >
                  {LEVEL_LABELS[entry.level]}
                </span>
                <span className={styles.entryMsg}>{entry.message}</span>
                {entry.level === "error" && onRetry && (
                  <button
                    type="button"
                    className={styles.retryBtn}
                    onClick={() => onRetry(entry.itemId)}
                  >
                    重试
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default LogPanel;
