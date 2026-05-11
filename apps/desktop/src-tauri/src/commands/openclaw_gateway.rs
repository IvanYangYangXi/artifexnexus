// STORY-0018 T3：Gateway 状态控制面板的 5 个 Tauri Command。
// 转发到 sidecar 的 5 个 RPC：
// - openclaw.gateway.status
// - openclaw.gateway.start({force_restart})
// - openclaw.gateway.restart
// - openclaw.gateway.tail_log({n, since_id})
// - openclaw.web.open
//
// 文件行数硬上限 300。

use crate::sidecar::manager::SidecarState;
use serde::Serialize;
use serde_json::json;
use tauri::State;

// ---------------------------------------------------------------------------
// 响应类型（与 packages/platform/contracts/schemas/openclaw-gateway-*.schema.json 对齐）
// ---------------------------------------------------------------------------

/// openclaw.gateway.status 响应
#[derive(Debug, Serialize, Clone)]
pub struct GatewayStatusResponse {
    /// "running" | "stopped" | "errored"
    pub state: String,
    pub pid: Option<u32>,
    pub port: Option<u16>,
    /// 启动时间 unix ts（秒，float）
    pub started_at: Option<f64>,
    /// 当前 gateway 日志 buffer 的最大 id；前端用作 since_id 初值
    pub last_log_id: u64,
    pub last_error: Option<String>,
}

/// openclaw.gateway.start / openclaw.gateway.restart 响应
#[derive(Debug, Serialize, Clone)]
pub struct GatewayStartResponse {
    pub success: bool,
    pub restarted: bool,
    pub pid: u32,
    pub port: u16,
    pub message: String,
}

/// 单条 gateway 日志条目
#[derive(Debug, Serialize, Clone)]
pub struct GatewayLogEntry {
    pub id: u64,
    /// unix ts（秒，float）
    pub ts: f64,
    /// "DEBUG" | "INFO" | "WARN" | "ERROR"
    pub level: String,
    /// "stdout" | "stderr"
    pub stream: String,
    pub text: String,
}

/// openclaw.gateway.tail_log 响应
#[derive(Debug, Serialize, Clone)]
pub struct GatewayLogBatchResponse {
    pub entries: Vec<GatewayLogEntry>,
    pub max_id: u64,
    pub buffer_size: u64,
    pub dropped: u64,
}

/// openclaw.web.open 响应（fire-and-forget）
#[derive(Debug, Serialize, Clone)]
pub struct WebOpenResponse {
    pub success: bool,
    /// 固定 "openclaw_dashboard"，T3/T4 前端 fallback 时可扩展
    pub method: String,
    pub pid: Option<u32>,
    pub error: Option<String>,
}

/// openclaw.gateway.auth_info 响应（STORY-0039 Chat WS 直连）
///
/// 前端 WebSocket 握手需要 port + token，本命令从 sidecar 读取并回传。
/// token 仅在 Tauri 本地进程间流转，不上网络、不落盘。
#[derive(Debug, Serialize, Clone)]
pub struct GatewayAuthInfoResponse {
    /// Gateway 实际监听端口（已反映端口迁移后的真实值）
    pub port: u16,
    /// Gateway auth token；`auth_mode != "token"` 或未配置时为空串
    pub token: String,
    /// "token" / "none" / "" 未配置
    pub auth_mode: String,
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// 查询 gateway 进程状态。
///
/// 前端 1s 轮询此命令，渲染状态点 + 元数据行 + 滚动日志的 since_id 锚点。
#[tauri::command]
pub async fn openclaw_gateway_status(
    sidecar: State<'_, SidecarState>,
) -> Result<GatewayStatusResponse, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    let result = manager.call("openclaw.gateway.status", json!({}))?;

    Ok(GatewayStatusResponse {
        state: result["state"].as_str().unwrap_or("stopped").to_string(),
        pid: result["pid"].as_u64().map(|p| p as u32),
        port: result["port"].as_u64().map(|p| p as u16),
        started_at: result["started_at"].as_f64(),
        last_log_id: result["last_log_id"].as_u64().unwrap_or(0),
        last_error: result["last_error"].as_str().map(|s| s.to_string()),
    })
}

/// 启动 gateway（幂等）。
///
/// `force_restart=true` 时先 stop 再 start，等价 `openclaw_gateway_restart`。
#[tauri::command]
pub async fn openclaw_gateway_start(
    sidecar: State<'_, SidecarState>,
    force_restart: Option<bool>,
    port: Option<u16>,
) -> Result<GatewayStartResponse, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    let params = json!({
        "force_restart": force_restart.unwrap_or(false),
        "port": port.unwrap_or(19789),
    });
    let result = manager.call("openclaw.gateway.start", params)?;

    Ok(GatewayStartResponse {
        success: result["success"].as_bool().unwrap_or(false),
        restarted: result["restarted"].as_bool().unwrap_or(false),
        pid: result["pid"].as_u64().unwrap_or(0) as u32,
        port: result["port"].as_u64().unwrap_or(19789) as u16,
        message: result["message"].as_str().unwrap_or("").to_string(),
    })
}

/// 重启 gateway（等价 start force_restart=true）。
#[tauri::command]
pub async fn openclaw_gateway_restart(
    sidecar: State<'_, SidecarState>,
    port: Option<u16>,
) -> Result<GatewayStartResponse, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    let params = json!({ "port": port.unwrap_or(19789) });
    let result = manager.call("openclaw.gateway.restart", params)?;

    Ok(GatewayStartResponse {
        success: result["success"].as_bool().unwrap_or(false),
        restarted: result["restarted"].as_bool().unwrap_or(false),
        pid: result["pid"].as_u64().unwrap_or(0) as u32,
        port: result["port"].as_u64().unwrap_or(19789) as u16,
        message: result["message"].as_str().unwrap_or("").to_string(),
    })
}

/// 增量拉取 gateway 日志。
///
/// `since_id` 与 `n` **互斥**：若同传，sidecar 优先 since_id（spec §2.4）。
/// 首次拉取：`{ n: 200 }`；后续轮询：`{ since_id: last_max_id }`。
#[tauri::command]
pub async fn openclaw_gateway_tail_log(
    sidecar: State<'_, SidecarState>,
    n: Option<u32>,
    since_id: Option<u64>,
) -> Result<GatewayLogBatchResponse, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    // 按 sidecar 约定：同传时 since_id 优先；二者全无时走默认 n=200
    let mut params = serde_json::Map::new();
    if let Some(sid) = since_id {
        params.insert("since_id".to_string(), json!(sid));
    } else if let Some(nv) = n {
        params.insert("n".to_string(), json!(nv));
    }
    let result = manager.call("openclaw.gateway.tail_log", serde_json::Value::Object(params))?;

    let entries: Vec<GatewayLogEntry> = result["entries"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|e| GatewayLogEntry {
                    id: e["id"].as_u64().unwrap_or(0),
                    ts: e["ts"].as_f64().unwrap_or(0.0),
                    level: e["level"].as_str().unwrap_or("INFO").to_string(),
                    stream: e["stream"].as_str().unwrap_or("stdout").to_string(),
                    text: e["text"].as_str().unwrap_or("").to_string(),
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(GatewayLogBatchResponse {
        entries,
        max_id: result["max_id"].as_u64().unwrap_or(0),
        buffer_size: result["buffer_size"].as_u64().unwrap_or(0),
        dropped: result["dropped"].as_u64().unwrap_or(0),
    })
}

/// 让 OpenClaw CLI 自开浏览器到 dashboard（fire-and-forget）。
///
/// 不带 `--no-open`，token 不透传到前端，比 `openclaw_web_get_url` 更安全。
/// spawn 即返回，不阻塞、不解析 stdout；spawn 即时失败时 `success=false`。
#[tauri::command]
pub async fn openclaw_web_open(
    sidecar: State<'_, SidecarState>,
) -> Result<WebOpenResponse, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    let result = manager.call("openclaw.web.open", json!({}))?;

    Ok(WebOpenResponse {
        success: result["success"].as_bool().unwrap_or(false),
        method: result["method"]
            .as_str()
            .unwrap_or("openclaw_dashboard")
            .to_string(),
        pid: result["pid"].as_u64().map(|p| p as u32),
        error: result["error"].as_str().map(|s| s.to_string()),
    })
}

/// 获取 Gateway 连接凭据（port + token），供前端 WebSocket 握手使用。
///
/// 设计要点（STORY-0039）：
/// - 前端直连 Gateway WS 时必须发送 `auth.token`；token 存在
///   `openclaw.json → gateway.auth.token`，前端原本无法读取。
/// - token 仅经 Tauri 本地进程（sidecar stdio → main → webview IPC），
///   **绝不**上网络、**绝不**写任何可上传日志。
/// - port 使用 `gateway_state` 登记的运行态实际端口，覆盖端口探测迁移
///   后的新值（默认 19789 经常被占用后迁到 19809 / 19829 等）。
#[tauri::command]
pub async fn openclaw_gateway_auth_info(
    sidecar: State<'_, SidecarState>,
) -> Result<GatewayAuthInfoResponse, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    let result = manager.call("openclaw.gateway.auth_info", json!({}))?;

    Ok(GatewayAuthInfoResponse {
        port: result["port"].as_u64().unwrap_or(19789) as u16,
        token: result["token"].as_str().unwrap_or("").to_string(),
        auth_mode: result["auth_mode"].as_str().unwrap_or("").to_string(),
    })
}
