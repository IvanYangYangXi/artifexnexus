---
id: EPIC-0009
kind: epic
title: M9 · 扩展 DCC（SP / SD / Houdini / Unity）
status: planned
priority: P3
owner: "@ivan"
assignee: pair
estimate: 4w
created: 2026-05-05
updated: 2026-05-28
parent: "[[../../vision/roadmap]]"
milestone: M9
related_adr: [0006]
related_specs: []
related_packages:
  - "packages/dcc"
tags: [epic, dcc, substance-painter, substance-designer, houdini, unity, M9, planned]
---

# M9 · 扩展 DCC（SP / SD / Houdini / Unity）📋 PLANNED

## 背景与目标

在 M7 多 DCC 框架稳定后，按需扩展 Substance Painter / Substance Designer / Houdini / Unity，
复用 M2 起就跑通的 uplink + gateway-plugin + dcc 插件三件套。

## 当前状态

- ✅ **所有四款软件的 Skills 已创建**：
  - Substance Painter：4 个（context / bake-export / layer-ops / operation-rules）
  - Substance Designer：9 个（context / fxmap / generators / learned-recipes / node-capture / node-catalog / node-ops / operation-rules / pixel-processor）
  - Houdini：4 个（context / node-ops / operation-rules / simulation）
  - Unity：5 个（asset-ops / component-ops / editor-control / gameobject-ops / scene-ops）
- ❌ **DCC 插件均未开发**
- ❌ **安装向导未配置这些 DCC**
- ❌ **MCP 端口未分配**

## 范围 / 非范围

- 范围：Substance Painter / Substance Designer / Houdini / Unity 的 DCC 适配 + 安装向导接入
- 非范围：行业其它 DCC（Cinema 4D / Modo 等），按社区贡献接

## UI 先行产物

- [ ] `docs/specs/ui/installer-structure.md` 增补这四类 DCC 的子项字段差异（不另建 spec）

## 可分发定义（DoD）

- [ ] 安装向导出现 SP / SD / Houdini / Unity 顶级条目，可装、可调
- [ ] 四者中至少一个能跑通 `mcp_<dcc>_run_python`

## 出口条件

- [ ] 所有 STORY 进入 `done/`
- [ ] 至少一个完整 E2E 用例

## 子节点（STORY 列表）

- [ ] 待 align 展开

## 进展日志

- 2026-05-28 **状态更新**：所有四款软件 Skills 已创建，待 DCC 插件开发
- 2026-05-05 created
