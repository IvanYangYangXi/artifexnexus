// STORY-0020：重装确认弹窗组件
// 在用户点击"重装"时展示，允许选择保留哪些已有配置。

import { useState } from "react";
import type { PreserveOptions } from "../../ipc/openclaw";
import styles from "./ReinstallConfirmDialog.module.css";

const PRESERVE_ITEMS: {
  key: keyof PreserveOptions;
  label: string;
  description: string;
}[] = [
  {
    key: "preserveProviders",
    label: "保留已配置的供应商",
    description: "baseUrl、模型列表等",
  },
  {
    key: "preserveAuth",
    label: "保留鉴权凭据与绑定",
    description: "API Key 不删，profile 绑定不变",
  },
  {
    key: "preserveAgents",
    label: "保留 Agent 设置",
    description: "默认模型、推理偏好等",
  },
  {
    key: "preservePlugins",
    label: "保留插件自定义配置",
    description: "memory-core dreaming 等",
  },
];

interface Props {
  onConfirm: (options: PreserveOptions) => void;
  onCancel: () => void;
}

export default function ReinstallConfirmDialog({ onConfirm, onCancel }: Props) {
  const [options, setOptions] = useState<PreserveOptions>({
    preserveProviders: true,
    preserveAuth: true,
    preserveAgents: true,
    preservePlugins: true,
  });

  const toggle = (key: keyof PreserveOptions) => {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.dialog}>
        <h3 className={styles.title}>重新安装 OpenClaw</h3>

        <p className={styles.description}>
          重装会重新下载 CLI 并刷新基础配置（gateway/端口）。勾选的项目将在重装后自动恢复。
        </p>

        <div className={styles.optionsList}>
          {PRESERVE_ITEMS.map((item) => (
            <label key={item.key} className={styles.optionItem}>
              <input
                type="checkbox"
                checked={options[item.key] ?? true}
                onChange={() => toggle(item.key)}
              />
              <div className={styles.optionText}>
                <span className={styles.optionLabel}>{item.label}</span>
                <span className={styles.optionDesc}>{item.description}</span>
              </div>
            </label>
          ))}
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => onConfirm(options)}
          >
            确认重装
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnGhost}`}
            onClick={onCancel}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
