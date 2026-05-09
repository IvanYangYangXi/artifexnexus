---
tags: [spec, openclaw, developer, build]
created: 2026-05-03
status: draft
---

# OpenClaw Wrapper — 开发者视角（Dev）

> 总览：[[openclaw-wrapper]]。本文只讲**仓内结构、本地跑通、打包构建**。

## 1. 仓内新增结构

```
apps/
└── desktop/                      # Tauri 壳（新增）
    ├── src-tauri/                # Rust 端：系统能力（薄）
    │   ├── src/
    │   │   ├── main.rs
    │   │   ├── modes/            # 三种职能拆分
    │   │   │   ├── installer.rs  # 一次性首装/卸载
    │   │   │   ├── daemon.rs     # 常驻：拉起/管理 sidecar、状态分发（核心）
    │   │   │   └── upgrade.rs    # 版本迁移
    │   │   ├── commands/         # Tauri Command：暴露给前端
    │   │   ├── sidecar/          # 与 Python sidecar 的 stdio JSON-RPC 客户端
    │   │   ├── ports/            # 端口探测（bind→close→真实占用）
    │   │   └── fs_layout/        # ~/.artifexnexus/ 目录生成、UE copy、Blender copy
    │   └── tauri.conf.json
    ├── src/                      # 前端（React）
    │   ├── routes/
    │   │   ├── setup-wizard.tsx  # 首启 3 屏向导
    │   │   ├── status.tsx        # 日常状态面板
    │   │   └── settings.tsx
    │   └── ...
    └── package.json

packages/adapters/openclaw/
├── wrapper/                      # Python 侧 sidecar 业务逻辑
│   └── src/artifex_nexus/openclaw_wrapper/
│       ├── __init__.py
│       ├── sidecar.py            # JSON-RPC 2.0 over stdio 的 server 入口
│       ├── bootstrap.py          # 首启初始化（目录、config、skill）
│       ├── ports.py              # 端口探测（与 Rust 互为备份）
│       ├── runtime.py            # OpenClaw gateway 子进程入口（spawn 上游 CLI）
│       ├── installer.py          # 调用上游 install-cli.sh / install.ps1（薄壳模式）
│       └── doctor.py             # 健康检查（CLI / 桌面共用）
└── pyproject.toml
```

> ⚠ **历史 vendor/ 子目录已废弃**：本项目采用**薄壳模式**（详见 [[openclaw-upstream-survey]]），
> 不在仓内 fork 或 vendor OpenClaw 源码；ADR 0002 已增补"薄壳决策"小节。

**文件行数上限**：每个 `.rs` / `.py` 文件保持 100–300 行黄金区，超 500 必须拆。

> IPC 边界（前端 ↔ Rust ↔ Python sidecar）单独见 [[openclaw-wrapper-ipc]]。

## 2. 本地开发（不打包）

```bash
# 1. 安装依赖
pnpm install
uv sync --all-packages

# 2. 起壳（dev 模式，前端热更）
pnpm --filter @artifex-nexus/desktop tauri dev

# 3. 壳内按钮会拉起以下 Python 入口：
#    python -m artifex_nexus.openclaw_wrapper.runtime
```

Dev 模式下 `OPENCLAW_HOME` 指向 `./.dev-home/.openclaw/`，不污染真实用户目录。

## 3. 调试子进程

- Rust 端日志：`RUST_LOG=debug pnpm ... tauri dev`
- Python 子进程日志：壳内"Open Log"按钮 → `.dev-home/logs/`
- 端口调试：`artifex doctor --explain-ports`

### 3.1 手动启动 OpenClaw gateway（绕开壳，纯命令行）

DEV 与生产路径布局完全一致（差 `.dev` 后缀），手动起 gateway 用于隔离调试：

```bash
# DEV
export OPENCLAW_HOME="$HOME/.artifexnexus.dev/.openclaw"
export OPENCLAW_STATE_DIR="$OPENCLAW_HOME/state"
export OPENCLAW_CONFIG_PATH="$OPENCLAW_HOME/openclaw.json"
"$OPENCLAW_HOME/cli/v2026.5.4/bin/openclaw" gateway start --port 19789

# 自检
"$OPENCLAW_HOME/cli/v2026.5.4/bin/openclaw" doctor --non-interactive
```

> 首次安装命令：`bash <(curl -fsSL https://openclaw.ai/install-cli.sh) --prefix "$OPENCLAW_HOME/cli/v2026.5.4" --version v2026.5.4 --no-onboard --json`

## 4. 打包

```bash
# Win（在 windows-latest 上）
pnpm --filter @artifex-nexus/desktop tauri build --bundles nsis

# macOS（在 macos-latest 上）
pnpm --filter @artifex-nexus/desktop tauri build --bundles dmg
```

产物：
- Win：`apps/desktop/src-tauri/target/release/bundle/nsis/ArtifexNexus-Setup-x.y.z.exe`
- mac：`apps/desktop/src-tauri/target/release/bundle/dmg/ArtifexNexus-x.y.z.dmg`

## 5. 打包前资源准备（CI 步骤）

1. `scripts/fetch-python.sh {win|mac} 3.11.x` — 下 `python-build-standalone` 到 `apps/desktop/resources/python/`
2. `scripts/fetch-uv.sh {win|mac} <version>` — 下 uv 到 `apps/desktop/resources/uv/`
3. ~~`pnpm --filter @artifex-nexus/openclaw-vendor snapshot`~~ — **薄壳模式已不需要**：OpenClaw
   不入安装包，由首启时调用上游 `install-cli.sh` 在线拉取（详见 [[openclaw-upstream-survey]] §10.3）
4. `pnpm --filter @artifex-nexus/skill-official pack` — 官方 skill 打成 tarball

## 6. CI Matrix

`.github/workflows/release.yml`（新增）：

- `windows-latest` → NSIS
- `macos-latest` → DMG（含 codesign + notarize 步骤，证书走 secrets）
- artifact 上传 Release

## 7. 与现有包的边界

| 归属 | 内容 |
|------|------|
| `apps/desktop/` | Tauri 壳、安装器 UI、进程编排、gateway 子进程托管 |
| `packages/adapters/openclaw/wrapper/` | Python sidecar：bootstrap / installer（薄壳调上游脚本）/ doctor / ports |
| ~~`packages/adapters/openclaw/vendor/`~~ | **已废弃**（薄壳模式不 vendor 源码） |
| `packages/platform/contracts/` | config schema |
| `packages/platform/skill/` | 官方 skill 预装来源 |

**禁止**：`apps/desktop/` 直接 import `packages/dcc/*`；要投放插件一律通过 fs 复制/软链。

## 8. 验收（开发者视角）

- [ ] `tauri dev` 能本地跑通，壳内按钮能拉起 OpenClaw gateway 子进程
- [ ] `pnpm tauri build` 在两个 OS 上都能出包
- [ ] CI 能自动出两个 OS 的安装器 artifact
- [ ] 打包总时长 ≤ 10 分钟（薄壳模式：不含 OpenClaw 拉取，安装包体积 < 100 MB）
- [ ] 手动调试命令（§3.1）可在 dev home 下完整跑通安装 + start + doctor

## 相关

- [[openclaw-wrapper]] · [[openclaw-wrapper-install]] · [[openclaw-wrapper-runtime]] · [[openclaw-wrapper-ipc]]
- [[openclaw-upstream-survey]] — 上游事实底（v2026.5.4 调研）
- [[../tasks/done/TASK-0001-openclaw-wrapper]]
- [[../tasks/done/STORY-0007-openclaw-spec-realign]] — 本 spec 校正来源
