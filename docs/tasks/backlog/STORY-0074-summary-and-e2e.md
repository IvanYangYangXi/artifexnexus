---
id: STORY-0074
kind: story
title: Summary Bar 统计 + 导出 + E2E 烟雾 + tauri 出包
status: review
priority: P0
owner: "@ivan"
assignee: ai
estimate: 2d
created: 2026-06-03
updated: 2026-06-04
updated: 2026-06-03
parent: "[[EPIC-0010-m10-data-view]]"
milestone: M10
related_adr: []
related_specs:
  - "[[../../specs/ui/data-view-structure]]"
related_packages:
  - "packages/apps/web"
  - "apps/desktop"
tags: [story, data, summary, export, e2e, M10]
---

# STORY-0074 · 统计 + 导出 + 端到端验证

## 背景与目标

收尾 STORY，让 M10 满足"可分发"铁律：
- 实现 Summary Bar 的统计计算（数值 / 文本 / 布尔）
- 实现完整导出（CSV / ANDF JSON / ANDF Diff）
- 端到端烟雾走通：CSV 导入 → 列配置 → 选视图 → 编辑 → 导出
- `pnpm tauri build` 出可装 artifact

## 范围 / 非范围

- 范围：
  - Summary Bar：数值列 min / max / avg / sum / median；文本列 count / unique / top-N；布尔列 true 占比
  - 导出 CSV / 导出 ANDF JSON / 导出 ANDF Diff JSON
  - 端到端烟雾测试脚本（手动 checklist 即可，首版不做自动化）
  - 出包并验证可双击运行 + 模块可达 + 流程可走
- 非范围：自动化 E2E（Playwright / WebdriverIO），首版手测

## 验收标准

- [ ] Summary Bar 在所有视图下根据当前列正确计算
- [ ] 3 类导出按钮均可用，文件内容正确
- [ ] `pnpm tauri build` 成功，安装包可装
- [ ] 端到端 checklist 全部勾选通过
- [ ] EPIC-0010 DoD 全部满足

## 设计要点

- 统计计算放纯函数 `packages/apps/web/src/features/data/stats.ts`，单元测试单独跑
- CSV 导出处理引号、逗号、换行的 escape
- 出包前先跑 `pnpm -C apps/desktop tauri build`，注意 PATH 含 cargo（参考 project-overview.md）

## 进展日志

- 2026-06-03 created
- 2026-06-04 implemented — stats.ts (9 tests 通过) + SummaryBar 增强（5列统计快照） + "导出 ANDF" 按钮 + E2E checklist（10类30项） + tauri build 尝试验证
