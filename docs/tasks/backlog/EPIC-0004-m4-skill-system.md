---
id: EPIC-0004
kind: epic
title: M4 · Skill 系统
status: backlog
priority: P1
owner: "@ivan"
assignee: pair
estimate: 3w
created: 2026-05-04
updated: 2026-05-15
parent: "[[../../vision/roadmap]]"
milestone: M4
related_adr: [0003, 0004]
related_specs:
  - "[[../../specs/skill-system]]"
related_docs:
  - "[[../../research/artclaw-tool-manager-replication-plan-v2]]"
related_packages:
  - "packages/platform/skill"
  - "packages/apps/web"
  - "apps/desktop"
  - "packages/adapters/openclaw/wrapper"
tags: [epic, skill, M4]
---

# M4 · Skill 系统

## 背景与目标

落地 `packages/platform/skill/`（hub / registry / loader / installer / conflict / version / manifest / decorator）
并在 Web UI 里提供安装 / 启停 / 调用面板。

## 范围 / 非范围

- 范围：Skill 运行时 + manifest 校验 + 安装/卸载 + Web UI 管理
- 非范围：Tool 独立管理（M5）、记忆联动（M6）

## UI 先行产物

- [ ] `docs/specs/ui/skill-manager-structure.md`

## 可分发定义（DoD）

- [ ] 从 Web UI 装一个官方示例 Skill，Blender 中可调用成功
- [ ] 冲突 / 版本 / 卸载链路可见

## 子节点（STORY 列表）

- [ ] [[STORY-0042-m4-sdk-decorator-manifest]] · @tool 装饰器 + Manifest + Version (2d)
- [ ] [[STORY-0043-m4-sdk-hub-registry]] · SkillHub + Registry + Conflict (2d)
- [ ] [[STORY-0044-m4-sdk-installer-loader]] · SkillInstaller + Loader + Config (2d)
- [ ] [[STORY-0046-m4-rpc-skill-tool]] · Sidecar RPC：Skill/Tool 方法 (1.5d)
- [ ] [[STORY-0047-m4-ui-skill-tool-wiring]] · Web UI 接线 (2d)
- [ ] [[STORY-0048-m4-migration-skill-tool]] · Skill/Tool 内容迁移 (1.5d)

## 进展日志

- 2026-05-15 align 完成：子节点已按 v2 复刻方案展开为 6 个 STORY
- 2026-05-04 created
