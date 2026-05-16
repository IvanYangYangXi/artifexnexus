---
id: STORY-0047
kind: story
title: M4-UI-01 · Web UI：Skill/Nexus-Tool 管理面板接线
status: ready
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
- [x] `packages/apps/web/src/lib/skill/skill-api.ts`：封装 `SkillAPI` 接口（14 方法）
- [x] `packages/apps/web/src/lib/nexus-tool/nexus-tool-api.ts`：封装 `NexusToolAPI` 接口（14 方法含 run）

### Rust Tauri Command
- [x] `commands/skill.rs` 新建：28 个 `#[tauri::command]` 函数（14 skill + 14 nexus-tool）
- [x] `lib.rs` `generate_handler![]` 注册所有新 command
- [x] `commands/mod.rs` 追加 `pub mod skill;`

### Web UI 接线
- [x] 技能页面 `SkillsPage.tsx`：Tab "Tool" → "Nexus-Tool"，import 修正
- [x] `SkillList.tsx`：替换 mock → 真实 `skill-api` + loading/error 状态
- [x] `NexusToolList.tsx`（原 ToolList.tsx）：替换 mock → 真实 `nexus-tool-api`
- [x] 操作后自动刷新列表（乐观更新 + 静默重取）
- [x] [▶ 运行] 按钮接线 `nexusToolRun()`

### 上下文预览区 D5（事件驱动）
- [x] `AppShell.tsx` 新增 `PreviewContext.Provider`（setPreview / clearPreview / preview）
- [x] `RightPanel.tsx` D5 接入 PreviewContext + `PreviewRenderer`（kind → 渲染组件）
- [x] `nexus-tool-run-result` / `nexus-tool-detail` 渲染器

### 容错
- [x] sidecar 未启动时显示明确错误提示，不白屏
- [x] 单个操作失败不影响列表渲染

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

## ⚠️ PM 标注（2026-05-16）：`nexus-tool.run` 执行路由已确认

**最终决策**：`nexus-tool.run` 保留为 RPC 方法（STORY-0046 已实现）。
执行路由：DCC 工具 → Sidecar MCP Bridge → DCC run_python；通用工具 → subprocess。
[▶ 运行] 按钮正常调用 `nexus-tool-run` Rust command → sidecar RPC。
