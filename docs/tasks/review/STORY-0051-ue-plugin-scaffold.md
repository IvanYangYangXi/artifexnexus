---
id: STORY-0051
kind: story
title: UE 插件脚手架 & C++ 模块搭建
status: review
priority: P0
owner: "@ivan"
assignee: ai
estimate: 2d
created: 2026-05-22
updated: 2026-05-22
parent: "[[EPIC-0007-m7-multi-dcc-inapp-chat]]"
milestone: M7
related_specs: ["[[../../specs/ue57-mcp-integration]]"]
related_packages: ["packages/dcc/unreal"]
tags: [story, unreal, scaffold]
---

# UE 插件脚手架 & C++ 模块搭建

## 背景与目标

从 artclaw_bridge 的 UEClawBridge 插件复制代码到 `packages/dcc/unreal/`，
完成所有命名空间/文件名/标识符的全局替换（artclaw → artifex nexus），
移除不需要的模块，搭建两个 C++ 模块的基础编译框架。

## 范围 / 非范围

- 范围：复制插件代码、全局重命名、移除 UI 模块、搭建 Build.cs
- 非范围：API 类内部逻辑改动（STORY-0052）、Subsystem 功能改造（STORY-0053）

## 验收标准

- [ ] `ArtifexNexusForUnreal.uplugin` 模块声明正确（2 模块: ArtifexNexus + ArtifexNexusAPI）
- [ ] `ArtifexNexus.Build.cs` 依赖正确（移除 XAtlasLib 引用，添加必要的 Editor 模块依赖）
- [ ] `ArtifexNexusAPI.Build.cs` 依赖完整（覆盖 20+ API 所需全部 UE 子系统）
- [ ] 所有文件名从 UEClawBridge*/UEAgent* 改为 ArtifexNexus*
- [ ] 所有 `#include` 路径更新为新文件名
- [ ] 所有 DLL 导出宏 `UECLAWBRIDGE_API` → `ARTIFEXNEXUS_API`
- [ ] 所有 API 类导出宏 `UECLAWBRIDGEAPI_API` → `ARTIFEXNEXUSAPI_API`
- [ ] 所有日志分类 `LogUEAgent*` → `LogArtifexNexus*`
- [ ] 所有 UFUNCTION Category `ArtClaw|*` → `ArtifexNexus|*`
- [ ] 所有 C++ namespace `ClawJson` → `ArtifexNexusJson`
- [ ] 所有 FName/FString 字面量中 artclaw/claw 字符串替换
- [ ] XAtlasLib 模块目录完全删除
- [ ] UEClawBridge 模块中 UI 相关文件删除（Dashboard/ManagePanel/McpTab/SkillTab/Commands/Style/PlatformBridge）
- [ ] `packages/dcc/unreal/` 下目录结构符合规格文档 §3.2
- [ ] dev junction: `D:\MyProject_D\artifexnexus_packages\ue57_artifex_nexus` → `packages/dcc/unreal/`
- [ ] 废弃文件列表记录到 `packages/dcc/unreal/MIGRATION_LOG.md`

## 设计要点

- 参考 [[../../specs/ue57-mcp-integration]] §2.3 改造映射表
- 参考 [[../../specs/ue57-mcp-integration]] §4.6 命名变更速查表
- 全局替换使用 IDE 批量重构 + 手动检查
- 删除项先记录后删除，便于追溯

## 子任务

- [x] 创建 `MIGRATION_LOG.md` 记录改造日志
- [x] 复制 artclaw 插件到 `packages/dcc/unreal/`
- [x] 目录结构重组（文件移动/重命名）
- [x] 全局文本替换（文件名、代码内字符串）
- [x] 清理删除 UI 相关文件
- [x] 删除 XAtlasLib 模块
- [x] 更新 `.uplugin` 描述符
- [x] 更新 `ArtifexNexus.Build.cs`
- [x] 更新 `ArtifexNexusAPI.Build.cs`（依赖检查）
- [x] 创建 dev junction
- [ ] 验证 UE 项目能加载插件（需 UE 5.7 环境编译验证）

## 进展日志

- 2026-05-22 created
- 2026-05-22 **implement**：复制 UEClawBridge → 删除 XAtlasLib/UI/Python 文件 → 全局重命名 88 文件 → 更新 .uplugin/Build.cs → 创建 junction → MIGRATION_LOG
- 2026-05-22 → review（待 UE 环境编译验证）
