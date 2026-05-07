// Auth Profiles Tab：左列表 / 右详情 / API Key 脱敏占位行为。
// EPIC-0001 第二批 STORY-0015。

import { type Dispatch } from "react";
import type { SettingsState, SettingsAction } from "../settings.reducer";
import type { AuthMode } from "../settings.types";
import { t } from "../settings.i18n";
import styles from "../SettingsPanel.module.css";

const zh = t.zhCN;

const MODE_OPTIONS: { value: AuthMode; label: string }[] = [
  { value: "api-key", label: zh.authModeApiKey },
  { value: "oauth", label: zh.authModeOauth },
  { value: "token", label: zh.authModeToken },
  { value: "paste", label: zh.authModePaste },
];

interface Props {
  state: SettingsState;
  dispatch: Dispatch<SettingsAction>;
}

/** 是否脱敏占位（≥8 个 *） */
function isMaskedApiKey(value: string): boolean {
  return !!value && value.length >= 8 && /^\*+$/.test(value);
}

export default function AuthProfilesTab({ state, dispatch }: Props) {
  const selected = state.authProfiles.find((a) => a.id === state.selectedAuthId);

  return (
    <>
      <div className={styles.list}>
        {state.authProfiles.length === 0 ? (
          <div className={styles.listEmpty}>{zh.emptyState}</div>
        ) : (
          state.authProfiles.map((a) => (
            <div
              key={a.id}
              className={`${styles.listItem} ${
                a.id === state.selectedAuthId ? styles.listItemActive : ""
              }`}
              onClick={() => dispatch({ type: "SELECT_AUTH", id: a.id })}
            >
              <span>{a.id}</span>
              <span className={styles.listItemBadge}>{a.provider || "—"}</span>
            </div>
          ))
        )}

        <div className={styles.listActions}>
          <button
            type="button"
            className={styles.btn}
            onClick={() => {
              const provider = state.providers[0]?.id ?? "openai";
              dispatch({ type: "ADD_AUTH_PROFILE", provider });
            }}
          >
            {zh.btnAdd}
          </button>
        </div>
      </div>

      <div className={styles.detail}>
        {!selected ? (
          <div className={styles.detailEmpty}>{zh.selectFirst}</div>
        ) : (
          <>
            <div className={styles.formRow}>
              <label className={styles.formLabel}>{zh.fieldAuthId}</label>
              <input className={styles.formInput} value={selected.id} disabled />
            </div>

            <div className={styles.formRow}>
              <label className={styles.formLabel}>{zh.fieldProviderId}</label>
              <select
                className={styles.formSelect}
                value={selected.provider}
                onChange={(e) =>
                  dispatch({
                    type: "UPDATE_AUTH_PROFILE",
                    id: selected.id,
                    patch: { provider: e.target.value },
                  })
                }
              >
                {state.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.formRow}>
              <label className={styles.formLabel}>{zh.fieldAuthMode}</label>
              <select
                className={styles.formSelect}
                value={selected.mode}
                onChange={(e) =>
                  dispatch({
                    type: "UPDATE_AUTH_PROFILE",
                    id: selected.id,
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

            {(selected.mode === "api-key" || selected.mode === "paste") && (
              <div className={styles.formRow}>
                <label className={styles.formLabel}>{zh.fieldApiKey}</label>
                <input
                  className={styles.formInput}
                  type="password"
                  autoComplete="off"
                  value={selected.apiKey}
                  placeholder={
                    isMaskedApiKey(selected.apiKey)
                      ? zh.apiKeyMaskedHint
                      : zh.apiKeyPlaceholder
                  }
                  onFocus={(e) => {
                    // 聚焦时若是脱敏占位则清空，方便用户输新值
                    if (isMaskedApiKey(selected.apiKey)) {
                      dispatch({
                        type: "UPDATE_AUTH_PROFILE",
                        id: selected.id,
                        patch: { apiKey: "" },
                      });
                      e.currentTarget.value = "";
                    }
                  }}
                  onChange={(e) =>
                    dispatch({
                      type: "UPDATE_AUTH_PROFILE",
                      id: selected.id,
                      patch: { apiKey: e.target.value },
                    })
                  }
                />
              </div>
            )}

            <div className={styles.formRow}>
              <label className={styles.formLabel}>{zh.fieldEmail}</label>
              <input
                className={styles.formInput}
                value={selected.email ?? ""}
                onChange={(e) =>
                  dispatch({
                    type: "UPDATE_AUTH_PROFILE",
                    id: selected.id,
                    patch: { email: e.target.value || undefined },
                  })
                }
              />
            </div>

            <div className={styles.formRow}>
              <label className={styles.formLabel}>{zh.fieldNotes}</label>
              <input
                className={styles.formInput}
                value={selected.notes ?? ""}
                onChange={(e) =>
                  dispatch({
                    type: "UPDATE_AUTH_PROFILE",
                    id: selected.id,
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
                onClick={() =>
                  dispatch({ type: "DELETE_AUTH_PROFILE", id: selected.id })
                }
              >
                {zh.btnDelete}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
