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
- `[[../../vendor/openclaw/README|vendor/openclaw/README]]`
