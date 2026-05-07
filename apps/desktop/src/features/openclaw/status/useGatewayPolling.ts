// STORY-0018 T4：gateway 状态 + 日志增量轮询 hook
//
// 调度规则（spec §4.3）：
// - 每 1s 轮询 openclaw.gateway.status
// - status.state === "running" 时同时增量拉 openclaw.gateway.tail_log（since_id = 上次 max_id）
// - 首次拿到 status 时初始化 since_id = status.last_log_id（避免一次拉 8000 行）
// - 组件卸载时停轮询
//
// 性能保证：所有调用串行（同一 setInterval tick 内 await），不会堆积；
// gateway 已停时跳过 tail_log 节省一次 RPC。

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type GatewayLogEntry,
  type GatewayStatus,
  getGatewayStatus,
  tailGatewayLog,
} from "../../../ipc/openclaw";

/** 日志窗口最大保留行数（spec §4.1：最近 200 行虚拟列表） */
const LOG_WINDOW = 200;

/** 轮询间隔（spec §4.3） */
const POLL_INTERVAL_MS = 1000;

/** useGatewayPolling 返回值 */
export interface GatewayPollingState {
  /** 当前 gateway 状态；初次加载未拿到时为 null */
  status: GatewayStatus | null;
  /** 滚动日志窗口（按 id 升序，仅保留最近 LOG_WINDOW 行） */
  logs: GatewayLogEntry[];
  /** 最近一次 tail_log 反馈的 dropped 计数（前端可提示用户用 CLI tail） */
  dropped: number;
  /** 上次轮询是否出错；空字符串表示无错 */
  pollError: string;
  /** 手动清屏（不影响 sidecar buffer，仅清前端窗口） */
  clearLogs: () => void;
  /** 手动触发一次轮询（按钮反馈用，不取代定时） */
  refreshNow: () => Promise<void>;
}

/** 1s 轮询 gateway 状态 + 增量拉日志的 hook */
export function useGatewayPolling(): GatewayPollingState {
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [logs, setLogs] = useState<GatewayLogEntry[]>([]);
  const [dropped, setDropped] = useState(0);
  const [pollError, setPollError] = useState("");

  // since_id 用 ref 而非 state：tick 内同步读写，避免 setState 异步导致重复拉
  const sinceIdRef = useRef<number | null>(null);
  // 标志：组件已卸载，禁止 setState（避免 React act warning）
  const aliveRef = useRef(true);

  const tick = useCallback(async () => {
    try {
      const next = await getGatewayStatus();
      if (!aliveRef.current) return;
      setStatus(next);
      setPollError("");

      // 首次：初始化 since_id 为 status.last_log_id，跳过历史日志
      if (sinceIdRef.current === null) {
        sinceIdRef.current = next.last_log_id;
      }

      // 仅 running 时拉日志：stopped/errored 时 sidecar 不会再产新行，省一次 RPC
      if (next.state !== "running") return;

      const batch = await tailGatewayLog({ sinceId: sinceIdRef.current });
      if (!aliveRef.current) return;

      if (batch.entries.length > 0) {
        setLogs((prev) => {
          const merged = [...prev, ...batch.entries];
          // 滑动窗口：超过 LOG_WINDOW 截掉前面
          return merged.length > LOG_WINDOW
            ? merged.slice(merged.length - LOG_WINDOW)
            : merged;
        });
        sinceIdRef.current = batch.max_id;
      }
      setDropped(batch.dropped);
    } catch (e) {
      if (!aliveRef.current) return;
      setPollError(String(e));
    }
  }, []);

  // 启动定时器
  useEffect(() => {
    aliveRef.current = true;
    // 立即跑一次，再起定时
    void tick();
    const id = setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);

    return () => {
      aliveRef.current = false;
      clearInterval(id);
    };
  }, [tick]);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const refreshNow = useCallback(async () => {
    await tick();
  }, [tick]);

  return { status, logs, dropped, pollError, clearLogs, refreshNow };
}
