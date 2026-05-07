// OpenClaw 设置面板 Tauri Commands：dump / patch / test_provider。
// EPIC-0001 第二批 STORY-0015。
// 透传 sidecar JSON-RPC，把 Python dict 原样返回前端（serde_json::Value）。
// 文件行数硬上限 300。

use crate::sidecar::manager::SidecarState;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::State;

/// `openclaw.config.dump` 返回结构（与 sidecar 对齐）。
///
/// 注意：providers / authProfiles / agentDefaults 内部结构由上游 schema 决定，
/// 这里用 serde_json::Value 透传，避免每次上游字段变化都改 Rust 类型。
#[derive(Debug, Serialize, Clone)]
pub struct OpenClawConfigDumpResponse {
    pub providers: Value,
    #[serde(rename = "authProfiles")]
    pub auth_profiles: Value,
    #[serde(rename = "authOrder")]
    pub auth_order: Value,
    #[serde(rename = "agentDefaults")]
    pub agent_defaults: Value,
    pub extras: Value,
}

/// `openclaw.config.patch` 返回结构。
#[derive(Debug, Serialize, Clone)]
pub struct OpenClawConfigPatchResponse {
    pub success: bool,
    #[serde(rename = "validateError")]
    pub validate_error: Option<String>,
}

/// `openclaw.config.test_provider` 返回结构。
#[derive(Debug, Serialize, Clone)]
pub struct OpenClawConfigTestProviderResponse {
    pub success: bool,
    #[serde(rename = "latencyMs")]
    pub latency_ms: Option<u32>,
    #[serde(rename = "modelEcho")]
    pub model_echo: Option<String>,
    pub error: Option<String>,
}

/// 聚合 dump：providers / authProfiles / authOrder / agentDefaults / extras（apiKey 已脱敏）。
#[tauri::command]
pub async fn openclaw_config_dump(
    sidecar: State<'_, SidecarState>,
) -> Result<OpenClawConfigDumpResponse, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    let result = manager.call("openclaw.config.dump", json!({}))?;

    Ok(OpenClawConfigDumpResponse {
        providers: result.get("providers").cloned().unwrap_or_else(|| json!({})),
        auth_profiles: result.get("authProfiles").cloned().unwrap_or_else(|| json!({})),
        auth_order: result.get("authOrder").cloned().unwrap_or_else(|| json!({})),
        agent_defaults: result.get("agentDefaults").cloned().unwrap_or_else(|| json!({})),
        extras: result.get("extras").cloned().unwrap_or_else(|| json!({})),
    })
}

/// 写 patch + extras_patch（apiKey 若是脱敏占位会在 sidecar 端剔除）。
///
/// `patch` 与 `extras_patch` 都是任意 JSON object，前端按 spec §6 构造。
#[tauri::command]
pub async fn openclaw_config_patch(
    sidecar: State<'_, SidecarState>,
    patch: Value,
    extras_patch: Option<Value>,
) -> Result<OpenClawConfigPatchResponse, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    let mut params = json!({ "patch": patch });
    if let Some(ep) = extras_patch {
        params["extrasPatch"] = ep;
    }
    let result = manager.call("openclaw.config.patch", params)?;

    Ok(OpenClawConfigPatchResponse {
        success: result["success"].as_bool().unwrap_or(false),
        validate_error: result["validateError"].as_str().map(|s| s.to_string()),
    })
}

/// 测试 provider 连通性（spawn `openclaw infer`）。
#[tauri::command]
pub async fn openclaw_config_test_provider(
    sidecar: State<'_, SidecarState>,
    provider_id: String,
    model_id: String,
    auth_profile_id: Option<String>,
) -> Result<OpenClawConfigTestProviderResponse, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    let mut params = json!({
        "providerId": provider_id,
        "modelId": model_id,
    });
    if let Some(p) = auth_profile_id {
        params["authProfileId"] = json!(p);
    }
    let result = manager.call("openclaw.config.test_provider", params)?;

    Ok(OpenClawConfigTestProviderResponse {
        success: result["success"].as_bool().unwrap_or(false),
        latency_ms: result["latencyMs"].as_u64().map(|n| n as u32),
        model_echo: result["modelEcho"].as_str().map(|s| s.to_string()),
        error: result["error"].as_str().map(|s| s.to_string()),
    })
}
