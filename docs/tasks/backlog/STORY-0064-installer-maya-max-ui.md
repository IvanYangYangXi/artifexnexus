---
id: STORY-0064
kind: story
title: 前端安装器 Maya/Max 支持
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
related_packages: ["apps/desktop"]
tags: [story, frontend, installer, maya, 3ds_max]
---

# 前端安装器 Maya/Max 支持

## 背景与目标

前端安装向导（`apps/desktop/src/features/installer/`）的 `dccRegistry.ts` 中已有 Maya/Max 占位，需要取消注释并实现真实的 detect/install/uninstall 逻辑。

## 范围 / 非范围

- 范围：`dccRegistry.ts` + 可能的 `sidecarRpc.ts` 补充
- 非范围：不改变安装向导 UI 结构（已有 Maya/Max fixture）

## 验收标准

- [ ] `dccRegistry.maya`：实现 detect → `detectMayaVersions()`、install → `installMayaAddon()`、uninstall → `uninstallMayaAddon()`
- [ ] `dccRegistry.max`：实现 detect → `detectMaxVersions()`、install → `installMaxAddon()`、uninstall → `uninstallMaxAddon()`
- [ ] 新增通用 `adaptDCCDetect()` 函数（替代 Blender 专用的 `adaptBlenderDetect`）
- [ ] `pnpm -C apps/desktop tauri build` 编译通过

## 设计要点

- 参照现有 `blender` / `unreal` 的 registry 实现模式
- i18n 文案已有 "Maya" / "3ds Max"（fixtures 中已存在）
- 安装状态检测与 Blender 一致（通过 sidecar RPC）

## 子任务（TASK 列表）

- [ ] `dccRegistry.ts` 实现 Maya/Max 三项操作
- [ ] 新增 `adaptDCCDetect()` 通用适配函数
- [ ] `pnpm tauri build` 编译验证

## 进展日志

- 2026-05-25 created
