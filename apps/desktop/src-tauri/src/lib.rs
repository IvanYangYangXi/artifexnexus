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

    tauri::Builder::default()
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
            // STORY-0018 T3：Gateway 状态控制面板
            commands::openclaw_gateway::openclaw_gateway_status,
            commands::openclaw_gateway::openclaw_gateway_start,
            commands::openclaw_gateway::openclaw_gateway_restart,
            commands::openclaw_gateway::openclaw_gateway_tail_log,
            commands::openclaw_gateway::openclaw_web_open
        ])
        .setup(|_app| {
            // 应用启动后自动启动 sidecar
            // 注意：setup 中无法直接访问 State，需要在首次调用时 lazy init
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}
