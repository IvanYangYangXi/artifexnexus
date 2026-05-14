use tauri::Window;

/// 最小化窗口
#[tauri::command]
pub fn window_minimize(window: Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

/// 切换最大化/还原
#[tauri::command]
pub fn window_toggle_maximize(window: Window) -> Result<(), String> {
    let maximized = window.is_maximized().map_err(|e| e.to_string())?;
    if maximized {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

/// 关闭窗口（触发 ExitRequested → post_exit_cleanup）
#[tauri::command]
pub fn window_close(window: Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

/// 查询是否最大化（供前端同步按钮图标）
#[tauri::command]
pub fn window_is_maximized(window: Window) -> Result<bool, String> {
    window.is_maximized().map_err(|e| e.to_string())
}
