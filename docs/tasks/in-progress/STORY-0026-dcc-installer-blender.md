---
id: STORY-0026
kind: story
title: Sidecar DCC 安装器 — Blender 插件检测/安装/卸载
status: in-progress
priority: P1
owner: "@ivan"
assignee: pair
estimate: 1d
created: 2026-05-08
parent: "[[../backlog/EPIC-0002-m2-blender-mcp-e2e]]"
milestone: M2
related_packages:
  - "packages/adapters/openclaw/wrapper"
  - "packages/dcc/blender"
tags: [story, dcc, installer, blender, M2]
---

# STORY-0026 · Sidecar DCC 安装器

## 用户故事
作为安装向导，我能通过 sidecar RPC 检测本机 Blender 版本、安装/卸载 Artifex Nexus 插件。

## 验收标准
- [ ] `find_blender_versions()` 扫描 `%APPDATA%/Blender Foundation/Blender/` 返回已安装版本列表
- [ ] `install_blender_addon(version)` 用 junction/symlink 将插件链接到 Blender addons 目录
- [ ] `uninstall_blender_addon(version)` 删除 junction/symlink
- [ ] 版本匹配：`bl_info.blender` 字段标注最低兼容版本，检测到的 Blender 版本 >= 最低版本即可安装
- [ ] 无兼容版本时返回可用插件版本列表供前端弹窗选择
- [ ] sidecar RPC：`openclaw.dcc.blender.detect` / `openclaw.dcc.blender.install` / `openclaw.dcc.blender.uninstall`
- [ ] 单元测试覆盖版本检测 + 安装/卸载

## 技术要点
- 复刻 `artclaw_bridge/install_dcc_ext.py` 的 `install_blender` / `uninstall_blender` / `find_blender_versions`
- 安装方式：junction（Windows）/ symlink（macOS/Linux）
- 插件源路径：`packages/dcc/blender/src/artifex_nexus/`
- 目标路径：`%APPDATA%/Blender Foundation/Blender/{version}/scripts/addons/artifex_nexus/`
- 插件版本从 `blender_addon/__init__.py` 的 `bl_info` 读取
