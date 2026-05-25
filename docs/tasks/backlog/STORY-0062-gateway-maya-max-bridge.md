---
id: STORY-0062
kind: story
title: Gateway mcp-bridge 注册 Maya/Max
status: backlog
priority: P1
owner: "@ivan"
assignee: ai
estimate: 0.5d
created: 2026-05-25
updated: 2026-05-25
parent: "[[EPIC-0007-m7-multi-dcc-inapp-chat]]"
milestone: M7
related_adr: [0006]
related_specs: ["../../specs/maya-max-mcp-integration"]
related_packages: ["packages/adapters/openclaw/gateway-plugin"]
tags: [story, gateway, mcp-bridge, maya, 3ds_max]
---

# Gateway mcp-bridge 注册 Maya/Max

## 背景与目标

在 OpenClaw Gateway 的 mcp-bridge 插件中注册 Maya（18081）和 3ds Max（18082）的 WebSocket MCP 服务器，并注册对应的 `run_python` 工具。

## 范围 / 非范围

- 范围：`src/index.ts` 新增两个 server + 两个 tool 注册；`openclaw.plugin.json` 配置更新
- 非范围：不修改 MCP 协议层

## 验收标准

- [ ] `src/index.ts` 注册 `maya-primary`（ws://127.0.0.1:18081）和 `max-primary`（ws://127.0.0.1:18082）
- [ ] 注册 `mcp_maya-primary_run_python` 和 `mcp_max-primary_run_python` 工具
- [ ] 工具 description 正确对应 Maya/Max 上下文变量
- [ ] `openclaw.plugin.json` 包含 Maya/Max 服务器配置
- [ ] 编译通过（esbuild/tsc）

## 设计要点

- 参照现有 `blender-editor` 和 `unreal-editor` 的注册模式
- 上下文变量描述：
  - Maya：`S=maya.cmds.ls(sl=True)`, `W=file(q=True, sn=True)`, `L=maya.cmds`
  - Max：`S=pymxs.runtime.selection`, `W=maxFilePath+maxFileName`, `L=pymxs.runtime`
- Up Axis 提示：Maya Y-Up，Max Z-Up

## 子任务（TASK 列表）

- [ ] `src/index.ts` 新增 Maya/Max server + tool 注册
- [ ] `openclaw.plugin.json` 更新
- [ ] 编译验证

## 进展日志

- 2026-05-25 created
