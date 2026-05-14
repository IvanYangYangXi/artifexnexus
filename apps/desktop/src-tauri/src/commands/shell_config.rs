// Shell 配置持久化：读/写 ~/.artifexnexus/config/shell.json。
// 文件行数硬上限 100。

use std::path::PathBuf;

fn shell_config_path() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."));
    home.join(".artifexnexus").join("config").join("shell.json")
}

/// 读取 shell 配置（{ panelOpen?: boolean, sidebarCollapsed?: boolean }）
#[tauri::command]
pub fn read_shell_config() -> Result<String, String> {
    let path = shell_config_path();
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok("{}".into()),
        Err(e) => Err(format!("读取 shell 配置失败: {e}")),
    }
}

/// 写入 shell 配置
#[tauri::command]
pub fn write_shell_config(json: String) -> Result<(), String> {
    let path = shell_config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建 config 目录失败: {e}"))?;
    }
    // 先验证是合法 JSON
    let _: serde_json::Value =
        serde_json::from_str(&json).map_err(|e| format!("JSON 格式无效: {e}"))?;
    std::fs::write(&path, &json).map_err(|e| format!("写入 shell 配置失败: {e}"))
}
