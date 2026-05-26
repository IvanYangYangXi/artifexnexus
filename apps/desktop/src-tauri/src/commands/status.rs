// 状态查询 Tauri Command：返回 sidecar 运行状态、OpenClaw 聚合状态。

use crate::sidecar::manager::SidecarState;
use serde::Serialize;
use serde_json::json;
use tauri::State;

/// 前端状态响应
#[derive(Debug, Serialize)]
pub struct StatusResponse {
    /// sidecar 是否运行中
    pub sidecar_running: bool,
    /// OpenClaw CLI 是否已安装
    pub cli_installed: bool,
    /// bootstrap 是否完成
    pub bootstrap_done: bool,
    /// gateway 是否运行中
    pub gateway_running: bool,
    /// 当前端口
    pub port: u16,
    /// 当前版本
    pub version: String,
    /// 隔离目录路径
    pub openclaw_home: String,
}

/// 查询当前运行状态（聚合 sidecar + OpenClaw）。
#[tauri::command]
pub fn get_status(sidecar: State<SidecarState>) -> Result<StatusResponse, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;

    // 懒初始化：与其他命令保持一致，首次调用时自动启动 sidecar
    manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;

    let sidecar_running = manager.is_running();

    // 尝试获取 OpenClaw 状态
    let (cli_installed, bootstrap_done, gateway_running, port, version) =
        if sidecar_running {
            match manager.call("openclaw.status", json!({})) {
                Ok(result) => (
                    result["cli_installed"].as_bool().unwrap_or(false),
                    result["bootstrap_done"].as_bool().unwrap_or(false),
                    result["gateway_running"].as_bool().unwrap_or(false),
                    result["port"].as_u64().unwrap_or(19789) as u16,
                    result["version"].as_str().unwrap_or("").to_string(),
                ),
                Err(_) => (false, false, false, 19789, String::new()),
            }
        } else {
            (false, false, false, 19789, String::new())
        };

    Ok(StatusResponse {
        sidecar_running,
        cli_installed,
        bootstrap_done,
        gateway_running,
        port,
        version,
        openclaw_home: "~/.artifexnexus/.openclaw/".to_string(),
    })
}
