// 状态页（STORY-0018 T4 重构）：
// - SidecarHealth：sidecar 进程状态（5s 轮询，独立）
// - GatewayStatusCard：gateway 状态点 + 元数据 + 3 按钮（消费 useGatewayPolling）
// - GatewayLogPanel：实时日志窗口 200 行（消费 useGatewayPolling）
//
// 旧逻辑（5s 轮询 sidecar 内联）已拆到 SidecarHealth.tsx；
// 新轮询（1s gateway status + 增量 tail_log）由 useGatewayPolling 提供。

import { useNavigate } from "react-router-dom";
import GatewayLogPanel from "../features/openclaw/status/GatewayLogPanel";
import GatewayStatusCard from "../features/openclaw/status/GatewayStatusCard";
import SidecarHealth from "../features/openclaw/status/SidecarHealth";
import statusStyles from "../features/openclaw/status/StatusPanel.module.css";
import { useGatewayPolling } from "../features/openclaw/status/useGatewayPolling";

function Status() {
  const navigate = useNavigate();
  const { status, logs, dropped, pollError, clearLogs, refreshNow } =
    useGatewayPolling();

  return (
    <main className={statusStyles.page}>
      <h1 className={statusStyles.pageTitle}>Artifex Nexus — 运行状态</h1>

      {pollError && (
        <div className={statusStyles.errorBanner}>
          ⚠️ Gateway 轮询失败：{pollError}
        </div>
      )}

      <SidecarHealth />

      <GatewayStatusCard status={status} onAfterAction={refreshNow} />

      <GatewayLogPanel logs={logs} dropped={dropped} onClear={clearLogs} />

      <button
        type="button"
        onClick={() => navigate("/installer")}
        style={{
          marginTop: 12,
          padding: "6px 14px",
          fontSize: 13,
          background: "#fff",
          border: "1px solid #d1d5db",
          borderRadius: 6,
          color: "#374151",
          cursor: "pointer",
        }}
      >
        重新运行安装向导
      </button>
    </main>
  );
}

export default Status;
