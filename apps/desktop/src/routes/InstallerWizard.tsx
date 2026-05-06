// 安装向导页面容器：路由入口，渲染安装清单 + 状态机 + 依赖门禁。
// Installer wizard page container: route entry, renders install list + state machine + dependency gate.

import { useReducer, createContext, useContext, type Dispatch } from "react";
import type { InstallItem, InstallItemState } from "../features/installer/installer.types";
import { FIXTURE_ITEMS } from "../features/installer/installer.fixtures";
import { t } from "../features/installer/installer.i18n";
import InstallList from "../features/installer/InstallList";
import styles from "./InstallerWizard.module.css";

const zh = t.zhCN;

// ---- 状态管理（useReducer + Context，零依赖） ----

/** 安装向导全局状态 */
export interface InstallerState {
  items: InstallItem[];
}

export type InstallerAction =
  | { type: "SET_ITEMS"; items: InstallItem[] }
  | { type: "UPDATE_ITEM"; id: string; patch: Partial<InstallItem> }
  | { type: "DETECT"; id: string }
  | { type: "INSTALL_START"; id: string }
  | { type: "INSTALL_DONE"; id: string }
  | { type: "INSTALL_FAIL"; id: string }
  | { type: "DETECT_CHILD"; parentId: string; childIndex: number }
  | { type: "INSTALL_CHILD_START"; parentId: string; childIndex: number }
  | { type: "INSTALL_CHILD_DONE"; parentId: string; childIndex: number }
  | { type: "INSTALL_CHILD_FAIL"; parentId: string; childIndex: number }
  | { type: "DELETE_CHILD"; parentId: string; childIndex: number };

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

    case "DETECT": {
      const item = state.items.find((it) => it.id === action.id);
      if (!item) return state;
      const patch = simulateDetect(item, state.items);
      if (Object.keys(patch).length === 0) return state; // 无变更（如 pending 保持）
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
          it.id === action.id ? { ...it, state: "failed" } : it,
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
  });

  const handleGlobalDetect = () => {
    // 全局检测：对所有条目依次 dispatch DETECT
    for (const item of state.items) {
      dispatch({ type: "DETECT", id: item.id });
    }
  };

  const handleGlobalSettings = () => {
    console.log("[installer] global settings");
  };

  const handleFinish = () => {
    console.log("[installer] finish");
  };

  return (
    <InstallerContext.Provider value={{ state, dispatch }}>
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
            <button
              type="button"
              className={styles.toolbarBtn}
              onClick={handleGlobalSettings}
            >
              {zh.globalSettings}
            </button>
            <button
              type="button"
              className={styles.toolbarBtnPrimary}
              onClick={handleFinish}
            >
              {zh.globalFinish}
            </button>
          </div>
        </header>

        {/* 安装清单主表 */}
        <section className={styles.body}>
          <InstallList items={state.items} />
        </section>
      </main>
    </InstallerContext.Provider>
  );
}

export default InstallerWizard;
