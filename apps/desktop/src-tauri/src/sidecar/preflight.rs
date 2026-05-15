// EXE 启动 / 退出期清理：单实例 + 孤儿进程/端口清理。
//
// Why（2026-05-14 写入）：
//   历史上 EXE 启动反复卡在"正在检测环境…"，根因是：
//     1. 上次 EXE 异常退出留下 gateway (node.exe) 孤儿继续占 19789，
//        但 sidecar 写的 PID 锁是上次的 sidecar PID，前端 status 拿到
//        gateway_running=true（PID 锁有效）→ 跳过 startGateway → ChatView
//        WS 连不上死的 gateway → 永卡。
//     2. 用户连续双击 EXE 导致两个实例并存，互相覆盖 run/sidecar.instance
//        和 run/gateway.pid，状态错乱。
//   修复策略简单粗暴：EXE 入口先杀光所有相关孤儿，退出时再杀一遍自己。
//
// 设计原则（用户原话）：流程不要搞太复杂，越复杂越容易出错。
//   - 全部 best-effort，失败只打日志不阻塞启动
//   - 清理逻辑全部集中在这一个文件，便于排查
//   - 不引入新 crate，全用标准库 + 已有的 windows api crate

use std::path::PathBuf;
use std::process::Command;

use crate::trace_log;

/// gateway 监听端口（与 sidecar 的 DEFAULT_PORT 保持一致）
const GATEWAY_PORT: u16 = 19789;
/// browser control UI 端口（OpenClaw 自带的）
const BROWSER_CONTROL_PORT: u16 = 19791;

/// EXE 启动期清理：杀光所有可能的残留进程 + 端口 + 锁文件。
///
/// 顺序：
///   1. 杀掉所有同名 artifex-nexus-desktop.exe（除自己外）→ 实现"单实例"
///   2. 杀掉所有 python.exe -u sidecar.py（孤儿 sidecar）
///   3. 杀掉占用 GATEWAY_PORT / BROWSER_CONTROL_PORT 的 node.exe（孤儿 gateway）
///   4. 删 ~/.artifexnexus/run/gateway.pid 和 sidecar.instance（陈旧锁文件）
///
/// 全程 best-effort：任何失败都打日志继续执行，绝不阻塞 EXE 启动。
pub fn pre_startup_cleanup() {
    trace_log!("preflight", "=== pre_startup_cleanup start ===");
    let self_pid = std::process::id();

    // 1. 杀同名 EXE
    kill_processes_by_name("artifex-nexus-desktop.exe", &[self_pid]);

    // 2. 杀孤儿 sidecar（python.exe -u .*sidecar.py）
    kill_python_sidecars();

    // 3. 杀 gateway 端口占用
    kill_processes_on_port(GATEWAY_PORT);
    kill_processes_on_port(BROWSER_CONTROL_PORT);

    // 4. 删陈旧锁文件
    let run_dir = artifex_run_dir();
    for fname in &["gateway.pid", "sidecar.instance"] {
        let p = run_dir.join(fname);
        if p.exists() {
            match std::fs::remove_file(&p) {
                Ok(_) => trace_log!("preflight", "removed stale lock: {}", p.display()),
                Err(e) => trace_log!("preflight", "failed to remove {}: {e}", p.display()),
            }
        }
    }

    trace_log!("preflight", "=== pre_startup_cleanup done ===");
}

/// EXE 退出期清理：杀掉自己拉起的 sidecar + gateway。
///
/// 与 pre_startup_cleanup 等价（全杀），保证下次启动时是干净状态。
pub fn post_exit_cleanup() {
    trace_log!("preflight", "=== post_exit_cleanup start ===");
    let self_pid = std::process::id();

    // 杀自己 spawn 的 sidecar 子进程（python.exe）
    kill_python_sidecars();

    // 杀 gateway（自己拉起的 node.exe）
    kill_processes_on_port(GATEWAY_PORT);
    kill_processes_on_port(BROWSER_CONTROL_PORT);

    // 删锁文件
    let run_dir = artifex_run_dir();
    for fname in &["gateway.pid", "sidecar.instance"] {
        let _ = std::fs::remove_file(run_dir.join(fname));
    }

    trace_log!("preflight", "=== post_exit_cleanup done (self_pid={self_pid}) ===");
}

// ─────────────────────────────────────────────────────────────────────
// 内部工具：跨平台进程/端口操作
// ─────────────────────────────────────────────────────────────────────

fn artifex_run_dir() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".artifexnexus").join("run")
}

/// 杀掉所有指定名字的进程（除 except_pids 外）。
///
/// Windows: 用 `taskkill /F /IM <name> /T`；这会一次性杀光所有同名进程。
/// 为了排除 self_pid，先用 wmic 列出再逐个杀。
fn kill_processes_by_name(name: &str, except_pids: &[u32]) {
    let pids = list_pids_by_name(name);
    trace_log!("preflight", "{} pids found: {:?} (except {:?})", name, pids, except_pids);
    for pid in pids {
        if except_pids.contains(&pid) {
            continue;
        }
        kill_pid(pid);
    }
}

/// 列出指定名字的所有进程 PID（Windows 用 wmic，跨平台兜底用 tasklist 解析）。
fn list_pids_by_name(name: &str) -> Vec<u32> {
    let mut pids = Vec::new();

    #[cfg(windows)]
    {
        // wmic 输出格式： "ProcessId\n12345\n67890\n"
        let out = Command::new("wmic")
            .args(["process", "where", &format!("name='{name}'"), "get", "ProcessId"])
            .creation_flags_no_window()
            .output();
        if let Ok(out) = out {
            let s = String::from_utf8_lossy(&out.stdout);
            for line in s.lines().skip(1) {
                let t = line.trim();
                if let Ok(p) = t.parse::<u32>() {
                    pids.push(p);
                }
            }
        }
    }

    #[cfg(not(windows))]
    {
        let out = Command::new("pgrep").args(["-f", name]).output();
        if let Ok(out) = out {
            for line in String::from_utf8_lossy(&out.stdout).lines() {
                if let Ok(p) = line.trim().parse::<u32>() {
                    pids.push(p);
                }
            }
        }
    }

    pids
}

/// 列出所有 python.exe 中命令行包含 sidecar.py 的进程并杀掉。
///
/// 不能用 kill_processes_by_name("python.exe")，因为系统上可能跑着别的 Python
/// 脚本（如 mcp_bridge、artclaw_stdio_bridge 等），不能误伤。
pub(super) fn kill_python_sidecars() {
    #[cfg(windows)]
    {
        // wmic ... get ProcessId,CommandLine /format:csv
        let out = Command::new("wmic")
            .args([
                "process", "where", "name='python.exe'",
                "get", "ProcessId,CommandLine", "/format:csv",
            ])
            .creation_flags_no_window()
            .output();
        let mut killed = Vec::new();
        if let Ok(out) = out {
            // CSV 格式： "Node,CommandLine,ProcessId"，含表头
            let s = String::from_utf8_lossy(&out.stdout);
            for line in s.lines() {
                if !line.contains("sidecar.py") {
                    continue;
                }
                // 末列是 PID
                if let Some(pid_str) = line.rsplit(',').next() {
                    if let Ok(pid) = pid_str.trim().parse::<u32>() {
                        kill_pid(pid);
                        killed.push(pid);
                    }
                }
            }
        }
        trace_log!("preflight", "killed sidecar.py python pids: {:?}", killed);
    }

    #[cfg(not(windows))]
    {
        let out = Command::new("pgrep").args(["-f", "sidecar.py"]).output();
        if let Ok(out) = out {
            for line in String::from_utf8_lossy(&out.stdout).lines() {
                if let Ok(p) = line.trim().parse::<u32>() {
                    kill_pid(p);
                }
            }
        }
    }
}

/// 杀掉占用指定 TCP 端口的所有 LISTENING 进程。
fn kill_processes_on_port(port: u16) {
    let pids = list_pids_listening_on_port(port);
    trace_log!("preflight", "port {port} listening pids: {:?}", pids);
    for pid in pids {
        kill_pid(pid);
    }
}

/// netstat 解析：找出 LISTENING 在指定端口的所有 PID。
fn list_pids_listening_on_port(port: u16) -> Vec<u32> {
    let mut pids = Vec::new();
    let needle = format!(":{port}");

    let mut cmd = Command::new("netstat");
    cmd.args(["-ano"]);
    #[cfg(windows)]
    {
        cmd.creation_flags_no_window();
    }
    let out = cmd.output();

    if let Ok(out) = out {
        let s = String::from_utf8_lossy(&out.stdout);
        for line in s.lines() {
            // Windows 格式：
            //   "  TCP    127.0.0.1:19789        0.0.0.0:0       LISTENING       43192"
            if !line.contains(&needle) || !line.contains("LISTENING") {
                continue;
            }
            // 检查 ":19789" 是 LOCAL 地址（避免误伤 connect 到 19789 的客户端）
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 5 {
                continue;
            }
            // parts[1] = LOCAL  (e.g. "127.0.0.1:19789")
            if !parts[1].ends_with(&needle) {
                continue;
            }
            if let Ok(pid) = parts[parts.len() - 1].parse::<u32>() {
                if pid != 0 && !pids.contains(&pid) {
                    pids.push(pid);
                }
            }
        }
    }

    pids
}

/// 强制杀进程（Windows: taskkill /F /T /PID; Unix: kill -9）。
fn kill_pid(pid: u32) {
    if pid == 0 || pid == 4 {
        // 忽略 System Idle / System
        return;
    }
    #[cfg(windows)]
    {
        let r = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags_no_window()
            .output();
        match r {
            Ok(o) if o.status.success() => {
                trace_log!("preflight", "killed pid={pid}");
            }
            Ok(o) => {
                let stderr = String::from_utf8_lossy(&o.stderr);
                trace_log!("preflight", "taskkill pid={pid} non-zero exit: {}", stderr.trim());
            }
            Err(e) => trace_log!("preflight", "taskkill pid={pid} spawn error: {e}"),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
    }
}

// ─────────────────────────────────────────────────────────────────────
// Windows 专属：CREATE_NO_WINDOW（避免 wmic/netstat/taskkill 弹黑窗）
// ─────────────────────────────────────────────────────────────────────

#[cfg(windows)]
trait CommandExtNoWindow {
    fn creation_flags_no_window(&mut self) -> &mut Self;
}

#[cfg(windows)]
impl CommandExtNoWindow for Command {
    fn creation_flags_no_window(&mut self) -> &mut Self {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        self.creation_flags(CREATE_NO_WINDOW)
    }
}
