---
id: STORY-0001
kind: story
title: 安装向导 UI 结构设计 spec
status: done
priority: P1
owner: "@ivan"
assignee: ai
estimate: 1d
created: 2026-05-04
updated: 2026-05-05
parent: "[[EPIC-0000-m0-installer-wizard]]"
milestone: M0
related_adr: []
related_specs:
  - "[[../../specs/ui/installer-structure]]"
related_packages:
  - "apps/desktop"
tags: [story, ui, installer, M0]
---

# 安装向导 UI 结构设计 spec

## 背景与目标

**所有 GUI 必须 UI 先行**。本 STORY 交付安装向导的信息架构 / 主要流程 / 线框，
作为后续实现的锚。

## 范围 / 非范围

- 范围
  - `docs/specs/ui/installer-structure.md`（信息架构 / 状态机图 / 关键线框）
  - 列出所有顶级条目：OpenClaw / Web UI / Blender / UE / Max / Maya / ComfyUI（占位）
  - DCC 条目子项结构（版本 / 工程路径 / 安装路径 / 安装脚本）
  - 三按钮（检测 / 设置 / 安装）的交互规则
  - 安装依赖顺序（必须先 OpenClaw）
- 非范围
  - 具体视觉（颜色 / 字体）
  - 统一设计语言（留给 M3）
  - SP / SD / Houdini 等（M9，单独 EPIC）

## 验收标准

- [x] spec 文件落位 `docs/specs/ui/installer-structure.md`
- [x] 含顶级条目清单与 DCC 子项字段表
- [x] 含状态机图：6 状态 unavailable / not-installed / installing / installed / update-available / failed
- [x] 含关键交互：OpenClaw 未装 → 其他项"安装"按钮置灰，检测/设置仍可用
- [x] 含"检测 / 设置 / 安装"三按钮的可见性与启用条件
- [x] 含设置抽屉、事件/日志面板、子项独立操作的设计
- [x] 反链至 [[EPIC-0000-m0-installer-wizard]] 与 [[../../inbox/安装向导]]

## 设计要点

- align 决策摘要见 [[../../specs/ui/installer-structure]] §1–§9
- 视觉留空，不做 token（token 在 M3 统一）
- 可借助 [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) 做 UX 探索，结论已沉淀到 spec

## 进展日志

- 2026-05-04 created
- 2026-05-05 align 完成 7 个决策点（条目/状态/按钮/抽屉/子项/检测时机/日志面板），spec 落位 `docs/specs/ui/installer-structure.md`，迁 ready
- 2026-05-05 review 通过，迁 done

