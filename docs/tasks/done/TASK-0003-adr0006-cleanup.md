---
id: TASK-0003
title: ADR 0006 配套清理（措辞 / 规则 / prompt / 代码注释）
status: done
closed: 2026-05-03
priority: P2
owner: "@ivan"
assignee: ai
estimate: 1d
created: 2026-05-03
updated: 2026-05-04
related_adr: [0006]
related_specs:
  - "[[../../specs/系统架构设计]]"
related_packages:
  - ".ai/rules"
  - ".ai/prompts"
tags: [task, cleanup, docs, scope]
---

# ADR 0006 配套清理

## 背景与目标

[[../../decisions/0006-scope-converge-to-openclaw]] 把项目范围收敛到 OpenClaw 单平台。
ADR 自身已落，但仓内仍有少量"多平台"措辞与占位文件需要清理。

本任务**做文案 + 代码注释/docstring 双层清扫**，不动 schema/不动 import/不删目录。
（schema 重构归已完成的 [[TASK-0002-schema-de-abstraction]]；目录重命名经 align 决定不做。）

## 验收标准

### A. 文档层（docs/ + .ai/ + 根 README/CLAUDE）

- [ ] `docs/specs/系统架构设计.md` 全文不再出现"未来其他平台 / 多 AI 平台"等表述
- [ ] `.ai/rules/00-architecture.md` §1 依赖图中 `adapters/<platform>` 改为 `adapters/openclaw`
- [ ] `.ai/rules/00-architecture.md` §8 可替换性矩阵中"换平台 = 新建 adapters/<name>/"一行更新或删除
- [ ] `.ai/prompts/new-platform.md` 删除或改名为"新增 OpenClaw 子模块"指南
- [ ] `.ai/context/project-overview.md` / `glossary.md` 中 platform/vendor 措辞同步
- [ ] `CLAUDE.md` / `README.md` 项目定位段同步为「OpenClaw 桥接 + DCC 集成」

### B. 代码层（packages/platform/ 下注释 & docstring）

- [ ] `packages/platform/` 内所有 .py / .rs / .ts 中：
      - "platform-agnostic" / "multi-vendor" / "any AI platform" 等表达 → 改为 OpenClaw 语义
      - `vendor` 在指代"AI 平台"时 → 改为 `openclaw`；指代"DCC 厂商"时保留
- [ ] `packages/platform/contracts/` 内 schema 的 `description` 字段措辞与 ADR 0006 一致
- [ ] 公共 API docstring 中英双语都改（遵守 .ai/rules/10-coding-style.md）

### C. 全仓 grep 自检

- [ ] `rg "adapters/<platform>"` 0 命中
- [ ] `rg -i "platform-agnostic|multi[- ]vendor|other AI platform"` 0 命中
- [ ] `rg -i "OpenClaw"` 命中数显著上升（替换生效证据）

## 设计要点 / 边界

- **保留**：`packages/platform/` 目录名（align 已决，读作"本平台内部底层"）。
- **保留**：`packages/adapters/openclaw/` 目录与现有 import 路径。
- **不动**：`schemas/*.json` 的 `$id` / `required` / 字段名（仅改 description）。
- **不动**：测试用例（如有 vendor 字样应在后续任务专门处理）。
- 一处歧义即问，遵循 `.ai/rules/30-agent-behavior.md` Clarify-First。

## 进展日志

- 2026-05-03 created（由 ADR 0006 拆出）
- 2026-05-04 align：扩展范围至代码注释/docstring；目录名 platform/ 经决定**保留**；任务卡升级为 P2、估时 1d，进入 in-progress
- 2026-05-04 implement：执行 5 处改动（删 new-platform.md / north-star.md L16-L19 / pyproject.toml / 2 个 __init__.py docstring 中英双语）；最终 grep 自检通过（外部命中归零，仅剩 ADR 反向陈述与任务卡自身），推 review
- 2026-05-03 done：用户验收通过，关闭
