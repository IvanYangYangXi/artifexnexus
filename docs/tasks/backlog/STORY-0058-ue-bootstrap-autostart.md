---
id: STORY-0058
kind: story
title: UE 启动引导 & 自动启动
status: backlog
priority: P1
owner: "@ivan"
assignee: ai
estimate: 1d
created: 2026-05-22
updated: 2026-05-22
parent: "[[EPIC-0007-m7-multi-dcc-inapp-chat]]"
milestone: M7
related_specs: ["[[../../specs/ue57-mcp-integration]]"]
related_packages: ["packages/dcc/unreal"]
tags: [story, unreal, bootstrap, autostart]
---

# UE 启动引导 & 自动启动

## 背景与目标

实现 UE 编辑器启动时自动初始化 Artifex Nexus 插件：
1. 自动启动 MCP Server
2. 注册触发器钩子
3. 加载知识库和 Skill Hub
4. Python 环境配置

## 范围 / 非范围

- 范围：init_unreal.py 改造、自动启动逻辑、Python 路径配置
- 非范围：Skill Hub/KB 完整功能实现（只做加载框架，具体功能在 run_python 中按需使用）

## 验收标准

### Python 启动入口 (__init__.py)

- [ ] UE 启动时 `PythonScriptPlugin` 自动执行 `Content/Python/artifex_nexus_ue/__init__.py`
- [ ] 自动清理 `__pycache__` 避免过期 .pyc 干扰
- [ ] 将 `Content/Python/Lib/` 添加到 `sys.path`
- [ ] 将 Python stdout/stderr 重定向至 UE Output Log
  - `LogArtifexNexus` (通用)
  - `LogArtifexNexus_MCP` (MCP 通信)
  - `LogArtifexNexus_Error` (错误)
- [ ] UE 启动后延迟 3 秒自动启动 MCP Server（避免阻塞编辑器加载）
- [ ] 自动启动成功/失败日志打印到 Output Log
- [ ] 注册 `UArtifexNexusSubsystem` 的 DCC 事件 delegate 回调
- [ ] 初始化 `trigger_dispatcher` 单例
- [ ] 初始化 `knowledge_base` 和 `skill_hub`（不预加载数据，仅初始化框架）

### 启动/停止行为

- [ ] 插件启用（编辑器启动时自动加载）：自动启动 MCP + 注册触发器
- [ ] 插件禁用：停止 MCP Server + 注销触发器钩子 + 清理 asyncio 事件循环
- [ ] 编辑器关闭：优雅停止 MCP Server
- [ ] 控制面板按钮：调用 Python `mcp_server.start()` / `mcp_server.stop()`

### knowledge_base & skill_hub 保留

- [ ] `knowledge_base.py` — 保留 TF-IDF 检索实现，去掉 artclaw SDK 依赖
- [ ] `skill_hub.py` — 保留分层加载框架，适配 artifex 路径
- [ ] 两者通过 `run_python` 工具间接调用（不在启动时预加载全部数据）

### 版本适配

- [ ] `ue_version_adapter.py` 保留（UE 版本兼容适配），更新品牌名

## 设计要点

- 参考 artclaw `init_unreal.py` 的启动流程，但大幅精简
- 移除：OpenClaw uplink 连接、Tool Manager 自动启动
- __pycache__ 清理策略：仅在开发模式下清理（检测源码修改时间 vs .pyc 时间）
- 启动延迟使用 `unreal.register_slate_post_tick_callback` 一次性回调

## 子任务

- [ ] 改造 `__init__.py`（原 init_unreal.py）
- [ ] 实现自动启动延迟逻辑
- [ ] stdout/stderr 重定向到 UE Output Log
- [ ] Python 路径配置
- [ ] knowledge_base.py 适配（去 artclaw SDK 依赖）
- [ ] skill_hub.py 适配（路径 + 品牌名）
- [ ] ue_version_adapter.py 品牌名更新
- [ ] 插件禁用时的清理逻辑
- [ ] 测试：UE 冷启动 → 检查 MCP Server 自动启动 → curl ws://127.0.0.1:18080

## 进展日志

- 2026-05-22 created
