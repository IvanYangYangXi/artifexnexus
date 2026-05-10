---
id: STORY-0037
kind: story
title: M3-UI-07 · 设置模块 UI + D 区域右侧面板
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
tags: [story, ui, settings, right-panel, M3]
---

# STORY-0037 · 设置模块 UI + D 区域右侧面板

## 用户故事
在设置模块中配置模型/认证/Agent/通用设置；右侧面板显示最近使�?Skill/Tool/资源管理�?文件预览�?
## 验收标准

### 设置模块
- [ ] 设置分类导航：模�?/ 认证 / Agent / 通用
- [ ] 模型设置：Provider 选择 + API Key + 模型列表
- [ ] 认证设置：Token 管理
- [ ] Agent 设置：预设选择 + 自定义配�?- [ ] 通用设置：语言 / 主题 / 路径
- [ ] 全部使用 mock 数据

### D 区域右侧面板
- [ ] D 区域可隐�?显示，宽度可拖拽 240�?40px
- [ ] D1 最近使用：最�?10 �?Skill+Tool，按时间倒序
- [ ] D2 Skill 列表：状态点+名称+版本+[📌钉选]，可折叠
- [ ] D3 Tool 列表：按 Skill 分组折叠，每行图�?函数�?[▶运行]
- [ ] D4 资源管理器：树形目录，点击文件联�?D5 预览
- [ ] D5 文件预览�?md 渲染 / .py/.json/.ts 语法高亮 / 图片缩略�?- [ ] D5 �?C3-文件区联动：点击会话文件 �?D5 预览
- [ ] 各面板独立折叠，面板间高度可拖拽
- [ ] 全部使用 mock 数据

## 依赖
- �?STORY-0032（全局布局�?- �?STORY-0031（基础组件库）

## 非范�?- 真实设置 API 对接
- 真实文件系统读取
