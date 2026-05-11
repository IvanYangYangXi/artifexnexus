// Default Agent Tab：选 Artifex Nexus 默认 agent 用哪个模型。
// EPIC-0001 第二批 STORY-0015。
// 与 STORY-0017 联动：模型不写死在 preset，靠 agents.defaults.model 间接生效。

import { useMemo, type Dispatch } from "react";
import type { SettingsState, SettingsAction } from "../settings.reducer";
import { t } from "../settings.i18n";
import styles from "../SettingsPanel.module.css";

const zh = t.zhCN;

const THINKING_OPTIONS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "adaptive",
  "max",
];

const REASONING_OPTIONS = ["off", "on", "stream"];

interface Props {
  state: SettingsState;
  dispatch: Dispatch<SettingsAction>;
}

export default function DefaultAgentTab({ state, dispatch }: Props) {
  const ad = state.defaultAgent;

  // 模型笛卡尔积：provider/model
  const modelOptions = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    for (const p of state.providers) {
      for (const m of p.models) {
        if (m.id) {
          const value = `${p.id}/${m.id}`;
          out.push({ value, label: value });
        }
      }
    }
    return out;
  }, [state.providers]);

  // Bug #3 修复：如果当前选中的模型不在 options 中但非空，也要作为选项保留
  // （可能是从 openclaw.json 读回的旧值，provider 列表中已无对应条目）
  const ensureOption = (currentValue: string, options: typeof modelOptions) => {
    if (currentValue && !options.some((o) => o.value === currentValue)) {
      return [{ value: currentValue, label: `${currentValue} (未找到)` }, ...options];
    }
    return options;
  };

  const defaultModelOptions = ensureOption(ad.defaultModel, modelOptions);
  const imageModelOptions = ensureOption(ad.imageModel, modelOptions);
  const imageGenModelOptions = ensureOption(ad.imageGenerationModel, modelOptions);

  return (
    <div className={styles.detail} style={{ width: "100%" }}>
      <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 16 }}>
        Artifex Nexus 默认 agent（来自 STORY-0017）会自动消费此处的"主模型"——
        在这里切，preset 自动跟随。
      </p>

      {modelOptions.length === 0 && (
        <div
          style={{
            background: "#fef3c7",
            border: "1px solid #f59e0b",
            borderRadius: 4,
            padding: "8px 12px",
            fontSize: 12,
            marginBottom: 12,
            color: "#92400e",
          }}
        >
          ⚠ 尚未配置模型。请先在"供应商"标签页添加 Provider 和模型，然后回到此处选择默认模型。
        </div>
      )}

      <div className={styles.formRow}>
        <label className={styles.formLabel}>{zh.fieldDefaultModel}</label>
        <select
          className={styles.formSelect}
          value={ad.defaultModel}
          onChange={(e) =>
            dispatch({
              type: "UPDATE_DEFAULT_AGENT",
              patch: { defaultModel: e.target.value },
            })
          }
        >
          <option value="">{zh.modelPickerPlaceholder}</option>
          {defaultModelOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.formRow}>
        <label className={styles.formLabel}>{zh.fieldImageModel}</label>
        <select
          className={styles.formSelect}
          value={ad.imageModel}
          onChange={(e) =>
            dispatch({
              type: "UPDATE_DEFAULT_AGENT",
              patch: { imageModel: e.target.value },
            })
          }
        >
          <option value="">{zh.modelPickerPlaceholder}</option>
          {imageModelOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.formRow}>
        <label className={styles.formLabel}>{zh.fieldImageGenModel}</label>
        <select
          className={styles.formSelect}
          value={ad.imageGenerationModel}
          onChange={(e) =>
            dispatch({
              type: "UPDATE_DEFAULT_AGENT",
              patch: { imageGenerationModel: e.target.value },
            })
          }
        >
          <option value="">{zh.modelPickerPlaceholder}</option>
          {imageGenModelOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.formRow}>
        <label className={styles.formLabel}>{zh.fieldThinkingDefault}</label>
        <select
          className={styles.formSelect}
          value={ad.thinkingDefault}
          onChange={(e) =>
            dispatch({
              type: "UPDATE_DEFAULT_AGENT",
              patch: { thinkingDefault: e.target.value },
            })
          }
        >
          {THINKING_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.formRow}>
        <label className={styles.formLabel}>{zh.fieldReasoningDefault}</label>
        <select
          className={styles.formSelect}
          value={ad.reasoningDefault}
          onChange={(e) =>
            dispatch({
              type: "UPDATE_DEFAULT_AGENT",
              patch: { reasoningDefault: e.target.value },
            })
          }
        >
          {REASONING_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>

      {/* Bug #5：展示 agents.list 中的预设 agent */}
      {state.agentPresets.length > 0 && (
        <fieldset
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            padding: "8px 12px",
            margin: "16px 0 8px",
          }}
        >
          <legend style={{ fontSize: 12, color: "#374151", padding: "0 6px" }}>
            已注册 Agent 预设（{state.agentPresets.length}）
          </legend>
          {state.agentPresets.map((agent) => (
            <div
              key={agent.id}
              style={{
                border: "1px solid #f3f4f6",
                borderRadius: 4,
                padding: "8px 12px",
                marginBottom: 8,
                background: agent.isDefault ? "#f0fdf4" : "#fafafa",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 6,
                }}
              >
                <span style={{ fontWeight: 600, fontSize: 13 }}>
                  {agent.name || agent.id}
                </span>
                {agent.isDefault && (
                  <span
                    style={{
                      fontSize: 10,
                      background: "#16a34a",
                      color: "#fff",
                      padding: "1px 6px",
                      borderRadius: 3,
                    }}
                  >
                    默认
                  </span>
                )}
                <span style={{ fontSize: 11, color: "#9ca3af" }}>
                  ID: {agent.id}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "#4b5563", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px" }}>
                <span>Thinking: <strong>{agent.thinkingDefault || "—"}</strong></span>
                <span>Reasoning: <strong>{agent.reasoningDefault || "—"}</strong></span>
                <span>Verbose: <strong>{agent.verboseDefault || "—"}</strong></span>
                <span>Tool Detail: <strong>{agent.toolProgressDetail || "—"}</strong></span>
                {agent.skills.length > 0 && (
                  <span style={{ gridColumn: "1 / -1" }}>
                    Skills: <strong>{agent.skills.join(", ")}</strong>
                  </span>
                )}
              </div>
            </div>
          ))}
        </fieldset>
      )}
    </div>
  );
}
