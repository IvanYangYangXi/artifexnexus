// Tauri 应用库根：注册插件、命令、模式模块。
// 文件行数硬上限 500，超限拆到子模块。

mod commands;
mod fs_layout;
mod modes;
mod sidecar;

use sidecar::manager::{SidecarManager, SidecarState};
use std::sync::Mutex;

/// 解析 sidecar.py 路径。
/// 开发模式：相对于 CARGO_MANIFEST_DIR（Cargo.toml 所在目录）。
/// 打包模式：从 exe 所在目录向上查找项目根，再拼接相对路径。
fn resolve_sidecar_path() -> String {
    let relative = "packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/sidecar.py";

    // 优先使用 CARGO_MANIFEST_DIR（开发模式）
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let dev_path = std::path::PathBuf::from(&manifest_dir)
            .join("../../../")
            .join(relative);
        if dev_path.exists() {
            return dev_path.to_string_lossy().to_string();
        }
    }

    // 打包模式：从 exe 位置向上查找项目根
    if let Ok(exe_path) = std::env::current_exe() {
        let mut current = exe_path.parent().map(|p| p.to_path_buf());
        // 从 exe 目录向上最多 8 层查找
        for _ in 0..8 {
            if let Some(ref dir) = current {
                let candidate = dir.join(relative);
                if candidate.exists() {
                    return candidate.to_string_lossy().to_string();
                }
                current = dir.parent().map(|p| p.to_path_buf());
            }
        }
    }

    // 最后 fallback
    "sidecar.py".to_string()
}

/// Tauri 应用入口，由 main.rs 调用。
/// 在此注册所有 Tauri Command 和 Plugin。
pub fn run() {
    // ─────────────────────────────────────────────────────────────────
    // 启动期清理（2026-05-14）：
    // 杀光所有同名 EXE / 孤儿 sidecar / 占用 19789 的 gateway / 陈旧锁文件。
    // 实现"启动即单实例 + 干净状态"，避免历史上 EXE 反复卡在"正在检测环境…"。
    // 详见 sidecar/preflight.rs 顶部注释。
    // ─────────────────────────────────────────────────────────────────
    // 先初始化 trace 日志路径（其他 trace_log! 调用才能写到文件）
    let _ = sidecar::trace::log_file_path();
    trace_log!("lifecycle", "=== EXE START pid={} ===", std::process::id());

    sidecar::preflight::pre_startup_cleanup();

    let sidecar_path = resolve_sidecar_path();
    trace_log!("lifecycle", "sidecar_path={sidecar_path}");

    let manager = SidecarManager::new(sidecar_path);

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(manager) as SidecarState)
        .invoke_handler(tauri::generate_handler![
            commands::echo::echo,
            commands::frontend_log::frontend_log,
            commands::status::get_status,
            commands::openclaw::openclaw_status,
            commands::openclaw::openclaw_install,
            commands::openclaw::openclaw_bootstrap,
            commands::openclaw::openclaw_start,
            commands::openclaw::openclaw_stop,
            commands::openclaw::openclaw_doctor,
            commands::openclaw::openclaw_web_get_url,
            commands::openclaw::openclaw_agent_preset_status,
            commands::openclaw::openclaw_agent_preset_reset_default,
            commands::openclaw_config::openclaw_config_dump,
            commands::openclaw_config::openclaw_config_patch,
            commands::openclaw_config::openclaw_config_test_provider,
            commands::openclaw_config::openclaw_auth_set_token,
            commands::openclaw_config::openclaw_models_fetch_remote,
            // STORY-0024 M2：Blender MCP 桥接
            commands::openclaw::openclaw_mcp_blender_run_python,
            // STORY-0026 M2：DCC 安装器
            commands::openclaw::openclaw_dcc_blender_detect,
            commands::openclaw::openclaw_dcc_blender_install,
            commands::openclaw::openclaw_dcc_blender_uninstall,
            // STORY-0028 M2：Gateway MCP Bridge 插件
            commands::openclaw::openclaw_gateway_mcp_bridge_install,
            commands::openclaw::openclaw_gateway_mcp_bridge_status,
            // STORY-0029 M2：DCC 端口管理
            commands::openclaw::openclaw_dcc_port_get,
            commands::openclaw::openclaw_dcc_port_set,
            // STORY-0030 M2：部署文件校验
            commands::openclaw::openclaw_deploy_validate,
            // STORY-0030 M2：部署文件修复
            commands::openclaw::openclaw_deploy_repair,
            // STORY-0033 M3：Shell 打开路径
            commands::openclaw::shell_open_path,
            // STORY-0018 T3：Gateway 状态控制面板
            commands::openclaw_gateway::openclaw_gateway_status,
            commands::openclaw_gateway::openclaw_gateway_start,
            commands::openclaw_gateway::openclaw_gateway_restart,
            commands::openclaw_gateway::openclaw_gateway_tail_log,
            commands::openclaw_gateway::openclaw_web_open,
            // STORY-0039 M3：Chat WS 连接凭据（port + token）
            commands::openclaw_gateway::openclaw_gateway_auth_info,
            // STORY-0039 M3：对话列表管理
            commands::openclaw_sessions::openclaw_sessions_list,
            commands::openclaw_sessions::openclaw_sessions_history,
            // STORY-0041：备份-安装-恢复
            commands::openclaw::openclaw_backup,
            commands::openclaw::openclaw_restore,
            commands::openclaw::openclaw_backups_list,
            commands::openclaw::openclaw_backups_delete,

            commands::shell_config::read_shell_config,
            commands::shell_config::write_shell_config,
            commands::window_controls::window_minimize,
            commands::window_controls::window_toggle_maximize,
            commands::window_controls::window_close,
            commands::window_controls::window_is_maximized,
        ])
        .setup(|_app| {
            // 应用启动后自动启动 sidecar
            // 注意：setup 中无法直接访问 State，需要在首次调用时 lazy init
            // DevTools 通过 Cargo.toml features = ["devtools"] 启用，
            // 用户可按 F12 / Ctrl+Shift+I 手动打开
            //
            // 2026-05-14：gateway 自动拉起的逻辑放在 sidecar.py 的
            // _handle_openclaw_status 里（status 检测到 gateway_running=false
            // 就异步 spawn 一次），不在 Rust 这层做，避免 Mutex 竞争。
            Ok(())
        })
        .build(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("[tauri] Fatal: failed to build Tauri application: {e}");
            std::process::exit(1);
        });

    // 2026-05-14 简化：EXE 退出**先同步清理再退出**。
    // 之前用 spawn 线程 + 1s std::process::exit 的方案，问题是清理线程被
    // 强杀进程时打断（kill sidecar 完成后还没杀 gateway 就被终结），
    // 导致 gateway node.exe 孤儿留在 19789。
    //
    // 现在：主线程**同步**跑 post_exit_cleanup（~1-2s），完成后才 exit。
    // 用户体验上"窗口立即消失但进程多活 2 秒清理"是可接受的；下次启动时
    // preflight 也会再清一遍，双保险。
    use tauri::RunEvent;
    let mut exit_started = false;
    app.run(move |_app_handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            if exit_started {
                return;
            }
            exit_started = true;
            trace_log!("lifecycle", "=== EXE EXIT REQUESTED ===");
            // 同步清理：杀 sidecar / gateway / 端口 / 锁文件
            sidecar::preflight::post_exit_cleanup();
            trace_log!("lifecycle", "=== EXE EXIT cleanup done, exiting ===");
            std::process::exit(0);
        }
    });
}
