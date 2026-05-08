// DCC 子项行：版本/路径/脚本 + 状态徽章 + 四按钮（检测/设置/安装/删除）。
// DCC child row: version/paths/script + status badge + 4 action buttons (detect/settings/install/delete).

import { useCallback } from "react";
import type { InstallChildItem } from "./installer.types";
import { t } from "./installer.i18n";
import { useInstaller, isInstallGated } from "../../routes/InstallerWizard";
import { getDCCActions } from "./dccRegistry";
import StatusBadge from "./StatusBadge";
import styles from "./InstallChildRow.module.css";

const zh = t.zhCN;

interface InstallChildRowProps {
  child: InstallChildItem;
  parentId: string;
  childIndex: number;
}

/** 根据状态决定安装按钮文案 */
function getInstallLabel(state: InstallChildItem["state"]): string {
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

/** 子项行组件：渲染字段、状态徽章、四按钮（检测/设置/安装/删除），含依赖门禁 */
function InstallChildRow({ child, parentId, childIndex }: InstallChildRowProps) {
  const { state, dispatch } = useInstaller();
  const { items } = state;

  const parentItem = items.find((it) => it.id === parentId);
  const isInstalling = child.state === "installing";
  const gated = parentItem ? isInstallGated(parentItem, items) : false;
  const installDisabled = isInstalling || gated;

  const installTooltip = gated
    ? zh.tooltipOpenClawRequired
    : isInstalling
      ? zh.tooltipInstalling
      : undefined;

  // 子项 action id 格式：parentId/childIndex
  const childId = `${parentId}/${childIndex}`;

  const handleDetect = useCallback(() => {
    // DCC 子项：真实检测（检查单个版本是否已安装）
    const dccActions = getDCCActions(parentId);
    if (dccActions) {
      void (async () => {
        try {
          const result = await dccActions.detect();
          const versionInfo = result.versions.find((v) => v.version === child.version);
          if (versionInfo) {
            dispatch({
              type: "UPDATE_CHILD",
              parentId,
              childIndex,
              patch: {
                state: versionInfo.installed ? "installed" : "not-installed",
              },
            });
          }
        } catch {
          // 静默
        }
      })();
      return;
    }

    dispatch({ type: "DETECT_CHILD", parentId, childIndex });
  }, [dispatch, parentId, childIndex, child.version]);

  const handleSettings = useCallback(() => {
    console.log(`[installer] child settings: ${childId}`);
  }, [childId]);

  const handleInstall = useCallback(() => {
    if (installDisabled) return;

    // DCC 子项：真实安装逻辑
    const dccActions = getDCCActions(parentId);
    if (dccActions) {
      dispatch({ type: "INSTALL_CHILD_START", parentId, childIndex });
      void (async () => {
        try {
          const result = await dccActions.install(child.version);
          if (result.success) {
            dispatch({ type: "INSTALL_CHILD_DONE", parentId, childIndex });
          } else {
            dispatch({ type: "INSTALL_CHILD_FAIL", parentId, childIndex });
          }
        } catch {
          dispatch({ type: "INSTALL_CHILD_FAIL", parentId, childIndex });
        }
      })();
      return;
    }

    // 非 DCC 子项：桩行为
    dispatch({ type: "INSTALL_CHILD_START", parentId, childIndex });
    setTimeout(() => {
      const success = Math.random() > 0.3;
      dispatch({
        type: success ? "INSTALL_CHILD_DONE" : "INSTALL_CHILD_FAIL",
        parentId,
        childIndex,
      });
    }, 1500);
  }, [dispatch, parentId, childIndex, child.version, installDisabled]);

  const handleDelete = useCallback(() => {
    // 删除前弹窗确认
    if (!window.confirm(zh.childDeleteConfirm.replace("{label}", child.label))) {
      return;
    }
    dispatch({ type: "DELETE_CHILD", parentId, childIndex });
  }, [dispatch, parentId, childIndex, child.label]);

  return (
    <div className={styles.row}>
      {/* 缩进 + 字段信息 */}
      <div className={styles.info}>
        <span className={styles.label}>{child.label}</span>
        <span className={styles.meta}>
          {zh.childFieldVersion}: {child.version}
          {" · "}
          {zh.childFieldInstallPath}: {child.installPath}
          {child.projectPath && (
            <>
              {" · "}
              {zh.childFieldProjectPath}: {child.projectPath}
            </>
          )}
          {" · "}
          {zh.childFieldScriptPath}: {child.scriptPath}
        </span>
      </div>

      {/* 状态徽章 */}
      <StatusBadge state={child.state} />

      {/* 四按钮 */}
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
          {getInstallLabel(child.state)}
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnDanger}`}
          disabled={isInstalling}
          onClick={handleDelete}
        >
          {zh.childBtnDelete}
        </button>
      </div>
    </div>
  );
}

export default InstallChildRow;
