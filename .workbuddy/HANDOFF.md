# 接续提示词 — 用于新对话首条消息

> 复制以下整段（含分隔线之间所有内容）粘到新对话的第一条消息里。
> 它会让 AI 立刻拿到全部上下文，无需重新通读项目。

---

## 角色与项目
你是接续 Artifex Nexus（artclaw_bridge 重构 fork，AI Agent ↔ DCC 桥；Tauri+Rust+Python sidecar+OpenClaw Gateway）项目的协作者。
工作目录：`D:\MyProject_D\artifexnexus`（Windows，bash shell，python 3.14.3，node 24.13.1）。
默认中文回答；改架构先改 docs/specs/；apps/desktop 改动必须 `pnpm -C apps/desktop tauri build`，并在汇报里给出 .exe / setup 大小与时间戳。

请先扫一眼 `D:\MyProject_D\artifexnexus\.workbuddy\memory\2026-05-12.md`，那里有完整的调试历史。

## 当前任务
延续 2026-05-12 的"OpenClaw Gateway 启动遮罩不消失"调试。已完成事项：
1. **client.rs**：sidecar stderr 实时落地到 `~/.artifexnexus/logs/sidecar-stderr-<pid>.log`。
2. **client.rs**：Python 启动加 `-u` + `PYTHONUNBUFFERED=1` + `PYTHONIOENCODING=utf-8`，解决 Windows 命名管道 stdin block-buffer。
3. **sidecar.py**：增加 boot/main/rpc 全链路 stderr 打点；`for line in sys.stdin:` 改成 `while True: readline()`。
4. **runtime.py::is_running()**：自愈 — 在 `_current_openclaw_home is None` 时回退到 `OPENCLAW_HOME` env / 默认路径读 PID 锁；命中后同步 `gateway_state.set_running()`。

最后一次 build：2026-05-12 16:47，artifex-nexus-desktop.exe 12 MB / setup 3.0 MB。

**Python 改动（runtime.py）不需要重 cargo build**，因为 release exe 通过 `resolve_sidecar_path()` 的 fallback 直接从源码 `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/sidecar.py` 加载。

## 已抓到的关键证据（上一轮 sidecar 日志）
- sidecar 重启后跑 41 条 RPC 全部 in→out 成功（没有 30s 超时的 RPC）。
- 但每次 `openclaw.status` 都返回 `gateway_running=false` → 前端 waitReady 60 次都看不到 true → 遮罩永不消失。
- 12568 sidecar 在 `gateway.start id=13` 之后某条 RPC 触发 30s 超时被 Rust 杀掉（怀疑 React #418 渲染异常 + Mutex 串行积压）。

## 你下一步做的事
1. 跑 `D:\MyProject_D\artifexnexus\scripts\reset-and-run.bat`（用户会双击执行；它会清残留进程、清 PID 锁、清旧 sidecar log，再启动 exe）。
2. 等遮罩状态稳定（消失或卡住）。
3. 把 `C:\Users\yangjili\.artifexnexus\logs\sidecar-stderr-*.log` 的全部内容贴给我。

期待的下一步定位：
- 如果有 sidecar 日志显示 `[sidecar.rpc] in: openclaw.status` → `out: openclaw.status` 但前端依然循环（status 仍报 false）：说明 is_running 自愈也失效，去 dump `gateway_state.get_info()` 当前快照。
- 如果某条 RPC 只有 `in:` 没 `out:`：定位到具体 handler，加打点。
- 如果遮罩按预期消失：处理两个次级 bug（React #418 hydration / 18083 426 Upgrade Required）。

## 关键文件位置（备查）
- `apps/desktop/src-tauri/src/sidecar/client.rs` — sidecar spawn + stderr 落地
- `apps/desktop/src-tauri/src/sidecar/manager.rs` — Mutex 串行 + 重启逻辑
- `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/sidecar.py` — RPC 主循环
- `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/runtime.py` — gateway 进程管理 + is_running 自愈
- `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/sidecar_gateway.py` — gateway.* RPC handler
- `packages/apps/web/src/components/shell/AppShell.tsx` — 启动遮罩 + waitReady 轮询
- `C:\Users\yangjili\.artifexnexus\.openclaw\openclaw.json` — Gateway 配置（gateway.port=19789, auth.mode=token）
- 调试 probe：`.workbuddy/probe_sidecar.py`（直连 sidecar.py 单独验证，**用 `python -u`**）
- 一键脚本：`scripts/reset-and-run.bat`

## 我等你
我准备好把 sidecar log 贴上。
