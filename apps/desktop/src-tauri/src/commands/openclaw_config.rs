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
    #[serde(rename = "agentList")]
    pub agent_list: Value,
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

/// `openclaw.auth.set_token` 返回结构。
///
/// STORY-0018 hot-fix：上游 v2026.5.4 把 `auth.profiles.<id>` 收敛为纯元数据
/// （additionalProperties: false），凭证另走 `openclaw models auth paste-token`
/// 写 `auth-profiles.json`。本结构对齐 sidecar 端 `SetAuthTokenResult.to_dict()`。
#[derive(Debug, Serialize, Clone)]
pub struct OpenClawAuthSetTokenResponse {
    pub success: bool,
    #[serde(rename = "profileId")]
    pub profile_id: Option<String>,
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
        agent_list: result.get("agentList").cloned().unwrap_or_else(|| json!([])),
        extras: result.get("extras").cloned().unwrap_or_else(|| json!({})),
    })
}

/// 写 patch + extras_patch（apiKey 若是脱敏占位会在 sidecar 端剔除）。
///
/// `patch` 与 `extras_patch` 都是任意 JSON object，前端按 spec §6 构造。
/// `replace_paths` 列表里的每个 dot/bracket 路径会作为 ``--replace-path`` 透传给
/// 上游 ``openclaw config patch``，让该路径下的 object/array **整体替换**而非
/// 递归 merge —— 用于"删除 provider / 删除 model" 等需要真删的场景。
#[tauri::command]
pub async fn openclaw_config_patch(
    sidecar: State<'_, SidecarState>,
    patch: Value,
    extras_patch: Option<Value>,
    replace_paths: Option<Vec<String>>,
) -> Result<OpenClawConfigPatchResponse, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    let mut params = json!({ "patch": patch });
    if let Some(ep) = extras_patch {
        params["extrasPatch"] = ep;
    }
    if let Some(rp) = replace_paths {
        if !rp.is_empty() {
            params["replacePaths"] = json!(rp);
        }
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

/// 把 API token 写入上游 `auth-profiles.json` + 同步 `openclaw.json` 元数据。
///
/// STORY-0018 hot-fix：透传到 sidecar 的 `openclaw.auth.set_token`，由 wrapper
/// spawn `openclaw models auth paste-token --provider <p> --profile-id <id>`，
/// token 经 stdin 传入（不入 argv，避免泄漏到进程列表）。
///
/// 调用前提：profile 元数据（provider + mode）已通过 `openclaw_config_patch`
/// 写入；本命令仅负责凭证字段。脱敏占位（全 `*` 串）会被 sidecar 拒绝。
#[tauri::command]
pub async fn openclaw_auth_set_token(
    sidecar: State<'_, SidecarState>,
    provider: String,
    profile_id: String,
    token: String,
    expires_in: Option<String>,
) -> Result<OpenClawAuthSetTokenResponse, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    let mut params = json!({
        "provider": provider,
        "profileId": profile_id,
        "token": token,
    });
    if let Some(exp) = expires_in {
        params["expiresIn"] = json!(exp);
    }
    let result = manager.call("openclaw.auth.set_token", params)?;

    Ok(OpenClawAuthSetTokenResponse {
        success: result["success"].as_bool().unwrap_or(false),
        profile_id: result["profileId"].as_str().map(|s| s.to_string()),
        error: result["error"].as_str().map(|s| s.to_string()),
    })
}

/// 远端模型列表中的单个模型信息。
#[derive(serde::Serialize)]
pub struct RemoteModelInfo {
    id: String,
    name: Option<String>,
    #[serde(rename = "ownedBy")]
    owned_by: Option<String>,
}

/// 远端模型列表获取结果。
#[derive(serde::Serialize)]
pub struct FetchRemoteModelsResponse {
    success: bool,
    models: Vec<RemoteModelInfo>,
    error: Option<String>,
}

/// 从远端 provider 的 OpenAI 兼容 `/models` 端点获取模型列表。
///
/// STORY-0019：前端"获取模型列表"按钮的后端。透传到 sidecar 的
/// `openclaw.models.fetch_remote`，由 wrapper 直接 HTTP GET `{baseUrl}/models`。
/// 对于不支持该端点的 provider（如返回 404/403），graceful 返回错误信息。
///
/// Bug #2 修复：新增 `provider_id` 参数。当 token 为空或脱敏占位时，
/// sidecar 会自动从 auth-profiles.json 中读取已保存的真实 token。
#[tauri::command]
pub async fn openclaw_models_fetch_remote(
    sidecar: State<'_, SidecarState>,
    base_url: String,
    token: String,
    provider_id: Option<String>,
) -> Result<FetchRemoteModelsResponse, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    let mut params = json!({
        "baseUrl": base_url,
        "token": token,
    });
    if let Some(pid) = provider_id {
        params["providerId"] = json!(pid);
    }
    let result = manager.call("openclaw.models.fetch_remote", params)?;

    let models_raw = result["models"].as_array();
    let models = models_raw
        .map(|arr| {
            arr.iter()
                .filter_map(|m| {
                    let id = m["id"].as_str()?.to_string();
                    Some(RemoteModelInfo {
                        id,
                        name: m["name"].as_str().map(|s| s.to_string()),
                        owned_by: m["ownedBy"].as_str().map(|s| s.to_string()),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(FetchRemoteModelsResponse {
        success: result["success"].as_bool().unwrap_or(false),
        models,
        error: result["error"].as_str().map(|s| s.to_string()),
    })
}
