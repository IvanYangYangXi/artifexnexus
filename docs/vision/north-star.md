---
tags: [vision, north-star]
created: 2026-05-02
updated: 2026-05-28
status: accepted
---

# Artifex Nexus 北极星 / North Star

> **Artifex Nexus — The AI-Agent Bridge for Digital Creation**
>
> Artifex（工匠）+ Nexus（连接）。为数字创作者把 AI Agent 接进创作软件的桥。

## 起源

本项目是 [`artclaw_bridge`](https://github.com/IvanYangYangXi/artclaw_bridge) 的重构 fork。
artclaw_bridge 在历史演进中暴露了三个根因痛点：

1. 跟随 OpenClaw 上游频繁 break，稳定性受制于人；
2. 上下游适配面铺得太广，文档/代码漂移、SDK 边界模糊；
3. 安装链路散落，新用户上手成本高。

Artifex Nexus 通过**收敛范围 + 锁定上游 + 文档驱动**重新出发。

## 五大目标

### 1. 品牌与定位

- 项目名 **Artifex Nexus**，全称 *Artifex Nexus: The AI-Agent Bridge for Digital Creation*。
- 中文名「山雀」。
- DCC 插件统一以品牌前缀命名：`Artifex Nexus for Unreal` / `Artifex Nexus for Blender` / `Artifex Nexus for Maya` / `Artifex Nexus for 3ds Max`。

### 2. 重构与标准化

- 优化文档结构与文档内容，建立**单一信息源**（`docs/specs/`）。
- 建立标准 SDK / API：四层契约（共享核心 / 平台适配器 / DCC 适配 / Skill SDK），每层一份 spec、一份 ABC、一份 schema。
- 优化代码结构、建立代码规范、提升稳定性与可维护性。
- **共享 SDK**：所有 DCC 复用 `packages/dcc/shared/artifex_nexus_sdk/`（BaseDCCAdapter/MCPServer/SkillHub/SkillManifest/装饰器/事件系统）。

### 3. 收敛范围

- **AI 平台**：**只支持 OpenClaw 一个平台**（见 [[../decisions/0006-scope-converge-to-openclaw]]）。
  `openclaw` 是一等公民，不为虚构的"未来其他平台"保留抽象层。
- **DCC**：首发 **Unreal Engine 5.7** 与 **Blender 5.1**。已扩展 **Maya 2023+、3ds Max 2024+** 插件支持。
  通过 Skill 体系已覆盖 **ComfyUI、Houdini、Substance Painter、Substance Designer、Unity** 的 AI 操作。
  其他 DCC 留接口，按需新增 `packages/dcc/<name>/`。

### 4. 稳定性与分发

- fork OpenClaw 到 Artifex Nexus 组织，长期分支 `artifex-nexus/v0.x`，**锁定固定版本**（当前 `v2026.5.4`）。
- vendor 进 `vendor/openclaw/`，安装时整体部署到 `~/.artifexnexus/.openclaw/`，**与 Artifex Nexus 自身隔离**。
- 默认数据目录从 `~/.openclaw/` 改为 `~/.artifexnexus/`。
- 安装支持双模式：`--link`（开发期，源码可热更新）与 `--copy`（发布期，独立稳定）。

### 5. 入口与体验

- 把原 tool-manager 升级为 **Artifex Nexus Web UI**（`packages/apps/web`），作为平台标准入口。
- Web UI 已实现：四面板 App Shell（Chat / Skills / Tools / System / Calendar / Settings），内嵌于 Tauri 桌面应用。
- Web UI 同时承担 **Skill / Tool / Workflow 管理台**职责。

## DCC 与软件覆盖

| 软件 | 插件 | Skills | MCP 端口 | 状态 |
|------|------|--------|----------|------|
| Unreal Engine 5.7 | ✅ C++ + Python | 18 个 | 18080 | ✅ 完整 |
| Blender 5.1 | ✅ Python addon | 5 个 | 18083 | ✅ 完整 |
| Maya 2023+ | ✅ Python 插件 | 1 个 | 18081 | 🔄 骨架完成 |
| 3ds Max 2024+ | ✅ Python 插件 | 1 个 | 18082 | 🔄 骨架完成 |
| ComfyUI | ❌ 待开发 | 14 个 | — | 📋 Skills 就绪 |
| Substance Designer | ❌ 待开发 | 9 个 | — | 📋 Skills 就绪 |
| Substance Painter | ❌ 待开发 | 4 个 | — | 📋 Skills 就绪 |
| Houdini | ❌ 待开发 | 4 个 | — | 📋 Skills 就绪 |
| Unity | ❌ 待开发 | 5 个 | — | 📋 Skills 就绪 |

## 非目标 / Non-Goals

- **不做多 AI 平台支持**（只支持 OpenClaw，详见 [[../decisions/0006-scope-converge-to-openclaw]]）。
- ~~不再维护 Maya / 3ds Max / Unity / Houdini / Substance 等 DCC~~ **（已调整）**：Maya 和 3ds Max 插件已由团队开发，其余 DCC 通过 Skill 体系渐次覆盖。
- 不做云托管的 Skill 市场（远期，先打稳本地体系）。

## 成功指标

| 指标 | 目标 | 当前状态 |
|------|------|---------|
| 从下载到第一次 AI 操作 | < 10 分钟 | 🔄 安装向导可用，仍需优化 |
| 新增 Skill 全流程 | < 30 分钟 | ✅ Skill 体系完整 |
| 核心 bug 数量下降 | > 70% | 🔄 持续优化中 |
| 支持 DCC 数量 | 4+ | ✅ UE/Blender/Maya/Max |

## 相关

- `[[../specs/系统架构设计]]`
- `[[../decisions/0001-monorepo-layout]]`
- `[[../decisions/0002-vendor-openclaw-fork]]`
- `[[../decisions/0003-mcp-tools-minimization]]`
- `[[../decisions/0006-scope-converge-to-openclaw]]`
