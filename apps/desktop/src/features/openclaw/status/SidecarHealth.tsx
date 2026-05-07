// STORY-0018 T4：Sidecar 健康状态卡片
// 从原 routes/Status.tsx 拆出来：显示 sidecar 是否运行 + 端口 + OPENCLAW_HOME

import { useEffect, useState } from "react";
import { getStatus, type StatusResponse } from "../../../ipc/status";
import styles from "./StatusPanel.module.css";

/** Sidecar 状态卡：5s 轮询，与 Gateway 状态卡（1s）独立 */
function SidecarHealth() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    const fetchOnce = async () => {
      try {
        const s = await getStatus();
        if (!alive) return;
        setStatus(s);
        setError("");
      } catch (e) {
        if (!alive) return;
        setError(String(e));
      }
    };
    void fetchOnce();
    const id = setInterval(fetchOnce, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <section className={styles.card} aria-label="Sidecar 健康状态">
      <h2 className={styles.cardTitle}>Sidecar</h2>
      {error && <div className={styles.errorBanner}>⚠️ {error}</div>}
      {status && (
        <div className={styles.sidecarRow}>
          <span
            className={`${styles.dot} ${status.sidecar_running ? styles.dotRunning : styles.dotStopped}`}
            aria-hidden="true"
          />
          <span>{status.sidecar_running ? "运行中" : "已停止"}</span>
          <span style={{ color: "#9ca3af" }}>·</span>
          <span>端口 <code>{status.port}</code></span>
          <span style={{ color: "#9ca3af" }}>·</span>
          <span>HOME <code>{status.openclaw_home}</code></span>
        </div>
      )}
      {!status && !error && (
        <div className={styles.sidecarRow} style={{ color: "#9ca3af" }}>
          正在连接 sidecar...
        </div>
      )}
    </section>
  );
}

export default SidecarHealth;
