// 状态查询 Tauri Command：返回 sidecar 运行状态、端口等信息。

use crate::sidecar::manager::SidecarState;
use serde::Serialize;
use tauri::State;

/// 前端状态响应
#[derive(Debug, Serialize)]
pub struct StatusResponse {
    /// sidecar 是否运行中
    pub sidecar_running: bool,
    /// 当前端口（骨架阶段固定 14523）
    pub port: u16,
    /// 隔离目录路径
    pub openclaw_home: String,
}

/// 查询当前运行状态。
#[tauri::command]
pub fn get_status(sidecar: State<SidecarState>) -> Result<StatusResponse, String> {
    let manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;

    Ok(StatusResponse {
        sidecar_running: manager.is_running(),
        port: 14523, // 骨架阶段固定，后续从 sidecar get_port 获取
        openclaw_home: "~/.artifexnexus/.openclaw/".to_string(),
    })
}
