---
id: STORY-0052
kind: story
title: C++ Blueprint API 迁移
status: backlog
priority: P0
owner: "@ivan"
assignee: ai
estimate: 3d
created: 2026-05-22
updated: 2026-05-22
parent: "[[EPIC-0007-m7-multi-dcc-inapp-chat]]"
milestone: M7
related_specs: ["[[../../specs/ue57-mcp-integration]]"]
related_packages: ["packages/dcc/unreal"]
tags: [story, unreal, api, blueprint]
---

# C++ Blueprint API 迁移

## 背景与目标

将 UEClawBridgeAPI 模块全部 20+ API 类重命名为 ArtifexNexusAPI，
所有类名、函数名、宏、注释中的 artclaw/claw 引用替换为 artifex nexus。
保留所有 BlueprintCallable / BlueprintPure 函数签名不变，
确保 AI Agent 可通过 `run_python` 调用 `unreal.ArtifexNexusActorOpsAPI.spawn_actor()` 等。

## 范围 / 非范围

- 范围：全部 API 类重命名、Category 改名、注释更新
- 非范围：API 逻辑修改、新增/删除 API 函数

## 验收标准

- [ ] 全部 20+ API 头文件类名改为 `UArtifexNexus*API`（例如 `UActorOpsAPI` → `UArtifexNexusActorOpsAPI`）
- [ ] 全部 UFUNCTION Category 从 `ArtClaw|*` 改为 `ArtifexNexus|*`（例如 `ArtClaw|Actor` → `ArtifexNexus|Actor`）
- [ ] 全部 `#include` 路径更新
- [ ] 全部工具类重命名（FAssetModifier → FArtifexNexusAssetModifier 等）
- [ ] 全部 Utils 类重命名（ClawJson::MakeError → ArtifexNexusJson::MakeError）
- [ ] 全部 .cpp 实现文件中类名/函数名/注释更新
- [ ] `ArtifexNexusAPI.Build.cs` 无编译错误
- [ ] 所有 `bUseUnity = false` 保留（各 .cpp 有同名匿名命名空间函数）
- [ ] 条件编译宏保持（WITH_NIAGARA, WITH_GAMEPLAY_ABILITIES 等）

## 设计要点

- 命名规范：`ArtifexNexus` + 原功能名（去掉 Claw 前缀）
- 完整 API 类清单（按子模块分组）：

| 原类名 | 新类名 |
|--------|--------|
| **Actor** | |
| UActorOpsAPI | UArtifexNexusActorOpsAPI |
| UActorReflectionAPI | UArtifexNexusActorReflectionAPI |
| **Asset** | |
| UAssetManagementAPI | UArtifexNexusAssetManagementAPI |
| UAssetQueryAPI | UArtifexNexusAssetQueryAPI |
| **AI** | |
| UBehaviorTreeAPI | UArtifexNexusBehaviorTreeAPI |
| **Build** | |
| UBuildSystemAPI | UArtifexNexusBuildSystemAPI |
| **DataTable** | |
| UDataTableAPI | UArtifexNexusDataTableAPI |
| **Input** | |
| UEnhancedInputAPI | UArtifexNexusEnhancedInputAPI |
| UInputInjectionAPI | UArtifexNexusInputInjectionAPI |
| **GAS** | |
| UGameplayAbilityAPI | UArtifexNexusGameplayAbilityAPI |
| **Logging** | |
| ULoggingAPI | UArtifexNexusLoggingAPI |
| **Mesh** | |
| UMeshAnalysisAPI | UArtifexNexusMeshAnalysisAPI |
| UMeshUVOpsAPI | UArtifexNexusMeshUVOpsAPI |
| **Niagara** | |
| UNiagaraAPI | UArtifexNexusNiagaraAPI |
| **PIE** | |
| UPIEControlAPI | UArtifexNexusPIEControlAPI |
| **Performance** | |
| UPerformanceAPI | UArtifexNexusPerformanceAPI |
| **Project** | |
| UProjectInfoAPI | UArtifexNexusProjectInfoAPI |
| **Sequencer** | |
| USequencerAPI | UArtifexNexusSequencerAPI |
| **StateTree** | |
| UStateTreeAPI | UArtifexNexusStateTreeAPI |
| **Widget** | |
| UWidgetBlueprintAPI | UArtifexNexusWidgetBlueprintAPI |
| **Blueprint Graph** | |
| UBlueprintGraphQuery → UArtifexNexusBlueprintGraphQuery |
| UBlueprintGraphEdit → UArtifexNexusBlueprintGraphEdit |
| UBlueprintGraphConnect → UArtifexNexusBlueprintGraphConnect |
| UBlueprintNodeProperty → UArtifexNexusBlueprintNodeProperty |
| UAnimBlueprintQuery → UArtifexNexusAnimBlueprintQuery |
| **Utils** | |
| FAssetModifier → FArtifexNexusAssetModifier |
| FGraphLayoutUtil → FArtifexNexusGraphLayoutUtil |
| FPropertySerializer → FArtifexNexusPropertySerializer |
| ClawJson → ArtifexNexusJson |
| namespace ClawXAtlas → (注意：XAtlasLib 已删除，API 中无此依赖) |

## 子任务

- [ ] API 模块入口文件 `ArtifexNexusAPI.h/.cpp` 重命名
- [ ] Actor 组 API 重命名（2 类）
- [ ] Asset 组 API 重命名（2 类）
- [ ] AI 组 API 重命名（1 类）
- [ ] Build + DataTable 组（2 类）
- [ ] Input 组 + GAS 组（3 类）
- [ ] Logging + Mesh + Niagara（3 类）
- [ ] PIE + Performance + ProjectInfo（3 类）
- [ ] Sequencer + StateTree + Widget（3 类）
- [ ] Blueprint 子模块重命名（5 类）
- [ ] Utils 工具类重命名（4 类）
- [ ] 编译验证

## 进展日志

- 2026-05-22 created
