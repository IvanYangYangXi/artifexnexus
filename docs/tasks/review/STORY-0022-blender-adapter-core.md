---
id: STORY-0022
kind: story
title: BlenderAdapter — 主线程调度 + execute_code
status: review
priority: P1
owner: "@ivan"
assignee: pair
estimate: 1d
created: 2026-05-08
parent: "[[../backlog/EPIC-0002-m2-blender-mcp-e2e]]"
milestone: M2
related_packages:
  - "packages/dcc/blender"
tags: [story, blender, adapter, M2]
---

# STORY-0022 · BlenderAdapter 核心实现

## 用户故事
作为开发者，BlenderAdapter 提供安全的主线程调度和万能代码执行器，所有 bpy 调用通过 adapter 代理。

## 验收标准
- [ ] `execute_on_main_thread()` 通过 `queue.Queue` + `bpy.app.timers` 实现主线程调度
- [ ] `execute_code()` 注入预定义变量（`bpy`/`S`/`W`/`L`/`C`/`D`），捕获 stdout 和异常
- [ ] `get_selected_objects()` / `get_scene_info()` / `get_current_file()` 返回正确数据
- [ ] 持久化命名空间：跨 `execute_code` 调用保持用户变量
- [ ] 主线程调度超时 30s，超时抛出 `TimeoutError`
- [ ] 单元测试覆盖主线程调度 + execute_code + 上下文采集

## 技术要点
- 复刻 `artclaw_bridge/subprojects/DCCClawBridge/adapters/blender_adapter.py`
- 精简：去掉 `_panel`（Qt Chat Panel）、`on_startup` 中的 EventManager/Tool Manager 代码
- 保留：`_main_thread_queue` + `_main_thread_consumer` + `_ensure_timer_registered` 调度机制
- 保留：`BaseDCCAdapter` 抽象基类（精简版）
