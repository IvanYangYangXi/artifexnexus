---
id: STORY-0049
kind: story
title: DCC 本地触发器调度器（Blender 首发）
status: ready
priority: P1
owner: "@yangjili"
assignee: ai
estimate: 1d
created: 2026-05-18
updated: 2026-05-18
parent: "[[EPIC-0005-m5-nexus-tool-system]]"
milestone: M5
related_adr: [0003]
related_specs:
  - "[[../specs/dcc-extension-trigger-system]]"
  - "[[../specs/dcc-plugin-management]]"
related_packages:
  - "packages/dcc/blender"
  - "packages/adapters/openclaw/wrapper"
tags: [story, dcc, trigger, blender, M5]
---

# DCC 本地触发器调度器（Blender 首发）

## 背景与目标

当前触发器执行路径为 Blender → WebSocket → sidecar → TriggerDispatcher → WebSocket → Blender（round-trip），延迟大、依赖网络、工具代码无法直接访问 bpy。改为在 DCC 内部直接执行：事件触发后，Blender addon 读取 `tool-sources.json` 配置，扫描 manifest，匹配触发器，import 工具代码并在 Blender Python 内直接运行。

## 验收标准

- [ ] `tool-sources.json` 新增 `sdk_path` 字段，bootstrap 自动写入
- [ ] Blender addon 新增 `trigger_dispatcher.py`，独立完成触发器匹配与工具执行
- [ ] Blender addon 侧栏面板新增触发器启用/禁用开关
- [ ] 开关关闭时，保存文件不触发任何检查
- [ ] 开关开启时，Save 触发 "Blender对象命名规范检查"
  - [ ] 有违规对象 → 弹出 popup 显示违规列表
  - [ ] 无违规 → 静默通过
- [ ] 触发器执行不依赖 sidecar 运行（sidecar 未启动时仍可弹窗）
- [ ] sidecar 侧 `trigger_dispatcher.py` 保持不动（非 Blender DCC fallback）

## 设计要点

- 参考 spec: [[../specs/dcc-extension-trigger-system]]
- 实施计划: [[../specs/dcc-trigger-system-plan]]
- `sdk_path` 解决 Blender addon 脱离 monorepo 后找不到 SDK 的问题
- 工具 import 在 Blender Python 内完成，可直接使用 bpy
- 弹窗使用 `bpy.context.window_manager.popup_menu()`

## 子任务

- [x] Step 1: `tool_sources.py` 新增 `set_sdk_path()` / `get_sdk_path()`
- [x] Step 2: `bootstrap.py` 写入 sdk_path
- [x] Step 3: 新建 `blender_addon/trigger_dispatcher.py`
- [x] Step 4: 修改 `blender_addon/__init__.py`（接入 dispatcher + UI 开关）
- [x] Step 5: 删除旧 plan 文件 `docs/specs/dcc-trigger-system-plan.md`
- [x] Step 6: QA 审核（代码规范/逻辑/边界检查通过，P3 doc 已修复）

## 进展日志

- 2026-05-18 created, plan approved
- 2026-05-18 Steps 1-4 implemented, syntax verified, QA reviewed
- 2026-05-18 sidecar.py main() 新增 sdk_path 自动补齐逻辑（已有安装缺字段时自动写入）
- 2026-05-18 待 Blender 内实际验收测试（需要重启 Tauri + 启动 Blender）
