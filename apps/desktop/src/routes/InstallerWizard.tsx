// 安装向导页面容器：路由入口，渲染安装清单 + 状态机 + 依赖门禁。
// Installer wizard page container: route entry, renders install list + state machine + dependency gate.

import { useReducer, createContext, useContext, useEffect, useCallback, type Dispatch } from "react";
import type { InstallItem, InstallItemState, InstallChildItem } from "../features/installer/installer.types";
import { FIXTURE_ITEMS } from "../features/installer/installer.fixtures";
import { t } from "../features/installer/installer.i18n";
import InstallList from "../features/installer/InstallList";
import LogPanel, { type LogEntry } from "../features/installer/LogPanel";
import { getOpenClawStatus, validateDeployments } from "../ipc/openclaw";
import { getDCCActions } from "../features/installer/dccRegistry";
import styles from "./InstallerWizard.module.css";

const zh = t.zhCN;

// ---- 状态管理（useReducer + Context，零依赖） ----

/** 安装向导全局状态 */
export interface InstallerState {
  items: InstallItem[];
  logs: LogEntry[];
}

export type InstallerAction =
  | { type: "SET_ITEMS"; items: InstallItem[] }
  | { type: "UPDATE_ITEM"; id: string; patch: Partial<InstallItem> }
  | { type: "DETECT"; id: string }
  | { type: "INSTALL_START"; id: string }
  | { type: "INSTALL_DONE"; id: string }
  | { type: "INSTALL_FAIL"; id: string; error?: string }
  | { type: "DETECT_CHILD"; parentId: string; childIndex: number }
  | { type: "INSTALL_CHILD_START"; parentId: string; childIndex: number }
  | { type: "INSTALL_CHILD_DONE"; parentId: string; childIndex: number }
  | { type: "INSTALL_CHILD_FAIL"; parentId: string; childIndex: number }
  | { type: "UPDATE_CHILD"; parentId: string; childIndex: number; patch: Partial<InstallChildItem> }
  | { type: "ADD_CHILD"; parentId: string; child: InstallChildItem }
  | { type: "DELETE_CHILD"; parentId: string; childIndex: number }
  | { type: "ADD_LOG"; entry: LogEntry }
  | { type: "CLEAR_LOGS" };

/** 检测桩：随机走状态流。
 *  - ComfyUI 固定 unavailable
 *  - pending 项：若 OpenClaw 已安装则转 not-installed，否则保持 pending
 *  - 其他项随机 installed / not-installed / update-available
 */
function simulateDetect(item: InstallItem, items: InstallItem[]): Partial<InstallItem> {
  if (item.id === "comfyui") return { state: "unavailable" };

  // pending 项：检查 OpenClaw 是否已安装
  if (item.state === "pending") {
    const openClawInstalled = items.some(
      (it) => it.id === "openclaw" && it.state === "installed",
    );
    if (openClawInstalled) return { state: "not-installed" };
    return {}; // 保持 pending
  }

  const roll = Math.random();
  if (roll < 0.6) return { state: "installed" };
  if (roll < 0.85) return { state: "not-installed" };
  return { state: "update-available" };
}

function installerReducer(
  state: InstallerState,
  action: InstallerAction,
): InstallerState {
  switch (action.type) {
    case "SET_ITEMS":
      return { ...state, items: action.items };

    case "UPDATE_ITEM":
      return {
        ...state,
        items: state.items.map((it) =>
          it.id === action.id ? { ...it, ...action.patch } : it,
        ),
      };

    case "ADD_LOG":
      return {
        ...state,
        logs: [...state.logs.slice(-199), action.entry], // 保留最后 200 行
      };

    case "CLEAR_LOGS":
      return { ...state, logs: [] };

    case "DETECT": {
      const item = state.items.find((it) => it.id === action.id);
      if (!item) return state;
      const patch = simulateDetect(item, state.items);
      if (Object.keys(patch).length === 0) return state;
      return {
        ...state,
        items: state.items.map((it) =>
          it.id === action.id ? { ...it, ...patch } : it,
        ),
      };
    }

    case "INSTALL_START":
      return {
        ...state,
        items: state.items.map((it) =>
          it.id === action.id ? { ...it, state: "installing" } : it,
        ),
      };

    case "INSTALL_DONE":
      return {
        ...state,
        items: state.items.map((it) => {
          if (it.id === action.id) return { ...it, state: "installed" };
          // OpenClaw 安装完成后，所有 pending 项自动切换为 not-installed
          if (action.id === "openclaw" && it.state === "pending") {
            return { ...it, state: "not-installed" };
          }
          return it;
        }),
      };

    case "INSTALL_FAIL":
      return {
        ...state,
        items: state.items.map((it) =>
          it.id === action.id
            ? { ...it, state: "failed" as const, errorMessage: action.error || "安装失败" }
            : it,
        ),
      };

    // ---- 子项 action ----

    case "DETECT_CHILD": {
      return {
        ...state,
        items: state.items.map((it) => {
          if (it.id !== action.parentId || !it.children) return it;
          const child = it.children[action.childIndex];
          if (!child) return it;
          const roll = Math.random();
          const newState: InstallItemState =
            roll < 0.6 ? "installed" : roll < 0.85 ? "not-installed" : "update-available";
          const newChildren = [...it.children];
          newChildren[action.childIndex] = { ...child, state: newState };
          return { ...it, children: newChildren };
        }),
      };
    }

    case "INSTALL_CHILD_START": {
      return {
        ...state,
        items: state.items.map((it) => {
          if (it.id !== action.parentId || !it.children) return it;
          const child = it.children[action.childIndex];
          if (!child) return it;
          const newChildren = [...it.children];
          newChildren[action.childIndex] = { ...child, state: "installing" };
          return { ...it, children: newChildren };
        }),
      };
    }

    case "INSTALL_CHILD_DONE": {
      return {
        ...state,
        items: state.items.map((it) => {
          if (it.id !== action.parentId || !it.children) return it;
          const child = it.children[action.childIndex];
          if (!child) return it;
          const newChildren = [...it.children];
          newChildren[action.childIndex] = { ...child, state: "installed" };
          return { ...it, children: newChildren };
        }),
      };
    }

    case "INSTALL_CHILD_FAIL": {
      return {
        ...state,
        items: state.items.map((it) => {
          if (it.id !== action.parentId || !it.children) return it;
          const child = it.children[action.childIndex];
          if (!child) return it;
          const newChildren = [...it.children];
          newChildren[action.childIndex] = { ...child, state: "failed" };
          return { ...it, children: newChildren };
        }),
      };
    }

    case "UPDATE_CHILD": {
      return {
        ...state,
        items: state.items.map((it) => {
          if (it.id !== action.parentId || !it.children) return it;
          const child = it.children[action.childIndex];
          if (!child) return it;
          const newChildren = [...it.children];
          newChildren[action.childIndex] = { ...child, ...action.patch };
          return { ...it, children: newChildren };
        }),
      };
    }

    case "ADD_CHILD": {
      return {
        ...state,
        items: state.items.map((it) => {
          if (it.id !== action.parentId) return it;
          const children = it.children ? [...it.children, action.child] : [action.child];
          return { ...it, children };
        }),
      };
    }

    case "DELETE_CHILD": {
      return {
        ...state,
        items: state.items.map((it) => {
          if (it.id !== action.parentId || !it.children) return it;
          const newChildren = it.children.filter((_, i) => i !== action.childIndex);
          return { ...it, children: newChildren };
        }),
      };
    }

    default:
      return state;
  }
}

const InstallerContext = createContext<{
  state: InstallerState;
  dispatch: Dispatch<InstallerAction>;
  addLog: (itemId: string, level: LogEntry["level"], message: string, childLabel?: string) => void;
} | null>(null);

/** 获取安装向导上下文（仅限 InstallerWizard 子树内使用） */
export function useInstaller() {
  const ctx = useContext(InstallerContext);
  if (!ctx) {
    throw new Error("useInstaller 必须在 InstallerWizard 内使用");
  }
  return ctx;
}

// ---- 依赖门禁工具 ----

/** 判断 OpenClaw 是否已安装 */
export function isOpenClawInstalled(items: InstallItem[]): boolean {
  return items.some(
    (it) => it.id === "openclaw" && it.state === "installed",
  );
}

/** 判断某条目"安装"按钮是否应被门禁禁用 */
export function isInstallGated(item: InstallItem, items: InstallItem[]): boolean {
  if (item.id === "openclaw") return false;
  return !isOpenClawInstalled(items);
}

// ---- 页面组件 ----

/** 安装向导页面：路由 `/installer` 入口 */
function InstallerWizard() {
  const [state, dispatch] = useReducer(installerReducer, {
    items: FIXTURE_ITEMS,
    logs: [],
  });

  // 页面初始化时自动执行一次全局检测
  useEffect(() => {
    handleGlobalDetect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGlobalDetect = () => {
    // OpenClaw：真实状态查询
    void (async () => {
      try {
        const status = await getOpenClawStatus();
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
        addLog("openclaw", "info", `OpenClaw 状态: ${newState === "installed" ? "已安装" : newState === "update-available" ? "可更新" : "未安装"}`);

        // STORY-0030：部署文件校验
        try {
          const validation = await validateDeployments();
          const { summary } = validation;
          if (summary.total === 0) {
            addLog("openclaw", "info", "部署文件校验: 暂无部署记录");
          } else {
            const parts: string[] = [];
            if (summary.ok > 0) parts.push(`✅ ${summary.ok} 正常`);
            if (summary.outdated > 0) parts.push(`🔄 ${summary.outdated} 可更新`);
            if (summary.corrupted > 0) parts.push(`⚠️ ${summary.corrupted} 损坏`);
            if (summary.missing > 0) parts.push(`❌ ${summary.missing} 缺失`);
            addLog("openclaw", "info", `部署文件校验: ${parts.join(" · ")}`);
            for (const dep of validation.deployments) {
              if (dep.status !== "ok") {
                addLog("openclaw", "warn", `  ${dep.status}: ${dep.details}`);
              }
            }
          }
        } catch (e) {
          addLog("openclaw", "warn", `部署文件校验失败: ${e instanceof Error ? e.message : String(e)}`);
        }
      } catch {
        dispatch({
          type: "UPDATE_ITEM",
          id: "openclaw",
          patch: { state: "not-installed" },
        });
      }
    })();

    // 已注册的 DCC 条目：真实检测（合并手动添加的子项）
    for (const item of state.items) {
      const dccActions = getDCCActions(item.id);
      if (!dccActions) continue;

      void (async () => {
        try {
          addLog(item.id, "info", `正在检测本机 ${item.name} 版本…`);
          const result = await dccActions.detect();
          // 检测到的版本 → 子项
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

          // 父项状态：至少一个子项已安装 → installed
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

          // STORY-0030：部署文件校验
          try {
            const validation = await validateDeployments();
            const { summary } = validation;
            if (summary.total === 0) {
              addLog(item.id, "info", "部署文件校验: 暂无部署记录");
            } else {
              const parts: string[] = [];
              if (summary.ok > 0) parts.push(`✅ ${summary.ok} 正常`);
              if (summary.outdated > 0) parts.push(`🔄 ${summary.outdated} 可更新`);
              if (summary.corrupted > 0) parts.push(`⚠️ ${summary.corrupted} 损坏`);
              if (summary.missing > 0) parts.push(`❌ ${summary.missing} 缺失`);
              addLog(item.id, "info", `部署文件校验: ${parts.join(" · ")}`);
              for (const dep of validation.deployments) {
                if (dep.status !== "ok") {
                  addLog(item.id, "warn", `  ${dep.status}: ${dep.details}`);
                }
              }
            }
          } catch (e) {
            addLog(item.id, "warn", `部署文件校验失败: ${e instanceof Error ? e.message : String(e)}`);
          }
        } catch {
          // sidecar 不可用，保持当前状态
        }
      })();
    }

    // 其他条目：桩检测
    for (const item of state.items) {
      if (item.id === "openclaw" || getDCCActions(item.id)) continue;
      dispatch({ type: "DETECT", id: item.id });
    }
  };

  const handleGlobalSettings = () => {
    console.log("[installer] global settings");
  };

  const handleFinish = () => {
    console.log("[installer] finish");
  };

  /** 添加日志条目 */
  const addLog = useCallback(
    (itemId: string, level: LogEntry["level"], message: string, childLabel?: string) => {
      dispatch({
        type: "ADD_LOG",
        entry: {
          time: new Date().toISOString(),
          itemId,
          childLabel,
          level,
          message,
        },
      });
    },
    [dispatch],
  );

  /** 清空日志 */
  const clearLogs = useCallback(() => {
    dispatch({ type: "CLEAR_LOGS" });
  }, [dispatch]);

  /** 日志面板重试：触发对应项的安装 */
  const handleLogRetry = useCallback(
    (itemId: string) => {
      // 通过 context 让 InstallItemRow 处理
      // 这里直接 dispatch INSTALL_START，由 InstallItemRow 的 useEffect 或事件处理
      // 简化：找到对应项并触发安装（通过模拟点击）
      const item = state.items.find((it) => it.id === itemId);
      if (item && item.state === "failed") {
        // 重置为 not-installed 让用户可以重新点击安装
        dispatch({ type: "UPDATE_ITEM", id: itemId, patch: { state: "not-installed", errorMessage: undefined } });
      }
    },
    [dispatch, state.items],
  );

  // 通过 context 暴露 addLog
  const contextValue = { state, dispatch, addLog };

  return (
    <InstallerContext.Provider value={contextValue}>
      <main className={styles.page}>
        {/* 标题栏 */}
        <header className={styles.header}>
          <h1 className={styles.title}>{zh.pageTitle}</h1>
          <div className={styles.toolbar}>
            <button
              type="button"
              className={styles.toolbarBtn}
              onClick={handleGlobalDetect}
            >
              {zh.globalDetect}
            </button>
          </div>
        </header>

        {/* 安装清单主表 */}
        <section className={styles.body}>
          <InstallList items={state.items} />
        </section>

        {/* 事件/日志面板 */}
        <LogPanel
          entries={state.logs}
          onClear={clearLogs}
          onRetry={handleLogRetry}
        />
      </main>
    </InstallerContext.Provider>
  );
}

export default InstallerWizard;
