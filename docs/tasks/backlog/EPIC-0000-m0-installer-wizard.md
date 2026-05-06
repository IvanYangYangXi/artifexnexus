---
id: EPIC-0000
kind: epic
title: M0 · 安装向导框架
status: backlog
priority: P1
owner: "@ivan"
assignee: pair
estimate: 1w
created: 2026-05-04
updated: 2026-05-04
parent: "[[../../vision/roadmap]]"
milestone: M0
related_adr: [0005]
related_specs:
  - "[[../../specs/openclaw-wrapper-install]]"
related_packages:
  - "apps/desktop"
tags: [epic, installer, ui, M0]
---

# M0 · 安装向导框架

## 背景与目标

现有 `apps/desktop` 首启向导是 3 屏步骤式（选 DCC → 路径 → 完成），
不符合真实使用场景。本阶段按 [[../../inbox/安装向导]] 的需求，把它重构为
**安装清单式向导**：顶级条目含 OpenClaw / Web UI / 各 DCC，DCC 可展开子项
（不同版本 / 工程路径 / 安装脚本），每项带 **检测 / 设置 / 安装** 三按钮并自动显示状态。

M0 只做 **UI 结构 + 交互骨架 + 状态机**，真实安装逻辑留给 M1。

## 范围 / 非范围

- 范围
  - 将 SetupWizard 从步骤式改为清单式
  - 安装项状态机：不可用 / 待安装 / 已安装（桩数据即可）
  - OpenClaw 必须先装，其他项在未装 OpenClaw 前置灰
  - DCC 条目支持展开子列表（多版本 / 路径）
  - 出 UI 结构 spec
- 非范围
  - 真实的 OpenClaw 落盘安装（M1）
  - 真实的 DCC 插件注入（M2 起）
  - 设计语言统一化（M3 再回填）

## 可分发定义（DoD）

- [ ] `tauri build` 出 Windows installer artifact
- [ ] 双击安装后首启进入新向导
- [ ] 清单可点，按钮走桩数据但状态会变
- [ ] OpenClaw 未装前其他项按钮 disabled

## 出口条件

- [ ] `docs/specs/ui/installer-structure.md` 状态为 accepted
- [ ] 所有 STORY 进入 `done/`
- [ ] 手动冒烟：从全新 Windows 账户装起，无报错

## 设计要点

- 本阶段是 **UI 先行**：先交付 UI 结构 spec，再写代码
- 不引入统一设计语言（留给 M3），但需保留替换空间（不硬编码颜色到组件内）
- 参考 qclaw / Lobster AI 的安装清单形态

## 子节点（STORY 列表）

- [x] [[STORY-0001-installer-ui-structure-spec]]
- [x] [[STORY-0002-installer-list-shell]]
- [x] [[STORY-0003-installer-status-state-machine]]
- [x] [[STORY-0004-installer-dcc-expandable]]
- [x] [[STORY-0005-installer-tauri-build-artifact]]
- [x] [[STORY-0006-merge-installer-into-desktop]]

## 进展日志

- 2026-05-04 created · 落位路线图 M0，挂上安装向导新需求
