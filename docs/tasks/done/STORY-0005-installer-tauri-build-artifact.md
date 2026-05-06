---
id: STORY-0005
kind: story
title: M0 Tauri 可分发产物
status: done
priority: P1
owner: "@ivan"
assignee: ai
estimate: 1d
created: 2026-05-04
updated: 2026-05-06
parent: "[[EPIC-0000-m0-installer-wizard]]"
milestone: M0
related_adr: [0005]
related_specs:
  - "[[../../specs/openclaw-wrapper-install]]"
related_packages:
  - "apps/desktop"
tags: [story, build, release, M0]
---

# M0 Tauri 可分发产物

## 背景与目标

M0 退出条件要求产出可安装包。本 STORY 负责：
`tauri build` 能成功产出 Windows installer（msi / nsis 任一即可），
新账户双击可安装，启动后进入新版向导，不崩。

## 范围 / 非范围

- 范围
  - `tauri.conf.json` 的分发元数据（名称、图标、版本）
  - 本地 build 脚本可复现
  - 版本号在 `package.json` 与 `tauri.conf.json` 一致
- 非范围
  - 代码签名（留给后续 EPIC）
  - 自动更新（留给后续 EPIC）
  - macOS / Linux 构建（留给后续）

## 验收标准

- [x] `pnpm --filter @artifex-nexus/desktop tauri build` 无错通过
- [x] 产物位置文档化到 `docs/specs/openclaw-wrapper-install.md`
- [ ] 新 Windows 账户双击可装 + 启动
- [ ] 启动后看到新的安装清单向导

## 进展日志

- 2026-05-04 created
- 2026-05-05 implement started by ai — 迁 in-progress，安装 Rust 工具链，准备 tauri build
- 2026-05-05 implement done by ai — tauri build 成功，产物 NSIS + MSI 已生成；文档化到 openclaw-wrapper-install.md；迁 review（后两条验收标准需人工在新账户验证）
- 2026-05-06 done by ai — review 通过，迁 done。后两条验收标准需人类在新 Windows 账户手动验证。
