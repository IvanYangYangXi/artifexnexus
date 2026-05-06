// 状态徽章：6 种状态色块占位。
// Status badge: 6-state color block placeholder.

import type { InstallItemState } from "./installer.types";
import { t } from "./installer.i18n";
import styles from "./StatusBadge.module.css";

const zh = t.zhCN;

/** 状态 → 文案映射 */
const STATE_LABEL: Record<InstallItemState, string> = {
  unavailable: zh.statusUnavailable,
  pending: zh.statusPending,
  "not-installed": zh.statusNotInstalled,
  installing: zh.statusInstalling,
  installed: zh.statusInstalled,
  "update-available": zh.statusUpdateAvailable,
  failed: zh.statusFailed,
};

interface StatusBadgeProps {
  state: InstallItemState;
}

/** 状态徽章组件：根据 state 渲染不同颜色色块 + 文案 */
function StatusBadge({ state }: StatusBadgeProps) {
  const label = STATE_LABEL[state];

  return (
    <span className={`${styles.badge} ${styles[state] ?? ""}`}>
      {label}
    </span>
  );
}

export default StatusBadge;
