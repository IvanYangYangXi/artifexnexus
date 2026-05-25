---
id: STORY-0056
kind: story
title: UE 触发器系统
status: backlog
priority: P0
owner: "@ivan"
assignee: ai
estimate: 2d
created: 2026-05-22
updated: 2026-05-22
parent: "[[EPIC-0007-m7-multi-dcc-inapp-chat]]"
milestone: M7
related_specs: ["[[../../specs/ue57-mcp-integration]]", "[[../../specs/dcc-extension-trigger-system]]"]
related_packages: ["packages/dcc/unreal"]
tags: [story, unreal, trigger, events]
---

# UE 触发器系统

## 背景与目标

复刻 artclaw 的 DCC 事件触发器系统，适配 Artifex Nexus 架构。
支持双模式：UE 本地触发器（类似 Blender trigger_dispatcher）+ Sidecar 触发器（通过 MCP broadcast）。

## 范围 / 非范围

- 范围：dcc_event_intercept.py 改造、trigger_dispatcher.py 实现、C++ → Python 事件转发、双模式触发
- 非范围：Tool Manager HTTP 转发（删除）、triggers.json 配置 UI（Web 端管理）

## 验收标准

### dcc_event_intercept.py 改造

- [ ] 所有路径 `~/.artclaw/` → `~/.artifexnexus/`
- [ ] `triggers.json` 读取路径改为 `~/.artifexnexus/config/triggers.json`
- [ ] `tool-sources.json` 读取路径改为 `~/.artifexnexus/config/tool-sources.json`
- [ ] pending 通知文件路径改为 `~/.artifexnexus/run/_pending_notify.json`
- [ ] 日志/警告消息中 "ArtClaw" → "Artifex Nexus"
- [ ] SDK 路径适配 Artifex 结构（`artclaw_sdk` → `artifex_nexus_sdk`）
- [ ] `check_pre_save(asset_path, ...)` 函数签名不变
- [ ] `check_pre_delete(asset_paths)` 函数签名不变
- [ ] `handle_post_save/handle_post_delete/handle_actor_placed/handle_post_import` 函数签名不变
- [ ] `_notify_ue` 中的对话框标题 "ArtClaw" → "Artifex Nexus"

### trigger_dispatcher.py 实现

- [ ] 参考 Blender `trigger_dispatcher.py` 结构
- [ ] 读取 `tool-sources.json` 获取源码目录和 SDK 路径
- [ ] 扫描所有 `manifest.json`，构建 event_type → tool 索引
- [ ] 支持 `silent` / `notify` 两种执行模式
- [ ] 工具总闸：读取 `skills.json` 中 `nexus_tools.disabled` 列表
- [ ] 事件触发 → 动态 import → 调用 entry 函数 → 按模式显示结果
- [ ] 去重保护：500ms 内同 key 只处理一次

### C++ ↔ Python 事件转发

- [ ] `UArtifexNexusSubsystem` DCC 事件 delegate 触发时，调用 Python 事件处理函数
- [ ] C++ 的 post-save/post-delete/post-import/actor-placed 事件 → Python dcc_event_intercept
- [ ] C++ 的 pre-save 事件 → Python trigger_dispatcher + IsPackageOKToSave 拦截
- [ ] Post 事件通过 MCP Server broadcast_trigger_event 发送到 Sidecar
- [ ] Pre 事件仅本地执行（不广播，避免延迟影响保存体验）

### 触发器总开关

- [ ] 通过 `UArtifexNexusSubsystem` 的 BP 属性控制全局启用/禁用
- [ ] 控制面板按钮切换该属性
- [ ] 禁用时 C++ 事件 delegate 仍然触发但 Python 处理函数直接返回（放行）

## 设计要点

- 参考 [[../../specs/ue57-mcp-integration]] §4.5 触发器双模式架构
- 参考 [[../../specs/dcc-extension-trigger-system]] DCC 触发器扩展规范
- artclaw `triggers.json` 格式与 Artifex `tool-sources.json` 格式差异需适配
- C++ 事件转发使用 `FPythonScriptPlugin::Get()->ExecPythonCommand()`

## 子任务

- [ ] 改造 dcc_event_intercept.py（路径 + 品牌名替换）
- [ ] 创建 trigger_dispatcher.py（参考 Blender 实现）
- [ ] 适配 tool-sources.json 格式
- [ ] 实现双模式事件处理流程
- [ ] C++ Subsystem 事件触发 Python 调用
- [ ] Post 事件 MCP broadcast 集成
- [ ] 触发器总开关实现
- [ ] 测试：保存/删除/导入/放置资产触发检查

## 进展日志

- 2026-05-22 created
- 2026-05-25 — 核心实现完成

### 2026-05-25 完成内容

**前端修复**：
- [x] `AppShell.tsx`：dccStatus name 改为规范 DCC key（`"Unreal"` → `"unreal_engine"`，`"Blender"` → `"blender"`）
- [x] `Topbar.tsx`：添加 `DCC_DISPLAY` 映射表，保持用户友好的显示名称

**UE trigger_dispatcher.py 创建**：
- [x] 创建 `Content/Python/trigger_dispatcher.py`，参考 Blender `BlenderTriggerDispatcher`
- [x] 读取 `tool-sources.json` 获取源码目录和 SDK 路径
- [x] 扫描 `manifest.json` 构建 event_type → (tool_id, execution_mode) 索引
- [x] 支持 `silent` / `notify` 两种执行模式
- [x] 工具总闸：读取 `skills.json` 中 `nexus_tools.disabled` 列表
- [x] 全局开关联动 C++ `UArtifexNexusSubsystem.bTriggersEnabled`
- [x] 单例模式 `UETriggerDispatcher.get_instance()`
- [x] `on_trigger_event(event_type, filepath, data)` 统一 Pre/Post 接口

**dcc_event_intercept.py 改造**：
- [x] 移除旧 `triggers.json` 读取逻辑（`_load_config`, `_load_triggers`, `_resolve_tool_path` 等）
- [x] 委托给 `UETriggerDispatcher.on_trigger_event()` 进行 manifest 驱动匹配
- [x] 保留所有 C++ 接口契约（`check_pre_save`, `handle_post_save` 等函数签名不变）
- [x] 保留 `_notify_ue` 通知系统（pending 文件供 C++ FlushPendingNotify 消费）
- [x] `_get_dispatcher()` 每次同步 C++ 全局开关状态

**MCP broadcast 集成**：
- [x] `ue_mcp_server.py`：新增 `broadcast_trigger_event()` 异步方法
- [x] `init_unreal.py`：MCP 启动后注入 `_report_trigger_status` 回调

**Sidecar TriggerDispatcher**：
- [x] `dcc != "blender"` → `dcc not in ("blender", "unreal_engine")`，解除 Blender-only 限制

**同步**：
- [x] 已同步 4 个文件到测试工程 `ue57_artifex_nexus`

### 待测试
- [ ] UE 面板 Trigger 按钮切换 → dispatcher enabled 同步
- [ ] 保存资产 → post-save 触发器执行（需先创建 UE 触发器）
- [ ] 保存拦截 → pre-save 触发器阻止保存
- [ ] 前端 hasConnectedDCC 正确识别 UE
