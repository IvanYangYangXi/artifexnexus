---
id: STORY-0032
kind: story
title: M3-UI-02 · 全局布局骨架（A/B/C/D 四区域 + 响应式）
status: backlog
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
tags: [story, ui, layout, shell, M3]
---

# STORY-0032 · 全局布局骨架（A/B/C/D 四区域 + 响应式）

## 用户故事
打开 Web UI 后看到完整的四区域布局，顶栏/左侧导航/中央内容/右侧面板各就各位，窗口缩放时自动适配。

## 验收标准
- [ ] A 区域：顶栏 40px 全宽，含 A1 菜单区 + A2 搜索框 + A3 控制区（状态指示 + Gateway 启动按钮 + 面板开关 + 通知铃铛）
- [ ] B 区域：左侧导航栏，展开 200px / 折叠 48px，含 B1 模块列表 + B1-自定义 + B2 折叠按钮 + B3 用户区
- [ ] C 区域：中央内容区 flex:1，根据 B 选中模块渲染不同内容（初始为占位）
- [ ] D 区域：右侧面板 320px，可拖拽 240–640px，可隐藏
- [ ] 响应式断点：≥1280 全展开 / 1024–1279 D 隐藏 / 768–1023 B 折叠+D 隐藏 / <768 B 隐藏+D 隐藏
- [ ] B 区域折叠/展开动画平滑
- [ ] D 区域拖拽调整宽度流畅

## 技术要点
- CSS Grid 或 Flexbox 实现四区域
- B/D 宽度状态持久化到 localStorage
- 响应式通过 CSS media query + React state 双轨

## 依赖
- ← STORY-0031（基础组件库）

## 非范围
- 各区域内部真实内容（后续 STORY 逐个填充）
- 路由/导航逻辑
