---
id: STORY-0006
kind: story
title: installer/ 目录并入 apps/desktop + 划清 dev/产品职责
status: done
priority: P2
owner: "@ivan"
assignee: ai
estimate: 0.5d
created: 2026-05-05
updated: 2026-05-06
parent: "[[EPIC-0000-m0-installer-wizard]]"
milestone: M0
related_adr: []
related_specs:
  - "[[../../specs/openclaw-wrapper-install]]"
related_packages:
  - "apps/desktop"
  - "installer"
  - "scripts"
tags: [story, refactor, installer, M0]
---

# installer/ 目录并入 apps/desktop + 划清 dev/产品职责

## 背景与目标

仓库根的 `installer/` 目前是空壳（仅 README + 空 scripts/templates），与 `apps/desktop` 的
Tauri installer 模式（`src-tauri/src/modes/installer.rs`）功能重叠且让贡献者困惑。
本 STORY 做**纯物理迁移 + 职责声明**：

- `installer/` → `apps/desktop/installer-assets/`
- `scripts/README.md` 明文划分：
  - **开发者工具**：`dev-desktop.{bat,sh}`、`fetch-python.sh`、`fetch-uv.sh`、`gen-ico.py`
  - **产品安装器**：Tauri build 产出的 `installer.exe`（≠ 开发者脚本）

## 范围 / 非范围

- 范围
  - 移动 `installer/` 全部内容到 `apps/desktop/installer-assets/`
  - 写 `scripts/README.md`（若不存在则新建）
  - 更新 monorepo 文档（`docs/decisions/0001-monorepo-layout.md` 若引用了 `installer/`）
  - 更新 `.ai/context/project-overview.md` 包索引
- 非范围
  - 真实安装逻辑（已在 TASK-0001 / EPIC-0001 范围内）
  - 改 `dev-desktop.bat` 行为
  - 用 `installer.exe` 替代 `dev-desktop.bat`（两者职责不同，不替换）

## 验收标准

- [x] `installer/` 在仓库根已不存在
- [x] `apps/desktop/installer-assets/` 存在并保留原文件
- [x] `scripts/README.md` 存在且明文区分"开发者工具 / 产品安装器"
- [x] 全仓 grep `installer/` 无遗留引用（除 changelog 历史项）
- [x] `.ai/context/project-overview.md` 包索引同步

## 设计要点

- 用户安装 = Tauri 产出的 `installer.exe`（含 standalone Python，不依赖系统 Python/Node/Rust）
- 开发者上手 = `dev-desktop.bat`（装 Node/pnpm/Rust/Python 系统级工具链 + 起 dev）
- 两者**不可互相代替**

## 进展日志

- 2026-05-05 created（源自 STORY-0002 align 时 @ivan 提出的目录重复疑问）
- 2026-05-06 implement started by ai — 迁 in-progress，开始物理迁移 installer/ → apps/desktop/installer-assets/
- 2026-05-06 implement done by ai — 全部验收标准已勾选，迁 review
- 2026-05-06 done by ai — review 通过，迁 done
