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

/// 获取指定对话的历史消息（从 session transcript .jsonl 文件读取）。
///
/// 优先直接从文件系统读取（零延迟），只在文件找不到时才 fallback 到 sidecar RPC。
#[tauri::command]
pub async fn openclaw_sessions_history(
    sidecar: State<'_, SidecarState>,
    session_key: String,
    agent_id: Option<String>,
    limit: Option<u32>,
) -> Result<serde_json::Value, String> {
    let aid = agent_id.unwrap_or_else(|| "artifex-nexus".to_string());
    let max = limit.unwrap_or(50) as usize;

    // 直接从文件系统读取，绕过 sidecar RPC（避免 Mutex 锁竞争 30s 超时）
    match read_transcript_from_disk(&session_key, &aid, max) {
        Ok(messages) if !messages.is_empty() => {
            return Ok(json!({ "messages": messages }));
        }
        Ok(_) => {
            // 文件为空或不存在，继续 fallback
        }
        Err(e) => {
            eprintln!("[sessions_history] 直接读文件失败: {e}，fallback 到 sidecar");
        }
    }

    // Fallback: sidecar RPC（兼容旧路径/新创建的 session）
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }

    let params = json!({
        "session_key": session_key,
        "agent_id": aid,
        "limit": max,
    });

    let result = manager.call("openclaw.sessions.history", params)?;
    Ok(serde_json::Value::Object(
        result.as_object().cloned().unwrap_or_default(),
    ))
}

// ---------------------------------------------------------------------------
// 直接文件系统读取（零延迟）
// ---------------------------------------------------------------------------

/// 直接从 sessions.json + .jsonl 文件读取历史消息，绕过 sidecar。
fn read_transcript_from_disk(
    session_key: &str,
    agent_id: &str,
    limit: usize,
) -> Result<Vec<serde_json::Value>, String> {
    use std::io::BufRead;

    let layout = crate::fs_layout::FsLayout::new();
    let sessions_dir = layout.openclaw_state_dir
        .join("agents")
        .join(agent_id)
        .join("sessions");
    let sessions_json = sessions_dir.join("sessions.json");

    // 从 sessions.json 查找 sessionFile / sessionId
    let mut session_file: Option<std::path::PathBuf> = None;

    if sessions_json.exists() {
        if let Ok(content) = std::fs::read_to_string(&sessions_json) {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(entry) = parsed.get(session_key) {
                    // 优先用 sessionFile
                    if let Some(sf) = entry.get("sessionFile").and_then(|v| v.as_str()) {
                        let p = std::path::PathBuf::from(sf);
                        if p.exists() {
                            session_file = Some(p);
                        }
                    }
                    // Fallback: sessionId → <id>.jsonl
                    if session_file.is_none() {
                        if let Some(sid) = entry.get("sessionId").and_then(|v| v.as_str()) {
                            let p = sessions_dir.join(format!("{sid}.jsonl"));
                            if p.exists() {
                                session_file = Some(p);
                            }
                        }
                    }
                }
            }
        }
    }

    let session_file = session_file.ok_or_else(|| "找不到 transcript 文件".to_string())?;

    // 读取 .jsonl，提取 user/assistant 消息
    let file = std::fs::File::open(&session_file)
        .map_err(|e| format!("打开 transcript 失败: {e}"))?;
    let reader = std::io::BufReader::new(file);

    let mut messages = Vec::new();
    for line in reader.lines() {
        let line = line.map_err(|e| format!("读行失败: {e}"))?;
        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }
        let record: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if record.get("type").and_then(|v| v.as_str()) != Some("message") {
            continue;
        }
        let msg = match record.get("message") {
            Some(m) => m,
            None => continue,
        };
        let role = msg.get("role").and_then(|v| v.as_str()).unwrap_or("");
        if role != "user" && role != "assistant" {
            continue;
        }

        // 提取文本内容
        let text = extract_text_content(msg);
        if text.is_empty() {
            continue;
        }

        messages.push(json!({
            "id": record.get("id").and_then(|v| v.as_str()).unwrap_or(""),
            "role": role,
            "content": text,
            "timestamp": record.get("timestamp").and_then(|v| v.as_str()).unwrap_or(""),
        }));
    }

    // 只返回最近 limit 条
    if messages.len() > limit {
        messages = messages.split_off(messages.len() - limit);
    }

    Ok(messages)
}

/// 从消息内容中提取纯文本（兼容 string / content blocks 两种格式）。
fn extract_text_content(msg: &serde_json::Value) -> String {
    let content = msg.get("content");
    match content {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Array(arr)) => {
            arr.iter()
                .filter(|b| b.get("type").and_then(|v| v.as_str()) == Some("text"))
                .filter_map(|b| b.get("text").and_then(|v| v.as_str()))
                .collect::<Vec<_>>()
                .join("\n")
        }
        _ => String::new(),
    }
}
