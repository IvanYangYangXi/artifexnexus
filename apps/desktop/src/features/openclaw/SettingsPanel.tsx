// SettingsPanel: OpenClaw 设置面板入口（M3 modal）。
// EPIC-0001 第二批 STORY-0015。
// 三 Tab 子组件分文件，本文件只管 modal 外壳 / 加载 / 保存 / 二次确认。

import { useCallback, useEffect, useReducer, useState } from "react";
import {
  dumpOpenClawConfig,
  patchOpenClawConfig,
  resetOpenClawAgentPreset,
} from "../../ipc/openclaw";
import {
  buildPatchFromState,
  createInitialState,
  settingsReducer,
  validateState,
} from "./settings.reducer";
import type { Tab } from "./settings.reducer";
import { t } from "./settings.i18n";
import styles from "./SettingsPanel.module.css";
import ProvidersTab from "./tabs/ProvidersTab";
import AuthProfilesTab from "./tabs/AuthProfilesTab";
import DefaultAgentTab from "./tabs/DefaultAgentTab";

const zh = t.zhCN;

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

/** 二次确认 dialog（丢弃修改 / 重置预设共用） */
interface ConfirmConfig {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
}

export default function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const [state, dispatch] = useReducer(settingsReducer, undefined, createInitialState);
  const [confirm, setConfirm] = useState<ConfirmConfig | null>(null);
  // v3 — 高级模式：开启后顶部多出 "Auth Profiles" Tab + provider 详情显示"指向 profile"下拉。
  // 持久化到 localStorage，跨会话保留。
  const [advancedMode, setAdvancedMode] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("openclaw.settings.advancedMode") === "1";
    } catch {
      return false;
    }
  });
  const toggleAdvancedMode = useCallback((next: boolean) => {
    setAdvancedMode(next);
    try {
      window.localStorage.setItem(
        "openclaw.settings.advancedMode",
        next ? "1" : "0",
      );
    } catch {
      /* ignore quota / private mode */
    }
  }, []);

  // 打开时拉数据；关闭时不重置（避免下次打开闪烁，由 LOAD_START 兜底）
  useEffect(() => {
    if (!open) return;
    dispatch({ type: "LOAD_START" });
    let cancelled = false;
    void (async () => {
      try {
        const dump = await dumpOpenClawConfig();
        if (!cancelled) dispatch({ type: "LOAD_SUCCESS", dump });
      } catch (e) {
        if (!cancelled) {
          dispatch({
            type: "LOAD_ERROR",
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleSave = useCallback(() => {
    const issues = validateState(state);
    if (issues.length > 0) {
      dispatch({
        type: "SAVE_ERROR",
        message: `校验未通过: ${issues
          .slice(0, 3)
          .map((i) => `${i.scope}.${i.field} ${i.message}`)
          .join("; ")}`,
      });
      return;
    }

    dispatch({ type: "SAVE_START" });
    const { patch, extrasPatch } = buildPatchFromState(state);
    void (async () => {
      try {
        const result = await patchOpenClawConfig(patch, extrasPatch);
        if (!result.success) {
          dispatch({
            type: "SAVE_ERROR",
            message: result.validateError || zh.saveFailed,
          });
          return;
        }
        dispatch({ type: "SAVE_SUCCESS" });
        // 保存成功后立即关闭 modal（用户最直觉的反馈）
        onClose();
      } catch (e) {
        dispatch({
          type: "SAVE_ERROR",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    })();
  }, [state, onClose]);

  const requestClose = useCallback(() => {
    if (state.dirty && !state.saving) {
      setConfirm({
        title: zh.discardConfirmTitle,
        body: zh.discardConfirmBody,
        confirmLabel: zh.btnDiscard,
        onConfirm: () => {
          setConfirm(null);
          dispatch({ type: "RESET_DIRTY" });
          onClose();
        },
      });
      return;
    }
    onClose();
  }, [state.dirty, state.saving, onClose]);

  const handleResetPreset = useCallback(() => {
    setConfirm({
      title: zh.resetPresetConfirmTitle,
      body: zh.resetPresetConfirmBody,
      confirmLabel: zh.btnResetAgentPreset,
      onConfirm: () => {
        setConfirm(null);
        void (async () => {
          try {
            const r = await resetOpenClawAgentPreset(true);
            if (!r.success) {
              dispatch({
                type: "SAVE_ERROR",
                message: r.error || "重置预设失败",
              });
            }
          } catch (e) {
            dispatch({
              type: "SAVE_ERROR",
              message: e instanceof Error ? e.message : String(e),
            });
          }
        })();
      },
    });
  }, []);

  if (!open) return null;

  const setTab = (tab: Tab) => dispatch({ type: "SET_TAB", tab });

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>{zh.modalTitle}</span>
          <span className={styles.spacer} />
          <label
            className={styles.advancedModeToggle}
            title={zh.advancedModeHint}
          >
            <input
              type="checkbox"
              checked={advancedMode}
              onChange={(e) => toggleAdvancedMode(e.target.checked)}
            />
            {zh.advancedModeLabel}
          </label>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={requestClose}
            aria-label={zh.btnClose}
          >
            ×
          </button>
        </div>

        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${state.tab === "providers" ? styles.tabActive : ""}`}
            onClick={() => setTab("providers")}
          >
            {zh.tabProviders} ({state.providers.length})
          </button>
          {/* v3 — Auth Tab 仅在高级模式或当前已 deep-link 到 auth 时显示 */}
          {(advancedMode || state.tab === "auth") && (
            <button
              type="button"
              className={`${styles.tab} ${state.tab === "auth" ? styles.tabActive : ""}`}
              onClick={() => setTab("auth")}
            >
              {zh.tabAuth} ({state.authProfiles.length})
            </button>
          )}
          <button
            type="button"
            className={`${styles.tab} ${state.tab === "defaultAgent" ? styles.tabActive : ""}`}
            onClick={() => setTab("defaultAgent")}
          >
            {zh.tabDefaultAgent}
          </button>
        </div>

        <div className={styles.body}>
          {state.load.kind === "loading" && (
            <div className={styles.detailEmpty}>{zh.loading}</div>
          )}
          {state.load.kind === "error" && (
            <div className={styles.detailEmpty}>
              {zh.loadFailed}: {state.load.message}
            </div>
          )}
          {state.load.kind === "ready" && state.tab === "providers" && (
            <ProvidersTab
              state={state}
              dispatch={dispatch}
              advancedMode={advancedMode}
            />
          )}
          {state.load.kind === "ready" && state.tab === "auth" && (
            <AuthProfilesTab state={state} dispatch={dispatch} />
          )}
          {state.load.kind === "ready" && state.tab === "defaultAgent" && (
            <DefaultAgentTab state={state} dispatch={dispatch} />
          )}
        </div>

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.btn}
            onClick={handleResetPreset}
            disabled={state.saving}
          >
            {zh.btnResetAgentPreset}
          </button>
          <span className={styles.spacer} />
          {state.lastSaveError && (
            <span className={`${styles.statusBar} ${styles.statusErr}`}>
              {state.lastSaveError}
            </span>
          )}
          <button
            type="button"
            className={styles.btn}
            onClick={requestClose}
            disabled={state.saving}
          >
            {zh.btnCancel}
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary} ${
              !state.dirty || state.saving ? styles.btnDisabled : ""
            }`}
            onClick={handleSave}
            disabled={!state.dirty || state.saving}
          >
            {state.saving ? zh.btnSaving : zh.btnSave}
          </button>
        </div>
      </div>

      {confirm && (
        <div className={styles.overlay}>
          <div className={styles.confirmDialog}>
            <div className={styles.confirmTitle}>{confirm.title}</div>
            <div className={styles.confirmBody}>{confirm.body}</div>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.btn}
                onClick={() => setConfirm(null)}
              >
                {zh.btnKeepEditing}
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnDanger}`}
                onClick={confirm.onConfirm}
              >
                {confirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
