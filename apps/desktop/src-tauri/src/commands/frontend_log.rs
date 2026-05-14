// 前端 → Rust 日志桥接：让前端 [startup-trace] 日志能写到磁盘文件。
//
// Why（2026-05-14）：
//   release 模式下前端 console.log 只在 DevTools 里显示，用户报"卡在正在
//   检测环境"时无法回看。通过这个 command，前端把每条事件 mirror 到
//   ~/.artifexnexus/logs/exe-stderr-<pid>.log（与 Rust 日志同文件，按时序）。

use crate::trace_log;

/// 前端写一条日志到 Rust trace 文件。
///
/// tag: 日志分类（如 "ui.AppShell"、"ui.ChatView"）
/// message: 日志文本（已 stringify 好）
#[tauri::command]
pub fn frontend_log(tag: String, message: String) -> Result<(), String> {
    trace_log!(&tag, "{message}");
    Ok(())
}
