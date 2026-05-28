---
id: EPIC-0008
kind: epic
title: M8 · ComfyUI MCP + Web UI Workflow 管理
status: planned
priority: P2
owner: "@ivan"
assignee: pair
estimate: 3w
created: 2026-05-04
updated: 2026-05-28
parent: "[[../../vision/roadmap]]"
milestone: M8
related_adr: []
related_specs: []
related_packages:
  - "packages/apps/web"
tags: [epic, comfyui, workflow, M8, planned]
---

# M8 · ComfyUI MCP + Web UI Workflow 管理 📋 PLANNED

## 背景与目标

将 ComfyUI 以 MCP 身份接入；Web UI 提供 workflow 的导入 / 编辑 / 调度 / 执行视图。

## 当前状态

- ✅ **14 个 ComfyUI Skills 已创建**：txt2img / img2img / inpainting / controlnet / hires-fix / workflow-builder / workflow-manager / workflow-repair / workflow-validator / model-manager / node-installer / civitai / operation-rules / context
- ❌ **ComfyUI MCP Server 未开发**
- ❌ **Workflow 管理 UI 未开发**
- ❌ **Gateway MCP Bridge 未配置 ComfyUI 端口**

## 范围 / 非范围

- 范围：ComfyUI MCP 适配 + Web UI workflow 管理页
- 非范围：自研 workflow 引擎（直接复用 ComfyUI）

## UI 先行产物

- [ ] `docs/specs/ui/workflow-manager-structure.md`

## 可分发定义（DoD）

- [ ] 用户在 Web UI 导入一个 ComfyUI workflow，并能一键跑通
- [ ] 结果可在 UI 查看 / 下载

## 子节点（STORY 列表）

- [ ] 待 align 展开

## 进展日志

- 2026-05-28 **状态更新**：14 个 ComfyUI Skills 已创建（含完整 workflow 操作链），待 MCP 接入和 UI 开发
- 2026-05-04 created
