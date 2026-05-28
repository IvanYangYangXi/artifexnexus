---
id: STORY-0050
kind: story
title: Nexus Tool 直接运行 — 异步化 + 参数传递修复
status: done
priority: P0
owner: "@yangjili"
assignee: ai
estimate: 2d
created: 2026-05-18
updated: 2026-05-18
parent: "[[EPIC-0005-m5-nexus-tool-system]]"
milestone: M5
related_specs:
  - "[[../../specs/nexus-tool-direct-run-async]]"
related_packages:
  - "packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/nexus_tool_rpc.py"
  - "apps/desktop/src-tauri/src/commands/skill.rs"
  - "apps/desktop/src-tauri/src/lib.rs"
  - "packages/apps/web/src/lib/nexus-tool/nexus-tool-api.ts"
  - "packages/apps/web/src/components/skills/RunPanel.tsx"
tags: [story, nexus-tool, run, async, bug-fix, M5]
---

# Nexus Tool 直接运行 — 异步化 + 参数传递修复

## 背景与目标

点"运行"按钮触发三个问题：
1. **UI 卡住 + Gateway 假死**：Rust `Mutex<SidecarManager>` 持锁 120s + Python `readline()` 单线程阻塞
2. **参数未传递**：参数注入后从未调用入口函数（`implementation.function`）
3. **DCC 工具 `__name__` / 通用工具 SDK 路径问题**

目标：异步化 + 正确传递参数 + 所有 DCC 统一 MCP 执行路径。

## 验收标准

- [ ] 点"运行"按钮 → 前端立即显示"运行中..."，不卡住
- [ ] 运行页和详情页可正常切换，不转圈
- [ ] Gateway 不会崩溃（短期 RPC 调用不影响健康检查）
- [ ] 用户填写的参数实际传入工具入口函数 `func_name(**args)`
- [ ] 通用工具：SDK import 成功，`__name__` 问题解决
- [ ] DCC 工具：通过 MCP Bridge 在目标 DCC 中正确执行并返回结果
- [ ] 超时 120s 后自动中断并报错
- [ ] 用户可以点击取消按钮终止运行
- [ ] 并发运行不超过 3 个任务
- [ ] 多 DCC 扩展只需加一行映射配置

## 改动文件

| 层 | 文件 | 改动类型 |
|---|------|---------|
| Python | `nexus_tool_rpc.py` | 重写 `_handle_nexus_tool_run` + 新增 result/cancel/ack |
| Rust | `commands/skill.rs` | 修改超时 + 新增 3 命令 |
| Rust | `lib.rs` | `generate_handler![]` 注册 |
| 前端 | `nexus-tool-api.ts` | 新增 API |
| 前端 | `RunPanel.tsx` | 异步轮询模式 |

## 设计要点

- 参考 spec: [[../../specs/nexus-tool-direct-run-async]]
- task_id + 轮询模式（Rust 持锁 5s，Python 后台线程执行）
- `_execute_tool_sync` 统一入口：DCC → MCP Bridge，General → subprocess+importlib wrapper
- 所有 DCC（Blender/Maya/UE/Houdini/Max/ComfyUI）通过 `_DCC_TO_MCP_SERVER` 映射统一路由
