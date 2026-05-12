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

    /// 发送 JSON-RPC 请求（带超时保护 + 崩溃重启）。
    ///
    /// 当 sidecar 响应超时或 IO 错误时，先杀掉旧 sidecar 进程再重启，
    /// 避免旧进程残留占用端口/stdin。
    ///
    /// 2026-05-12 修复：超时时**不再无脑重启**。
    /// 之前的实现：`call()` 一旦失败（含 30s 超时）就 drop 旧 client → 重启 sidecar
    /// → 重试一次。问题是：sidecar 47788/47956 等多个日志显示 sidecar 实际处理 RPC
    /// 完全正常（in/out 全部成功），但 Rust 端因为 *别的并发 RPC 持锁太久*（如
    /// gateway.start 等 OpenClaw CLI 5-10s）→ 当前 RPC 排队 30s 超时 → 重启路径
    /// 杀掉一个完全健康的 sidecar → 用户看到"sidecar 调用失败（已重启重试）"。
    ///
    /// 现在：超时只重试一次（不重启）；只有 IO 错误（broken pipe / EOF）才走重启路径。
    pub fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let client = self
            .client
            .as_mut()
            .ok_or_else(|| "sidecar 未启动".to_string())?;

        match client.call(method, params.clone()) {
            Ok(result) => Ok(result),
            Err(e) => {
                let err_msg = e;
                // 区分错误类型：超时 vs IO 失败（含 EOF）
                let is_timeout = err_msg.contains("响应超时");
                let is_io_failed = err_msg.contains("意外退出")
                    || err_msg.contains("写入 sidecar 失败")
                    || err_msg.contains("flush sidecar 失败")
                    || err_msg.contains("读取 sidecar 响应失败");

                if is_timeout && !is_io_failed {
                    // 仅超时：sidecar 大概率还活着（可能被别的长 RPC 占着）。
                    // 不重启进程，直接返回错误让前端容错（如 ChatView load history 失败）。
                    return Err(format!("sidecar 调用超时（保留进程不重启）: {err_msg}"));
                }

                // 真正的 IO 失败（sidecar 死了）：drop 旧 client → spawn 新进程 → 重试一次
                self.client = None;
                self.start()?;
                self.client
                    .as_mut()
                    .ok_or_else(|| "sidecar 重启后仍不可用".to_string())?
                    .call(method, params)
                    .map_err(|retry_err| {
                        format!("sidecar 调用失败（已重启重试）: {retry_err}（原错误: {err_msg}）")
                    })
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
