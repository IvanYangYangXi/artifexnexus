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

  return (
    <div className={styles.detail} style={{ width: "100%" }}>
      <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 16 }}>
        Artifex Nexus 默认 agent（来自 STORY-0017）会自动消费此处的"主模型"——
        在这里切，preset 自动跟随。
      </p>

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
          {modelOptions.map((o) => (
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
          {modelOptions.map((o) => (
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
          {modelOptions.map((o) => (
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
    </div>
  );
}
