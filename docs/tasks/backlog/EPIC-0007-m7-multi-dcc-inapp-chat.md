---
id: EPIC-0007
kind: epic
title: M7 · 多 DCC 接入（UE 5.7 + Maya + 3ds Max）
status: backlog
priority: P1
owner: "@ivan"
assignee: pair
estimate: 3w
created: 2026-05-04
updated: 2026-05-25
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
tags: [epic, dcc, unreal, maya, 3ds_max, mcp, M7]
---

# M7 · 多 DCC 接入（UE 5.7 + Maya + 3ds Max）

## 背景与目标

把 M2 在 Blender 上跑通的 MCP 链路扩展到 UE 5.7、Maya 和 3ds Max。

> **范围变更 (2026-05-22)**：第一轮仅做 UE 5.7，Chat/Agent/Skill/Tool 管理全部走 Web 端。
> **范围变更 (2026-05-25)**：第二轮新增 Maya 和 3ds Max MCP 集成（共享 SDK 提取 + DCC 插件 + Gateway/Sidecar/前端安装器扩展）。

## 范围 / 非范围

- 范围：UE 5.7 / Maya / 3ds Max MCP 集成（MCP Server + DCC Adapter + 触发器 + 控制面板 + 安装器）
- 非范围：DCC 内 Chat/Agent/Skill/Tool 管理 UI（Web 端）、Houdini、memory_store

## 可分发定义（DoD）

- [ ] 在 UE 5.7 编辑器中，AI Agent 可通过 GateWay MCP 协议调用 `run_python` 操作 UE
- [ ] `mcp_unreal-editor_run_python` 工具注册且正常运行
- [ ] 多 DCC 并存时工具命名空间不冲突（`mcp_unreal-editor_run_python` vs `mcp_blender-editor_run_python`）
- [ ] UE 触发器系统正常工作（保存/删除/导入事件触发 Nexus Tool 检查）
- [ ] 控制面板可启动/停止 MCP Server 和触发器
- [ ] UE 插件通过安装向导安装到 UE 项目

## 关联规格

- [[../../specs/ue57-mcp-integration]] — UE 5.7 详细技术规格
- [[../../specs/maya-max-mcp-integration]] — Maya/3ds Max MCP 集成规格

## 子节点（STORY 列表）

### UE 5.7（STORY-0051 ~ 0058）

- [ ] [[STORY-0051-ue-plugin-scaffold]] — UE 插件脚手架 & C++ 模块搭建
- [ ] [[STORY-0052-ue-blueprint-api-migration]] — C++ Blueprint API 迁移（20+ API 类）
- [ ] [[STORY-0053-ue-editor-subsystem]] — Editor Subsystem 改造
- [ ] [[STORY-0054-ue-control-panel]] — 简单控制面板
- [ ] [[STORY-0055-ue-mcp-server-adapter]] — Python MCP Server & UE Adapter
- [ ] [[STORY-0056-ue-trigger-system]] — 触发器系统
- [ ] [[STORY-0057-ue-gateway-sidecar]] — Gateway & Sidecar 集成
- [ ] [[STORY-0058-ue-bootstrap-autostart]] — UE 启动引导 & 自动启动

### Maya & 3ds Max（STORY-0059 ~ 0066）

- [ ] [[STORY-0059-shared-module-extraction]] — 共享模块提取（BaseAdapter + MCPServer → shared SDK）
- [ ] [[STORY-0060-maya-plugin-scaffold]] — Maya 插件脚手架 & Adapter
- [ ] [[STORY-0061-max-plugin-scaffold]] — 3ds Max 插件脚手架 & Adapter
- [ ] [[STORY-0062-gateway-maya-max-bridge]] — Gateway mcp-bridge 注册 Maya/Max
- [ ] [[STORY-0063-sidecar-maya-max]] — Sidecar dcc_installer + bootstrap 扩展
- [ ] [[STORY-0064-installer-maya-max-ui]] — 前端安装器 Maya/Max 支持
- [ ] [[STORY-0065-blender-adapt-shared]] — Blender 适配共享模块
- [ ] [[STORY-0066-e2e-maya-max-verify]] — 端到端验证

## 进展日志

- 2026-05-04 created
- 2026-05-22 范围调整：第一轮仅做 UE 5.7，移除 in-app Chat。新增 8 个 STORY 子节点。
- 2026-05-25 范围调整：第二轮新增 Maya + 3ds Max MCP 集成。新增 STORY-0059~0066。
