---
tags: [adr, accepted]
created: 2026-05-02
status: accepted
---

# ADR 0002 — Vendor & 锁定 OpenClaw 分发

## Context

原 `artclaw_bridge` 强依赖 OpenClaw，但 OpenClaw 自身在频繁迭代，导致 bridge 频繁因上游 break change 而报错，是当前最大的稳定性痛点（见 `[[../artclaw bridge 项目重构]]` 第 4 条）。

## Decision

1. fork OpenClaw 到 Artifex Nexus 组织，建立长期维护分支 `artifex-nexus/v0.x`。
2. 在本仓库 `vendor/openclaw/` 引入该 fork（开发期 git submodule，发布期 release tarball + sha256 校验）。
3. 安装器把 vendor 内的 OpenClaw **整体部署到 `~/.artifexnexus/.openclaw/`**——
   作为 Artifex Nexus 用户数据目录下的一个**隔离子目录**，与 Artifex Nexus 自身完全分开。
4. 默认数据目录由 `~/.openclaw/` 改为 `~/.artifexnexus/`，OpenClaw 自身（被 fork）的默认路径
   也同步改为 `~/.artifexnexus/.openclaw/`，避免污染用户 home 根目录。
5. 用户可见名："Artifex Nexus (powered by OpenClaw vX.Y.Z)"。

## Consequences

**优点**：

- 单一受控版本，bridge 行为可预测。
- 用户一键安装即可获得"Gateway + Bridge + Plugin"全套。
- 修改默认路径与品牌字样可隔离 OpenClaw 与本项目的命名空间。

**代价**：

- 需要定期 rebase upstream（建议季度）。
- 安装包体积增大；需在 `[[../runbook/install]]` 提供按需下载方案。

## Alternatives Considered

- **不 vendor，仅写支持的 OpenClaw 版本范围**：被拒，无法解决稳定性根因。
- **完全 fork 永不合并 upstream**：被拒，会失去 OpenClaw 的新功能与修复。

## Links

- `[[0001-monorepo-layout]]`
- `[[../runbook/install]]`
- `[[0005-desktop-distribution-tauri-standalone-python]]`
- `[[../specs/openclaw-upstream-survey]]`
- `[[../tasks/done/STORY-0007-openclaw-spec-realign]]`

---

## 补充（2026-05-06，EPIC-0001 align）：薄壳模式取代 vendor fork

### 背景

EPIC-0001（M1）align 阶段实测确认：
1. OpenClaw 上游为 **Node.js / TypeScript 项目**（非原假设 Python），且**原生支持** `OPENCLAW_HOME` /
   `OPENCLAW_STATE_DIR` / `OPENCLAW_CONFIG_PATH` 三件套环境变量 + `agents.defaults.workspace`
   配置项，**零 fork 即可全路径隔离**。
2. 上游官方 `install-cli.sh` 原生支持 `--prefix` / `--version` / `--no-onboard` / `--json`（NDJSON
   事件流） / `--node-version` 全部所需 flag，且自带 standalone Node tarball，**零依赖**。
3. 上游 `gateway-lock` 机制 per-config 自动隔离，多实例场景下 lock 文件 / browser controlPort /
   CDP 端口段均按 base port 自动派生隔离。

详见 `[[../specs/openclaw-upstream-survey]]`。原决策 #1 #2（fork + vendor 子目录）的核心动机
是"修改 OpenClaw 默认路径以避免污染 user home"，但这一动机已被上游原生 env 隔离能力**完全消化**，
fork 不再必要。

### 补充决策

**6. 薄壳模式取代 vendor fork**：

- **不在仓内 fork OpenClaw**，不维护 `artifex-nexus/v0.x` 分支
- **不在 `packages/adapters/openclaw/vendor/` 引入 git subtree / submodule / tarball**
- 安装期由 Tauri 主进程调用上游 `install-cli.sh`（或 Win 上的 `install.ps1`）装到
  **隔离 prefix** `~/.artifexnexus/.openclaw/cli/v<version>/`，不入用户 PATH
- 路径与默认值偏移通过**环境变量 + `openclaw.json`** 完成：
  - `OPENCLAW_HOME=~/.artifexnexus/.openclaw`
  - `OPENCLAW_STATE_DIR=$OPENCLAW_HOME/state`
  - `OPENCLAW_CONFIG_PATH=$OPENCLAW_HOME/openclaw.json`
  - `gateway.port = 19789`（避开上游默认 18789 + 派生端口段）
  - `agents.defaults.workspace = $OPENCLAW_HOME/workspace`
- 版本管控通过 `OPENCLAW_VERSION` env / `openclaw.json.version` 字段双通道，M1 锁定
  `v2026.5.4`，M2+ 升级走 `openclaw upgrade --to <ver>` 接口（候选 STORY S7）

### 与原决策的关系

| 原决策 | 状态 |
|---|---|
| #1 fork OpenClaw 到 Artifex Nexus 组织 | **撤销**（薄壳模式不需要） |
| #2 vendor 子目录 / submodule / tarball | **撤销**（薄壳模式不需要） |
| #3 整体部署到 `~/.artifexnexus/.openclaw/` | **保留**（路径决策不变，仅装入手段从"copy from vendor"改为"上游 CLI install"） |
| #4 默认数据目录改为 `~/.artifexnexus/` | **保留**（通过 env 变量实现，不需 fork） |
| #5 用户可见名 "Artifex Nexus (powered by OpenClaw vX.Y.Z)" | **保留** |

### 收益

- **零 vendor 维护成本**：不再需要季度 rebase upstream
- **安装包大幅瘦身**：OpenClaw（~250 MB）不入 installer 包，Win/mac installer ≤ 100 MB
- **升级解耦**：用户可换 `OPENCLAW_VERSION` 一行升级，无需重打 Artifex Nexus 安装包
- **零冲突**：与用户已装的原生 OpenClaw（默认 `~/.openclaw/` + 端口 18789）完全无读写无端口冲突

### 代价

- 首启需要联网拉 OpenClaw（~250 MB）；离线场景安装壳后停在"未安装"状态
  （不报错；M2+ 可考虑 offline tarball 下发兜底）
- 上游 break change 风险回到台前——但通过 `OPENCLAW_VERSION` 锁定（M1=`v2026.5.4`）+
  CI 定期 `check-upstream` 工作流（人工 review 后才升）控制
