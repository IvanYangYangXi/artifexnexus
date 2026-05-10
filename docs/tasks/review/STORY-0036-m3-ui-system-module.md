---
id: STORY-0036
kind: story
title: M3-UI-06 · 系统模块 UI（安装向�?+ Gateway + 运行状态）
status: review
priority: P1
owner: "@ivan"
assignee: pair
estimate: 1.5d
created: 2026-05-10
parent: "[[../backlog/EPIC-0003-m3-web-ui-chat]]"
milestone: M3
related_specs:
  - "[[../../specs/ui/web-chat-structure]]"
related_packages:
  - "packages/apps/web"
tags: [story, ui, system, installer, gateway, M3]
---

# STORY-0036 · 系统模块 UI（安装向�?+ Gateway + 运行状态）

## 用户故事
在系统模块中看到安装向导、Gateway 控制和运行状态三�?Tab，界面与�?Desktop 安装向导一致�?
## 验收标准
- [ ] 系统模块 Tab 栏：[安装向导] [Gateway] [运行状态]
- [ ] 安装向导 Tab：安装清�?+ 日志面板（与�?Desktop 布局一致，使用新设计语言�?- [ ] 安装向导 安装清单行：图标+名称+状态徽�?三按�?展开/折叠子项
- [ ] 安装向导 日志面板：可折叠，自动滚动，级别颜色区分
- [ ] Gateway Tab：状态卡片（状态指�?元数�?错误信息+操作按钮�? 日志面板
- [ ] Gateway 状态卡�?G-d：[�?启动/�?重启] + [🌐 OpenClaw Web UI]
- [ ] 运行状�?Tab：Sidecar 状态卡�?+ DCC 连接列表 + 部署校验摘要
- [ ] 全部使用 mock 数据

## 依赖
- �?STORY-0032（全局布局�?- �?STORY-0031（基础组件库）

## 非范�?- 真实安装/Gateway API 对接
- 安装向导功能逻辑
