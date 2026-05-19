// Skill / Nexus-Tool Tauri Commands — STORY-0047。
// 每个 #[tauri::command] 转发到 sidecar JSON-RPC 方法。
// 文件行数硬上限 500。

use crate::sidecar::manager::SidecarState;
use serde_json::json;
use tauri::State;

// ═══════════════════════════════════════════════════════════════════════════════
// Skill commands (14)
// ═══════════════════════════════════════════════════════════════════════════════

/// skill.list — 分页列表
#[tauri::command]
pub async fn skill_list(
    sidecar: State<'_, SidecarState>,
    params: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call("skill.list", params.unwrap_or(json!({})))
}

/// skill.detail — 详情
#[tauri::command]
pub async fn skill_detail(
    sidecar: State<'_, SidecarState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call("skill.detail", params)
}

/// skill.install — 安装
#[tauri::command]
pub async fn skill_install(
    sidecar: State<'_, SidecarState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call("skill.install", params)
}

/// skill.uninstall — 卸载
#[tauri::command]
pub async fn skill_uninstall(
    sidecar: State<'_, SidecarState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call("skill.uninstall", params)
}

/// skill.enable — 启用
#[tauri::command]
pub async fn skill_enable(
    sidecar: State<'_, SidecarState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call("skill.enable", params)
}

/// skill.disable — 禁用
#[tauri::command]
pub async fn skill_disable(
    sidecar: State<'_, SidecarState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call("skill.disable", params)
}

/// skill.pin — 钉选
#[tauri::command]
pub async fn skill_pin(
    sidecar: State<'_, SidecarState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call("skill.pin", params)
}

/// skill.unpin — 取消钉选
#[tauri::command]
pub async fn skill_unpin(
    sidecar: State<'_, SidecarState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call("skill.unpin", params)
}

/// skill.favorite — 收藏
#[tauri::command]
pub async fn skill_favorite(
    sidecar: State<'_, SidecarState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call("skill.favorite", params)
}

/// skill.unfavorite — 取消收藏
#[tauri::command]
pub async fn skill_unfavorite(
    sidecar: State<'_, SidecarState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call("skill.unfavorite", params)
}

/// skill.sync — 同步
#[tauri::command]
pub async fn skill_sync(
    sidecar: State<'_, SidecarState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call("skill.sync", params)
}

/// skill.publish — 发布
#[tauri::command]
pub async fn skill_publish(
    sidecar: State<'_, SidecarState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call("skill.publish", params)
}

/// skill.batch — 批量操作
#[tauri::command]
pub async fn skill_batch(
    sidecar: State<'_, SidecarState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call("skill.batch", params)
}

/// skill.search — 搜索
#[tauri::command]
pub async fn skill_search(
    sidecar: State<'_, SidecarState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call("skill.search", params)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Nexus-Tool commands (14, 含 run)
// ═══════════════════════════════════════════════════════════════════════════════

/// nexus-tool.list — 分页列表
#[tauri::command]
pub async fn nexus_tool_list(
    sidecar: State<'_, SidecarState>,
    params: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call("nexus-tool.list", params.unwrap_or(json!({})))
}

/// nexus-tool.detail — 详情
#[tauri::command]
pub async fn nexus_tool_detail(
    sidecar: State<'_, SidecarState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call("nexus-tool.detail", params)
}

/// nexus-tool.create — 创建
#[tauri::command]
pub async fn nexus_tool_create(
    sidecar: State<'_, SidecarState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call("nexus-tool.create", params)
}

/// nexus-tool.update — 更新
#[tauri::command]
pub async fn nexus_tool_update(
    sidecar: State<'_, SidecarState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call("nexus-tool.update", params)
}

/// nexus-tool.delete — 删除
#[tauri::command]
pub async fn nexus_tool_delete(
    sidecar: State<'_, SidecarState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call("nexus-tool.delete", params)
}

/// nexus-tool.enable — 启用
#[tauri::command]
pub async fn nexus_tool_enable(
    sidecar: State<'_, SidecarState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call("nexus-tool.enable", params)
}

/// nexus-tool.disable — 禁用
#[tauri::command]
pub async fn nexus_tool_disable(
    sidecar: State<'_, SidecarState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call("nexus-tool.disable", params)
}

/// nexus-tool.pin — 钉选
#[tauri::command]
pub async fn nexus_tool_pin(
    sidecar: State<'_, SidecarState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call("nexus-tool.pin", params)
}

/// nexus-tool.unpin — 取消钉选
#[tauri::command]
pub async fn nexus_tool_unpin(
    sidecar: State<'_, SidecarState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call("nexus-tool.unpin", params)
}

/// nexus-tool.favorite — 收藏
#[tauri::command]
pub async fn nexus_tool_favorite(
    sidecar: State<'_, SidecarState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call("nexus-tool.favorite", params)
}

/// nexus-tool.unfavorite — 取消收藏
#[tauri::command]
pub async fn nexus_tool_unfavorite(
    sidecar: State<'_, SidecarState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call("nexus-tool.unfavorite", params)
}

/// nexus-tool.publish — 发布
#[tauri::command]
pub async fn nexus_tool_publish(
    sidecar: State<'_, SidecarState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call("nexus-tool.publish", params)
}

/// nexus-tool.run — 异步启动（5s 超时返回 task_id，后台线程执行）
#[tauri::command]
pub async fn nexus_tool_run(
    sidecar: State<'_, SidecarState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call_with_timeout("nexus-tool.run", params, 5)
}

/// nexus-tool.fetch_types — 实时查询 DCC 对象类型（超时 30s）
#[tauri::command]
pub async fn nexus_tool_fetch_types(
    sidecar: State<'_, SidecarState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call_with_timeout("nexus-tool.fetch_types", params, 30)
}

/// nexus-tool.batch — 批量操作
#[tauri::command]
pub async fn nexus_tool_batch(
    sidecar: State<'_, SidecarState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call("nexus-tool.batch", params)
}

/// nexus-tool.result — 轮询任务结果（5s 超时）
#[tauri::command]
pub async fn nexus_tool_result(
    sidecar: State<'_, SidecarState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call_with_timeout("nexus-tool.result", params, 5)
}

/// nexus-tool.cancel — 取消运行中任务（5s 超时）
#[tauri::command]
pub async fn nexus_tool_cancel(
    sidecar: State<'_, SidecarState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call_with_timeout("nexus-tool.cancel", params, 5)
}

/// nexus-tool.ack — 确认已收到结果，清理服务端 _task_store（5s 超时）
#[tauri::command]
pub async fn nexus_tool_ack(
    sidecar: State<'_, SidecarState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let mut manager = sidecar.lock().map_err(|e| format!("锁 sidecar 失败: {e}"))?;
    if !manager.is_running() {
        manager.start().map_err(|e| format!("启动 sidecar 失败: {e}"))?;
    }
    manager.call_with_timeout("nexus-tool.ack", params, 5)
}
