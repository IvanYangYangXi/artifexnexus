---
id: STORY-0027
kind: story
title: 安装向导 Blender 行接真实 DCC 安装逻辑
status: review
priority: P1
owner: "@ivan"
assignee: pair
estimate: 1d
created: 2026-05-08
parent: "[[../backlog/EPIC-0002-m2-blender-mcp-e2e]]"
milestone: M2
related_packages:
  - "apps/desktop/src"
tags: [story, installer, blender, ui, M2]
---

# STORY-0027 · 安装向导 Blender 行接真实逻辑

## 用户故事
作为用户，我在安装向导中点击 Blender 行的"检测"按钮，能看到本机已安装的 Blender 版本列表；点击"安装"按钮能将 Artifex Nexus 插件安装到对应版本。

## 验收标准
- [ ] Blender 行"检测"按钮 → 调用 `openclaw.dcc.blender.detect` RPC → 子项自动填充为检测到的版本
- [ ] 每个子项行显示：Blender 版本号 + 插件兼容状态 + 安装按钮
- [ ] 兼容版本：安装按钮直接可用，点击安装
- [ ] 不兼容版本：安装按钮显示警告，点击弹窗列出可用插件版本供手动选择
- [ ] 安装完成后子项状态更新为 `installed`
- [ ] 安装失败时显示错误信息

## 技术要点
- 新增 IPC 函数：`detectBlenderVersions` / `installBlenderAddon` / `uninstallBlenderAddon`
- 修改 `InstallItemRow.tsx`：Blender 行的 handleDetect / handleInstall 接真实逻辑
- 修改 `installer.fixtures.ts`：Blender 子项改为动态（初始空 children）
- 新增 `BlenderVersionDialog.tsx`：不兼容版本手动选择弹窗
