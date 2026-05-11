// AuthInlineSection: v3 — 在 Provider 详情下方内联编辑当前 provider 的全部 auth profiles。
// 自动按 auth.profiles.<id>.provider 过滤；折叠/展开手风琴；首条作为 auth.order[0]。
// EPIC-0001 第二批 STORY-0015 v3。

import { useMemo, useState, type Dispatch } from "react";
import type { SettingsState, SettingsAction } from "../settings.reducer";
import type { AuthMode, AuthProfileForm } from "../settings.types";
import { t } from "../settings.i18n";
import styles from "../SettingsPanel.module.css";

const zh = t.zhCN;

const MODE_OPTIONS: { value: AuthMode; label: string }[] = [
  { value: "api_key", label: zh.authModeApiKey },
  { value: "oauth", label: zh.authModeOauth },
  { value: "token", label: zh.authModeToken },
];

/** 是否脱敏占位（≥8 个 *） */
function isMaskedApiKey(value: string): boolean {
  return !!value && value.length >= 8 && /^\*+$/.test(value);
}

interface Props {
  state: SettingsState;
  dispatch: Dispatch<SettingsAction>;
  /** 当前 provider id（外层 ProvidersTab 传入） */
  providerId: string;
  /** 高级模式（显示 mode 下拉 / email 字段） */
  advancedMode?: boolean;
}

export default function AuthInlineSection({ state, dispatch, providerId, advancedMode = false }: Props) {
  // 仅展示 provider 字段匹配的 profiles（v3 心智：profile 属于 provider）
  const ownProfiles = useMemo(
    () => state.authProfiles.filter((a) => a.provider === providerId),
    [state.authProfiles, providerId],
  );

  // 默认 profile（auth.order[0]）= provider.authProfileId
  const provider = state.providers.find((p) => p.id === providerId);
  const defaultProfileId = provider?.authProfileId ?? null;

  // 折叠态：profile 数 > 1 时全部默认折叠（手风琴），= 1 时自动展开
  const [expandedId, setExpandedId] = useState<string | null>(
    ownProfiles.length === 1 ? ownProfiles[0]!.id : defaultProfileId,
  );

  const handleAdd = () => {
    dispatch({ type: "ADD_AUTH_PROFILE", provider: providerId });
    // 让新增的那条立即展开（reducer 会把它追到末尾）
    // 这里靠 effect 不够稳，改为下一个 render 时根据 ownProfiles 末尾计算
  };

  return (
    <div className={styles.inlineAuthSection}>
      {ownProfiles.length === 0 && (
        <div className={styles.inlineAuthEmpty}>{zh.inlineAuthEmpty}</div>
      )}

      {ownProfiles.map((a) => {
        const expanded = expandedId === a.id;
        const isDefault = a.id === defaultProfileId;
        return (
          <div
            key={a.id}
            className={`${styles.inlineAuthCard} ${
              isDefault ? styles.inlineAuthCardDefault : ""
            }`}
          >
            <button
              type="button"
              className={styles.inlineAuthHeader}
              onClick={() => setExpandedId(expanded ? null : a.id)}
            >
              <span className={styles.inlineAuthCaret}>{expanded ? "▾" : "▸"}</span>
              <span className={styles.inlineAuthId}>{a.id}</span>
              {advancedMode && (
                <span className={styles.listItemBadge}>{a.mode}</span>
              )}
              {isDefault && (
                <span className={styles.listItemBadge}>默认</span>
              )}
              <span className={styles.spacer} />
              <span
                className={
                  a.apiKey
                    ? styles.statusOk
                    : a.mode === "oauth"
                      ? styles.statusOk
                      : styles.statusErr
                }
                style={{ fontSize: 12 }}
              >
                {a.apiKey || a.mode === "oauth" ? "✅" : "⚠ 无 Key"}
              </span>
            </button>

            {expanded && (
              <div className={styles.inlineAuthBody}>
                <InlineAuthForm
                  profile={a}
                  ownCount={ownProfiles.length}
                  dispatch={dispatch}
                  advancedMode={advancedMode}
                />
              </div>
            )}
          </div>
        );
      })}

      <div className={styles.listActions}>
        <button type="button" className={styles.btn} onClick={handleAdd}>
          {zh.btnAddAuthInline}
        </button>
      </div>
    </div>
  );
}

interface InlineAuthFormProps {
  profile: AuthProfileForm;
  ownCount: number;
  dispatch: Dispatch<SettingsAction>;
  advancedMode?: boolean;
}

function InlineAuthForm({ profile, ownCount, dispatch, advancedMode = false }: InlineAuthFormProps) {
  // Bug #1：添加 API Key 明文/密文切换
  const [showApiKey, setShowApiKey] = useState(false);

  const handleDelete = () => {
    if (ownCount === 1) {
      const ok = window.confirm(zh.inlineAuthLastWarn);
      if (!ok) return;
    }
    dispatch({ type: "DELETE_AUTH_PROFILE", id: profile.id });
  };

  return (
    <>
      {advancedMode && (
        <div className={styles.formRow}>
          <label className={styles.formLabel}>{zh.fieldAuthMode}</label>
          <select
            className={styles.formSelect}
            value={profile.mode}
            onChange={(e) =>
              dispatch({
                type: "UPDATE_AUTH_PROFILE",
                id: profile.id,
                patch: { mode: e.target.value as AuthMode },
              })
            }
          >
            {MODE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className={styles.formRow}>
        <label className={styles.formLabel}>{zh.fieldApiKey}</label>
        <div style={{ display: "flex", gap: 4, flex: 1 }}>
          <input
            className={styles.formInput}
            type={showApiKey ? "text" : "password"}
            autoComplete="off"
            value={profile.apiKey}
            placeholder={
              isMaskedApiKey(profile.apiKey)
                ? zh.apiKeyMaskedHint
                : zh.apiKeyPlaceholder
            }
            onFocus={(e) => {
              if (isMaskedApiKey(profile.apiKey)) {
                dispatch({
                  type: "UPDATE_AUTH_PROFILE",
                  id: profile.id,
                  patch: { apiKey: "" },
                });
                e.currentTarget.value = "";
              }
            }}
            onChange={(e) =>
              dispatch({
                type: "UPDATE_AUTH_PROFILE",
                id: profile.id,
                patch: { apiKey: e.target.value },
              })
            }
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className={styles.btn}
            onClick={() => setShowApiKey((v) => !v)}
            title={showApiKey ? "隐藏 API Key" : "显示 API Key"}
            style={{ minWidth: 32, padding: "0 6px", fontSize: 14 }}
          >
            {showApiKey ? "🙈" : "👁"}
          </button>
        </div>
      </div>

      {advancedMode && (
        <div className={styles.formRow}>
          <label className={styles.formLabel}>{zh.fieldEmail}</label>
          <input
            className={styles.formInput}
            value={profile.email ?? ""}
            onChange={(e) =>
              dispatch({
                type: "UPDATE_AUTH_PROFILE",
                id: profile.id,
                patch: { email: e.target.value || undefined },
              })
            }
          />
        </div>
      )}

      <div className={styles.formRow}>
        <label className={styles.formLabel}>{zh.fieldNotes}</label>
        <input
          className={styles.formInput}
          value={profile.notes ?? ""}
          onChange={(e) =>
            dispatch({
              type: "UPDATE_AUTH_PROFILE",
              id: profile.id,
              patch: { notes: e.target.value || undefined },
            })
          }
        />
      </div>

      <div className={styles.detailFooter}>
        <span className={styles.spacer} />
        <button
          type="button"
          className={`${styles.btn} ${styles.btnDanger}`}
          onClick={handleDelete}
        >
          {zh.btnDelete}
        </button>
      </div>
    </>
  );
}
