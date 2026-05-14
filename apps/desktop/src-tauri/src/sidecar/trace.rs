// 启动期日志追踪：把 Rust 端的 eprintln! 同时镜像到磁盘文件。
//
// Why（2026-05-14）：
//   release 模式下 EXE 用 CREATE_NO_WINDOW 启动，没有控制台 → eprintln! 输出
//   全部丢弃 → 用户报"卡在正在检测环境"时，我们看不到 [preflight] / [startup]
//   等关键日志。本模块在 EXE 启动最早期注册一个全局 stderr writer，把所有
//   eprintln 写入 ~/.artifexnexus/logs/exe-stderr-<pid>.log。
//
// 实现策略：
//   - 不替换 stderr（会影响 Tauri 自己的 panic 输出）
//   - 提供 trace!() / trace_err!() 宏，主动写日志文件 + 同时 eprintln（dev 模式有用）
//   - 文件 append 模式，每条带时间戳
//   - best-effort，写失败不 panic

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::SystemTime;

static LOG_FILE_PATH: OnceLock<Option<PathBuf>> = OnceLock::new();

/// 获取日志文件路径（首次调用时初始化）。
pub fn log_file_path() -> Option<PathBuf> {
    LOG_FILE_PATH.get_or_init(|| {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .ok()?;
        let dir = PathBuf::from(home).join(".artifexnexus").join("logs");
        std::fs::create_dir_all(&dir).ok()?;
        let pid = std::process::id();
        Some(dir.join(format!("exe-stderr-{pid}.log")))
    }).clone()
}

/// 写一条日志：[timestamp] [tag] msg
pub fn write_line(tag: &str, msg: &str) {
    let ts = current_ts();
    let line = format!("[{ts}] [{tag}] {msg}\n");

    // 1. 写文件
    if let Some(p) = log_file_path() {
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&p) {
            let _ = f.write_all(line.as_bytes());
        }
    }
    // 2. 同时 eprintln（dev 模式有控制台时能看到）
    eprint!("{line}");
}

fn current_ts() -> String {
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let ms = now.subsec_millis();
    // 简单 HH:MM:SS.mmm（基于本地时区粗略偏移；够排查用）
    let total = secs as i64;
    let h = (total / 3600) % 24;
    let m = (total / 60) % 60;
    let s = total % 60;
    // GMT+8 偏移
    let h = (h + 8) % 24;
    format!("{h:02}:{m:02}:{s:02}.{ms:03}")
}

/// 便捷宏：trace!("preflight", "killed pid={}", 1234);
#[macro_export]
macro_rules! trace_log {
    ($tag:expr, $($arg:tt)*) => {
        $crate::sidecar::trace::write_line($tag, &format!($($arg)*))
    };
}
