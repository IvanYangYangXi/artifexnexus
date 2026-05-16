---
id: STORY-0047
kind: story
title: M4-UI-01 · Web UI：Skill/Nexus-Tool 管理面板接线
status: backlog
priority: P1
owner: "@ivan"
assignee: pair
estimate: 2d
created: 2026-05-15
updated: 2026-05-15
parent: "[[../backlog/EPIC-0004-m4-skill-system]]"
milestone: M4
related_adr: [0003]
related_docs:
  - "[[../../../docs/research/artclaw-tool-manager-replication-plan-v2]]"
related_packages:
  - "packages/apps/web"
  - "apps/desktop"
tags: [story, ui, skill, nexus-tool, tauri, invoke, M4, M5]
---

# STORY-0047 · Web UI：Skill/Nexus-Tool 管理面板接线

## 用户故事
技能管理页面从 mock 数据切换到真实 sidecar RPC，Skill 和 Nexus-Tool 的安装/启用/禁用/钉选/收藏全部真实可用。

## 验收标准

### TypeScript API 封装
- [ ] `packages/apps/web/src/lib/skill/skill-api.ts`：封装 `SkillAPI` 接口
  - `list / getDetail / install / uninstall / enable / disable / pin / unpin / sync / publish / batch / search`
  - 底层通过 `invoke("skill_xxx", params)` 调用 Rust command → sidecar RPC
- [ ] `packages/apps/web/src/lib/tool/nexus-tool-api.ts`：封装 `NexusToolAPI` 接口
  - `list / getDetail / create / update / delete / enable / disable / pin / unpin / publish / run / batch`
  - 底层通过 `invoke("nexus_tool_xxx", params)` 调用 Rust command → sidecar RPC

### Rust Tauri Command
- [ ] `commands/skill.rs` 新建（或追加到 `commands/openclaw.rs`）：24 个 `#[tauri::command]` 函数
- [ ] `lib.rs` `generate_handler![]` 注册所有新 command
- [ ] 每个 command 调用 `manager.call("skill.xxx" / "nexus-tool.xxx", params)`

### Web UI 接线
- [ ] 技能页面 `app/skills/page.tsx`：替换 mock 数据 → 真实 `skill-api.list()`
- [ ] `SkillCard.tsx`：安装/卸载/启用/禁用/钉选/收藏按钮接真实 API
- [ ] `NexusToolCard.tsx`：运行/收藏按钮接真实 API
- [ ] 操作后自动刷新列表（乐观更新 + 静默重取）

### 上下文预览区 D5（事件驱动）
- [ ] `RightPanel.tsx` D5 重构为事件驱动上下文预览容器
  - 无可见分页 UI，内容由 `PreviewContext` 事件触发切换
  - 内部维护渲染器注册表（`kind → React.Component`）
- [ ] `AppShell.tsx` 新增 `PreviewContext.Provider`
  - 暴露 `setPreview({ kind, title, payload })` / `clearPreview()` / `content`
- [ ] D3 Nexus-Tool 列表点击 Nexus-Tool 名 → D5 显示 `nexus-tool-detail` 渲染器
- [ ] D3 Nexus-Tool 列表点击 [▶ 运行] → D5 显示 `nexus-tool-run` 渲染器
- [ ] D4 资源管理器 / C3 文件区点击文件 → D5 显示 `file-preview` 渲染器
- [ ] D1/D2 接真实 API（`skill-api.list()` / 最近使用基于实际调用记录）
- [ ] D2 钉选按钮改为调 `skillApi.pin/unpin` 持久化

### 容错
- [ ] sidecar 未启动时显示明确错误提示，不白屏
- [ ] 单个操作失败不影响列表渲染

## 源文件对照

| 目标文件 | 源文件 | 适配量 |
|----------|--------|--------|
| `packages/apps/web/src/lib/skill/skill-api.ts` | 新写 (~150行) | 全写 |
| `packages/apps/web/src/lib/tool/nexus-tool-api.ts` | 新写 (~150行) | 全写 |
| `apps/desktop/src-tauri/src/commands/skill.rs` | 新写 (~200行) | 全写 |
| `apps/desktop/src-tauri/src/lib.rs` | 已存在（+24行 handler 注册） | **低** |
| `packages/apps/web/src/app/skills/page.tsx` | 已存在（改 mock→API） | **低** |
| `packages/apps/web/src/components/skills/SkillCard.tsx` | 已存在（改按钮接线） | **低** |
| `packages/apps/web/src/components/skills/NexusToolCard.tsx` | 已存在（改按钮接线） | **低** |
| `packages/apps/web/src/components/shell/RightPanel.tsx` | 已存在（D5 重构 + D2/D3 接线） | **中** |
| `packages/apps/web/src/components/shell/AppShell.tsx` | 已存在（+PreviewContext Provider） | **低** |

## 关键适配

- `invoke("skill_list", { filters })` → Rust `#[tauri::command] fn skill_list()` → `manager.call("skill.list", ...)`
- TypeScript `SkillAPI` / `NexusToolAPI` 接口定义与 v2 方案 §1.3 完全对齐
- 通信链路：Browser → Tauri IPC → Rust → stdio JSON-RPC → Python sidecar
- D5 上下文预览：事件驱动、kind → 渲染器注册表、无可见分页 UI。设计详见 `[[../../specs/ui/web-chat-structure]]` §8 D5

## 依赖
- → EPIC-0004（父，Skill UI）；→ EPIC-0005（Nexus-Tool UI）
- ← STORY-0046（Sidecar RPC 方法必须全部可用）
- ← STORY-0035（技能模块 UI 骨架已存在）

## 非范围
- Skill 市场/远程分发 UI
- Workflow 编辑器
- Memory 管理面板

## ⚠️ PM 标注（2026-05-16）：`run` 按钮 + `nexus-tool.run` RPC 待重新设计

**问题**：验收标准中 `NexusToolAPI.run`、`NexusToolCard.tsx` [▶ 运行] 按钮、
D3 `nexus-tool-run` 渲染器，当前设计链为 UI → Tauri invoke → Sidecar `nexus-tool.run` RPC。

但 Nexus-Tool 执行应在 DCC 内部完成（需要 `bpy`/`unreal`），不能通过 sidecar。
`nexus-tool.run` RPC 方法（STORY-0046）已建议移除。

**建议**：[▶ 运行] 按钮应触发 OpenClaw agent 生成 `run_python` 调用，而非走 sidecar RPC。
具体交互模式（D5 如何展示运行结果、如何等待异步执行完成）待后续设计。
