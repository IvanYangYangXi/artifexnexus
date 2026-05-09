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
  const { state, dispatch, addLog } = useInstaller();
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
      addLog(parentId, "info", `[${child.label}] 正在检测安装状态…`);
      void (async () => {
        try {
          const result = await dccActions.detect();
          const versionInfo = result.versions.find((v) => v.version === child.version);
          if (versionInfo) {
            const newState = versionInfo.installed ? "installed" : "not-installed";
            addLog(parentId, "info", `[${child.label}] 检测结果: ${newState === "installed" ? "已安装" : "未安装"}`);
            dispatch({
              type: "UPDATE_CHILD",
              parentId,
              childIndex,
              patch: { state: newState as "installed" | "not-installed" },
            });
          } else {
            addLog(parentId, "warn", `[${child.label}] 未在检测结果中找到版本 ${child.version}`);
          }
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          addLog(parentId, "error", `[${child.label}] 检测失败: ${errMsg}`);
        }
      })();
      return;
    }

    dispatch({ type: "DETECT_CHILD", parentId, childIndex });
  }, [dispatch, parentId, childIndex, child.version, addLog]);

  const handleSettings = useCallback(() => {
    // 弹出编辑版本号和安装路径（自动计算默认值）
    const newVersion = window.prompt("版本号：", child.version);
    if (newVersion === null) return; // 取消

    // 自动计算默认安装路径
    let defaultPath = child.installPath;
    if (!defaultPath && newVersion.trim()) {
      switch (parentId) {
        case "blender":
          defaultPath = `%APPDATA%/Blender Foundation/Blender/${newVersion.trim()}/scripts/addons/`;
          break;
        case "maya":
          defaultPath = `~/Documents/maya/${newVersion.trim()}/scripts/`;
          break;
        case "max":
          defaultPath = `%LOCALAPPDATA%/Autodesk/3dsMax/${newVersion.trim()}/ENU/scripts/`;
          break;
      }
    }

    const newInstallPath = window.prompt("安装路径（可修改）：", defaultPath);
    if (newInstallPath === null) return; // 取消

    const newLabel = `${parentItem?.name ?? ""} ${newVersion.trim()}`;
    dispatch({
      type: "UPDATE_CHILD",
      parentId,
      childIndex,
      patch: {
        label: newLabel,
        version: newVersion.trim(),
        installPath: newInstallPath.trim() || defaultPath,
      },
    });
  }, [dispatch, parentId, childIndex, child.version, child.installPath, parentItem?.name]);

  const handleInstall = useCallback(() => {
    if (installDisabled) return;

    // DCC 子项：真实安装逻辑
    const dccActions = getDCCActions(parentId);
    if (dccActions) {
      const isReinstall = child.state === "installed";
      dispatch({ type: "INSTALL_CHILD_START", parentId, childIndex });
      void (async () => {
        try {
          // 重装时先卸载旧版本
          if (isReinstall) {
            addLog(parentId, "info", `[${child.label}] 重装：先卸载旧版本…`);
            try {
              const uninstallResult = await dccActions.uninstall(child.version);
              if (uninstallResult.success) {
                addLog(parentId, "info", `[${child.label}] 旧版本卸载成功`);
              } else {
                addLog(parentId, "warn", `[${child.label}] 旧版本卸载失败（继续安装）: ${uninstallResult.error}`);
              }
            } catch (e) {
              addLog(parentId, "warn", `[${child.label}] 旧版本卸载异常（继续安装）: ${e instanceof Error ? e.message : String(e)}`);
            }
          }

          // 检查并安装 mcp-bridge 插件
          const { invoke } = await import("@tauri-apps/api/core");
          addLog(parentId, "info", `[${child.label}] 检查 MCP Bridge 插件…`);
          const bridgeStatus = await invoke<{ installed: boolean }>(
            "openclaw_gateway_mcp_bridge_status",
          );
          if (bridgeStatus.installed) {
            addLog(parentId, "info", `[${child.label}] MCP Bridge 插件已安装`);
          } else {
            addLog(parentId, "info", `[${child.label}] 正在部署 MCP Bridge 插件…`);
            const bridgeResult = await invoke<{
              success: boolean;
              method: string;
              error: string | null;
            }>("openclaw_gateway_mcp_bridge_install");
            if (!bridgeResult.success) {
              addLog(parentId, "error", `[${child.label}] MCP Bridge 部署失败: ${bridgeResult.error}`);
              dispatch({ type: "INSTALL_CHILD_FAIL", parentId, childIndex });
              return;
            }
            addLog(parentId, "info", `[${child.label}] MCP Bridge 部署成功 (${bridgeResult.method})`);
          }

          addLog(parentId, "info", `[${child.label}] 正在安装插件到 ${child.version}（目标: ${child.installPath || "自动计算"}）…`);
          const result = await dccActions.install(child.version);
          if (result.success) {
            addLog(parentId, "info", `[${child.label}] ✅ 安装成功 (方式: ${result.method}, 目标: ${result.target})`);
            dispatch({ type: "INSTALL_CHILD_DONE", parentId, childIndex });
          } else {
            const errMsg = result.error || "未知错误";
            addLog(parentId, "error", `[${child.label}] ❌ 安装失败: ${errMsg}`);
            dispatch({ type: "INSTALL_CHILD_FAIL", parentId, childIndex });
          }
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          addLog(parentId, "error", `[${child.label}] ❌ 安装异常: ${errMsg}`);
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

    // DCC 子项：真实卸载
    const dccActions = getDCCActions(parentId);
    if (dccActions) {
      addLog(parentId, "info", `[${child.label}] 正在卸载插件…`);
      void (async () => {
        try {
          const result = await dccActions.uninstall(child.version);
          if (result.success) {
            addLog(parentId, "info", `[${child.label}] 卸载成功`);
          } else {
            addLog(parentId, "error", `[${child.label}] 卸载失败: ${result.error}`);
          }
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          addLog(parentId, "error", `[${child.label}] 卸载异常: ${errMsg}`);
        }
      })();
    }

    dispatch({ type: "DELETE_CHILD", parentId, childIndex });
  }, [dispatch, parentId, childIndex, child.label, addLog]);

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
