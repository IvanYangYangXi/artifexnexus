// 安装清单单行：图标占位 + 名称 + 状态徽章 + 三按钮 + 展开/折叠子项。
// Install list row: icon placeholder + name + status badge + 3 action buttons + expand/collapse children.

import { useCallback, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import type { InstallItem } from "./installer.types";
import { t } from "./installer.i18n";
import { useInstaller, isInstallGated } from "../../routes/InstallerWizard";
import {
  installOpenClaw,
  bootstrapOpenClaw,
  startOpenClaw,
  getOpenClawStatus,
  getOpenClawWebUrl,
} from "../../ipc/openclaw";
import StatusBadge from "./StatusBadge";
import InstallChildRow from "./InstallChildRow";
import SettingsPanel from "../openclaw/SettingsPanel";
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
  const { state, dispatch, addLog } = useInstaller();
  const { items } = state;

  const [expanded, setExpanded] = useState(false);

  // EPIC-0001 第二批 #2：OpenClaw 行的 Web UI 状态（运行中 + Web UI 可用）
  // 仅 OpenClaw 行使用；非 OpenClaw 行恒为 false 不渲染按钮。
  const [gatewayRunning, setGatewayRunning] = useState<boolean>(false);
  const [webUiAvailable, setWebUiAvailable] = useState<boolean>(false);
  const [openingWebUi, setOpeningWebUi] = useState<boolean>(false);

  // EPIC-0001 第二批 #1：OpenClaw 设置面板 modal 开关
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);

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
    // OpenClaw 行：调用真实状态查询
    if (item.id === "openclaw") {
      void (async () => {
        try {
          const status = await getOpenClawStatus();
          // 同步 Web UI 门禁所需的两个状态位
          setGatewayRunning(status.gateway_running);
          setWebUiAvailable(status.web_ui_available);

          let newState: InstallItem["state"];
          if (status.gateway_running) {
            newState = "installed";
          } else if (status.cli_installed) {
            // 已安装但版本不一致 → "有更新"
            newState = status.version_mismatch ? "update-available" : "installed";
          } else {
            newState = "not-installed";
          }
          dispatch({
            type: "UPDATE_ITEM",
            id: "openclaw",
            patch: { state: newState },
          });
        } catch {
          // sidecar 不可用，标记为 not-installed
          setGatewayRunning(false);
          setWebUiAvailable(false);
          dispatch({
            type: "UPDATE_ITEM",
            id: "openclaw",
            patch: { state: "not-installed" },
          });
        }
      })();
      return;
    }
    dispatch({ type: "DETECT", id: item.id });
  }, [dispatch, item.id]);

  const handleSettings = useCallback(() => {
    // OpenClaw 行：打开设置面板（EPIC-0001 第二批 #1 / STORY-0015）
    if (item.id === "openclaw") {
      setSettingsOpen(true);
      return;
    }
    // 其它行 M2+ 接真实逻辑
    console.log(`[installer] settings: ${item.id}`);
  }, [item.id]);

  // EPIC-0001 第二批 #2：点击 "Web UI" 按钮，先取 URL 再用系统浏览器打开
  const handleOpenWebUi = useCallback(() => {
    if (item.id !== "openclaw") return;
    if (openingWebUi) return;

    void (async () => {
      setOpeningWebUi(true);
      try {
        addLog("openclaw", "info", "正在获取 Web UI 地址…");
        const result = await getOpenClawWebUrl();
        if (!result.available || !result.url) {
          const reason = result.reason || "Web UI 不可用";
          addLog("openclaw", "warn", reason);
          return;
        }
        addLog("openclaw", "info", `打开 Web UI: ${result.url}`);
        await openExternal(result.url);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        addLog("openclaw", "error", `打开 Web UI 失败: ${errMsg}`);
      } finally {
        setOpeningWebUi(false);
      }
    })();
  }, [item.id, openingWebUi, addLog]);

  const handleInstall = useCallback(() => {
    if (installDisabled) return;

    dispatch({ type: "INSTALL_START", id: item.id });

    // OpenClaw 行：触发真实安装链（install → bootstrap → start）
    if (item.id === "openclaw") {
      void (async () => {
        try {
          addLog("openclaw", "info", "开始安装 OpenClaw...");
          const installResult = await installOpenClaw("v2026.5.4");

          // 将安装过程中的进度事件推送到日志面板
          if (installResult.events) {
            for (const evt of installResult.events) {
              const level: "info" | "warn" | "error" =
                evt.phase === "error" ? "error" : "info";
              addLog("openclaw", level, evt.message);
            }
          }

          if (!installResult.success) {
            const errMsg = installResult.error_message || "安装失败";
            addLog("openclaw", "error", errMsg);
            dispatch({ type: "INSTALL_FAIL", id: "openclaw", error: errMsg });
            return;
          }
          addLog("openclaw", "info", "OpenClaw 安装完成");

          addLog("openclaw", "info", "开始初始化配置...");
          const bootstrapResult = await bootstrapOpenClaw("v2026.5.4");
          if (!bootstrapResult.success) {
            const errMsg = "初始化失败";
            addLog("openclaw", "error", errMsg);
            dispatch({ type: "INSTALL_FAIL", id: "openclaw", error: errMsg });
            return;
          }
          addLog("openclaw", "info", "配置初始化完成");

          addLog("openclaw", "info", "正在启动 Gateway...");
          const startResult = await startOpenClaw(bootstrapResult.port);
          if (!startResult.success) {
            const errMsg = startResult.message || "启动失败";
            addLog("openclaw", "error", errMsg);
            dispatch({ type: "INSTALL_FAIL", id: "openclaw", error: errMsg });
            return;
          }
          addLog("openclaw", "info", "Gateway 启动成功");

          dispatch({ type: "INSTALL_DONE", id: "openclaw" });
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          addLog("openclaw", "error", errMsg);
          dispatch({ type: "INSTALL_FAIL", id: "openclaw", error: errMsg });
        }
      })();
      return;
    }

    // 非 OpenClaw 行：保持桩行为（M2+ 接真实逻辑）
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

        {/* 失败时的错误信息 */}
        {item.state === "failed" && item.errorMessage && (
          <span className={styles.errorMsg} title={item.errorMessage}>
            {item.errorMessage.length > 60
              ? item.errorMessage.slice(0, 60) + "..."
              : item.errorMessage}
          </span>
        )}

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
            {/* 设置按钮（OpenClaw 行需 installed/update-available 才可点） */}
            {(() => {
              const isOpenClaw = item.id === "openclaw";
              const settingsGated =
                isOpenClaw &&
                item.state !== "installed" &&
                item.state !== "update-available";
              const settingsDisabled = isInstalling || settingsGated;
              const settingsTooltip = settingsGated
                ? zh.tooltipWebUiRequiresInstall
                : isInstalling
                  ? zh.tooltipInstalling
                  : undefined;
              return (
                <button
                  type="button"
                  className={`${styles.btn} ${settingsDisabled ? styles.btnDisabled : ""}`}
                  disabled={settingsDisabled}
                  title={settingsTooltip}
                  onClick={handleSettings}
                >
                  {zh.btnSettings}
                </button>
              );
            })()}
            {/* OpenClaw 行专属：Web UI 入口按钮（EPIC-0001 第二批 #2） */}
            {item.id === "openclaw" &&
              (() => {
                const notInstalled = item.state !== "installed";
                const webUiDisabled =
                  isInstalling ||
                  openingWebUi ||
                  notInstalled ||
                  !gatewayRunning ||
                  !webUiAvailable;
                let webUiTooltip: string | undefined;
                if (openingWebUi) {
                  webUiTooltip = zh.tooltipWebUiOpening;
                } else if (notInstalled) {
                  webUiTooltip = zh.tooltipWebUiRequiresInstall;
                } else if (!gatewayRunning) {
                  webUiTooltip = zh.tooltipWebUiRequiresGateway;
                } else if (!webUiAvailable) {
                  webUiTooltip = zh.tooltipWebUiUnavailable;
                }
                return (
                  <button
                    type="button"
                    className={`${styles.btn} ${webUiDisabled ? styles.btnDisabled : ""}`}
                    disabled={webUiDisabled}
                    title={webUiTooltip}
                    onClick={handleOpenWebUi}
                  >
                    {zh.btnWebUI}
                  </button>
                );
              })()}
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

      {/* OpenClaw 设置面板 modal（EPIC-0001 第二批 #1） */}
      {item.id === "openclaw" && (
        <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      )}
    </>
  );
}

export default InstallItemRow;
