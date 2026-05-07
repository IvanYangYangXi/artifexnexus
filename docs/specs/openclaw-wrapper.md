---
tags: [spec, openclaw, installer, architecture]
created: 2026-05-03
status: draft
---

# OpenClaw Wrapper — 总览

> Artifex Nexus 对 OpenClaw 的"**包壳**"：把 OpenClaw 作为内嵌组件，面向最终用户（美术/设计师）提供**双击安装 / 零冲突 / 自动初始化**的体验。开发者视角见 [[openclaw-wrapper-dev]]。

## 1. 范围

本组文档（按模块拆分）：

- **本文（overview）** — 目标、非目标、总体方案
- [[openclaw-wrapper-install]] — 安装器设计（Tauri / 打包 / 投放）
- [[openclaw-wrapper-runtime]] — 运行时设计（进程、端口、配置、隔离）
- [[openclaw-wrapper-ipc]] — 三层 IPC 边界（前端 ↔ Rust ↔ Python sidecar）
- [[openclaw-wrapper-dev]] — 开发者视角（仓内结构、调试、构建）

## 2. 用户故事

> "我是一位 UE 技术美术。我从 artifex-nexus.com 下载了 `ArtifexNexus-Setup.exe`，双击。
> 三分钟后桌面多了一个图标，打开它，里面 OpenClaw 已经跑起来了，UE 插件已经装好，
> 我在 UE 里点一下就连上了 AI Agent。我既不知道 Python 是什么，也没改过任何端口。
> 而我之前自己装的一份 OpenClaw 还在正常跑，两者井水不犯河水。"

## 3. 目标

1. **一键分发**：Win 双击 `.exe`，macOS 双击 `.dmg`，离线可装。
2. **零端口冲突**：默认 19789，冲突时自动探测并写回配置。
3. **零全局 Python 依赖**：内置 standalone Python，不污染系统。
4. **与外部 OpenClaw 完全隔离**：只读写 `~/.artifexnexus/.openclaw/`。
5. **自动初始化**：首启自动生成配置、安装官方 Skill、探测 DCC、投放 DCC 插件。
6. **可卸载**：标准卸载器 + `~/.artifexnexus/` 保留（除非用户勾选清空）。

## 4. 非目标

- 不做 OpenClaw 上游的功能替代；只做分发壳与隔离运行时。
- 不做多 OpenClaw 实例并发管理（单实例，多进程由外部自己管）。
- 不做自动同步外部 `~/.openclaw/` 的 Skill / 配置（见 ADR 0002 隔离原则）。

## 5. 参考

竞品体验：qclaw、Lobster AI 的"一键装 + 零配置"路径。

## 6. 技术总览

| 层 | 选型 | 依据 |
|----|------|------|
| 桌面壳 | **Tauri 2** | 包体小、内存低、与 web-ui 同栈 |
| 前端 UI | React + 现有 `packages/platform/web-ui` 共享组件 | 复用 |
| 壳内后端 | Rust（Tauri Command） | 负责进程编排、端口探测、文件投放 |
| Python 运行时 | 内置 `python-build-standalone` 3.11 | 离线可装，不污染系统 |
| 包管理 | `uv`（随安装器打包） | 已在用 |
| OpenClaw 源 | 薄壳模式：调用上游 install-cli.sh / install.ps1，安装到隔离 prefix | ADR 0002（已增补薄壳决策） |
| 配置中心 | `~/.artifexnexus/config/artifexnexus.json` | 见 contracts schema |

## 7. 里程碑

| M | 交付 | 验证 |
|---|------|------|
| M1 | 本组文档定稿 | 评审通过 |
| M2 | Tauri 壳能拉起内嵌 OpenClaw（dev 模式） | 端口探测 + 状态面板 |
| M3 | Win `.exe` / macOS `.dmg` 首个内部版 | 双击装 / 卸载干净 |
| M4 | DCC 插件自动投放（UE copy / Blender symlink） | UE 5.7 + Blender 5.1 验证 |
| M5 | 官方 Skill 预装 + 首启向导 | 新机零配置可用 |

## 相关

- ADR [[../decisions/0002-vendor-openclaw-fork]]
- ADR [[../decisions/0005-desktop-distribution-tauri-standalone-python]]
- 配置 schema：`packages/platform/contracts/schemas/config.schema.json`
- 任务卡 [[../tasks/ready/TASK-0001-openclaw-wrapper]]
