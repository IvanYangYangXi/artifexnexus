---
id: STORY-0019
kind: story
title: 远端模型列表自动获取
status: done
priority: P2
owner: "@ivan"
assignee: pair
estimate: 0.5d
created: 2026-05-08
updated: 2026-05-08
started: 2026-05-08
parent: "[[EPIC-0001-m1-onboarding-install]]"
milestone: M1
related_packages:
  - "apps/desktop"
  - "packages/adapters/openclaw/wrapper"
tags: [story, openclaw, models, remote-fetch, M1]
---

# STORY-0019: 远端模型列表自动获取

## 概述
在 Provider 设置面板的模型区域增加"获取模型列表"按钮，自动从远端 provider 的
OpenAI 兼容 `GET {baseUrl}/models` 接口拉取可用模型列表，供用户勾选导入。

## 用户故事
作为 Artifex Nexus 用户，我希望在配置 provider 时能一键获取可用模型列表，
而不是全部手动填写 model id。

## 技术实现（已完成）

### 后端链路
1. **Python wrapper** `config_io.py` — `fetch_remote_models(base_url, token, timeout)`
   - 直接 HTTP GET `{baseUrl}/models`
   - 解析 OpenAI 标准响应 `{data: [{id, owned_by}]}`
   - graceful 错误处理（404/403/401/超时）

2. **Sidecar RPC** `openclaw.models.fetch_remote`
   - 参数：`{baseUrl, token, timeout?}`
   - 返回：`{success, models?: [{id, name?, ownedBy?}], error?}`

3. **Tauri 命令** `openclaw_models_fetch_remote`
   - 参数：`base_url: String, token: String`
   - 返回：`FetchRemoteModelsResponse`

4. **前端 IPC** `fetchRemoteModels({baseUrl, token})`

### 前端 UI
- ProvidersTab 模型区域的"添加"按钮旁增加"获取模型列表"按钮
- 获取成功：展示远端模型列表面板（支持单个导入 / 全部导入）
- 获取失败：红色文字提示错误原因
- reducer 新增 `IMPORT_REMOTE_MODELS` action（批量去重导入）

### 兼容性（实机验证）
| Provider | /v1/models | 结果 |
|----------|-----------|------|
| DeepSeek (api.deepseek.com) | ✅ 200 | 返回 deepseek-v4-flash / deepseek-v4-pro |
| 网易 CodeMaker | ❌ 404 | 不支持，提示手动填写 |
| OpenAI | ✅ 200 | 标准接口 |
| Ollama (localhost) | ✅ 200 | 标准接口 |

## 验收标准
- [x] "获取模型列表"按钮在模型区域可见
- [x] 点击后显示 loading 状态
- [x] DeepSeek 等支持的 provider 能成功获取并展示列表
- [x] 不支持的 provider 显示友好错误提示
- [x] 导入后模型出现在列表中（去重）
- [x] 需要先保存凭据才能获取（无 token 时提示）
- [ ] 集成测试覆盖

## 状态
**已实现**（随 STORY-0018 hot-fix build10 一起出货）
