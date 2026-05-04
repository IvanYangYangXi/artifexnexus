// 状态页：显示 sidecar 运行状态、端口、隔离目录。
// 接入 Rust get_status command 获取实时数据。

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getStatus, type StatusResponse } from "../ipc/status";

function Status() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const s = await getStatus();
        setStatus(s);
        setError("");
      } catch (e) {
        setError(String(e));
      }
    };
    fetchStatus();
    // 每 5 秒轮询
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif", maxWidth: 500, margin: "0 auto" }}>
      <h1>Artifex Nexus — 运行状态</h1>

      {error && (
        <div style={{ marginTop: "1rem", padding: "0.75rem", background: "#fef2f2", borderRadius: 8, color: "#dc2626" }}>
          ⚠️ {error}
        </div>
      )}

      {status && (
        <div style={{ marginTop: "1.5rem", padding: "1rem", background: "#f0fdf4", borderRadius: 8 }}>
          <p>🟢 Sidecar：{status.sidecar_running ? "运行中" : "已停止"}</p>
          <p>🔌 端口：{status.port}</p>
          <p>📁 隔离目录：<code>{status.openclaw_home}</code></p>
        </div>
      )}

      {!status && !error && (
        <p style={{ marginTop: "1.5rem", color: "#6b7280" }}>正在连接 sidecar...</p>
      )}

      <button
        onClick={() => navigate("/setup-wizard")}
        style={{ marginTop: "1.5rem", padding: "0.5rem 1rem" }}
      >
        重新运行首启向导
      </button>
    </main>
  );
}

export default Status;
