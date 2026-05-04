// JSON-RPC 2.0 客户端：通过 stdio 与 Python sidecar 通信。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};

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
        let mut cmd = Command::new("python3");
        cmd.arg(sidecar_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());

        // 注入隔离环境变量
        for (key, value) in env_vars {
            cmd.env(key, value);
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

    /// 发送 JSON-RPC 请求并等待响应。
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

        // 读取响应（一行 JSON）
        let mut response_line = String::new();
        self.stdout
            .read_line(&mut response_line)
            .map_err(|e| format!("读取 sidecar 响应失败: {e}"))?;

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
        let result = client.call("get_port", json!({"port": 14523})).expect("get_port");
        assert_eq!(result["port"], json!(14523));
    }

    #[test]
    fn test_unknown_method() {
        let mut client = SidecarClient::spawn(&sidecar_path(), &[]).expect("spawn sidecar");
        let result = client.call("nonexistent", json!(null));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("sidecar 错误"));
    }
}
