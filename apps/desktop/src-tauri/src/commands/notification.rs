// 通知推送 Tauri Command。
// 接收来自外部脚本/cron 的通知请求，通过 Tauri 事件推送到前端 WebView。
// 文件行数硬上限 150。

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
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
    /// 详细内容（合规检查的问题列表等），点击详情弹窗时展示
    #[serde(default)]
    pub detail: Option<String>,
}

/// 扫描结果（返回给前端）
#[derive(Debug, Serialize)]
pub struct ScanResult {
    pub processed: usize,
    pub errors: Vec<String>,
}

/// push_notification — 将通知推送到前端
/// 外部脚本可通过 Tauri invoke("push_notification", { req: {...} }) 调用
#[tauri::command]
pub fn push_notification(
    app_handle: tauri::AppHandle,
    req: PushNotificationRequest,
) -> Result<(), String> {
    let valid_types = ["info", "success", "warning", "error"];
    if !valid_types.contains(&req.type_.as_str()) {
        return Err(format!(
            "无效通知类型: '{}'，可选: {:?}",
            req.type_, valid_types
        ));
    }

    app_handle
        .emit("notification-received", &req)
        .map_err(|e| format!("推送通知事件失败: {e}"))?;

    Ok(())
}

/// 获取待处理通知目录路径
fn pending_notifications_dir() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."));
    home.join(".artifexnexus").join("pending_notifications")
}

/// scan_pending_notifications — 扫描文件系统中的通知文件并推送到前端
///
/// Python 等外部脚本将通知 JSON 写入 ~/.artifexnexus/pending_notifications/，
/// 前端定时轮询此命令来消费这些文件。
#[tauri::command]
pub fn scan_pending_notifications(
    app_handle: tauri::AppHandle,
) -> Result<ScanResult, String> {
    let dir = pending_notifications_dir();
    let mut processed = 0usize;
    let mut errors: Vec<String> = Vec::new();

    // 确保目录存在
    if let Err(e) = std::fs::create_dir_all(&dir) {
        // 目录创建失败不是致命错误（可能已存在），继续尝试读取
        errors.push(format!("创建目录失败: {e}"));
    }

    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(e) => {
            return Err(format!("读取通知目录失败: {e}"));
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();

        // 只处理 .json 文件
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }

        // 读取文件内容
        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(e) => {
                errors.push(format!("读取 {} 失败: {e}", path.display()));
                // 删除损坏文件
                let _ = std::fs::remove_file(&path);
                continue;
            }
        };

        // 解析 JSON
        match serde_json::from_str::<PushNotificationRequest>(&content) {
            Ok(req) => {
                // 验证 type
                let valid_types = ["info", "success", "warning", "error"];
                let type_ok = valid_types.contains(&req.type_.as_str());
                let final_req = if type_ok {
                    req
                } else {
                    PushNotificationRequest {
                        type_: "info".to_string(),
                        ..req
                    }
                };

                // 推送到前端
                if let Err(e) = app_handle.emit("notification-received", &final_req) {
                    errors.push(format!("推送 {} 失败: {e}", path.display()));
                } else {
                    processed += 1;
                }
            }
            Err(e) => {
                errors.push(format!("解析 {} JSON 失败: {e}", path.display()));
            }
        }

        // 删除已处理的文件。Windows 上文件可能被 Python 写进程短暂锁定，
        // remove_file 静默失败会导致下次扫描重复处理 → 双重通知。
        // 删除失败时重命名为 .processed 后缀，防止重复消费。
        if std::fs::remove_file(&path).is_err() {
            let processed_path = path.with_extension("json.processed");
            let _ = std::fs::rename(&path, &processed_path);
        }
    }

    Ok(ScanResult { processed, errors })
}
