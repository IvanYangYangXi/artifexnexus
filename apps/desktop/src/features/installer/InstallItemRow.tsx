// 安装清单单行：图标占位 + 名称 + 状态徽章 + 三按钮 + 展开/折叠子项。
// Install list row: icon placeholder + name + status badge + 3 action buttons + expand/collapse children.

import { useCallback, useEffect, useState } from "react";
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
import type { PreserveOptions } from "../../ipc/openclaw";
import { getDCCActions } from "./dccRegistry";
import ReinstallConfirmDialog from "./ReinstallConfirmDialog";
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
  // STORY-0020：重装确认弹窗
  const [showReinstallConfirm, setShowReinstallConfirm] = useState(false);
  const [pendingPreserveOptions, setPendingPreserveOptions] = useState<PreserveOptions | null>(null);
  const [openingWebUi, setOpeningWebUi] = useState<boolean>(false);

  // EPIC-0001 第二批 #1：OpenClaw 设置面板 modal 开关
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);

  // STORY-0018 hot-fix：OpenClaw 行挂载时主动跑一次 status，避免
  // 用户首次进入安装页时 Web UI 按钮永远 disabled（必须先点"检测"
  // 才能拿到 gateway_running / web_ui_available 两个门禁位）。
  // 仅 OpenClaw 行执行；非 OpenClaw 行用桩状态保留旧行为。
  useEffect(() => {
    if (item.id !== "openclaw") return;
    let cancelled = false;
    void (async () => {
      try {
        const status = await getOpenClawStatus();
        if (cancelled) return;
        setGatewayRunning(status.gateway_running);
        setWebUiAvailable(status.web_ui_available);
      } catch {
        // 静默：sidecar 不可用时按 false 处理
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item.id]);

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
          setGatewayRunning(status.gateway_running);
          setWebUiAvailable(status.web_ui_available);

          let newState: InstallItem["state"];
          if (status.gateway_running) {
            newState = "installed";
          } else if (status.cli_installed) {
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

    // DCC 行（expandable 条目）：通用检测逻辑（合并手动添加的子项）
    const dccActions = getDCCActions(item.id);
    if (dccActions) {
      void (async () => {
        try {
          addLog(item.id, "info", `正在检测本机 ${item.name} 版本…`);
          const result = await dccActions.detect();

          const detectedChildren = result.versions.map((v) => ({
            label: `${item.name} ${v.version}`,
            version: v.version,
            installPath: `%APPDATA%/Blender Foundation/Blender/${v.version}/scripts/addons`,
            projectPath: "",
            scriptPath: `artifex_nexus_v${result.addon_info.version}`,
            state: v.installed
              ? ("installed" as const)
              : ("not-installed" as const),
          }));

          // 保留手动添加的子项（installPath 非空且版本不在检测结果中）
          const existingManual = (item.children ?? []).filter(
            (c) => c.installPath && !detectedChildren.some((d) => d.version === c.version),
          );

          const children = [...detectedChildren, ...existingManual];

          // 父项状态：至少一个子项已安装 → installed，否则 → not-installed
          const hasInstalled = children.some((c) => c.state === "installed");
          dispatch({
            type: "UPDATE_ITEM",
            id: item.id,
            patch: {
              children,
              state: hasInstalled ? "installed" : "not-installed",
            },
          });

          const installedCount = result.versions.filter((v) => v.installed).length;
          addLog(
            item.id,
            "info",
            `检测到 ${result.versions.length} 个 ${item.name} 版本（已装插件: ${installedCount}）`,
          );
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          addLog(item.id, "error", `检测失败: ${errMsg}`);
        }
      })();
      return;
    }

    dispatch({ type: "DETECT", id: item.id });
  }, [dispatch, item.id, addLog]);

  const handleSettings = useCallback(() => {
    // OpenClaw 行：打开设置面板（EPIC-0001 第二批 #1 / STORY-0015）
    if (item.id === "openclaw") {
      setSettingsOpen(true);
      return;
    }

    // DCC 行：弹出端口配置对话框（STORY-0029）
    const dccActions = getDCCActions(item.id);
    if (dccActions) {
      void (async () => {
        try {
          const { getDCCPort, setDCCPort } = await import("../../ipc/openclaw");
          const config = await getDCCPort(item.id);
          const newPortStr = window.prompt(
            `${item.name} MCP Server 端口：`,
            String(config.port),
          );
          if (newPortStr === null) return;

          const newPort = parseInt(newPortStr, 10);
          if (isNaN(newPort) || newPort < 1024 || newPort > 65535) {
            window.alert("端口号无效，范围 1024-65535");
            return;
          }

          const result = await setDCCPort(item.id, newPort);
          if (result.success) {
            const servers = result.updated_servers?.join(", ") || config.server_name;
            addLog(item.id, "info", `端口已更新: ${newPort}（同步: ${servers}）`);
          } else {
            addLog(item.id, "error", `端口设置失败: ${result.error}`);
          }
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          addLog(item.id, "error", `端口设置异常: ${errMsg}`);
        }
      })();
      return;
    }

    // 其它行 M2+ 接真实逻辑
    console.log(`[installer] settings: ${item.id}`);
  }, [item.id, addLog]);

  /** 根据 DCC 类型和版本号自动计算安装路径 */
  const calcInstallPath = useCallback((dccId: string, version: string): string => {
    switch (dccId) {
      case "blender":
        return `%APPDATA%/Blender Foundation/Blender/${version}/scripts/addons/`;
      case "maya":
        return `~/Documents/maya/${version}/scripts/`;
      case "max":
        return `%LOCALAPPDATA%/Autodesk/3dsMax/${version}/ENU/scripts/`;
      default:
        return "";
    }
  }, []);

  /** 添加子项：根据 DCC 类型弹出对应输入框 */
  const handleAddChild = useCallback(() => {
    // UE：输入工程路径
    if (item.id === "unreal") {
      const projectPath = window.prompt(
        `请输入 UE 工程根目录（插件将安装到 {目录}\\Plugins\\）：`,
      );
      if (!projectPath || !projectPath.trim()) return;
      const projectName = projectPath.trim().split(/[\\/]/).pop() || "Project";
      dispatch({
        type: "ADD_CHILD",
        parentId: item.id,
        child: {
          label: `${item.name} ${projectName}`,
          version: "",
          installPath: `${projectPath.trim()}\\Plugins\\`,
          projectPath: projectPath.trim(),
          scriptPath: "",
          state: "not-installed",
        },
      });
      return;
    }

    // Blender/Maya/Max：输入版本号 → 自动计算路径 → 确认/修改
    const version = window.prompt(`请输入 ${item.name} 版本号（如 5.1）：`);
    if (!version || !version.trim()) return;

    const autoPath = calcInstallPath(item.id, version.trim());
    const installPath = window.prompt(
      `插件安装路径（可修改）：`,
      autoPath,
    );
    if (installPath === null) return; // 用户取消

    const label = `${item.name} ${version.trim()}`;
    dispatch({
      type: "ADD_CHILD",
      parentId: item.id,
      child: {
        label,
        version: version.trim(),
        installPath: installPath.trim() || autoPath,
        projectPath: "",
        scriptPath: "",
        state: "not-installed",
      },
    });
  }, [dispatch, item.id, item.name, calcInstallPath]);

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

    // STORY-0020：已安装状态下重装，先弹窗确认
    if (item.id === "openclaw" && (item.state === "installed" || item.state === "update-available")) {
      setShowReinstallConfirm(true);
      return;
    }

    doInstall(null);
  }, [installDisabled, item.id, item.state]);

  /** 实际执行安装链（首次安装 preserveOpts=null，重装时带选项） */
  const doInstall = useCallback((preserveOpts: PreserveOptions | null) => {
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
          const bootstrapResult = await bootstrapOpenClaw("v2026.5.4", preserveOpts ?? undefined);
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

          // STORY-0018 hot-fix：安装链完成后立即同步 Web UI 门禁状态。
          // 否则用户必须手动点"检测"才能解锁 Web UI 按钮，体验割裂。
          // 这里直接复用 status RPC 的两个布尔位（gateway_running /
          // web_ui_available），避开 handleDetect 里的 dispatch（已经
          // 由 INSTALL_DONE 推到 installed 状态）。
          try {
            const status = await getOpenClawStatus();
            setGatewayRunning(status.gateway_running);
            setWebUiAvailable(status.web_ui_available);
          } catch {
            // 静默：sidecar 偶尔有瞬时不可用，下一次 mount/手动检测会修
          }
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          addLog("openclaw", "error", errMsg);
          dispatch({ type: "INSTALL_FAIL", id: "openclaw", error: errMsg });
        }
      })();
      return;
    }

    // DCC 行（expandable 条目）：通用安装逻辑
    const dccActions = getDCCActions(item.id);
    if (dccActions) {
      void (async () => {
        // 先检查并安装 mcp-bridge 插件
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          addLog(item.id, "info", "检查 MCP Bridge 插件…");
          const bridgeStatus = await invoke<{ installed: boolean }>(
            "openclaw_gateway_mcp_bridge_status",
          );
          if (bridgeStatus.installed) {
            addLog(item.id, "info", "MCP Bridge 插件已安装");
          } else {
            addLog(item.id, "info", "正在部署 Gateway MCP Bridge 插件…");
            const bridgeResult = await invoke<{
              success: boolean;
              method: string;
              error: string | null;
            }>("openclaw_gateway_mcp_bridge_install");
            if (bridgeResult.success) {
              addLog(item.id, "info", `MCP Bridge 插件部署成功 (${bridgeResult.method})`);
              // 自动重启 Gateway 加载新插件
              try {
                addLog(item.id, "info", "正在重启 Gateway 加载 MCP Bridge…");
                const { restartGateway } = await import("../../ipc/openclaw");
                await restartGateway();
                addLog(item.id, "info", "Gateway 已重启，MCP Bridge 已生效");
              } catch (restartErr) {
                addLog(item.id, "warn", "⚠️ Gateway 重启失败，请手动重启（状态页 → 停止 → 启动）");
              }
            } else {
              addLog(item.id, "error", `MCP Bridge 插件部署失败: ${bridgeResult.error}`);
              dispatch({
                type: "INSTALL_FAIL",
                id: item.id,
                error: `MCP Bridge 部署失败: ${bridgeResult.error}`,
              });
              return;
            }
          }
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          addLog(item.id, "error", `MCP Bridge 检查失败: ${errMsg}`);
          dispatch({ type: "INSTALL_FAIL", id: item.id, error: errMsg });
          return;
        }

        const children = item.children ?? [];
        if (children.length === 0) {
          addLog(item.id, "warn", `未检测到 ${item.name} 版本，请先点击"检测"`);
          dispatch({ type: "INSTALL_FAIL", id: item.id, error: "未检测到版本" });
          return;
        }

        addLog(item.id, "info", `开始安装 ${item.name} 插件（共 ${children.length} 个版本）…`);

        let allSuccess = true;
        let installedCount = 0;
        for (const child of children) {
          if (child.state === "installed") {
            addLog(item.id, "info", `${item.name} ${child.version} 已安装，跳过`);
            installedCount++;
            continue;
          }

          addLog(item.id, "info", `正在安装到 ${item.name} ${child.version}（目标: ${child.installPath || "自动计算"}）…`);
          try {
            const result = await dccActions.install(child.version);
            if (result.success) {
              addLog(item.id, "info", `✅ ${item.name} ${child.version} 安装成功 (方式: ${result.method}, 目标: ${result.target})`);
              dispatch({
                type: "UPDATE_CHILD",
                parentId: item.id,
                childIndex: children.indexOf(child),
                patch: { state: "installed" },
              });
              installedCount++;
            } else {
              addLog(item.id, "error", `❌ ${item.name} ${child.version} 安装失败: ${result.error}`);
              allSuccess = false;
            }
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            addLog(item.id, "error", `❌ ${item.name} ${child.version} 安装异常: ${errMsg}`);
            allSuccess = false;
          }
        }

        addLog(item.id, "info", `安装完成: ${installedCount}/${children.length} 个版本成功`);
        dispatch({
          type: allSuccess ? "INSTALL_DONE" : "INSTALL_FAIL",
          id: item.id,
          error: allSuccess ? undefined : "部分版本安装失败",
        });
      })();
      return;
    }

    // 非 OpenClaw/DCC 行：保持桩行为（M7+ 接真实逻辑）
    setTimeout(() => {
      const success = Math.random() > 0.3;
      dispatch({
        type: success ? "INSTALL_DONE" : "INSTALL_FAIL",
        id: item.id,
      });
    }, 1500);
  }, [dispatch, item.id, addLog]);

  // STORY-0020：弹窗确认回调
  const handleReinstallConfirm = useCallback((opts: PreserveOptions) => {
    setShowReinstallConfirm(false);
    setPendingPreserveOptions(opts);
    doInstall(opts);
  }, [doInstall]);

  const handleReinstallCancel = useCallback(() => {
    setShowReinstallConfirm(false);
  }, []);

  return (
    <>
      {showReinstallConfirm && (
        <ReinstallConfirmDialog
          onConfirm={handleReinstallConfirm}
          onCancel={handleReinstallCancel}
        />
      )}
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

        {/* 三按钮（非 expandable 条目显示全部；expandable 条目显示检测+安装+添加） */}
        {!item.expandable ? (
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
        ) : (
          /* expandable 条目（DCC 行）：检测 + 安装 + 添加 + 设置 */
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
              className={`${styles.btn} ${installDisabled ? styles.btnDisabled : ""}`}
              disabled={installDisabled}
              title={installTooltip}
              onClick={handleInstall}
            >
              {getInstallLabel(item.state)}
            </button>
            <button
              type="button"
              className={`${styles.btn}`}
              disabled={isInstalling}
              onClick={handleAddChild}
            >
              {zh.btnAdd}
            </button>
            <button
              type="button"
              className={`${styles.btn}`}
              disabled={isInstalling}
              onClick={handleSettings}
            >
              {zh.btnSettings}
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
