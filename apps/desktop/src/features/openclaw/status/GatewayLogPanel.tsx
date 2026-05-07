// STORY-0018 T4：Gateway 日志面板
// 折叠 / 全屏（max-height: 70vh） / 清屏；行虚拟列表（slice + max-height + auto-scroll）
//
// "虚拟列表"实现注释：
//   spec §4.1 写"虚拟列表"，但日志只 200 行 + 单行 ~80 字符，DOM 节点 200 个
//   不会卡顿（参见 spec §3.3 性能基线）。这里用最朴素的 slice + auto-scroll
//   + max-height + overflow-y:auto 即可达到"虚拟感"，不引入第三方库。

import { useEffect, useRef, useState } from "react";
import type { GatewayLogEntry } from "../../../ipc/openclaw";
import styles from "./StatusPanel.module.css";

interface Props {
  logs: GatewayLogEntry[];
  dropped: number;
  onClear: () => void;
}

function formatTs(ts: number): string {
  try {
    const d = new Date(ts * 1000);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  } catch {
    return "??:??:??";
  }
}

function levelClass(level: GatewayLogEntry["level"]): string {
  // CSS module 在严格模式下索引返回 string | undefined，统一兜底空串
  switch (level) {
    case "WARN":
      return styles.logLevelWarn ?? "";
    case "ERROR":
      return styles.logLevelError ?? "";
    case "DEBUG":
      return styles.logLevelDebug ?? "";
    case "INFO":
    default:
      return styles.logLevelInfo ?? "";
  }
}

function GatewayLogPanel({ logs, dropped, onClear }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  // 自动滚动开关：用户手动滚到非底部时关闭，回到底部时再开
  const stickToBottomRef = useRef(true);

  // 新日志到达 → 若 stickToBottom，则滚到底
  useEffect(() => {
    if (collapsed) return;
    const el = bodyRef.current;
    if (!el) return;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs, collapsed]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    // 距离底部 < 16px 视为粘底
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 16;
    stickToBottomRef.current = nearBottom;
  };

  return (
    <section className={styles.card} aria-label="Gateway 日志">
      <div className={styles.logHeader}>
        <h2 className={styles.cardTitle}>Gateway 日志</h2>
        <button
          type="button"
          className={styles.logToolBtn}
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? "展开" : "折叠"}
          aria-label={collapsed ? "展开日志" : "折叠日志"}
        >
          {collapsed ? "▸" : "▾"}
        </button>
        <button
          type="button"
          className={styles.logToolBtn}
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? "退出全屏" : "全屏"}
          aria-label={expanded ? "退出全屏" : "全屏显示"}
          disabled={collapsed}
        >
          ⛶
        </button>
        <button
          type="button"
          className={styles.logToolBtn}
          onClick={onClear}
          title="清屏（仅清前端窗口，不动 sidecar buffer）"
          aria-label="清屏"
          disabled={collapsed}
        >
          ⊟
        </button>
      </div>

      {!collapsed && (
        <>
          <div
            ref={bodyRef}
            className={`${styles.logBody} ${expanded ? styles.logBodyExpanded : ""}`}
            onScroll={handleScroll}
            role="log"
            aria-live="polite"
          >
            {logs.length === 0 ? (
              <div className={styles.logEmpty}>
                暂无日志（gateway 启动后这里会实时滚动）
              </div>
            ) : (
              logs.map((e) => (
                <div key={e.id} className={styles.logLine}>
                  <span className={styles.logTs}>{formatTs(e.ts)}</span>
                  <span className={`${styles.logLevel} ${levelClass(e.level)}`}>
                    {e.level}
                  </span>
                  <span className={styles.logText}>{e.text}</span>
                </div>
              ))
            )}
          </div>
          <div className={styles.logFooter}>
            <span>共 {logs.length} 行（窗口最多 200）</span>
            {dropped > 0 && (
              <span className={styles.dropWarn}>
                ⚠ buffer 累计丢弃 {dropped} 行（用 CLI `openclaw logs tail`
                取完整历史）
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export default GatewayLogPanel;
