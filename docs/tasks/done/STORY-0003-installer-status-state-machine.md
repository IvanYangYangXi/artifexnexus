---
id: STORY-0003
kind: story
title: 安装项状态机与依赖顺序（桩数据）
status: done
priority: P1
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
tags: [story, ui, installer, state, M0]
---

# 安装项状态机与依赖顺序

## 背景与目标

为每个条目引入状态：`unavailable | pending | installing | installed | failed`。
桩实现：点"检测"随机走状态流；点"安装"进 installing → installed。
**OpenClaw 未 installed 前，其他项按钮 disabled**。

## 范围 / 非范围

- 范围
  - 前端状态机（TS 类型 + reducer）
  - 按钮可见性与启用条件
  - 状态徽章视觉占位
- 非范围
  - 真实安装落盘（M1）
  - 真实探测（M1）

## 验收标准

- [x] 定义 `InstallItemState` 类型并集中管理
- [x] 新开应用首次进入，所有项为 `pending`
- [x] OpenClaw 未 `installed` 时其他项 "安装" 按钮 disabled 并带 tooltip 解释
- [x] 点"检测"按桩逻辑切换状态，UI 同步
- [x] 覆盖 installing → failed 的失败路径展示

## 进展日志

- 2026-05-04 created
- 2026-05-05 implement started by ai — 迁 in-progress，开始实现状态机 + 依赖门禁 + 按钮规则
- 2026-05-05 implement done by ai — 全部验收标准已勾选，迁 review
- 2026-05-05 align 分歧记录：以下 spec 要求延后到后续 STORY（已与 @ivan 确认）：
  - 重装二次确认（spec §4）→ 后续 STORY
  - failed 行内"查看详情"链接（spec §3）→ 日志面板在后续 STORY
  - installing 中"取消"按钮（spec §3）→ 后续 STORY
- 2026-05-05 spec 更新：新增 `pending` 状态（等待前置依赖就绪），状态机从 6 状态扩展为 7 状态。
  - 非 OpenClaw 项初始状态改为 `pending`
  - OpenClaw 安装完成后自动将 `pending` → `not-installed`
  - 同步更新 spec / types / fixtures / i18n / StatusBadge / reducer
