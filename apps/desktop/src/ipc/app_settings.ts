// 应用级设置 IPC：app.settings.get / set / reset。
// 调用 Tauri Rust commands，后者透传到 sidecar JSON-RPC。
// 字段为 camelCase，与 sidecar 端 DEFAULT_SETTINGS 对齐。

import { invoke } from "@tauri-apps/api/core";

/**
 * 应用级设置（前端可编辑字段）。
 *
 * 新增字段流程：
 *   1. sidecar 的 app_settings.py DEFAULT_SETTINGS 加默认值
 *   2. 这里添加 TypeScript 字段
 *   3. routes/Settings.tsx 的 GeneralTab 加输入控件
 */
export interface AppSettings {
  /** 通用 nexus-tool 默认超时（秒）。manifest.implementation.timeout 可单工具覆盖。 */
  nexusToolDefaultTimeoutSec: number;
  /** 同时允许运行的通用 nexus-tool 数。 */
  nexusToolMaxConcurrent: number;
  /** cancel 时是否递归杀子进程（Windows 下尤其重要）。 */
  nexusToolKillProcessTree: boolean;
  /** sidecar 日志等级（仅展示，热更新需后续迭代）。 */
  logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR";
  /** 运行工具前是否自动安装 manifest.dependencies 中缺失的 Python 包。 */
  nexusToolAutoInstallDeps: boolean;
  /** pip 安装镜像源 URL（为空时使用默认 PyPI）。 */
  nexusToolPipMirror: string;
}

export interface AppSettingsResponse {
  /** 当前设置（默认值已合并） */
  settings: AppSettings;
  /** 默认值（"重置"按钮可一键填回） */
  defaults: AppSettings;
  /** 持久化文件路径（展示给高级用户排错） */
  path: string;
}

/** 读取应用设置（含默认值合并） */
export async function getAppSettings(): Promise<AppSettingsResponse> {
  return invoke<AppSettingsResponse>("app_settings_get");
}

/** 部分更新应用设置；patch 只需包含要改的字段 */
export async function patchAppSettings(
  patch: Partial<AppSettings>,
): Promise<AppSettingsResponse> {
  return invoke<AppSettingsResponse>("app_settings_set", { patch });
}

/** 重置为默认值 */
export async function resetAppSettings(): Promise<AppSettingsResponse> {
  return invoke<AppSettingsResponse>("app_settings_reset");
}
