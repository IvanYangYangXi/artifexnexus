---
tags: [adr, openclaw, windows, subprocess]
created: 2026-05-07
status: accepted
---

# ADR 0007 — Windows 上 spawn `openclaw` CLI 的统一约定

## Context

OpenClaw v2026.5.4 通过 `npm install --prefix <cli_dir> openclaw@<ver>` 安装。
npm 在 Windows 上为可执行入口生成**三件套 shell wrapper**，落在 `<cli_dir>/`
**根目录**（不是 `<cli_dir>/bin/`）：

```
<cli_dir>/
├── openclaw           # POSIX sh 脚本（Cygwin / Git-Bash 用）
├── openclaw.cmd       # Windows cmd 脚本（cmd.exe / Tauri / Python 默认应该用这个）
├── openclaw.ps1       # PowerShell 脚本
├── node_modules/openclaw/openclaw.mjs   # 真正入口
└── bin/               # 空目录（npm 创建但不放任何东西）
```

联调时发现三类 bug 同源：

1. `runtime.py::_find_openclaw_bin()` 候选顺序为
   `bin/openclaw → bin/openclaw.cmd → openclaw → openclaw.cmd`，
   Windows 命中第三个（无后缀 sh 脚本），`subprocess.Popen` 直接 spawn 触发
   **`OSError [WinError 193] %1 不是有效的 Win32 应用程序`**；gateway 永远启不来。
2. `config_io.py` / `web_ui.py` / `agent_preset.py` 的 `subprocess.run([str(openclaw_bin), …])`
   即便选对了 `.cmd`，在某些 Python/Windows 组合下因未走 `cmd.exe` 也会失败；
   一旦失败，`dump_config / patch_config / test_provider / get_web_url / install_default_preset`
   全部不可用 → 设置面板"测试连接"、"保存"、"打开 Web UI"全部报同一个 WinError。
3. 每次 spawn 在 Windows 上还会**弹出黑色 cmd 窗口**（除非显式 `CREATE_NO_WINDOW`），
   严重影响 Tauri 桌面应用观感。

## Decision

抽出 `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/_subprocess.py`
作为 **wrapper 内 spawn `openclaw` CLI 的唯一入口**，并固化以下约定：

### 1. 可执行文件查找：Windows 优先 `.cmd`

`find_openclaw_bin(openclaw_home)` 候选顺序由平台决定：

| 平台 | 候选顺序（首个 exists 即返回） |
|---|---|
| Windows | `<vdir>/openclaw.cmd` → `<vdir>/bin/openclaw.cmd` → `<vdir>/openclaw.ps1` → `<vdir>/openclaw` → `<vdir>/bin/openclaw` |
| 非 Windows | `<vdir>/bin/openclaw` → `<vdir>/openclaw` → `<vdir>/bin/openclaw.cmd` → `<vdir>/openclaw.cmd` |

`<vdir>` 解析顺序仍为 `cli/current` symlink → `cli/current.txt` → `cli/` 下最新版本目录。

### 2. spawn 参数统一三件套（仅 Windows 启用）

通过 helper `popen_args(cmd, *, env=None) -> dict`（Python 3.11+ 支持的 keyword-only
形式），返回 `subprocess.Popen` / `subprocess.run` 共用的 kwargs：

- `creationflags = CREATE_NO_WINDOW (0x08000000)`：**禁止弹黑窗**
- 当 `cmd[0]` 以 `.cmd` / `.bat` 结尾且非 Windows 时按需 fallback；Windows 下 `.cmd`
  通过 `subprocess` 走 `cmd.exe` 是默认行为（Python 3.8+），无需手动 `shell=True`
- `text=True` + `encoding="utf-8"` + `errors="replace"`：**统一 UTF-8 解码**，
  规避 GBK 控制台导致的 `UnicodeDecodeError`
- 子进程 group：Windows `CREATE_NEW_PROCESS_GROUP`，便于 `taskkill /T`；非 Windows
  无（让 Tauri kill_on_drop 接管）

### 3. env 三件套自带，调用方零责任

helper 提供 `build_openclaw_env(openclaw_home) -> dict[str, str]`，固化注入：
`OPENCLAW_HOME / OPENCLAW_STATE_DIR / OPENCLAW_CONFIG_PATH / OPENCLAW_NO_ONBOARD=1`，
所有 spawn 调用必须经此 helper，禁止散落 `os.environ.copy()` + 手动赋值。

### 4. 统一封装 `run_openclaw(cmd_args, openclaw_home, *, timeout, input=None) -> CompletedProcess`

供 `config_io / web_ui / agent_preset / doctor` 调用。`runtime.start_gateway` 因
需要长进程句柄管理走 `Popen`，但 args/env/creationflags 复用同一 helper。

## Consequences

**优点**

- 一处修复，4 个 STORY 的 Windows 阻塞同时消失
- 后续新增 spawn 调用方不再需要重复处理 `.cmd` / `CREATE_NO_WINDOW` / UTF-8 编码
- 可在 helper 上集中加单测（mock subprocess + 平台分支）

**代价 / 风险**

- 增加一个新文件，但代码量可控（< 100 行）
- 若上游某天改名（如 `openclaw` → `oc`）或调整 npm wrapper 布局，候选清单需同步
  更新——通过 doctor 自检 + bin path 单测兜底

## Alternatives Considered

- **方案 A：每个调用点各自加 `if Windows: shell=True`**——已被本次联调证伪：5 处分散，
  容易遗漏；且 `shell=True` + 含空格路径有命令注入风险，本项目 `OPENCLAW_HOME` 默认
  就在 `C:\Users\<name>\.artifexnexus\` 下，`<name>` 可能含空格。拒。
- **方案 B：固定调 `cmd.exe /c openclaw.cmd …` 字符串拼接**——失去 list 形式的 quoting
  保护，且非 Windows 无意义。拒。
- **方案 C：把 `openclaw.cmd` 改写成 .exe shim（pyinstaller 之类）**——侵入上游 npm
  布局，违背 ADR 0002（不 patch 上游）。拒。
- **方案 D：sidecar 内嵌 Node + 直接 `node openclaw.mjs`**——可绕过 npm wrapper，
  但放弃了 OpenClaw 后续可能新增的 wrapper 行为（如自动选 node 版本）。M2+ 再考虑，
  M1 走 wrapper 路径风险最小。拒。

## Links

- `[[0002-vendor-openclaw-fork]]`
- `[[0005-desktop-distribution-tauri-standalone-python]]`
- `[[../specs/openclaw-wrapper-runtime]]`
- `[[../specs/openclaw-wrapper-dev]]`
- `[[../specs/openclaw-upstream-survey]]`
- `[[../tasks/in-progress/STORY-0015-openclaw-settings-panel]]`
- `[[../tasks/in-progress/STORY-0016-openclaw-web-ui-entry]]`
- `[[../tasks/in-progress/STORY-0017-openclaw-agent-preset]]`
- `[[../tasks/review/STORY-0010-openclaw-runtime-spawn]]`
