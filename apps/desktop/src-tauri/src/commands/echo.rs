// Echo Tauri Command：端到端验证 Rust ↔ sidecar ↔ 前端链路。

use crate::sidecar::manager::SidecarState;
use serde_json::json;
use tauri::State;

/// Echo 命令：通过 sidecar ping 验证链路。
/// 首次调用时自动启动 sidecar（lazy init）。
#[tauri::command]
pub fn echo(message: String, sidecar: State<SidecarState>) -> Result<String, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;

    // Lazy init：首次调用时启动 sidecar
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    // 通过 sidecar 发送 ping
    let result = manager.call("ping", json!({"message": message}))?;

    // 提取 result 字符串
    let pong = result.as_str().unwrap_or("unknown").to_string();

    Ok(format!("Echo via sidecar: {pong}"))
}
