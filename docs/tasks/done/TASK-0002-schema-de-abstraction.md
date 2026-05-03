---
id: TASK-0002
title: Schema 去抽象化（platform.* → openclaw.*）
status: done
priority: P2
owner: "@ivan"
assignee: ai
estimate: 0.5d
created: 2026-05-03
updated: 2026-05-03
related_adr: [0006]
related_specs:
  - "[[../../specs/系统架构设计]]"
related_packages:
  - "packages/platform/contracts"
tags: [task, contracts, refactor, schema]
---

# Schema 去抽象化

## 背景与目标

由 ADR 0006 触发：项目范围已收敛到 OpenClaw 单平台。
本任务把 `config.schema.json` 中为多平台预留的 `platform.*` 抽象彻底移除，
所有相关字段平铺合并到 `openclaw.*` 一棵子树。

**前提**：当前没有任何 Python/TS 实现代码消费 `platform.*` 字段（grep 验证），
因此本次清理是无破坏的纯 schema/文档操作。

## 验收标准

### Schema（已 align，待 implement）

- [x] 删除 `platform` 节点（含 `type/gateway_url/auth_token_env/config_path/config_key`）
- [x] 顶层 `required` 从 `["home", "platform"]` 改为 `["home", "openclaw"]`
- [x] `openclaw.*` 平铺包含：
  - [x] `port`（已存在，保留）
  - [x] `gateway_url`（默认 `ws://127.0.0.1:18789`）
  - [x] `auth_token_env`（默认 `OPENCLAW_AUTH_TOKEN`）
  - [x] `vendor_config_path`（默认 `~/.artifexnexus/.openclaw/openclaw.json`）
  - [x] `vendor_config_key`（默认 `mcp.servers`）
- [x] `openclaw` 节点 `required: ["port"]`
- [x] 所有字段保留 `description`，并明示哪些是 vendor 写入坐标
- [x] schema 顶部 `description` 注明"已收敛到 OpenClaw 单平台（见 ADR 0006）"

### 调用方 / 文档

- [x] grep 全仓：不再出现 `platform.type` / `platform.gateway_url` / `platform.auth_token_env` / `platform.config_path` / `platform.config_key`
- [x] `dcc_instances` 节点保留（不在本任务范围）
- [x] `[[../../specs/系统架构设计]]`：若有 `platform.*` 引用同步更新

### 非本任务

- 不动 `dcc_instances`
- 不动 `packages/adapters/openclaw/` 目录结构（属于 ADR 0006 cleanup TASK-0003）
- 不删除 `packages/adapters/` 顶层目录

## 设计要点（来自 align）

- **删除策略**：直接删 platform 节点（无代码消费，YAGNI）
- **结构**：平铺到 `openclaw.*`（5 个字段不需要再分子节点）
- **vendor 字段命名**：用 `vendor_config_path` / `vendor_config_key` 前缀，
  视觉上区分"Artifex Nexus 自己的配置"与"要去改 vendor 的写入坐标"

## 进展日志

- 2026-05-03 created（由 TASK-0001 align 过程拆出）
- 2026-05-03 SDD align 完成：3 个对齐点（删除策略 / 平铺结构 / vendor 命名）
- 2026-05-03 implement 完成：schema 重写、grep 验证无残留消费方；迁 review 等用户确认
- 2026-05-03 done：用户验收通过
