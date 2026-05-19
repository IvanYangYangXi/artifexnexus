// 应用级设置 Tauri Commands：app_settings.get / set / reset
// 透传 sidecar JSON-RPC，前端 ↔ 后端共用 camelCase 字段。
// 文件行数硬上限 300。

use crate::sidecar::manager::SidecarState;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::State;

/// app.settings.get 返回结构
#[derive(Debug, Serialize, Clone)]
pub struct AppSettingsResponse {
    /// 当前设置（默认值已合并），字段为 camelCase JSON object
    pub settings: Value,
    /// 默认值（前端"重置"按钮可一键填回）
    pub defaults: Value,
    /// 实际持久化文件路径（展示给高级用户/排错）
    pub path: String,
}

/// 读取应用设置（含默认值合并）。
#[tauri::command]
pub async fn app_settings_get(
    sidecar: State<'_, SidecarState>,
) -> Result<AppSettingsResponse, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    let result = manager.call("app.settings.get", json!({}))?;
    Ok(AppSettingsResponse {
        settings: result.get("settings").cloned().unwrap_or_else(|| json!({})),
        defaults: result.get("defaults").cloned().unwrap_or_else(|| json!({})),
        path: result
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
    })
}

/// 部分更新应用设置；patch 是 camelCase JSON object。
#[tauri::command]
pub async fn app_settings_set(
    sidecar: State<'_, SidecarState>,
    patch: Value,
) -> Result<AppSettingsResponse, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    let result = manager.call("app.settings.set", json!({ "patch": patch }))?;
    Ok(AppSettingsResponse {
        settings: result.get("settings").cloned().unwrap_or_else(|| json!({})),
        defaults: result.get("defaults").cloned().unwrap_or_else(|| json!({})),
        path: result
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
    })
}

/// 重置应用设置为默认值。
#[tauri::command]
pub async fn app_settings_reset(
    sidecar: State<'_, SidecarState>,
) -> Result<AppSettingsResponse, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    let result = manager.call("app.settings.reset", json!({}))?;
    Ok(AppSettingsResponse {
        settings: result.get("settings").cloned().unwrap_or_else(|| json!({})),
        defaults: result.get("defaults").cloned().unwrap_or_else(|| json!({})),
        path: result
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
    })
}
