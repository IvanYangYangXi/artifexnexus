// Sidecar 生命周期管理：spawn、健康检查、崩溃重启。
// 文件行数硬上限 300。

use crate::fs_layout::FsLayout;
use crate::sidecar::client::SidecarClient;
use serde_json::Value;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// 崩溃重启限制：3 次/分钟
const MAX_RESTARTS_PER_MINUTE: u32 = 3;
const RESTART_WINDOW: Duration = Duration::from_secs(60);

/// Sidecar 管理器：持有客户端实例和重启计数器。
pub struct SidecarManager {
    client: Option<SidecarClient>,
    sidecar_path: String,
    fs_layout: FsLayout,
    restart_times: Vec<Instant>,
}

impl SidecarManager {
    /// 创建管理器，不立即启动。
    pub fn new(sidecar_path: String) -> Self {
        Self {
            client: None,
            sidecar_path,
            fs_layout: FsLayout::new(),
            restart_times: Vec::new(),
        }
    }

    /// 检查 sidecar 是否正在运行。
    pub fn is_running(&self) -> bool {
        self.client.is_some()
    }

    /// 启动 sidecar（首次或重启）。
    pub fn start(&mut self) -> Result<(), String> {
        // 确保隔离目录存在
        self.fs_layout.ensure_dirs()?;

        // 检查重启频率
        let now = Instant::now();
        self.restart_times.retain(|t| now - *t < RESTART_WINDOW);
        if self.restart_times.len() >= MAX_RESTARTS_PER_MINUTE as usize {
            return Err(format!(
                "sidecar 崩溃过于频繁：{} 次/分钟，拒绝重启",
                self.restart_times.len()
            ));
        }
        self.restart_times.push(now);

        let env_vars = self.fs_layout.sidecar_env_strings();
        let client = SidecarClient::spawn(&self.sidecar_path, &env_vars)?;
        self.client = Some(client);
        Ok(())
    }

    /// 发送 JSON-RPC 请求。
    pub fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let client = self
            .client
            .as_mut()
            .ok_or_else(|| "sidecar 未启动".to_string())?;

        match client.call(method, params.clone()) {
            Ok(result) => Ok(result),
            Err(_e) => {
                // 调用失败，尝试重启
                self.client = None;
                self.start()?;
                // 重试一次，使用原始 params
                self.client
                    .as_mut()
                    .ok_or_else(|| "sidecar 重启后仍不可用".to_string())?
                    .call(method, params)
            }
        }
    }

    /// 健康检查：发送 ping。
    #[allow(dead_code)]
    pub fn health_check(&mut self) -> Result<(), String> {
        self.call("ping", serde_json::json!(null))?;
        Ok(())
    }
}

/// Tauri State 包装：Mutex 保证线程安全。
pub type SidecarState = Mutex<SidecarManager>;
