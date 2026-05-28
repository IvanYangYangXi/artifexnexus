---
id: EPIC-0007
kind: epic
title: M7 · 多 DCC 接入（UE 5.7 + Maya + 3ds Max）
status: in-progress
priority: P1
owner: "@ivan"
assignee: pair
estimate: 3w
created: 2026-05-04
updated: 2026-05-28
parent: "[[../../vision/roadmap]]"
milestone: M7
related_adr: [0006]
related_specs:
  - "[[../../specs/系统架构设计]]"
  - "[[../../specs/ue57-mcp-integration]]"
  - "[[../../specs/maya-max-mcp-integration]]"
related_packages:
  - "packages/dcc/unreal"
  - "packages/dcc/maya"
  - "packages/dcc/max"
  - "packages/dcc/shared"
  - "packages/adapters/openclaw"
tags: [epic, dcc, unreal, maya, 3ds_max, mcp, M7, in-progress]
---

# M7 · 多 DCC 接入（UE 5.7 + Maya + 3ds Max）🔄 IN PROGRESS

## 背景与目标

把 M2 在 Blender 上跑通的 MCP 链路扩展到 UE 5.7、Maya 和 3ds Max。

> **范围变更 (2026-05-22)**：第一轮仅做 UE 5.7，Chat/Agent/Skill/Tool 管理全部走 Web 端。
> **范围变更 (2026-05-25)**：第二轮新增 Maya 和 3ds Max MCP 集成（共享 SDK 提取 + DCC 插件 + Gateway/Sidecar/前端安装器扩展）。

## 当前进度概览

| 领域 | 进度 | 说明 |
|------|------|------|
| UE 5.7 C++ 插件 | 🔄 进行中 | Blueprint API 迁移、Editor Subsystem、Control Panel、Trigger System |
| UE 5.7 Python | 🔄 进行中 | MCP Server、UE Adapter、Skill Hub（复用 shared SDK） |
| Maya 插件 | ✅ 骨架完成 | adapter / UI / MCP Server / trigger_dispatcher |
| 3ds Max 插件 | ✅ 骨架完成 | adapter / UI / MCP Server / trigger_dispatcher / startup |
| 共享 SDK | ✅ 完成 | `packages/dcc/shared/artifex_nexus_sdk/`（BaseDCCAdapter/MCPServer/SkillHub/装饰器） |
| Gateway MCP Bridge | ✅ 完成 | 已预配置 Maya(18081)/Max(18082) 端口 + 工具前缀 |
| Sidecar 安装器 | ✅ 完成 | dcc_installer.py 支持 Maya/Max |
| 前端安装 UI | ✅ 完成 | 安装向导已支持 Maya/Max 子项 |
| Blender 适配共享 | 🔄 进行中 | 迁移到共享 SDK 模块 |
| E2E 验证 | 📋 待推进 | Maya/Max 端到端验证 |
| 内嵌 Chat 面板 | 📋 待推进 | DCC 软件内 AI 对话面板 |

## 范围 / 非范围

- 范围：UE 5.7 / Maya / 3ds Max MCP 集成（MCP Server + DCC Adapter + 触发器 + 控制面板 + 安装器）
- 非范围：DCC 内 Chat/Agent/Skill/Tool 管理 UI（Web 端）、Houdini、memory_store

## 可分发定义（DoD）

- [ ] 在 UE 5.7 编辑器中，AI Agent 可通过 GateWay MCP 协议调用 `run_python` 操作 UE
- [x] `mcp_unreal-editor_run_python` + `mcp_maya-primary_run_python` + `mcp_max-primary_run_python` 工具预注册
- [x] 多 DCC 并存时工具命名空间不冲突
- [ ] UE 触发器系统正常工作（保存/删除/导入事件触发 Nexus Tool 检查）
- [ ] 控制面板可启动/停止 MCP Server 和触发器
- [x] UE 插件通过安装向导安装到 UE 项目
- [x] Maya/Max 插件骨架可部署

## 子节点（STORY 列表）

### UE 5.7（STORY-0051 ~ 0058）

| # | STORY | 状态 |
|---|-------|------|
| S51 | STORY-0051 — UE 插件脚手架 & C++ 模块搭建 | ✅ done |
| S52 | STORY-0052 — C++ Blueprint API 迁移（20+ API 类） | 🔄 backlog |
| S53 | STORY-0053 — Editor Subsystem 改造 | 🔄 backlog |
| S54 | STORY-0054 — 简单控制面板 | 🔄 backlog |
| S55 | STORY-0055 — Python MCP Server & UE Adapter | 🔄 backlog |
| S56 | STORY-0056 — 触发器系统 | 🔄 backlog |
| S57 | STORY-0057 — Gateway & Sidecar 集成 | 🔄 backlog |
| S58 | STORY-0058 — UE 启动引导 & 自动启动 | 🔄 backlog |

### Maya & 3ds Max（STORY-0059 ~ 0066）

| # | STORY | 状态 |
|---|-------|------|
| S59 | STORY-0059 — 共享模块提取 | ✅ done |
| S60 | STORY-0060 — Maya 插件脚手架 | ✅ done |
| S61 | STORY-0061 — 3ds Max 插件脚手架 | ✅ done |
| S62 | STORY-0062 — Gateway mcp-bridge 注册 Maya/Max | ✅ done |
| S63 | STORY-0063 — Sidecar dcc_installer + bootstrap 扩展 | ✅ done |
| S64 | STORY-0064 — 前端安装器 Maya/Max 支持 | ✅ done |
| S65 | STORY-0065 — Blender 适配共享模块 | 🔄 review |
| S66 | STORY-0066 — 端到端验证 | 📋 backlog |

## 进展日志

- 2026-05-28 **状态更新**：对照代码确认，Maya/Max 插件骨架 + Gateway Bridge + Sidecar 安装器 + 前端 UI 全部完成；UE 增强进行中
- 2026-05-25 范围调整：第二轮新增 Maya + 3ds Max MCP 集成。新增 STORY-0059~0066
- 2026-05-22 范围调整：第一轮仅做 UE 5.7，移除 in-app Chat。新增 8 个 STORY 子节点
- 2026-05-04 created
