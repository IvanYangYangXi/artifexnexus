// OpenClaw Tauri Commands：安装、bootstrap、启停、状态查询。
// 文件行数硬上限 300。

use crate::sidecar::manager::SidecarState;
use serde::Serialize;
use serde_json::json;
use tauri::State;

/// OpenClaw 状态响应（与 contracts/openclaw-status.schema.json 对齐）
#[derive(Debug, Serialize, Clone)]
pub struct OpenClawStatusResponse {
    pub cli_installed: bool,
    pub bootstrap_done: bool,
    pub gateway_running: bool,
    pub version: String,
    pub supported_version: String,
    pub version_mismatch: bool,
    pub port: u16,
    pub pid: Option<u32>,
    /// EPIC-0001 第二批 #2：当前 OpenClaw 版本是否提供 Web UI（轻量探测）
    pub web_ui_available: bool,
}

/// Web UI URL 探测响应（与 sidecar `openclaw.web.get_url` 对齐）
#[derive(Debug, Serialize, Clone)]
pub struct OpenClawWebUrlResponse {
    pub available: bool,
    pub url: Option<String>,
    pub reason: Option<String>,
}

/// Agent 预设状态响应（与 sidecar `openclaw.agent_preset.status` 对齐）
#[derive(Debug, Serialize, Clone)]
pub struct OpenClawAgentPresetStatusResponse {
    pub installed: bool,
    pub version: Option<String>,
    #[serde(rename = "modifiedByUser")]
    pub modified_by_user: bool,
    #[serde(rename = "lockPath")]
    pub lock_path: String,
}

/// Agent 预设 reset 响应（与 sidecar `openclaw.agent_preset.reset_default` 对齐）
#[derive(Debug, Serialize, Clone)]
pub struct OpenClawAgentPresetResetResponse {
    pub success: bool,
    pub action: String,
    pub version: String,
    pub error: Option<String>,
}

/// 查询 OpenClaw 聚合状态。
#[tauri::command]
pub async fn openclaw_status(
    sidecar: State<'_, SidecarState>,
) -> Result<OpenClawStatusResponse, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;

    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    let result = manager.call("openclaw.status", json!({}))?;

    Ok(OpenClawStatusResponse {
        cli_installed: result["cli_installed"].as_bool().unwrap_or(false),
        bootstrap_done: result["bootstrap_done"].as_bool().unwrap_or(false),
        gateway_running: result["gateway_running"].as_bool().unwrap_or(false),
        version: result["version"].as_str().unwrap_or("").to_string(),
        supported_version: result["supported_version"].as_str().unwrap_or("").to_string(),
        version_mismatch: result["version_mismatch"].as_bool().unwrap_or(false),
        port: result["port"].as_u64().unwrap_or(19789) as u16,
        pid: result["pid"].as_u64().map(|p| p as u32),
        web_ui_available: result["web_ui_available"].as_bool().unwrap_or(false),
    })
}

/// 安装 OpenClaw CLI。
#[tauri::command]
pub async fn openclaw_install(
    sidecar: State<'_, SidecarState>,
    version: Option<String>,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;

    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    let params = json!({
        "version": version.unwrap_or_else(|| "v2026.5.4".to_string()),
    });

    // CLI 安装/解压可能耗时数分钟（npm tarball ~200MB），用 600s 超时
    manager.call_with_timeout("openclaw.install", params, 600)
}

/// Bootstrap 初始化。
#[tauri::command]
pub async fn openclaw_bootstrap(
    sidecar: State<'_, SidecarState>,
    version: Option<String>,
    preserve_options: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;

    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    let mut params = json!({
        "version": version.unwrap_or_else(|| "v2026.5.4".to_string()),
    });
    if let Some(opts) = preserve_options {
        params["preserve_options"] = opts;
    }

    // bootstrap 写入大量配置 + 拷贝 official skills，可能 30-60s，给 120s
    manager.call_with_timeout("openclaw.bootstrap", params, 120)
}

/// 启动 OpenClaw gateway。
#[tauri::command]
pub async fn openclaw_start(
    sidecar: State<'_, SidecarState>,
    port: Option<u16>,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;

    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    let params = json!({
        "port": port.unwrap_or(19789),
    });

    manager.call("openclaw.start", params)
}

/// 停止 OpenClaw gateway。
#[tauri::command]
pub async fn openclaw_stop(
    sidecar: State<'_, SidecarState>,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;

    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    manager.call("openclaw.stop", json!({}))
}

/// 健康检查。
#[tauri::command]
pub async fn openclaw_doctor(
    sidecar: State<'_, SidecarState>,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;

    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    manager.call("openclaw.doctor", json!({}))
}

/// 获取 OpenClaw Control UI 的 URL（带 token，可直接系统浏览器打开）。
///
/// 调用 sidecar `openclaw.web.get_url`，返回 { available, url, reason }。
/// 前端拿到 url 后通过 `@tauri-apps/plugin-shell` 的 `open()` 打开。
#[tauri::command]
pub async fn openclaw_web_get_url(
    sidecar: State<'_, SidecarState>,
) -> Result<OpenClawWebUrlResponse, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;

    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    let result = manager.call("openclaw.web.get_url", json!({}))?;

    Ok(OpenClawWebUrlResponse {
        available: result["available"].as_bool().unwrap_or(false),
        url: result["url"].as_str().map(|s| s.to_string()),
        reason: result["reason"].as_str().map(|s| s.to_string()),
    })
}

/// 查询 Artifex Nexus 默认 agent 预设状态。
#[tauri::command]
pub async fn openclaw_agent_preset_status(
    sidecar: State<'_, SidecarState>,
) -> Result<OpenClawAgentPresetStatusResponse, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;

    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    let result = manager.call("openclaw.agent_preset.status", json!({}))?;

    Ok(OpenClawAgentPresetStatusResponse {
        installed: result["installed"].as_bool().unwrap_or(false),
        version: result["version"].as_str().map(|s| s.to_string()),
        modified_by_user: result["modifiedByUser"].as_bool().unwrap_or(false),
        lock_path: result["lockPath"].as_str().unwrap_or("").to_string(),
    })
}

/// 强制重置 Artifex Nexus 默认 agent 预设。
///
/// `force=true` 跳过 "用户改动" 检测，直接覆盖（设置面板"重置默认 agent 预设"按钮调用）。
#[tauri::command]
pub async fn openclaw_agent_preset_reset_default(
    sidecar: State<'_, SidecarState>,
    force: Option<bool>,
) -> Result<OpenClawAgentPresetResetResponse, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;

    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    let params = json!({ "force": force.unwrap_or(true) });
    let result = manager.call("openclaw.agent_preset.reset_default", params)?;

    Ok(OpenClawAgentPresetResetResponse {
        success: result["success"].as_bool().unwrap_or(false),
        action: result["action"].as_str().unwrap_or("").to_string(),
        version: result["version"].as_str().unwrap_or("").to_string(),
        error: result["error"].as_str().map(|s| s.to_string()),
    })
}

/// 在 Blender 中执行 Python 代码（通过 MCP 桥接）。
///
/// Gateway 作为 MCP 客户端连接 Blender MCP Server，
/// 转发 tools/call run_python 请求。
///
/// STORY-0024 M2：Blender MCP 桥接。
#[tauri::command]
pub async fn openclaw_mcp_blender_run_python(
    sidecar: State<'_, SidecarState>,
    code: Option<String>,
    get_context: Option<bool>,
    timeout: Option<f64>,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;

    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    let mut params = json!({});
    if let Some(c) = code {
        params["code"] = serde_json::Value::String(c);
    }
    if let Some(gc) = get_context {
        params["get_context"] = serde_json::Value::Bool(gc);
    }
    if let Some(t) = timeout {
        params["timeout"] = serde_json::Value::Number(
            serde_json::Number::from_f64(t).unwrap_or(serde_json::Number::from(30)),
        );
    }

    manager.call("openclaw.mcp.blender.run_python", params)
}

/// 检测本机 Blender 版本及插件安装状态。
///
/// STORY-0026 M2：DCC 安装器。
#[tauri::command]
pub async fn openclaw_dcc_blender_detect(
    sidecar: State<'_, SidecarState>,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;

    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    manager.call("openclaw.dcc.blender.detect", json!({}))
}

/// 安装 Artifex Nexus 插件到指定 Blender 版本。
///
/// STORY-0026 M2：DCC 安装器。
#[tauri::command]
pub async fn openclaw_dcc_blender_install(
    sidecar: State<'_, SidecarState>,
    version: String,
    force: Option<bool>,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;

    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    let mut params = json!({"version": version});
    if let Some(f) = force {
        params["force"] = serde_json::Value::Bool(f);
    }

    manager.call("openclaw.dcc.blender.install", params)
}

/// 卸载 Artifex Nexus 插件。
///
/// STORY-0026 M2：DCC 安装器。
#[tauri::command]
pub async fn openclaw_dcc_blender_uninstall(
    sidecar: State<'_, SidecarState>,
    version: String,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;

    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    manager.call("openclaw.dcc.blender.uninstall", json!({"version": version}))
}

/// 检测可用 UE 插件版本。
///
/// STORY-0051 M5：UE 插件安装/卸载。
#[tauri::command]
pub async fn openclaw_dcc_unreal_detect(
    sidecar: State<'_, SidecarState>,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;

    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    manager.call("openclaw.dcc.unreal.detect", json!({}))
}

/// 安装 UE 插件到指定项目目录。
///
/// STORY-0051 M5：UE 插件安装/卸载。
#[tauri::command]
pub async fn openclaw_dcc_unreal_install(
    sidecar: State<'_, SidecarState>,
    version: String,
    project_path: String,
    force: Option<bool>,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;

    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    let mut params = json!({"version": version, "project_path": project_path});
    if let Some(f) = force {
        params["force"] = serde_json::Value::Bool(f);
    }

    manager.call("openclaw.dcc.unreal.install", params)
}

/// 卸载 UE 插件。
///
/// STORY-0051 M5：UE 插件安装/卸载。
#[tauri::command]
pub async fn openclaw_dcc_unreal_uninstall(
    sidecar: State<'_, SidecarState>,
    version: String,
    project_path: String,
    keep_lib: Option<bool>,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;

    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    let mut params = json!({"version": version, "project_path": project_path});
    if let Some(k) = keep_lib {
        params["keep_lib"] = serde_json::Value::Bool(k);
    }

    manager.call("openclaw.dcc.unreal.uninstall", params)
}

/// 检查 UE 插件是否已安装到指定项目目录。
///
/// 纯前端可用：不依赖 sidecar，直接检查文件系统。
#[tauri::command]
pub fn check_ue_plugin_installed(
    project_path: String,
) -> Result<serde_json::Value, String> {
    let target = std::path::Path::new(&project_path)
        .join("Plugins")
        .join("ArtifexNexusForUnreal");
    let installed = target.exists();
    Ok(serde_json::json!({
        "installed": installed,
        "target": target.to_string_lossy(),
    }))
}

/// 部署 mcp-bridge 插件到 OpenClaw plugins 目录。
///
/// STORY-0028 M2：Gateway MCP Bridge 插件。
#[tauri::command]
pub async fn openclaw_gateway_mcp_bridge_install(
    sidecar: State<'_, SidecarState>,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;

    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    manager.call("openclaw.gateway.mcp_bridge.install", json!({}))
}

/// 检查 mcp-bridge 插件部署状态。
///
/// STORY-0028 M2：Gateway MCP Bridge 插件。
#[tauri::command]
pub async fn openclaw_gateway_mcp_bridge_status(
    sidecar: State<'_, SidecarState>,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;

    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    manager.call("openclaw.gateway.mcp_bridge.status", json!({}))
}

/// 触发器系统诊断：检查 MCPBridgeClient 连接状态及工具注册情况。
#[tauri::command]
pub async fn openclaw_trigger_diagnose(
    sidecar: State<'_, SidecarState>,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;

    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    manager.call("openclaw.trigger.diagnose", json!({}))
}

/// 获取 DCC MCP Server 端口配置。
///
/// STORY-0029 M2：DCC 端口设置。
#[tauri::command]
pub async fn openclaw_dcc_port_get(
    sidecar: State<'_, SidecarState>,
    dcc: String,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;

    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    manager.call("openclaw.dcc.port.get", json!({"dcc": dcc}))
}

/// 设置 DCC MCP Server 端口。
///
/// STORY-0029 M2：DCC 端口设置。
#[tauri::command]
pub async fn openclaw_dcc_port_set(
    sidecar: State<'_, SidecarState>,
    dcc: String,
    port: u16,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;

    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    manager.call("openclaw.dcc.port.set", json!({"dcc": dcc, "port": port}))
}

/// 全局部署校验：对比 deploy-manifest.json 与磁盘文件的 sha256。
///
/// STORY-0030 M2：安装向导"检测"按钮增加部署文件校验。
#[tauri::command]
pub async fn openclaw_deploy_validate(
    sidecar: State<'_, SidecarState>,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;

    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    manager.call("openclaw.deploy.validate", json!({}))
}

/// 修复（重新部署）指定部署项，同步 manifest 与磁盘文件。
#[tauri::command]
pub async fn openclaw_deploy_repair(
    sidecar: State<'_, SidecarState>,
    dep_id: String,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;

    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    manager.call("openclaw.deploy.repair", json!({"dep_id": dep_id}))
}

/// 在操作系统中打开文件/目录/URL。
///
/// STORY-0033 M3：B 区域自定义连接点击打开。
#[tauri::command]
pub async fn shell_open_path(
    sidecar: State<'_, SidecarState>,
    path: String,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;

    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    manager.call("shell.open_path", json!({"path": path}))
}

// ── STORY-0041：备份-安装-恢复 ────────────────────────────────────────────

/// 备份 OpenClaw 用户数据。
#[tauri::command]
pub async fn openclaw_backup(
    sidecar: State<'_, SidecarState>,
    preserve_options: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;

    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    manager.call_with_timeout("openclaw.backup", json!({"preserve_options": preserve_options}), 300)
}

/// 恢复 OpenClaw 用户数据（含全新安装）。
#[tauri::command]
pub async fn openclaw_restore(
    sidecar: State<'_, SidecarState>,
    backup_timestamp: String,
    preserve_options: serde_json::Value,
    version: Option<String>,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;

    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    let mut params = json!({
        "backup_timestamp": backup_timestamp,
        "preserve_options": preserve_options,
    });
    if let Some(v) = version {
        params["version"] = json!(v);
    }

    // restore 含安全网备份 + clean_install + CLI 全量重装 + bootstrap + 选择性恢复，给 600s
    manager.call_with_timeout("openclaw.restore", params, 600)
}

/// 列出所有 OpenClaw 备份。
#[tauri::command]
pub async fn openclaw_backups_list(
    sidecar: State<'_, SidecarState>,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;

    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    manager.call("openclaw.backups.list", json!({}))
}

/// 删除指定的 OpenClaw 备份。
#[tauri::command]
pub async fn openclaw_backups_delete(
    sidecar: State<'_, SidecarState>,
    timestamp: String,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;

    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    manager.call("openclaw.backups.delete", json!({"timestamp": timestamp}))
}
