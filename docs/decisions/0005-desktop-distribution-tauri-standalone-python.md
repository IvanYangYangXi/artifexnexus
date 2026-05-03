---
tags: [adr, accepted, desktop, installer]
created: 2026-05-03
status: accepted
---

# ADR 0005 — 桌面分发选型：Tauri + 内置 standalone Python

## Context

Artifex Nexus 的目标用户是美术 / 技术美术 / 设计师，**不能要求他们用命令行**。
我们需要一个"双击即装、零配置可用、与系统已装 OpenClaw 不冲突"的桌面壳。

候选：
- 桌面框架：**Tauri 2** vs Electron
- Python 运行时分发：**内置 standalone Python** vs 复用系统 Python vs 安装时由 uv 拉取

详见 `[[../specs/openclaw-wrapper-install]]` 的对比章节。

## Decision

1. **桌面框架选 Tauri 2**。安装包体积、内存占用、子进程编排能力均优于 Electron；
   与现有 `packages/platform/web-ui` 同栈（前端复用 React/TS）。
2. **Python 运行时采用内置 standalone Python 3.11**：CI 阶段把
   `python-build-standalone` 产物打进 installer，**用户离线可装**。
3. **uv 二进制随安装包内置**：用于首启时 `uv sync` 创建虚拟环境到
   `~/.artifexnexus/.openclaw/venv/`。
4. **Windows 用 NSIS（.exe）**，**macOS 用 DMG**；CI 在 GitHub Actions Matrix 出包。
5. **代码签名分阶段**：M3 内部分发可不签；M5 上线前 Win 走 EV / OV，
   macOS 走 Apple Developer ID + notarize。

## Consequences

**优点**：
- 安装包体积可控：Win ≤ 90 MB，mac ≤ 100 MB（含 standalone Python）。
- 离线环境可装；公司代理 / 白名单网络环境零踩坑。
- 内存常驻显著低于 Electron，对美术机器友好。
- Rust 后端原生处理子进程 / 文件系统投放，端口探测稳定。

**代价**：
- CI 增加 `fetch-python.sh` / `fetch-uv.sh` 步骤；首次配置略复杂。
- Tauri 生态比 Electron 年轻，少数复杂 UI 场景样板要自己写。
- 升级 Python 版本需重打 installer（已写入 `[[../specs/openclaw-wrapper-runtime]]` 升级流程）。

## Alternatives Considered

- **Electron**：被拒，体积 +80–100 MB、内存高，对美术机器不友好。
- **uv 安装时拉 standalone python**：被拒，要求安装时联网，公司网络环境风险大。
- **复用系统 Python**：被拒，版本/环境差异大，"装个 OpenClaw 把我系统 Python 搞挂了"是真实风险。
- **NSIS → MSIX**：暂缓，MSIX 部署门槛对个人用户更高。

## Links

- `[[0002-vendor-openclaw-fork]]`
- `[[../specs/openclaw-wrapper]]`
- `[[../specs/openclaw-wrapper-install]]`
- `[[../specs/openclaw-wrapper-runtime]]`
- `[[../tasks/ready/TASK-0001-openclaw-wrapper]]`
