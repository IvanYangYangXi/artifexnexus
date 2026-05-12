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
    let sidecar_path = resolve_sidecar_path();

    let manager = SidecarManager::new(sidecar_path);

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(manager) as SidecarState)
        .invoke_handler(tauri::generate_handler![
            commands::echo::echo,
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
            commands::openclaw_sessions::openclaw_sessions_list
        ])
        .setup(|_app| {
            // 应用启动后自动启动 sidecar
            // 注意：setup 中无法直接访问 State，需要在首次调用时 lazy init
            // DevTools 通过 Cargo.toml features = ["devtools"] 启用，
            // 用户可按 F12 / Ctrl+Shift+I 手动打开
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");

    // STORY-0018 hot-fix：监听 RunEvent::ExitRequested / Exit，
    // 在主进程退出前同步停掉 sidecar 管理的 gateway，避免孤儿残留。
    //
    // Why：仅靠 sidecar 自身的 atexit 不够——Tauri 在 release 模式下用
    // CTRL_BREAK_EVENT 终结子进程组，sidecar 收到信号但 stdout 已关，
    // 而 gateway 进程是 sidecar 的"孙子"，需要 sidecar 走 stop_gateway
    // 才能干净地杀（taskkill /T /F + wait_pid_dead）。
    //
    // 这里我们在 ExitRequested（用户点关闭窗口）和 Exit（最终退出）
    // 两个时机都尝试 stop，幂等。Tauri 主进程会等所有 Command 返回再
    // 真正退出，sidecar 有充足时间收 child（最多 SHUTDOWN_TIMEOUT=5s）。
    use tauri::{Manager as _, RunEvent};
    app.run(|app_handle, event| match event {
        RunEvent::ExitRequested { .. } | RunEvent::Exit => {
            // best-effort：忽略所有错误，主进程必须退出
            if let Some(state) = app_handle.try_state::<SidecarState>() {
                if let Ok(mut manager) = state.lock() {
                    if manager.is_running() {
                        // 调 sidecar 的 openclaw.stop（等价于 stop_gateway）
                        let _ = manager.call("openclaw.stop", serde_json::json!({}));
                    }
                }
            }
        }
        _ => {}
    });
}
