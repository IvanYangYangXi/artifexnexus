// Tauri 应用库根：注册插件、命令、模式模块。
// 文件行数硬上限 500，超限拆到子模块。

mod commands;
mod fs_layout;
mod modes;
mod sidecar;

use sidecar::manager::{SidecarManager, SidecarState};
use std::sync::Mutex;

/// Tauri 应用入口，由 main.rs 调用。
/// 在此注册所有 Tauri Command 和 Plugin。
pub fn run() {
    // 获取 sidecar.py 路径（相对于 Cargo.toml 所在目录）
    let sidecar_path = std::env::var("CARGO_MANIFEST_DIR")
        .map(|dir| {
            std::path::PathBuf::from(dir)
                .join("../../../packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/sidecar.py")
                .to_string_lossy()
                .to_string()
        })
        .unwrap_or_else(|_| "sidecar.py".to_string());

    let manager = SidecarManager::new(sidecar_path);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(manager) as SidecarState)
        .invoke_handler(tauri::generate_handler![
            commands::echo::echo,
            commands::status::get_status
        ])
        .setup(|_app| {
            // 应用启动后自动启动 sidecar
            // 注意：setup 中无法直接访问 State，需要在首次调用时 lazy init
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}
