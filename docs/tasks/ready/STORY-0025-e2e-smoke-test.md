---
id: STORY-0025
kind: story
title: E2E 冒烟测试 — 从 OpenClaw 输入一句话到 Blender print hello
status: ready
priority: P1
owner: "@ivan"
assignee: pair
estimate: 0.5d
created: 2026-05-08
parent: "[[../backlog/EPIC-0002-m2-blender-mcp-e2e]]"
milestone: M2
related_packages:
  - "packages/dcc/blender"
  - "packages/adapters/openclaw/gateway-plugin"
tags: [story, e2e, test, blender, M2]
---

# STORY-0025 · E2E 冒烟测试

## 用户故事
作为 QA，我能运行一条命令验证 Blender MCP 全链路：OpenClaw → Gateway → Blender MCP Server → BlenderAdapter → bpy → 返回结果。

## 验收标准
- [ ] E2E 冒烟脚本：启动 Blender（带 addon）→ 启动 Gateway → 发送 `mcp_blender_run_python` → 验证 `print("hello from blender")` 返回
- [ ] 脚本化：一条命令跑通全链路
- [ ] 失败时输出清晰的错误信息（哪一环节断了）
- [ ] 测试覆盖：正常执行 / 代码异常 / Blender 未启动 / 超时

## 技术要点
- 冒烟脚本放在 `packages/dcc/blender/tests/e2e/`
- 使用 pytest + subprocess 启动 Blender（headless 或 GUI）
- 验证 Gateway 侧 MCP 工具注册成功
- 验证 `run_python` 往返延迟 < 2s（本地）
