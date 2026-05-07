---
id: STORY-0014
kind: story
title: 版本升级通道接口预留 — openclaw upgrade --to vX.Y.Z（M1 仅留接口）
status: review
priority: P3
owner: "@ivan"
assignee: ai
estimate: 0.5d
created: 2026-05-06
updated: 2026-05-06
parent: "[[EPIC-0001-m1-onboarding-install]]"
milestone: M1
related_adr: [0002, 0005]
related_specs:
  - "[[../../specs/openclaw-upstream-survey]]"
related_packages:
  - "apps/desktop"
  - "packages/adapters/openclaw/wrapper"
tags: [story, openclaw, upgrade, version, M1, scaffold-only]
depends_on:
  - "[[STORY-0010-openclaw-runtime-spawn]]"
---

# 版本升级通道接口预留 — openclaw upgrade --to vX.Y.Z（M1 仅留接口）

## 背景与目标

EPIC-0001 align 决策 5（详见 [[../../specs/openclaw-upstream-survey]] §9）：版本管理是
一等公民。M1 默认锁定 `v2026.5.4`，但 CLI 按版本分子目录 `cli/<version>/` 设计就是为了
**M2+ 灰度升级 / 回滚**。本 STORY **仅留接口**：sidecar RPC + 命令行 + 数据结构准备就绪，
真实升级流程与端到端验证留 M2+。

## 范围 / 非范围

- 范围
  - sidecar `openclaw.list_versions() -> [Version]`：扫描 `cli/` 下所有版本子目录
  - sidecar `openclaw.upgrade({ to: version, force?: bool })` 接口签名 + 占位实现（返回 `NotImplemented` + 友好提示）
  - sidecar `openclaw.rollback({ to: version })` 接口签名 + 占位实现
  - `cli/current` symlink（或 Win 上 `current.txt` 指针文件）作为"当前活动版本"的单一指向
  - runtime spawn（S3）改为通过 `cli/current/bin/openclaw` 调用（而非硬编码 `cli/v2026.5.4/`）
  - openclaw.json 写入 `version` 字段；启动时校验与 `cli/current` 指向版本一致
- 非范围
  - 真实升级 / 回滚的实现逻辑（M2+）
  - 升级 UI（M2+）
  - 自动 check-upstream（M2+）

## 验收标准

- [ ] `cli/current` symlink 指向 `cli/v2026.5.4/`，runtime 通过 symlink 启动正常
- [ ] `openclaw.list_versions` 返回 `[{ version: "v2026.5.4", active: true, installed_at: ... }]`
- [ ] `openclaw.upgrade` 调用返回 `{ status: "not_implemented", message: "升级功能将在 M2 提供" }`
- [ ] openclaw.json 的 `version` 字段与 `cli/current` 解析出的版本一致；不一致时启动报警
- [ ] Win 上无 symlink 权限时 fallback 到 `current.txt` 指针文件
- [ ] sidecar RPC 接口签名稳定（schema 写入 contracts），M2+ 实现时不破坏前端调用方

## 设计要点

- **symlink Win 兼容**：Win 10+ 的 `mklink /D` 需要管理员或开发者模式；fallback 用
  `current.txt` 内容为 `v2026.5.4` 的指针文件，runtime spawn 前读 → 拼路径
- **接口稳定性**：本 STORY 的 RPC schema 一旦定义，M2+ 升级实现时只能加字段不能改字段
- **M2+ 升级流程草图**（仅参考，不在本 STORY 实现）：
  1. install-cli.sh 装到 `cli/<new_ver>/`
  2. doctor 验新版本健康
  3. stop 当前 gateway
  4. 切 `current` symlink
  5. start 新 gateway + health check
  6. 失败回滚切回旧 symlink

## 子任务

- [ ] `cli/current` symlink 创建（含 Win fallback）
- [ ] `runtime.py` 改用 symlink/pointer 解析版本路径
- [ ] sidecar RPC 三方法（list/upgrade/rollback）签名 + 占位实现
- [ ] contracts schema 定义 `openclaw-version.schema.json`
- [ ] 启动时版本一致性校验
- [ ] manual test：手动 mv 一个假 cli/v2026.X.Y/ 进去，验证 list_versions 能识别

## 进展日志

- 2026-05-06 created（S7 of 7，scaffold-only，依赖 S3 done）
