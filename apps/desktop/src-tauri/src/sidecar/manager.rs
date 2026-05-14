// Sidecar 生命周期管理：spawn、健康检查、崩溃重启。
// 文件行数硬上限 300。

use crate::fs_layout::FsLayout;
use crate::sidecar::client::SidecarClient;
use crate::trace_log;
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
            let msg = format!(
                "sidecar 崩溃过于频繁：{} 次/分钟，拒绝重启",
                self.restart_times.len()
            );
            trace_log!("sidecar.start", "REJECT: {msg}");
            return Err(msg);
        }
        self.restart_times.push(now);

        let env_vars = self.fs_layout.sidecar_env_strings();
        trace_log!("sidecar.start", "spawning sidecar (path={})", self.sidecar_path);
        let client = SidecarClient::spawn(&self.sidecar_path, &env_vars)?;
        trace_log!("sidecar.start", "sidecar spawned successfully");
        self.client = Some(client);
        Ok(())
    }

    /// 发送 JSON-RPC 请求。
    ///
    /// 2026-05-14 大幅简化：
    /// - 不再"超时/IO 失败时自动重启 sidecar"。多线 Tauri command 共享 Mutex，
    ///   旧实现重启 sidecar 会让其他正在等响应的线程报"sidecar 重启后仍不可用"，
    ///   制造级联混乱，而 sidecar 现实中很少崩溃。
    /// - sidecar 死了/卡了 → 报错让前端看见 → 用户重启 EXE → preflight 清理。
    /// - 简单粗暴优于"复杂的自动恢复"。
    pub fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let client = self
            .client
            .as_mut()
            .ok_or_else(|| {
                trace_log!("rpc", "FAIL method={method} reason=sidecar_未启动");
                "sidecar 未启动".to_string()
            })?;

        let t0 = Instant::now();
        trace_log!("rpc", "→ {method}");

        match client.call(method, params) {
            Ok(result) => {
                trace_log!("rpc", "← {method} OK ({}ms)", t0.elapsed().as_millis());
                Ok(result)
            }
            Err(e) => {
                trace_log!("rpc", "✗ {method} FAIL ({}ms): {e}", t0.elapsed().as_millis());
                Err(e)
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
