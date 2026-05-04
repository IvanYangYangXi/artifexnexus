// 文件系统布局：管理 ~/.artifexnexus/.openclaw/ 隔离目录。
// 文件行数硬上限 200。

use std::path::PathBuf;

/// Artifex Nexus 隔离目录根路径。
/// 所有 OpenClaw 相关文件完全隔离到此目录下，零读写 ~/.openclaw/。
pub struct FsLayout {
    /// ~/.artifexnexus/
    pub root: PathBuf,
    /// ~/.artifexnexus/.openclaw/
    pub openclaw_home: PathBuf,
    /// ~/.artifexnexus/config/
    pub config_dir: PathBuf,
    /// ~/.artifexnexus/logs/
    pub logs_dir: PathBuf,
}

impl FsLayout {
    /// 创建默认布局（基于用户 home 目录）。
    pub fn new() -> Self {
        let home = dirs_next_home();
        let root = home.join(".artifexnexus");
        let openclaw_home = root.join(".openclaw");
        let config_dir = root.join("config");
        let logs_dir = root.join("logs");

        Self {
            root,
            openclaw_home,
            config_dir,
            logs_dir,
        }
    }

    /// 确保所有目录存在。
    pub fn ensure_dirs(&self) -> Result<(), String> {
        std::fs::create_dir_all(&self.openclaw_home)
            .map_err(|e| format!("创建 .openclaw 目录失败: {e}"))?;
        std::fs::create_dir_all(&self.config_dir)
            .map_err(|e| format!("创建 config 目录失败: {e}"))?;
        std::fs::create_dir_all(&self.logs_dir)
            .map_err(|e| format!("创建 logs 目录失败: {e}"))?;
        Ok(())
    }

    /// 返回 sidecar 子进程应使用的环境变量。
    /// 关键：OPENCLAW_HOME 指向隔离目录，而非默认 ~/.openclaw/。
    #[allow(dead_code)]
    pub fn sidecar_env(&self) -> Vec<(&str, &str)> {
        // 注意：Rust 中 &str 的生命周期问题，这里用 String 更安全
        // 骨架阶段返回空，后续填充实际环境变量
        vec![]
    }

    /// 返回 sidecar 子进程应使用的环境变量（String 版本）。
    pub fn sidecar_env_strings(&self) -> Vec<(String, String)> {
        vec![
            (
                "OPENCLAW_HOME".to_string(),
                self.openclaw_home.to_string_lossy().to_string(),
            ),
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
    }

    #[test]
    fn test_sidecar_env() {
        let layout = FsLayout::new();
        let env = layout.sidecar_env_strings();
        assert_eq!(env.len(), 2);
        assert_eq!(env[0].0, "OPENCLAW_HOME");
        assert_eq!(env[1].0, "ARTIFEX_NEXUS_HOME");
    }
}
