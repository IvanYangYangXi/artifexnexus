---
id: STORY-0033
kind: story
title: M3-UI-03 · B 区域导航 + 自定义连接
status: backlog
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
tags: [story, ui, navigation, sidebar, M3]
---

# STORY-0033 · B 区域导航 + 自定义连接

## 用户故事
左侧导航栏显示模块入口（Chat/技能/系统/设置），底部有自定义快捷连接和用户区，点击模块切换中央内容。

## 验收标准
- [ ] B1 模块列表：💬 Chat / 🧩 技能 / 🖥️ 系统 / ⚙️ 设置，点击切换 C 区域内容（初始为占位页面）
- [ ] 当前激活项高亮（accent 背景色）
- [ ] B1-自定义：可添加/编辑/删除网页链接🔗、目录📁、文件📄、脚本▶
- [ ] 自定义项点击行为：网页→浏览器打开 / 目录→资源管理器 / 文件→关联软件 / 脚本→运行
- [ ] 自定义项右键菜单：编辑/删除/复制路径
- [ ] 自定义项数据持久化到 `~/.artifexnexus/config/quick-links.json`
- [ ] B2 折叠按钮：切换 B 区域展开/折叠
- [ ] B3 用户区：头像占位 + ⚙ 设置齿轮（点击跳转设置模块）

## 依赖
- ← STORY-0032（全局布局）

## 非范围
- 模块内容页真实实现（后续 STORY）
- 账户体系
