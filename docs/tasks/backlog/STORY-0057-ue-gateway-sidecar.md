---
id: STORY-0057
kind: story
title: Gateway & Sidecar 集成
status: backlog
priority: P0
owner: "@ivan"
assignee: ai
estimate: 2d
created: 2026-05-22
updated: 2026-05-22
parent: "[[EPIC-0007-m7-multi-dcc-inapp-chat]]"
milestone: M7
related_specs: ["[[../../specs/ue57-mcp-integration]]", "[[../../specs/dcc-plugin-management]]"]
related_packages: ["packages/adapters/openclaw"]
tags: [story, unreal, gateway, sidecar, integration]
---

# Gateway & Sidecar 集成

## 背景与目标

修改 Artifex Nexus 项目侧的 Gateway 插件和 Python Sidecar，
使其支持 UE 5.7 DCC 的 MCP 连接。包括：
1. mcp-bridge Gateway 插件注册 unreal-editor 工具
2. bootstrap.py 生成 UE 相关配置
3. dcc_installer.py 实现 UE 插件安装/检测/卸载

## 范围 / 非范围

- 范围：Gateway 插件改动、Sidecar RPC 改动、安装向导前端改动
- 非范围：UE 插件本身代码（STORY-0051~0056）

## 验收标准

### mcp-bridge Gateway 插件

- [ ] `packages/adapters/openclaw/gateway-plugin/src/index.ts` 新增 `unreal-editor` 服务器配置
- [ ] 注册 `mcp_unreal-editor_run_python` 工具
- [ ] 注册 `mcp_unreal-editor_get_editor_context` 工具
- [ ] 工具描述前缀 `[MCP:unreal-editor]`
- [ ] 连接 `ws://127.0.0.1:18080`（端口可配置）
- [ ] 自动重连（指数退避）
- [ ] 15s ping 保活
- [ ] 30s 请求超时
- [ ] 编译器编译通过（`pnpm build`）
- [ ] 部署 manifest 校验

### bootstrap.py

- [ ] `_generate_default_config()` 中添加 `unreal-editor` 到 `plugins.entries.mcp-bridge.config.servers`
- [ ] `openclaw.json` 模板包含 `unreal-editor` 配置块
- [ ] 格式与 `blender-editor` 一致
- [ ] `_deploy_mcp_bridge_plugin()` 部署时自动复制网关插件到 OpenClaw extensions

### dcc_installer.py

- [ ] `find_unreal_versions()` — 检测 UE 5.7 安装路径
- [ ] `install_unreal_plugin(version, project_path)` — 复制插件到 UE 项目 Plugins/
- [ ] `uninstall_unreal_plugin(project_path)` — 移除插件
- [ ] `_record_deployment("unreal-addon-5.7")` — 部署 manifest
- [ ] 遵循 ADR 0008：物理拷贝 + deploy-manifest.json 校验
- [ ] 在 METHOD_TABLE 注册 RPC 方法
- [ ] Sidecar JSON-RPC handler: `openclaw.dcc.unreal.detect` / `.install` / `.uninstall`
- [ ] 前端 `dccRegistry.ts` 注册 UE 入口
- [ ] 安装向导 UI 自动显示 UE 选项

### 端口管理

- [ ] `ports.json` 记录 `unreal-editor: 18080`
- [ ] 端口冲突检测（与 Blender 18083 互不干扰）

## 设计要点

- 参考 Blender 的 mcp-bridge 集成（gateway-plugin/src/index.ts 已有 blender-editor 配置）
- 参考 Blender 的 dcc_installer（dcc_installer.py 已有 Blender 检测/安装逻辑）
- 新增 DCC 接入模式与 agent-onboarding.md §6.1 一致
- mcp-bridge 配置格式：
```json
"unreal-editor": {
  "type": "websocket",
  "url": "ws://127.0.0.1:18080",
  "enabled": true
}
```

## 子任务

- [ ] mcp-bridge 插件添加 unreal-editor 配置
- [ ] mcp-bridge 插件注册 `mcp_unreal-editor_run_python` 工具
- [ ] mcp-bridge 插件注册 `mcp_unreal-editor_get_editor_context` 工具
- [ ] bootstrap.py 生成 unreal-editor 配置
- [ ] dcc_installer.py 实现 find_unreal_versions
- [ ] dcc_installer.py 实现 install_unreal_plugin
- [ ] dcc_installer.py 实现 uninstall_unreal_plugin
- [ ] dcc_installer.py 实现 _record_deployment
- [ ] METHOD_TABLE 注册 3 个 RPC handler
- [ ] dccRegistry.ts 注册 UE
- [ ] 端到端测试：安装向导检测 UE → 安装插件 → 启动 MCP → AI 对话调用 run_python

## 进展日志

- 2026-05-22 created
