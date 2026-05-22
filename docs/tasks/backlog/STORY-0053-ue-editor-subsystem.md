---
id: STORY-0053
kind: story
title: Editor Subsystem 改造
status: backlog
priority: P0
owner: "@ivan"
assignee: ai
estimate: 1.5d
created: 2026-05-22
updated: 2026-05-22
parent: "[[EPIC-0007-m7-multi-dcc-inapp-chat]]"
milestone: M7
related_specs: ["[[../../specs/ue57-mcp-integration]]"]
related_packages: ["packages/dcc/unreal"]
tags: [story, unreal, subsystem, events]
---

# Editor Subsystem 改造

## 背景与目标

将 UUEAgentSubsystem 改造为 UArtifexNexusSubsystem。
保留 DCC 事件钩子、保存拦截、MCP 控制接口；
移除 artclaw 特有的 Tool Manager 自动启动、活跃面板追踪、Chat 相关状态。

## 范围 / 非范围

- 范围：类重命名、DCC 事件保留、保存拦截改造、MCP 控制接口
- 非范围：Subsystem 功能扩展、新增事件类型

## 验收标准

- [ ] 类名 `UUEAgentSubsystem` → `UArtifexNexusSubsystem`
- [ ] 枚举 `EUEAgentActivePanel` → `EArtifexNexusActivePanel`
- [ ] 全部委托 `FOnAgent*` → `FOnArtifexNexus*`
- [ ] 日志分类 `LogUEAgent*` → `LogArtifexNexus*`
- [ ] **保留** 全部 DCC 事件委托（OnAssetPreSave/OnAssetPostSave/OnAssetImported/OnAssetPreDelete/OnAssetPostDelete/OnLevelPreSave/OnLevelPostSave/OnLevelLoaded/OnEditorStartup）
- [ ] **保留** IsPackageOKToSave 保存拦截机制（含 HookIsPackageOKToSave/UnhookIsPackageOKToSave）
- [ ] **保留** FlushPendingNotify（读取 Python pending 文件弹气泡）
- [ ] **保留** SetServerPort/GetServerAddress/GetClientCount MCP 控制接口
- [ ] **保留** SetConnectionStatus/GetConnectionStatus/OnConnectionStatusChanged
- [ ] **移除** AutoLaunchToolManager（Tool Manager 不存在于 Artifex）
- [ ] **移除** SetupSelectionTracking / CleanupSelectionTracking（无 UE 内 Chat UI, 不需要活跃面板追踪）
- [ ] **移除** SaveInterceptSilentPass 相关成员和方法（简化触发器配置）
- [ ] **保留** ActorsDropped/ActorsPlaced delegate 处理（供触发器使用）
- [ ] `ArtifexNexusSubsystem.cpp` 中 `#include` 路径更新
- [ ] `ArtifexNexus.Build.cs` 依赖正确（EditorSubsystem, UnrealEd, AssetRegistry 等）

## 设计要点

- 参考 [[../../specs/ue57-mcp-integration]] §4.1 改造对照表
- 保存拦截逻辑转换: Python 调用路径 `dcc_event_intercept.check_pre_save()` 保持不变
- 日志路径 `~/.artclaw/_pending_notify.json` → `~/.artifexnexus/run/_pending_notify.json`

## 子任务

- [ ] 头文件重命名（类名/枚举/委托/日志分类）
- [ ] Initialize/Deinitialize 清理（移除 Tool Manager + SelectionTracking）
- [ ] 保留 DCC 事件钩子所有代码
- [ ] 保存拦截代码保留 + 路径更新
- [ ] MCP 控制接口保留
- [ ] .cpp 实现重命名 + #include 更新
- [ ] 编译验证

## 进展日志

- 2026-05-22 created
