// STORY-0018 T4：Gateway 状态卡片
// 状态点 + 元数据（PID/端口/启动时间） + 3 按钮（启动/重启/Web UI/AN Web UI）
//
// 行为对齐 spec §1（线框图） + §6（验收）：
// - state=running → 绿点 + "重启 Gateway" 按钮可点
// - state=stopped → 灰点 + "启动 Gateway" 按钮可点
// - state=errored → 红点 + last_error 横幅 + "启动 Gateway" 按钮可点
// - "OpenClaw Web UI" running 时可点；非 running 时灰
// - "Artifex Nexus Web UI" 永远 disabled，tooltip "M3 milestone 实装"

import { useState } from "react";
import {
  type GatewayStatus,
  openOpenClawWebUi,
  restartGateway,
  startGateway,
} from "../../../ipc/openclaw";
import styles from "./StatusPanel.module.css";

interface Props {
  status: GatewayStatus | null;
  /** 触发后强制重拉一次 status，让 UI 立即响应 */
  onAfterAction: () => Promise<void>;
}

function formatStartedAt(ts: number | null): string {
  if (ts === null) return "—";
  try {
    return new Date(ts * 1000).toLocaleString("zh-CN", {
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return String(ts);
  }
}

function GatewayStatusCard({ status, onAfterAction }: Props) {
  const [busy, setBusy] = useState(false);
  const [opError, setOpError] = useState("");

  const state = status?.state ?? "stopped";
  const isRunning = state === "running";
  const isErrored = state === "errored";

  const dotClass = isRunning
    ? styles.dotRunning
    : isErrored
      ? styles.dotErrored
      : styles.dotStopped;
  const stateLabel = isRunning ? "运行中" : isErrored ? "异常" : "未运行";

  const startBtnLabel = isRunning ? "↻ 重启 Gateway" : "▶ 启动 Gateway";

  const handleStartOrRestart = async () => {
    setBusy(true);
    setOpError("");
    try {
      if (isRunning) {
        await restartGateway();
      } else {
        await startGateway();
      }
      await onAfterAction();
    } catch (e) {
      setOpError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleOpenWebUi = async () => {
    setBusy(true);
    setOpError("");
    try {
      const r = await openOpenClawWebUi();
      if (!r.success) {
        setOpError(r.error ?? "打开 OpenClaw Web UI 失败");
      }
    } catch (e) {
      setOpError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.card} aria-label="OpenClaw Gateway">
      <h2 className={styles.cardTitle}>OpenClaw Gateway</h2>

      <div className={styles.gatewayHeader}>
        <span className={`${styles.dot} ${dotClass}`} aria-hidden="true" />
        <span className={styles.stateLabel}>{stateLabel}</span>
      </div>

      <div className={styles.gatewayMeta}>
        PID <code>{status?.pid ?? "—"}</code> · 端口{" "}
        <code>{status?.port ?? "—"}</code> · 启动于{" "}
        <code>{formatStartedAt(status?.started_at ?? null)}</code>
      </div>

      {isErrored && status?.last_error && (
        <div className={styles.gatewayError}>
          最后错误：{status.last_error}
        </div>
      )}

      {opError && <div className={styles.gatewayError}>{opError}</div>}

      <div className={styles.btnRow}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={handleStartOrRestart}
          disabled={busy}
          aria-label={startBtnLabel}
        >
          {startBtnLabel}
        </button>
        <button
          type="button"
          className={styles.btn}
          onClick={handleOpenWebUi}
          disabled={busy || !isRunning}
          title={
            isRunning ? "在系统浏览器打开 OpenClaw Web UI" : "Gateway 未运行"
          }
          aria-label="打开 OpenClaw Web UI"
        >
          🌐 OpenClaw Web UI
        </button>
        <button
          type="button"
          className={styles.btn}
          disabled
          title="M3 milestone 实装"
          aria-label="Artifex Nexus Web UI（M3 实装，当前不可用）"
        >
          🚀 Artifex Nexus Web UI
        </button>
      </div>
    </section>
  );
}

export default GatewayStatusCard;
