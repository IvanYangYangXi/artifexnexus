---
id: STORY-0066
kind: story
title: 端到端验证（Maya/Max MCP 集成）
status: backlog
priority: P1
owner: "@ivan"
assignee: ai
estimate: 1d
created: 2026-05-25
updated: 2026-05-25
parent: "[[EPIC-0007-m7-multi-dcc-inapp-chat]]"
milestone: M7
related_adr: [0006]
related_specs: ["../../specs/maya-max-mcp-integration"]
related_packages: ["packages/dcc/maya", "packages/dcc/max", "packages/adapters/openclaw", "apps/desktop"]
tags: [story, e2e, verification, maya, 3ds_max]
---

# 端到端验证

## 背景与目标

所有 STORY（0059~0065）完成后，进行端到端验证：编译验证、安装器逻辑验证、MCP 工具注册完整性检查。

## 范围 / 非范围

- 范围：`pnpm tauri build` 编译 + 代码逻辑审查 + MCP 工具注册完整性
- 非范围：Maya/Max 实际环境运行测试（需要 DCC 软件环境，标记待后续验证）

## 验收标准

- [ ] `pnpm tauri build` 编译通过（Tauri + Next.js + Gateway Plugin）
- [ ] `pnpm -C apps/desktop tauri build` 成功出包
- [ ] 安装器逻辑审查通过（版本扫描 / 安装 / 卸载 / locale 同步）
- [ ] Gateway 插件编译通过，`mcp_maya-primary_run_python` 和 `mcp_max-primary_run_python` 已注册
- [ ] Sidecar dcc_installer Python 语法检查通过
- [ ] 端口无冲突（18081 Maya, 18082 Max, 18083 Blender, 18080 UE）
- [ ] 共享模块 import 路径一致

## 待后续实际环境验证

| 验证项 | Maya | 3ds Max |
|--------|------|---------|
| 安装器扫描到已安装的 DCC 版本 | 待验证 | 待验证 |
| MCP Server 自动拉起（端口 18081/18082） | 待验证 | 待验证 |
| Gateway mcp-bridge 连接成功 | 待验证 | 待验证 |
| `run_python` + `get_editor_context` 调用 | 待验证 | 待验证 |
| 主线程执行场景修改 | 待验证 | 待验证 |
| 触发器（保存/打开事件） | 待验证 | 待验证 |
| 安装器卸载清理完整 | 待验证 | 待验证 |

## 子任务（TASK 列表）

- [ ] `pnpm tauri build` 编译验证
- [ ] Python 代码语法检查（`python -m py_compile`）
- [ ] 端口冲突检查
- [ ] MCP 工具注册完整性审查

## 进展日志

- 2026-05-25 created
