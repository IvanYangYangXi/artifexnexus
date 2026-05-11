// Providers Tab：左列表 / 右详情 / 模板 picker / 高级折叠 / 测试连接 / 内联 Auth (v3)。
// EPIC-0001 第二批 STORY-0015。

import { useCallback, useState, type Dispatch } from "react";
import type { SettingsState, SettingsAction } from "../settings.reducer";
import { parseCustomHeaders } from "../settings.reducer";
import { PROVIDER_TEMPLATES } from "../settings.types";
import type { Protocol } from "../settings.types";
import { testOpenClawProvider, fetchRemoteModels } from "../../../ipc/openclaw";
import type { RemoteModelInfo } from "../../../ipc/openclaw";
import { t } from "../settings.i18n";
import styles from "../SettingsPanel.module.css";
import AuthInlineSection from "./AuthInlineSection";

const zh = t.zhCN;

const PROTOCOL_OPTIONS: { value: Protocol; label: string }[] = [
  { value: "openai", label: zh.protocolOpenAi },
  { value: "openai-compatible", label: zh.protocolOpenAiCompat },
  { value: "anthropic", label: zh.protocolAnthropic },
  { value: "google", label: zh.protocolGoogle },
  { value: "azure-openai", label: zh.protocolAzureOpenAi },
];

interface Props {
  state: SettingsState;
  dispatch: Dispatch<SettingsAction>;
  /** 高级模式：true 时仍显示底部"指向 auth profile"的下拉，便于跨 provider 共享 key */
  advancedMode?: boolean;
}

export default function ProvidersTab({ state, dispatch, advancedMode = false }: Props) {
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [alsoAuth, setAlsoAuth] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [newModelId, setNewModelId] = useState("");
  const [fetchingModels, setFetchingModels] = useState(false);
  const [remoteModels, setRemoteModels] = useState<RemoteModelInfo[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const selected = state.providers.find((p) => p.id === state.selectedProviderId);

  const handlePickTemplate = useCallback(
    (key: string) => {
      dispatch({
        type: "ADD_PROVIDER_FROM_TEMPLATE",
        templateKey: key,
        alsoAuth,
      });
      setShowTemplatePicker(false);
    },
    [alsoAuth, dispatch],
  );

  const handleAddBlank = useCallback(() => {
    dispatch({ type: "ADD_PROVIDER_BLANK" });
    setShowTemplatePicker(false);
  }, [dispatch]);

  const handleTestConnection = useCallback(() => {
    if (!selected) return;
    const defaultModel =
      selected.models.find((m) => m.isDefault)?.id || selected.models[0]?.id;
    if (!defaultModel) return;

    dispatch({ type: "TEST_START", providerId: selected.id });
    void (async () => {
      try {
        const r = await testOpenClawProvider({
          providerId: selected.id,
          modelId: defaultModel,
          authProfileId: selected.authProfileId,
        });
        dispatch({
          type: "TEST_DONE",
          providerId: selected.id,
          success: r.success,
          latencyMs: r.latencyMs,
          error: r.error,
        });
      } catch (e) {
        dispatch({
          type: "TEST_DONE",
          providerId: selected.id,
          success: false,
          latencyMs: null,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
  }, [selected, dispatch]);

  const handleFetchModels = useCallback(() => {
    if (!selected) return;
    // 需要 baseUrl
    if (!selected.baseUrl) {
      setFetchError("请先填写 baseUrl");
      return;
    }
    // 从 state 里查找关联的 auth profile 拿 token
    const profile = state.authProfiles.find(
      (a) => a.id === selected.authProfileId,
    );
    const token = profile?.apiKey || "";
    // Bug #2 修复：即使 token 为空或脱敏占位，也可以尝试获取模型列表，
    // sidecar 会自动从 auth-profiles.json 中读取已保存的真实 token。
    // 仅当完全没有凭据时才报错（无 auth profile 关联且无 token）
    if (!profile && !token) {
      setFetchError("请先关联凭据（创建 Auth Profile 并输入 API Key）");
      return;
    }

    setFetchingModels(true);
    setFetchError(null);
    setRemoteModels(null);
    void (async () => {
      try {
        const r = await fetchRemoteModels({
          baseUrl: selected.baseUrl,
          token,
          providerId: selected.id,
        });
        if (r.success && r.models && r.models.length > 0) {
          setRemoteModels(r.models);
        } else {
          setFetchError(r.error || "未获取到任何模型");
        }
      } catch (e) {
        setFetchError(e instanceof Error ? e.message : String(e));
      } finally {
        setFetchingModels(false);
      }
    })();
  }, [selected, state.authProfiles]);

  const handleImportRemoteModels = useCallback(
    (modelIds: string[]) => {
      if (!selected || modelIds.length === 0) return;
      dispatch({
        type: "IMPORT_REMOTE_MODELS",
        providerId: selected.id,
        modelIds,
      });
      setRemoteModels(null);
    },
    [selected, dispatch],
  );

  const headersValid =
    !selected?.customHeadersJson.trim() ||
    parseCustomHeaders(selected.customHeadersJson) !== null;

  return (
    <>
      <div className={styles.list}>
        {state.providers.length === 0 ? (
          <div className={styles.listEmpty}>{zh.emptyState}</div>
        ) : (
          state.providers.map((p) => (
            <div
              key={p.id}
              className={`${styles.listItem} ${
                p.id === state.selectedProviderId ? styles.listItemActive : ""
              }`}
              onClick={() => dispatch({ type: "SELECT_PROVIDER", id: p.id })}
            >
              <span>{p.displayName || p.id}</span>
              <span className={styles.listItemBadge}>{p.protocol}</span>
            </div>
          ))
        )}

        <div className={styles.listActions}>
          <button
            type="button"
            className={styles.btn}
            onClick={handleAddBlank}
          >
            {zh.btnAdd}
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={() => setShowTemplatePicker((s) => !s)}
          >
            {zh.btnAddFromTemplate}
          </button>
        </div>

        {showTemplatePicker && (
          <div className={styles.list} style={{ width: "100%", borderRight: "none" }}>
            {PROVIDER_TEMPLATES.map((tpl) => (
              <div
                key={tpl.key}
                className={styles.listItem}
                onClick={() => handlePickTemplate(tpl.key)}
              >
                <span>{tpl.label}</span>
                {tpl.note && (
                  <span className={styles.listItemBadge}>{tpl.note}</span>
                )}
              </div>
            ))}
            <div className={styles.checkboxRow}>
              <input
                id="auto-create-auth"
                type="checkbox"
                checked={alsoAuth}
                onChange={(e) => setAlsoAuth(e.target.checked)}
              />
              <label htmlFor="auto-create-auth">{zh.autoCreateAuthLabel}</label>
            </div>
          </div>
        )}
      </div>

      <div className={styles.detail}>
        {!selected ? (
          <div className={styles.detailEmpty}>{zh.selectFirst}</div>
        ) : (
          <>
            <div className={styles.formRow}>
              <label className={styles.formLabel}>{zh.fieldProviderId}</label>
              <input
                className={`${styles.formInput} ${selected.id ? "" : styles.formInputInvalid}`}
                value={selected.id}
                disabled
                title="ID 不可重命名（请删旧建新）"
              />
            </div>

            <div className={styles.formRow}>
              <label className={styles.formLabel}>{zh.fieldDisplayName}</label>
              <input
                className={styles.formInput}
                value={selected.displayName}
                onChange={(e) =>
                  dispatch({
                    type: "UPDATE_PROVIDER",
                    id: selected.id,
                    patch: { displayName: e.target.value },
                  })
                }
              />
            </div>

            <div className={styles.formRow}>
              <label className={styles.formLabel}>{zh.fieldProtocol}</label>
              <select
                className={styles.formSelect}
                value={selected.protocol}
                onChange={(e) =>
                  dispatch({
                    type: "UPDATE_PROVIDER",
                    id: selected.id,
                    patch: { protocol: e.target.value as Protocol },
                  })
                }
              >
                {PROTOCOL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.formRow}>
              <label className={styles.formLabel}>{zh.fieldBaseUrl}</label>
              <input
                className={`${styles.formInput} ${
                  selected.baseUrl ? "" : styles.formInputInvalid
                }`}
                value={selected.baseUrl}
                placeholder="https://..."
                onChange={(e) =>
                  dispatch({
                    type: "UPDATE_PROVIDER",
                    id: selected.id,
                    patch: { baseUrl: e.target.value },
                  })
                }
              />
            </div>

            {/* v3：高级模式才显示"指向已有 profile"下拉，用于跨 provider 共享 key */}
            {advancedMode && (
              <div className={styles.formRow}>
                <label className={styles.formLabel}>{zh.fieldAuthProfile}</label>
                <select
                  className={styles.formSelect}
                  value={selected.authProfileId ?? ""}
                  onChange={(e) =>
                    dispatch({
                      type: "UPDATE_PROVIDER",
                      id: selected.id,
                      patch: { authProfileId: e.target.value || undefined },
                    })
                  }
                >
                  <option value="">—</option>
                  {state.authProfiles.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.id}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className={styles.formRow}>
              <label className={styles.formLabel}>{zh.fieldModels}</label>
              <div style={{ flex: 1 }}>
                <div className={styles.modelList}>
                  {selected.models.map((m, i) => (
                    <div key={`${m.id}-${i}`} className={styles.modelRow}>
                      <input
                        className={styles.formInput}
                        value={m.id}
                        onChange={(e) =>
                          dispatch({
                            type: "UPDATE_MODEL",
                            providerId: selected.id,
                            index: i,
                            patch: { id: e.target.value },
                          })
                        }
                      />
                      <label
                        style={{
                          fontSize: 12,
                          display: "flex",
                          gap: 4,
                          alignItems: "center",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={!!m.isDefault}
                          onChange={(e) => {
                            // 单选语义：勾选当前则其它取消
                            const checked = e.target.checked;
                            selected.models.forEach((_, idx) => {
                              dispatch({
                                type: "UPDATE_MODEL",
                                providerId: selected.id,
                                index: idx,
                                patch: { isDefault: idx === i && checked },
                              });
                            });
                          }}
                        />
                        默认
                      </label>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnGhost}`}
                        onClick={() =>
                          dispatch({
                            type: "DELETE_MODEL",
                            providerId: selected.id,
                            index: i,
                          })
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className={styles.formInput}
                    placeholder="model-id (gpt-4o-mini / claude-3-5-sonnet …)"
                    value={newModelId}
                    onChange={(e) => setNewModelId(e.target.value)}
                  />
                  <button
                    type="button"
                    className={styles.btn}
                    onClick={() => {
                      const id = newModelId.trim();
                      if (!id) return;
                      dispatch({
                        type: "ADD_MODEL",
                        providerId: selected.id,
                        modelId: id,
                      });
                      setNewModelId("");
                    }}
                  >
                    {zh.btnAdd}
                  </button>
                  <button
                    type="button"
                    className={styles.btn}
                    disabled={fetchingModels}
                    onClick={handleFetchModels}
                    title="从远端 API 获取可用模型列表（需要先保存凭据）"
                  >
                    {fetchingModels ? "获取中…" : "获取模型列表"}
                  </button>
                </div>
                {fetchError && (
                  <div style={{ color: "#dc2626", fontSize: 12, marginTop: 4 }}>
                    {fetchError}
                  </div>
                )}
                {remoteModels && remoteModels.length > 0 && (
                  <div
                    style={{
                      border: "1px solid #d1d5db",
                      borderRadius: 4,
                      padding: 8,
                      marginTop: 8,
                      maxHeight: 180,
                      overflowY: "auto",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 6,
                      }}
                    >
                      <span style={{ fontSize: 12, color: "#6b7280" }}>
                        远端可用模型（{remoteModels.length} 个）
                      </span>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnSmall}`}
                          onClick={() =>
                            handleImportRemoteModels(
                              remoteModels.map((m) => m.id),
                            )
                          }
                        >
                          全部导入
                        </button>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnGhost} ${styles.btnSmall}`}
                          onClick={() => setRemoteModels(null)}
                        >
                          关闭
                        </button>
                      </div>
                    </div>
                    {remoteModels.map((m) => (
                      <div
                        key={m.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "3px 0",
                          borderBottom: "1px solid #f3f4f6",
                        }}
                      >
                        <span style={{ fontSize: 13 }}>
                          {m.name || m.id}
                          {m.ownedBy && (
                            <span style={{ color: "#9ca3af", fontSize: 11, marginLeft: 6 }}>
                              ({m.ownedBy})
                            </span>
                          )}
                        </span>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnGhost} ${styles.btnSmall}`}
                          onClick={() => handleImportRemoteModels([m.id])}
                        >
                          导入
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* v3 — 内联 Auth Profiles 折叠区（默认显示，与上游 Control UI 一致） */}
            <fieldset
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 6,
                padding: "8px 12px",
                margin: "8px 0",
              }}
            >
              <legend style={{ fontSize: 12, color: "#374151", padding: "0 6px" }}>
                {zh.sectionAuthInline}
              </legend>
              <AuthInlineSection
                state={state}
                dispatch={dispatch}
                providerId={selected.id}
                advancedMode={advancedMode}
              />
            </fieldset>

            <button
              type="button"
              className={styles.advancedToggle}
              onClick={() => setShowAdvanced((s) => !s)}
            >
              {showAdvanced ? "▽" : "▶"} {zh.fieldAdvanced}
            </button>

            {showAdvanced && (
              <div className={styles.advancedBody}>
                <div className={styles.formRow}>
                  <label className={styles.formLabel}>
                    {zh.fieldCustomHeaders}
                  </label>
                  <textarea
                    className={`${styles.formTextarea} ${
                      headersValid ? "" : styles.formInputInvalid
                    }`}
                    value={selected.customHeadersJson}
                    placeholder='{ "X-Org": "..." }'
                    onChange={(e) =>
                      dispatch({
                        type: "UPDATE_PROVIDER",
                        id: selected.id,
                        patch: { customHeadersJson: e.target.value },
                      })
                    }
                  />
                </div>
                {!headersValid && (
                  <div className={styles.formError}>{zh.errorInvalidJson}</div>
                )}
              </div>
            )}

            <div className={styles.detailFooter}>
              <button
                type="button"
                className={styles.btn}
                onClick={handleTestConnection}
                disabled={state.testing || selected.models.length === 0}
              >
                {state.testing ? zh.btnTesting : zh.btnTest}
              </button>
              <span className={styles.spacer} />
              {state.lastTest && state.lastTest.providerId === selected.id && (
                <span
                  className={
                    state.lastTest.success ? styles.statusOk : styles.statusErr
                  }
                  style={{ fontSize: 12 }}
                >
                  {state.lastTest.success
                    ? `${zh.testSuccess}${state.lastTest.latencyMs !== null ? ` · ${state.lastTest.latencyMs}ms` : ""}`
                    : `${zh.testFailed}: ${state.lastTest.error ?? "?"}`}
                </span>
              )}
              <button
                type="button"
                className={`${styles.btn} ${styles.btnDanger}`}
                onClick={() =>
                  dispatch({ type: "DELETE_PROVIDER", id: selected.id })
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
