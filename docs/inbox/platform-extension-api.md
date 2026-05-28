---
tags: [inbox, epic, platform, dcc, api]
created: 2026-05-28
updated: 2026-05-28
status: draft
priority: P2
---

> **优先级调整**（2026-05-28）：DCC 平台化 API 排在最后（先做数据视图 + Workflow）。

# 目标1：平台化扩展 — 开放 DCC 软件接入 API

> 让任意软件通过 Chat + AI 引导即可接入 Artifex Nexus，无需手工写插件代码。

## 背景

当前 DCC 接入（UE/Blender/Maya/Max）需要人工编写 Gateway 插件、MCP Server、连接状态标识等，流程封闭。
目标是像 Tool 气泡弹窗安装逻辑一样，开放全套 API，让用户通过与 AI 聊天即可完成新软件的接入。

## 核心需求

### 需要开放 API 的模块

| 模块 | 当前状态 | 需要 API 化 |
|------|---------|------------|
| Gateway 插件注册 | 手工编写 `openclaw.json` plugins | 开放 `plugins register` API |
| MCP Server 启动 | 每个 DCC 独立脚本启动 | 统一 `mcp.start(config)` API |
| 右上角连接状态标识 | 硬编码 DCC 类型 | 动态注册 `ConnectionIndicator` |
| DCC 软件枚举 | `contracts/data/categories.json` 静态定义 | 动态注册枚举 + 版本检测规则 |
| 安装检测 | 固定 `find_dcc_versions()` | 插件化检测器 API |
| Skills 目录 | 按 DCC 分目录 | 自动创建 + 模板注入 |
| 端口分配 | 固定 18080-18083 | 动态端口管理 |

### 用户交互流程

```
用户: "帮我接入 Rhinoceros 3D"
AI:   → 检测 Rhino 安装路径
      → 注册新 DCC 到枚举
      → 生成 MCP Server 骨架
      → 注册 Gateway Plugin
      → 分配端口
      → 添加右上角连接图标
      → 生成基础 Skill 模板
      → 用户确认后一键部署
```

### 指引 Skill

在 Skill 体系中新增 `dcc-platform-integration` 指引 Skill，包含：
- DCC 接入规范文档
- API 接口清单
- 最小接入示例（Hello World DCC）
- 端口管理策略
- 安全沙箱规则

## 非目标

- 不自动生成复杂 Skill 逻辑（只生成骨架模板）
- 不替代 DCC 原生的 Python API 封装
- 不负责 DCC 软件本身的安装分发

## 相关文档

- `docs/specs/dcc-plugin-management.md`
- `docs/sdk/dcc-installer.md`
- `docs/sdk/dcc-registry.md`
