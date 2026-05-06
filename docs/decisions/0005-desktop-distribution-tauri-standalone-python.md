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
- `[[../specs/openclaw-upstream-survey]]`
- `[[../tasks/done/TASK-0001-openclaw-wrapper]]`
- `[[../tasks/review/STORY-0007-openclaw-spec-realign]]`

---

## 补充（2026-05-06，EPIC-0001 align）：Node runtime 共存 + M1 不注册系统服务

### 背景

EPIC-0001（M1）align 阶段实测确认 OpenClaw 上游为 **Node.js / TypeScript 项目**（pnpm
monorepo），与本 ADR 原文中"Python runtime 即可拉起 OpenClaw"的隐含假设不符。详见
`[[../specs/openclaw-upstream-survey]]`。本小节补充两项决策，**不撤销原决策 1–5**。

### 补充决策

**6. 双 runtime 共存**：

| Runtime | 来源 | 服务对象 | 体积 |
|---|---|---|---|
| standalone Python 3.11 | python-build-standalone（已决策 #2） | wrapper sidecar（stdio JSON-RPC server） | 25–40 MB |
| standalone Node 22.22.0 | 上游 `install-cli.sh` 自带（首启在线拉） | OpenClaw gateway 主进程 | ~80 MB |

二者**完全解耦**：sidecar 不 import OpenClaw 任何模块，仅通过子进程 spawn + HTTP/WS 调用
gateway。Python runtime 仍内置在 installer 包中（保持原"离线可装壳"承诺），Node runtime 由
`install-cli.sh` 在首启时拉取（不入 installer 包，控制 installer ≤ 100 MB）。

**7. M1 不注册系统级服务**：

不调用上游 `openclaw gateway install`（systemd / launchd / schtasks）；改由 Tauri 主进程
直接 spawn `<cli>/bin/openclaw gateway start --port 19789` 子进程托管，应用退出即停。

理由：
- 彻底回避与"用户已经装了原生 OpenClaw"的 service 名冲突（上游 service 名硬编码为
  `openclaw-gateway.service`）
- 符合 ADR 0005 原文"Rust 后端原生处理子进程编排"的架构主轴
- M1 范围最小（无需处理 UAC / sudo / 卸载残留 service unit）
- 不影响最终用户体验：Artifex Nexus 桌面壳本身就是常驻应用，gateway 跟壳同生命周期

代价：
- 用户关掉 Artifex Nexus 桌面 → gateway 也停 → DCC 内 MCP 连接断开。但这是符合用户心智的
  （"我没开 Artifex Nexus，AI 当然不在")
- 后续若需要"无壳常驻"模式，可在 M2+ 增量决策（候选 STORY S7 已留接口）

### 与原决策的关系

- 原决策 #2 #3（standalone Python + uv）保留：服务对象由"拉 OpenClaw"收敛为"跑 wrapper sidecar"
- 原决策 #1 #4 #5（Tauri / NSIS+DMG / 签名分阶段）完全不变
- 历史 vendor 子目录（`packages/adapters/openclaw/vendor/`）废弃，ADR 0002 同步增补"薄壳决策"小节
