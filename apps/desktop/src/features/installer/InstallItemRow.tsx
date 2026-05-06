// 安装清单单行：图标占位 + 名称 + 状态徽章 + 三按钮 + 展开/折叠子项。
// Install list row: icon placeholder + name + status badge + 3 action buttons + expand/collapse children.

import { useCallback, useState } from "react";
import type { InstallItem } from "./installer.types";
import { t } from "./installer.i18n";
import { useInstaller, isInstallGated } from "../../routes/InstallerWizard";
import StatusBadge from "./StatusBadge";
import InstallChildRow from "./InstallChildRow";
import styles from "./InstallItemRow.module.css";

const zh = t.zhCN;

interface InstallItemRowProps {
  item: InstallItem;
}

/** 根据状态决定安装按钮文案 */
function getInstallLabel(state: InstallItem["state"]): string {
  switch (state) {
    case "installing":
      return zh.btnInstalling;
    case "installed":
      return zh.btnReinstall;
    case "failed":
      return zh.btnRetry;
    default:
      return zh.btnInstall;
  }
}

/** 生成子项汇总文案："已装 N · 可用 M · 已配置 K" */
function getChildSummary(item: InstallItem): string {
  const children = item.children ?? [];
  const installed = children.filter((c) => c.state === "installed").length;
  const available = children.length; // 桩：可用 = 已配置
  const configured = children.length;
  return zh.childSummary
    .replace("{N}", String(installed))
    .replace("{M}", String(available))
    .replace("{K}", String(configured));
}

/** 单行组件：渲染图标占位、名称、状态徽章、三按钮（检测/设置/安装），含依赖门禁与子项展开 */
function InstallItemRow({ item }: InstallItemRowProps) {
  const { state, dispatch } = useInstaller();
  const { items } = state;

  const [expanded, setExpanded] = useState(false);

  const isInstalling = item.state === "installing";
  const gated = isInstallGated(item, items);
  const installDisabled = isInstalling || gated;

  const installTooltip = gated
    ? zh.tooltipOpenClawRequired
    : isInstalling
      ? zh.tooltipInstalling
      : undefined;

  const hasChildren = item.expandable && (item.children ?? []).length > 0;

  const handleToggle = useCallback(() => {
    if (item.expandable) {
      setExpanded((prev) => !prev);
    }
  }, [item.expandable]);

  const handleDetect = useCallback(() => {
    dispatch({ type: "DETECT", id: item.id });
  }, [dispatch, item.id]);

  const handleSettings = useCallback(() => {
    console.log(`[installer] settings: ${item.id}`);
  }, [item.id]);

  const handleInstall = useCallback(() => {
    if (installDisabled) return;

    dispatch({ type: "INSTALL_START", id: item.id });

    setTimeout(() => {
      const success = Math.random() > 0.3;
      dispatch({
        type: success ? "INSTALL_DONE" : "INSTALL_FAIL",
        id: item.id,
      });
    }, 1500);
  }, [dispatch, item.id, installDisabled]);

  return (
    <>
      <div className={styles.row}>
        {/* 展开/折叠箭头（仅 expandable 条目显示） */}
        <span
          className={`${styles.toggle} ${item.expandable ? styles.toggleActive : ""}`}
          onClick={handleToggle}
        >
          {item.expandable ? (expanded ? "▼" : "▶") : ""}
        </span>

        {/* 图标占位 */}
        <span className={styles.icon} title={zh.iconPlaceholder}>
          {item.iconKey.slice(0, 2).toUpperCase()}
        </span>

        {/* 名称 */}
        <span className={styles.name}>{item.name}</span>

        {/* 状态徽章 */}
        <StatusBadge state={item.state} />

        {/* 子项汇总（仅 expandable 条目显示） */}
        {item.expandable && (
          <span className={styles.childSummary}>{getChildSummary(item)}</span>
        )}

        {/* 占位文案（ComfyUI 等） */}
        {item.comingSoon && (
          <span className={styles.comingSoon}>{zh.comingSoon}</span>
        )}

        {/* 三按钮（仅非 expandable 条目显示；DCC 条目按钮在子项行上） */}
        {!item.expandable && (
          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.btn} ${isInstalling ? styles.btnDisabled : ""}`}
              disabled={isInstalling}
              onClick={handleDetect}
            >
              {zh.btnDetect}
            </button>
            <button
              type="button"
              className={`${styles.btn} ${isInstalling ? styles.btnDisabled : ""}`}
              disabled={isInstalling}
              onClick={handleSettings}
            >
              {zh.btnSettings}
            </button>
            <button
              type="button"
              className={`${styles.btn} ${installDisabled ? styles.btnDisabled : ""}`}
              disabled={installDisabled}
              title={installTooltip}
              onClick={handleInstall}
            >
              {getInstallLabel(item.state)}
            </button>
          </div>
        )}
      </div>

      {/* 子项列表（展开时渲染） */}
      {expanded &&
        hasChildren &&
        item.children!.map((child, idx) => (
          <InstallChildRow
            key={`${item.id}-${idx}`}
            child={child}
            parentId={item.id}
            childIndex={idx}
          />
        ))}
    </>
  );
}

export default InstallItemRow;
