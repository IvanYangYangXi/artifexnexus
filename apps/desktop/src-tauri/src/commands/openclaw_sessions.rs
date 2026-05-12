// STORY-0039 M3：对话列表管理。
// 转发到 sidecar RPC: openclaw.sessions.list
//
// 前端通过此命令获取 Gateway 侧的对话列表（从 sessions.json 读取）。

use crate::sidecar::manager::SidecarState;
use serde::Serialize;
use serde_json::json;
use tauri::State;

// ---------------------------------------------------------------------------
// 响应类型
// ---------------------------------------------------------------------------

/// 单个对话摘要
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub session_key: String,
    pub session_id: String,
    pub title: String,
    /// unix ts（毫秒）
    pub created_at: u64,
    /// unix ts（毫秒）
    pub updated_at: u64,
    pub model: String,
    pub model_provider: String,
    pub status: String,
    pub total_tokens: u64,
}

/// openclaw.sessions.list 响应
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionsListResponse {
    pub sessions: Vec<SessionSummary>,
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
    pub has_more: bool,
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// 获取对话列表（从 Gateway sessions.json 读取，按 updatedAt 降序）。
///
/// 前端 ChatControlBar 使用此命令获取可切换的对话列表。
#[tauri::command]
pub async fn openclaw_sessions_list(
    sidecar: State<'_, SidecarState>,
    agent_id: Option<String>,
    offset: Option<u32>,
    limit: Option<u32>,
) -> Result<SessionsListResponse, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    let params = json!({
        "agent_id": agent_id.unwrap_or_else(|| "artifex-nexus".to_string()),
        "offset": offset.unwrap_or(0),
        "limit": limit.unwrap_or(20),
    });

    let result = manager.call("openclaw.sessions.list", params)?;

    let sessions: Vec<SessionSummary> = result["sessions"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|s| {
            Some(SessionSummary {
                session_key: s["sessionKey"].as_str()?.to_string(),
                session_id: s["sessionId"].as_str()?.to_string(),
                title: s["title"].as_str().unwrap_or("").to_string(),
                created_at: s["createdAt"].as_u64().unwrap_or(0),
                updated_at: s["updatedAt"].as_u64().unwrap_or(0),
                model: s["model"].as_str().unwrap_or("").to_string(),
                model_provider: s["modelProvider"].as_str().unwrap_or("").to_string(),
                status: s["status"].as_str().unwrap_or("").to_string(),
                total_tokens: s["totalTokens"].as_u64().unwrap_or(0),
            })
        })
        .collect();

    Ok(SessionsListResponse {
        sessions,
        total: result["total"].as_u64().unwrap_or(0) as u32,
        offset: result["offset"].as_u64().unwrap_or(0) as u32,
        limit: result["limit"].as_u64().unwrap_or(20) as u32,
        has_more: result["has_more"].as_bool().unwrap_or(false),
    })
}
