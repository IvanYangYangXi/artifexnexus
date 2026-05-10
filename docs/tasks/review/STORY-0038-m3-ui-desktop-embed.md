---
id: STORY-0038
kind: story
title: M3-UI-08 · Desktop 内嵌 Web UI + M0 回填
status: review
priority: P1
owner: "@ivan"
assignee: pair
estimate: 1d
created: 2026-05-10
parent: "[[../backlog/EPIC-0003-m3-web-ui-chat]]"
milestone: M3
related_specs:
  - "[[../../specs/ui/web-chat-structure]]"
related_packages:
  - "packages/apps/web"
  - "apps/desktop"
tags: [story, ui, desktop, embed, migration, M3]
---

# STORY-0038 · Desktop 内嵌 Web UI + M0 回填

## 用户故事
Desktop .exe 启动后加载新�?Web UI（替代原 React 前端），M0 安装向导使用新设计语言复刷�?
## 验收标准
- [ ] Desktop .exe 加载 Web UI（本�?HTTP 服务�?iframe�?- [ ] Tauri 桥接层：Rust Command �?Web UI IPC 通道可用
- [ ] M0 安装向导使用新设计语言复刷（不改结构，只换 token/组件�?- [ ] 安装向导功能无回退（安�?检�?卸载/日志 均正常）
- [ ] `pnpm -C apps/desktop tauri build` 通过

## 依赖
- �?STORY-0031~0037（全�?UI STORY 完成�?
## 非范�?- 新功能开�?- 性能优化
