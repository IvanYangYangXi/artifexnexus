---
tags: [vision, non-goals]
created: 2026-05-28
status: draft
---

# 非目标（Non-Goals）

> 明确 Artifex Nexus **不做**什么，以避免范围蔓延和资源浪费。

## 1. OpenClaw 替代

Artifex Nexus 不做 OpenClaw 上游的功能替代。OpenClaw 是独立项目，本项目只做分发壳与隔离运行时（薄壳模式）。不嵌 OpenClaw 源码、不 fork、不 vendor。

## 2. 通用 AI Agent 平台

不做通用 AI Agent 平台（如 Dify / Coze / LangChain 等）。Artifex Nexus 聚焦 **DCC 工作流 + 数字内容创作** 垂直场景，不面向通用聊天/办公/RAG。

## 3. 多实例并发管理

不做多个 OpenClaw 实例的并发管理。单实例运行，多进程由外部（用户/系统管理员）自行管理。

## 4. 自动同步外部配置

不自动同步或导入外部 `~/.openclaw/` 的 Skill / 配置。遵循 ADR 0002 隔离原则，Artifex Nexus 仅管理 `~/.artifexnexus/` 命名空间。

## 5. 云端服务 / SaaS

Artifex Nexus 是本地桌面应用（Tauri），不做：
- 云端 API 代理
- 用户数据上云
- 模型托管服务
- 多用户协作 / 团队版

## 6. 移动端 / Web 端独立运行

Web UI 是桌面壳内嵌页面，仅供桌面端使用。不做独立部署的 Web 服务或移动 App。

## 7. DCC 插件之外的集成

仅支持 DCC（Blender / Maya / Max / UE）插件安装。不做：
- IDE 插件（VS Code / JetBrains）
- 通用自动化（CI/CD / 脚本调度）
- 第三方软件集成（Photoshop / Houdini 等）

## 8. 非 Windows/macOS 平台

M1-M5 仅支持 Windows 10/11 和 macOS 12+。不做 Linux 桌面发行版（可通过绿色包/手动方式自行运行，但不官方支持）。

## 相关

- [[north-star]] — 北极星愿景
- [[roadmap]] — 路线图
- [[../decisions/0002-vendor-openclaw-fork]] — ADR 0002 隔离原则
