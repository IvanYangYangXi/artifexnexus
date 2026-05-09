---
id: STORY-0034
kind: story
title: M3-UI-04 · Chat 模块 UI（C1 控制栏 + C2 消息流 + C3 输入区）
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
tags: [story, ui, chat, messages, input, M3]
---

# STORY-0034 · Chat 模块 UI（C1 控制栏 + C2 消息流 + C3 输入区）

## 用户故事
在 Chat 模块中看到完整的对话界面：顶部控制栏选择 Agent/Model/对话，中间消息流展示对话，底部输入区可输入消息。

## 验收标准
- [ ] C1 控制栏：Agent 下拉 + Model 下拉 + 对话下拉（搜索/切换/重命名/删除）
- [ ] C2 消息流：用户消息（右对齐，蓝色气泡）+ AI 消息（左对齐，含头像）+ 系统消息（居中灰字）
- [ ] C2-A-b Markdown 渲染（代码块语法高亮）
- [ ] C2-A-c 工具执行卡片：≥3 个工具时默认折叠为摘要行，可展开
- [ ] C2-A-d 操作栏：复制/重新生成/点赞/点踩
- [ ] C2-U-c 附件区：图片缩略图 + 文件下载链接
- [ ] C3-文件区：显示对话中操作的文件（新建/修改/删除），点击联动 D5
- [ ] C3-钉选区：@提及标签栏，可取消
- [ ] C3a 快捷操作栏：📎附件 / @提及 / /命令 / [+ 新对话]
- [ ] C3b 多行输入框：自适应高度 80–200px，Shift+Enter 换行
- [ ] C3c 发送区：发送/停止/恢复按钮 + 发送方式切换（立即/队列）
- [ ] 对话状态机：Idle → Composing → Sending → Streaming → ToolExecuting → Paused/Queued
- [ ] 消息流自动滚动到底，手动滚动时暂停粘底
- [ ] 全部使用 mock 数据，不接后端

## 依赖
- ← STORY-0032（全局布局）
- ← STORY-0031（基础组件库）

## 非范围
- 真实 API 对接
- WebSocket 流式
- 文件上传真实实现
