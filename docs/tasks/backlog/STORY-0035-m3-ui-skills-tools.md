---
id: STORY-0035
kind: story
title: M3-UI-05 · 技能模块 UI（Skill/Tool 卡片 + 列表 + 筛选）
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
tags: [story, ui, skills, tools, cards, M3]
---

# STORY-0035 · 技能模块 UI（Skill/Tool 卡片 + 列表 + 筛选）

## 用户故事
在技能模块中看到 Skill 和 Tool 的卡片/列表，可按软件/来源/状态筛选，可切换卡片/列表视图。

## 验收标准
- [ ] Skill Tab 工具栏：🔍搜索 + 软件筛选 + 来源筛选 + 排序 + 📋/🗂视图切换 + [+ 安装]
- [ ] Skill 卡片：S-a 图标(按DCC) + S-b 名称 + S-e 来源 + S-f 状态徽章 → S-d 描述 → S-g 元信息 → S-c 操作按钮
- [ ] Skill 状态徽章：已安装(绿)/可安装(灰)/有更新(黄)/已禁用(红)
- [ ] Skill 操作按钮按状态动态显示：[详情] [安装]/[卸载] [启用]/[禁用] [更新] [发布] [钉选]
- [ ] Skill 详情 → 弹出模态窗口（Dialog），含打开源码/安装目录
- [ ] Tool Tab 工具栏：与 Skill 一致（+ 创建按钮）
- [ ] Tool 卡片：T-a 图标 + T-b 函数名+实现类型标签 + T-e 来源 + T-f 状态 → T-d 描述 → T-g 元信息+触发规则 → T-c 操作按钮
- [ ] Tool 实现类型标签：包装/脚本/组合
- [ ] Tool 操作按钮：[详情] [运行] [收藏] [发布] [删除]
- [ ] Tool 详情/运行 → 右侧 D 面板展开参数表单+执行按钮
- [ ] Tool 列表按 Skill 分组折叠
- [ ] 列表模式：S-g/T-g 元信息第一行，S-d/T-d 描述与 S-c/T-c 按钮同行
- [ ] 批量选择 + BatchActionBar
- [ ] 全部使用 mock 数据

## 依赖
- ← STORY-0032（全局布局）
- ← STORY-0031（基础组件库）

## 非范围
- 真实 Skill/Tool API 对接
- Workflow Tab（M8）
