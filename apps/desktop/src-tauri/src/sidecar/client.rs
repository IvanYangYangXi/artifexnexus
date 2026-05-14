// JSON-RPC 2.0 客户端：通过 stdio 与 Python sidecar 通信。
//
// 2026-05-14 重构：用独立 reader 线程 + mpsc channel 替代 BufReader 轮询。
//
// Why（追查 30s 卡顿根因）：
//   旧实现的 call() 用 `BufReader::fill_buf()` 检查是否有数据，但 fill_buf
//   在 BufReader 内部 buffer 为空时会调底层 stdout.read()，这是 **Windows
//   pipe 上的阻塞调用**，没有超时；外层 `Instant::now() >= deadline` 的
//   检查永远不会被执行 → call() 卡 30s 才超时退出。
//   sidecar log 显示响应早就写完了（"out: openclaw.config.dump"），但
//   Rust 这边永远读不到 → 用户看到"sidecar 响应超时"反复出现。
//
// 新设计：
//   spawn 时启动独立 reader 线程持续 read_line，把每行响应通过 mpsc
//   channel 发给主线程。call() 主线程只做 write stdin + recv_timeout，
//   永不阻塞在 read 上。
//
// 简单清晰，绕开 Windows pipe 的所有怪异行为。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::time::Duration;

/// sidecar RPC 调用超时（秒）。
const CALL_TIMEOUT_SECS: u64 = 30;

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
    /// 可选 data 字段：结构化错误载荷（如 port_busy 的 occupants 列表）。
    /// STORY-0039 起用于让前端区分"端口被外部占用"等特殊错误。
    #[serde(default)]
    data: Option<Value>,
}

/// Sidecar 客户端：持有子进程句柄、stdin writer、stdout 响应 channel。
///
/// 设计：spawn 时启动一个独立 reader 线程持续 read_line，每读一行就把字符串
/// 通过 mpsc channel 发给主线程。call() 主线程只做 write stdin + recv_timeout，
/// 永不阻塞在 read 上——绕开 Windows pipe 的所有怪异 I/O 行为。
pub struct SidecarClient {
    stdin: Box<dyn Write + Send>,
    /// reader 线程发来的响应行（已 trim，无 trailing \n）
    response_rx: Receiver<Result<String, String>>,
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
        // -u：强制 Python stdin/stdout/stderr 完全无缓冲。
        // Why：Tauri 子进程模式下 Python 默认把 sys.stdin / sys.stdout 当作非 tty，
        //   走 block-buffered 模式 → Rust 写完 NDJSON 一行 + flush 后，Python 端
        //   `for line in sys.stdin:` 仍可能在 buffer 填满前不返回，造成 sidecar
        //   收不到 RPC、Rust 30s 超时 → 反复重启循环（2026-05-12 调试发现）。
        // -u 让 Python 直接绕过这层缓冲，等价于运行时设 PYTHONUNBUFFERED=1。
        cmd.arg("-u")
            .arg(sidecar_path)
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

        // 强制 Python 全无缓冲 + UTF-8 stdio：与上面的 `-u` 双保险，
        // 同时把 stdin/stdout 编码强制成 UTF-8，避免 Windows 默认 mbcs/GBK
        // 解码 Rust 写来的 JSON 字符串（含中文 token / 路径）时炸 UnicodeDecodeError。
        cmd.env("PYTHONUNBUFFERED", "1");
        cmd.env("PYTHONIOENCODING", "utf-8");

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

        // 读取 stderr 到一个独立线程，避免管道缓冲区满导致 sidecar 阻塞。
        // 同时把 stderr 落到日志文件 ~/.artifexnexus/logs/sidecar-stderr-<pid>.log，
        // 方便 GUI 模式（CREATE_NO_WINDOW）下事后排查 sidecar 卡死/异常。
        // 注意：用 USERPROFILE/HOME 环境变量解析 home，避免引入新 crate。
        if let Some(stderr) = child.stderr.take() {
            use std::io::BufRead;
            let pid = child.id();
            // 计算日志文件路径
            let home = std::env::var("USERPROFILE")
                .or_else(|_| std::env::var("HOME"))
                .ok();
            let log_path: Option<std::path::PathBuf> = home.map(|h| {
                let dir = std::path::PathBuf::from(h)
                    .join(".artifexnexus")
                    .join("logs");
                let _ = std::fs::create_dir_all(&dir);
                dir.join(format!("sidecar-stderr-{pid}.log"))
            });
            std::thread::spawn(move || {
                use std::io::Write;
                let mut log_file = log_path
                    .as_ref()
                    .and_then(|p| {
                        std::fs::OpenOptions::new()
                            .create(true)
                            .append(true)
                            .open(p)
                            .ok()
                    });
                if let Some(f) = log_file.as_mut() {
                    let _ = writeln!(f, "[startup] sidecar stderr capture begin pid={pid}");
                    let _ = f.flush();
                }
                let reader = std::io::BufReader::new(stderr);
                for line in reader.lines() {
                    if let Ok(l) = line {
                        eprintln!("[sidecar:stderr] {l}");
                        if let Some(f) = log_file.as_mut() {
                            let _ = writeln!(f, "{l}");
                            let _ = f.flush();
                        }
                    }
                }
                if let Some(f) = log_file.as_mut() {
                    let _ = writeln!(f, "[shutdown] sidecar stderr capture end pid={pid}");
                }
            });
        }

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "无法获取 sidecar stdin".to_string())?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "无法获取 sidecar stdout".to_string())?;

        // ─────────────────────────────────────────────────────────────
        // 启动独立 reader 线程：持续读 sidecar stdout，每行 push 到 channel。
        // 这样主线程的 call() 不会阻塞在 read 上，超时严格生效。
        // 线程会在 sidecar 退出（read 返回 Ok(0)）或 broken pipe 时退出。
        // ─────────────────────────────────────────────────────────────
        let (tx, response_rx) = mpsc::channel::<Result<String, String>>();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                let mut line = String::new();
                match reader.read_line(&mut line) {
                    Ok(0) => {
                        // EOF：sidecar 已退出
                        let _ = tx.send(Err("sidecar 进程意外退出（stdout EOF）".to_string()));
                        break;
                    }
                    Ok(_) => {
                        let trimmed = line.trim_end().to_string();
                        if trimmed.is_empty() {
                            continue;
                        }
                        if tx.send(Ok(trimmed)).is_err() {
                            // 主线程 SidecarClient 已 drop，线程退出
                            break;
                        }
                    }
                    Err(e) => {
                        let _ = tx.send(Err(format!("读取 sidecar 响应失败: {e}")));
                        break;
                    }
                }
            }
        });

        Ok(Self {
            stdin: Box::new(stdin),
            response_rx,
            _child: child,
            next_id: 1,
        })
    }

    /// 发送 JSON-RPC 请求并等待响应（带严格超时保护）。
    ///
    /// 实现：write stdin → channel.recv_timeout 等 reader 线程发来响应。
    /// 永不阻塞在底层 read 上 → 30s 超时严格生效。
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

        // 等响应（reader 线程会通过 channel 推过来）。
        // 注意：因为多 RPC 共享同一个 channel，理论上可能收到非本次请求的响应——
        // 但 SidecarManager 用 Mutex 串行化所有 call()，前一个 call 必须完成
        // 才能开始下一个，所以 channel 里不会有"上一次响应"残留。
        let response_line = self
            .response_rx
            .recv_timeout(Duration::from_secs(CALL_TIMEOUT_SECS))
            .map_err(|e| match e {
                mpsc::RecvTimeoutError::Timeout => {
                    format!("sidecar 响应超时（{}s），方法: {method}", CALL_TIMEOUT_SECS)
                }
                mpsc::RecvTimeoutError::Disconnected => {
                    "sidecar reader 线程已退出（sidecar 已死）".to_string()
                }
            })?
            .map_err(|e| e)?; // reader 线程内部 IO 错误

        let response: JsonRpcResponse = serde_json::from_str(response_line.trim())
            .map_err(|e| format!("解析 sidecar 响应失败: {e} (raw={})", &response_line[..response_line.len().min(200)]))?;

        if let Some(error) = response.error {
            // STORY-0039：如果 sidecar 带 data（结构化错误），把 data 序列化成
            // JSON 字符串前缀进错误 message，前端按 `__rpcdata__:` 切出来解析。
            if let Some(data) = error.data {
                let data_str = serde_json::to_string(&data)
                    .unwrap_or_else(|_| "{}".to_string());
                return Err(format!(
                    "sidecar 错误: {} (code: {}) __rpcdata__:{}",
                    error.message, error.code, data_str
                ));
            }
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
