---
id: STORY-0004
kind: story
title: DCC 条目子项可展开（多版本/工程路径/脚本）
status: done
priority: P2
owner: "@ivan"
assignee: ai
estimate: 1.5d
created: 2026-05-04
updated: 2026-05-05
parent: "[[EPIC-0000-m0-installer-wizard]]"
milestone: M0
related_adr: []
related_specs:
  - "[[../../specs/ui/installer-structure]]"
related_packages:
  - "apps/desktop"
tags: [story, ui, installer, dcc, M0]
---

# DCC 条目子项可展开

## 背景与目标

不同 DCC 会有多版本 / 不同工程路径 / 不同安装脚本。条目需支持展开子列表，
每个子项独立拥有状态与"检测 / 设置 / 安装"操作。

## 范围 / 非范围

- 范围
  - DCC 行右侧"展开/折叠"交互
  - 子项字段：版本号 / 工程路径 / 安装路径 / 脚本路径
  - 子项状态独立
- 非范围
  - 自动扫描系统已装 DCC 版本（放到 M1 的探测里）

## 验收标准

- [x] Blender / UE 等条目可展开
- [x] 子项每行显示 4 个字段 + 状态徽章 + 三按钮
- [x] 子项状态独立于父项
- [x] 父项显示一个"子项汇总"徽章（N 可用 / M 已装）

## 进展日志

- 2026-05-04 created
- 2026-05-05 implement started by ai — 迁 in-progress，开始实现 DCC 子项展开
- 2026-05-05 implement done by ai — 全部验收标准已勾选，迁 review
- 2026-05-05 顺手清理：移除 STORY-0003 遗留的 `pending` 状态（不在 spec 6 状态枚举中）
- 2026-05-05 review 修正：expandable 父项行隐藏三按钮（对齐 spec 线框）；子项行加删除按钮 + DELETE_CHILD action
- 2026-05-05 review 修正 #2：恢复 `pending` 状态（spec 已更新为 7 状态枚举，`pending` 是正式状态）。
  恢复范围：types / i18n / StatusBadge / fixtures / reducer（simulateDetect + INSTALL_DONE 自动转换）。
  同步 board.md / EPIC-0000 / openspec config。
