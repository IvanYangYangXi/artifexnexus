// JSON-RPC 2.0 客户端：通过 stdio 与 Python sidecar 通信。
//
// 关键设计：call() 有读取超时保护（默认 30s），防止 sidecar 卡死时
// read_line 永久阻塞 → 持有 Mutex → tokio 工作线程饥饿 → WebView 黑屏。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

/// sidecar RPC 调用超时（秒）。
/// 超时后 call() 返回错误，触发 SidecarManager 重启 sidecar 进程。
const CALL_TIMEOUT_SECS: u64 = 30;

/// 超时轮询间隔（毫秒）。
const POLL_INTERVAL_MS: u64 = 100;

/// JSON-RPC 2.0 请求
#[derive(Debug, Serialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    method: String,
    params: Value,
    id: u64,
}

/// JSON-RPC 2.0 响应
#[derive(Debug, Deserialize)]
struct JsonRpcResponse {
    #[allow(dead_code)]
    jsonrpc: String,
    #[allow(dead_code)]
    id: u64,
    #[serde(default)]
    result: Option<Value>,
    #[serde(default)]
    error: Option<JsonRpcError>,
}

/// JSON-RPC 2.0 错误
#[derive(Debug, Deserialize)]
struct JsonRpcError {
    #[allow(dead_code)]
    code: i64,
    #[allow(dead_code)]
    message: String,
}

/// Sidecar 客户端：持有子进程句柄、stdin writer、stdout reader。
pub struct SidecarClient {
    stdin: Box<dyn Write + Send>,
    stdout: BufReader<Box<dyn std::io::Read + Send>>,
    _child: Child,
    next_id: u64,
}

impl SidecarClient {
    /// 启动 Python sidecar 子进程。
    /// `sidecar_path` 为 sidecar.py 的绝对路径。
    /// `env_vars` 为注入的环境变量（如 OPENCLAW_HOME）。
    pub fn spawn(sidecar_path: &str, env_vars: &[(String, String)]) -> Result<Self, String> {
        // 跨平台 Python 命令：Windows 用 python，Unix 用 python3
        let python_cmd = if cfg!(windows) { "python" } else { "python3" };
        let mut cmd = Command::new(python_cmd);
        cmd.arg(sidecar_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped()); // 不 inherit，避免弹出控制台窗口

        // Windows: 隐藏控制台窗口（CREATE_NO_WINDOW = 0x08000000）
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        // 注入隔离环境变量
        for (key, value) in env_vars {
            cmd.env(key, value);
        }

        // 将 sidecar.py 所在目录加入 PYTHONPATH，确保相对导入可用
        if let Some(parent) = std::path::Path::new(sidecar_path).parent() {
            let pythonpath = parent.to_string_lossy().to_string();
            // 合并已有的 PYTHONPATH
            let existing = std::env::var("PYTHONPATH").unwrap_or_default();
            let merged = if existing.is_empty() {
                pythonpath
            } else {
                format!("{};{}", pythonpath, existing)
            };
            cmd.env("PYTHONPATH", merged);
        }

        let mut child = cmd.spawn().map_err(|e| format!("无法启动 sidecar: {e}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "无法获取 sidecar stdin".to_string())?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "无法获取 sidecar stdout".to_string())?;

        Ok(Self {
            stdin: Box::new(stdin),
            stdout: BufReader::new(Box::new(stdout)),
            _child: child,
            next_id: 1,
        })
    }

    /// 发送 JSON-RPC 请求并等待响应（带超时保护）。
    ///
    /// 超时（默认 30s）后返回错误，触发上层 SidecarManager 重启 sidecar。
    /// 这防止 sidecar 卡死时 read_line 永久阻塞 → 持有 Mutex →
    /// tokio 工作线程饥饿 → WebView 渲染停止（黑屏 bug）。
    pub fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;

        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            method: method.to_string(),
            params,
            id,
        };

        // 写入请求（NDJSON：一行一个 JSON）
        let line = serde_json::to_string(&request).map_err(|e| format!("序列化失败: {e}"))?;
        writeln!(self.stdin, "{line}").map_err(|e| format!("写入 sidecar 失败: {e}"))?;
        self.stdin
            .flush()
            .map_err(|e| format!("flush sidecar 失败: {e}"))?;

        // 读取响应（一行 JSON），带超时保护。
        // Windows 管道不支持 set_read_timeout，用轮询方式：
        // 每隔 POLL_INTERVAL_MS 检查是否有数据可读，超时则返回错误。
        let deadline = Instant::now() + Duration::from_secs(CALL_TIMEOUT_SECS);
        let mut response_line = String::new();
        loop {
            // 检查超时
            if Instant::now() >= deadline {
                return Err(format!(
                    "sidecar 响应超时（{}s），方法: {method}",
                    CALL_TIMEOUT_SECS
                ));
            }

            // 尝试读取一行（非阻塞检查 + 阻塞读）
            // BufReader::fill_buf 在有数据时返回非空切片；
            // 返回空切片 = EOF（sidecar 已退出）
            {
                let buf = self
                    .stdout
                    .fill_buf()
                    .map_err(|e| format!("读取 sidecar 响应失败: {e}"))?;
                if buf.is_empty() {
                    // EOF：sidecar 进程已退出
                    return Err("sidecar 进程意外退出（stdout EOF）".to_string());
                }
                // 有数据：检查是否包含完整行（\n）
                let has_newline = buf.contains(&b'\n');
                // buf 是 &[u8] 引用，不需要显式 drop；编译器会自动管理生命周期

                if has_newline {
                    // 有完整行，阻塞读取（此时不会阻塞）
                    self.stdout
                        .read_line(&mut response_line)
                        .map_err(|e| format!("读取 sidecar 响应失败: {e}"))?;
                    break;
                }
                // 有数据但无换行：等待更多数据到达
                std::thread::sleep(Duration::from_millis(POLL_INTERVAL_MS));
            }
        }

        let response: JsonRpcResponse = serde_json::from_str(response_line.trim())
            .map_err(|e| format!("解析 sidecar 响应失败: {e}"))?;

        if let Some(error) = response.error {
            return Err(format!("sidecar 错误: {} (code: {})", error.message, error.code));
        }

        response
            .result
            .ok_or_else(|| "sidecar 响应无 result 字段".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// 获取 sidecar.py 路径（相对于 Cargo.toml）
    fn sidecar_path() -> String {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
        std::path::PathBuf::from(manifest_dir)
            .join("../../../packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/sidecar.py")
            .to_string_lossy()
            .to_string()
    }

    #[test]
    fn test_ping() {
        let mut client = SidecarClient::spawn(&sidecar_path(), &[]).expect("spawn sidecar");
        let result = client.call("ping", json!(null)).expect("ping");
        assert_eq!(result, json!("pong"));
    }

    #[test]
    fn test_get_port() {
        let mut client = SidecarClient::spawn(&sidecar_path(), &[]).expect("spawn sidecar");
        let result = client.call("get_port", json!({"port": 19789})).expect("get_port");
        assert_eq!(result["port"], json!(19789));
    }

    #[test]
    fn test_unknown_method() {
        let mut client = SidecarClient::spawn(&sidecar_path(), &[]).expect("spawn sidecar");
        let result = client.call("nonexistent", json!(null));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("sidecar 错误"));
    }
}
