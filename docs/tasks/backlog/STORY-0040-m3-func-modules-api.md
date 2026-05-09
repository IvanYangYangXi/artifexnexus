---
id: STORY-0040
kind: story
title: M3-FUNC-02 · 技能/系统/设置模块功能接线
status: backlog
priority: P1
owner: "@ivan"
assignee: pair
estimate: 2d
created: 2026-05-10
parent: "[[../backlog/EPIC-0003-m3-web-ui-chat]]"
milestone: M3
related_specs:
  - "[[../../specs/ui/web-chat-structure]]"
related_packages:
  - "packages/apps/web"
  - "packages/adapters/openclaw"
tags: [story, skills, system, settings, api, M3]
---

# STORY-0040 · 技能/系统/设置模块功能接线

## 用户故事
技能模块能真实列出/安装/管理 Skill 和 Tool；系统模块能真实控制 Gateway；设置模块能真实读写配置。

## 验收标准

### 技能模块
- [ ] Skill 列表从 API 加载（替换 mock）
- [ ] Skill 安装/卸载/启用/禁用/更新/钉选 真实可用
- [ ] Skill 详情弹窗：打开源码/安装目录真实可用
- [ ] Tool 列表从 API 加载
- [ ] Tool 运行：参数表单 → 发送到 Chat 执行
- [ ] Tool 收藏持久化

### 系统模块
- [ ] 安装向导功能与原 Desktop 一致（安装/检测/卸载/日志）
- [ ] Gateway 启动/停止/重启真实可用
- [ ] Gateway 日志实时流
- [ ] 运行状态：Sidecar/DCC 连接/部署校验 真实数据

### 设置模块
- [ ] 模型/认证/Agent 设置读写 `openclaw.json`
- [ ] 通用设置持久化

## 依赖
- ← STORY-0035（技能模块 UI）
- ← STORY-0036（系统模块 UI）
- ← STORY-0037（设置模块 UI）
- ← STORY-0038（Desktop 内嵌）

## 非范围
- Skill 市场/远程分发
- Workflow 功能
