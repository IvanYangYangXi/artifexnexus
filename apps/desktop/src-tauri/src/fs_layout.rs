// 文件系统布局：管理 ~/.artifexnexus/.openclaw/ 隔离目录。
// 文件行数硬上限 200。

use std::path::PathBuf;

/// Artifex Nexus 隔离目录根路径。
/// 所有 OpenClaw 相关文件完全隔离到此目录下，零读写 ~/.openclaw/。
pub struct FsLayout {
    /// ~/.artifexnexus/
    pub root: PathBuf,
    /// ~/.artifexnexus/.openclaw/（OPENCLAW_HOME）
    pub openclaw_home: PathBuf,
    /// ~/.artifexnexus/.openclaw/state/（OPENCLAW_STATE_DIR）
    pub openclaw_state_dir: PathBuf,
    /// ~/.artifexnexus/.openclaw/openclaw.json（OPENCLAW_CONFIG_PATH）
    pub openclaw_config_path: PathBuf,
    /// ~/.artifexnexus/config/
    pub config_dir: PathBuf,
    /// ~/.artifexnexus/logs/
    pub logs_dir: PathBuf,
    /// ~/.artifexnexus/run/
    pub run_dir: PathBuf,
}

impl FsLayout {
    /// 创建默认布局（基于用户 home 目录）。
    /// DEV 模式通过 ARTIFEX_NEXUS_DEV=1 环境变量自动加 .dev 后缀。
    pub fn new() -> Self {
        let home = dirs_next_home();
        let is_dev = std::env::var("ARTIFEX_NEXUS_DEV").unwrap_or_default() == "1";
        let suffix = if is_dev { ".dev" } else { "" };
        let root_name = format!(".artifexnexus{suffix}");
        let root = home.join(&root_name);
        let openclaw_home = root.join(".openclaw");
        let openclaw_state_dir = openclaw_home.join("state");
        let openclaw_config_path = openclaw_home.join("openclaw.json");
        let config_dir = root.join("config");
        let logs_dir = root.join("logs");
        let run_dir = root.join("run");

        Self {
            root,
            openclaw_home,
            openclaw_state_dir,
            openclaw_config_path,
            config_dir,
            logs_dir,
            run_dir,
        }
    }

    /// 确保所有目录存在。
    pub fn ensure_dirs(&self) -> Result<(), String> {
        std::fs::create_dir_all(&self.openclaw_home)
            .map_err(|e| format!("创建 .openclaw 目录失败: {e}"))?;
        std::fs::create_dir_all(&self.openclaw_state_dir)
            .map_err(|e| format!("创建 state 目录失败: {e}"))?;
        std::fs::create_dir_all(&self.config_dir)
            .map_err(|e| format!("创建 config 目录失败: {e}"))?;
        std::fs::create_dir_all(&self.logs_dir)
            .map_err(|e| format!("创建 logs 目录失败: {e}"))?;
        std::fs::create_dir_all(&self.run_dir)
            .map_err(|e| format!("创建 run 目录失败: {e}"))?;
        Ok(())
    }

    /// 返回 sidecar 子进程应使用的环境变量（String 版本）。
    /// 三件套 env：OPENCLAW_HOME / OPENCLAW_STATE_DIR / OPENCLAW_CONFIG_PATH
    /// + OPENCLAW_NO_ONBOARD=1
    pub fn sidecar_env_strings(&self) -> Vec<(String, String)> {
        vec![
            (
                "OPENCLAW_HOME".to_string(),
                self.openclaw_home.to_string_lossy().to_string(),
            ),
            (
                "OPENCLAW_STATE_DIR".to_string(),
                self.openclaw_state_dir.to_string_lossy().to_string(),
            ),
            (
                "OPENCLAW_CONFIG_PATH".to_string(),
                self.openclaw_config_path.to_string_lossy().to_string(),
            ),
            ("OPENCLAW_NO_ONBOARD".to_string(), "1".to_string()),
            (
                "ARTIFEX_NEXUS_HOME".to_string(),
                self.root.to_string_lossy().to_string(),
            ),
        ]
    }
}

impl Default for FsLayout {
    fn default() -> Self {
        Self::new()
    }
}

/// 获取用户 home 目录（跨平台）。
fn dirs_next_home() -> PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fs_layout_paths() {
        let layout = FsLayout::new();
        assert!(layout.root.ends_with(".artifexnexus"));
        assert!(layout.openclaw_home.ends_with(".openclaw"));
        assert!(layout.config_dir.ends_with("config"));
        assert!(layout.logs_dir.ends_with("logs"));
        assert!(layout.run_dir.ends_with("run"));
    }

    #[test]
    fn test_sidecar_env() {
        let layout = FsLayout::new();
        let env = layout.sidecar_env_strings();
        assert_eq!(env.len(), 5);
        assert_eq!(env[0].0, "OPENCLAW_HOME");
        assert_eq!(env[1].0, "OPENCLAW_STATE_DIR");
        assert_eq!(env[2].0, "OPENCLAW_CONFIG_PATH");
        assert_eq!(env[3].0, "OPENCLAW_NO_ONBOARD");
        assert_eq!(env[4].0, "ARTIFEX_NEXUS_HOME");
    }
}
