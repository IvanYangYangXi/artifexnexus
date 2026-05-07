---
tags: [inbox, idea, openclaw, settings, web-ui, agent, M1]
created: 2026-05-07
status: triaged
linked_epic: "[[../tasks/ready/EPIC-0001-m1-onboarding-install]]"
linked_stories:
  - "[[../tasks/backlog/STORY-0015-openclaw-settings-panel]]"
  - "[[../tasks/backlog/STORY-0016-openclaw-web-ui-entry]]"
  - "[[../tasks/backlog/STORY-0017-openclaw-agent-preset]]"
related_specs:
  - "[[../specs/openclaw-settings-panel]]"
  - "[[../specs/openclaw-agent-preset]]"
  - "[[../specs/ui/installer-structure]]"
---

# EPIC-0001 第二批需求 — OpenClaw 设置 / Web UI 入口 / agent 预设

> 已 triaged 进 EPIC-0001，作为 S8/S9/S10 三个并列 STORY 落地。

## 原始描述（用户）

EPIC-0001 阶段增加几个新需求：

1. 在安装向导的 OpenClaw item 增加设置按钮，点击设置后弹出面板设置大模型的：
   提供商名称 / API 协议 / 接口地址 url / API Key / 模型名称（模型 ID） / 高级配置
   （图片输入、推理模式，其他更多设置请调研 OpenClaw 支持什么）。
2. 需要提供一个打开 OpenClaw 的 Web UI 的入口。
3. OpenClaw 安装好后自动添加一份 agent 身份的预设，预设需要符合 Artifex Nexus 的
   应用场景，告知一些 Artifex Nexus 的基础信息。

## Triage 决策（2026-05-07）

落到 EPIC-0001 内拆 3 个并列 STORY（S8/S9/S10），共 4d，吃原 5d buffer，剩 1d。

| # | STORY | 估时 | 关键决策 |
|---|---|---|---|
| S8 | STORY-0015 设置面板 | 2d | 9 大主流 provider 矩阵（OpenAI / Anthropic / Google / Azure / Ollama / DeepSeek / 火山豆包 / 阿里千问 / 自定义 OpenAI 兼容）；同时支持多 provider 但单选默认；数据落 `openclaw.json` 与上游联动；apiKey 永不出 RPC 边界 |
| S9 | STORY-0016 Web UI 入口 | 0.5d | `tauri-plugin-shell::open()` 调默认浏览器；URL 由 sidecar spike 探测（不猜） |
| S10 | STORY-0017 agent 预设 | 1.5d（含 spike） | 注入位置 ABC 三选一待 spike；preset 含定位 / 支持 DCC / MCP 工具 / Skill 体系 / 调用约定 / 安全边界；幂等 + lock 文件 |

## 三处 spike 必须前置

详见 [[../specs/openclaw-upstream-survey]] §11 T6/T7/T8。implement 前必须先把
事实回填 spec，不允许猜测。

## 关联

- 主 EPIC：[[../tasks/ready/EPIC-0001-m1-onboarding-install]]
- 设计 spec：[[../specs/openclaw-settings-panel]] / [[../specs/openclaw-agent-preset]]
- UI 结构：[[../specs/ui/installer-structure]] §11
- 调研挂钩：[[../specs/openclaw-upstream-survey]] §11 T6/T7/T8 / §12
