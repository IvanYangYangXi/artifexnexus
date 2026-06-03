---
id: STORY-0067
kind: story
title: M10 数据视图 UI 结构 spec
status: done
priority: P0
owner: "@ivan"
assignee: ai
estimate: 2d
created: 2026-06-03
updated: 2026-06-03T22:20
parent: "[[EPIC-0010-m10-data-view]]"
milestone: M10
related_adr: []
related_specs:
  - "[[../../specs/ui/data-view-structure]]"
related_packages:
  - "packages/apps/web"
tags: [story, data, ui-spec, M10]
---

# STORY-0067 · M10 数据视图 UI 结构 spec

## 背景与目标

M10 涉及 GUI，按 `.ai/rules/30-agent-behavior.md` §4.2 必须先出 UI 结构 spec 再写代码。
本 STORY 产出 `docs/specs/ui/data-view-structure.md`，定义信息架构 / 状态机 / 10 视图槽位规则 /
Spatial Plot 与 Scene Heatmap 的交互细节 / 与现有 AppShell 的对接点。

## 范围 / 非范围

- 范围：UI 结构与交互、视图槽位字段规则、状态机、线框（ASCII）、错误态文案、对接点
- 非范围：视觉值（颜色 / 字号 / 圆角，留给 design-language token）、组件内部实现细节、ANDF schema 字段定义（属于 STORY-0068）

## 验收标准

- [x] `docs/specs/ui/data-view-structure.md` 文件创建，frontmatter 含 `status: accepted`
- [x] 涵盖 §1 信息架构 / §2 状态机 / §3 视图槽位规则 / §4 反向编辑细则 / §5 Spatial Plot 交互 / §6 Heatmap 交互 / §7 与 AppShell 对接点 / §8 错误与边界
- [x] 提供 ASCII 线框 ≥ 3 张（§2.1 导入态 / §4.4 直展型视图态 / §5.1 Spatial Plot 编辑态）
- [x] 与 [[../../specs/ui/web-chat-structure]] 区域 ABCD 命名一致
- [x] 与人确认后改 status 为 `accepted`

## 设计要点

- 复用 [[../../specs/ui/web-chat-structure]] 的 ABCD 区域命名
- 视图槽位规则：视图样式 → 允许字段，扩展字段视图支持就支持，不支持则忽略
- Spatial Plot 必须明确：底图上传 / 坐标系映射 / 点编码（颜色 / 形状 / 大小 / 缩略图）/ 拖动改值 / 反向编辑 Diff 格式
- 状态机至少包含：empty / importing / configuring / rendering / editing / error

## 进展日志

- 2026-06-03 created
- 2026-06-03 spec accepted + 线框补齐 (ASCII ≥ 3) + 三处同步迁 ready/
- 2026-06-03 review 通过（AC 5/5），迁 done/
