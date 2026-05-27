// 通知推送 Tauri Command。
// 接收来自外部脚本/cron 的通知请求，通过 Tauri 事件推送到前端 WebView。
// 文件行数硬上限 100。

use serde::{Deserialize, Serialize};
use tauri::Emitter;

/// 推送通知请求（前端/脚本 → Rust → WebView 事件）
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PushNotificationRequest {
    pub title: String,
    pub message: String,
    /// info | success | warning | error
    #[serde(rename = "type")]
    pub type_: String,
    #[serde(default)]
    pub source: Option<String>,
}

/// push_notification — 将通知推送到前端
/// 外部脚本可通过 Tauri invoke("push_notification", { req: {...} }) 调用
#[tauri::command]
pub fn push_notification(
    app_handle: tauri::AppHandle,
    req: PushNotificationRequest,
) -> Result<(), String> {
    // 验证 type 字段
    let valid_types = ["info", "success", "warning", "error"];
    if !valid_types.contains(&req.type_.as_str()) {
        return Err(format!(
            "无效通知类型: '{}'，可选: {:?}",
            req.type_, valid_types
        ));
    }

    // 通过 Tauri 事件推送到前端
    app_handle
        .emit("notification-received", &req)
        .map_err(|e| format!("推送通知事件失败: {e}"))?;

    Ok(())
}
