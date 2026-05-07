---
id: STORY-0012
kind: story
title: 端口冲突处理 — 19789 被占时按 +20 步进自动迁移
status: review
priority: P2
owner: "@ivan"
assignee: ai
estimate: 0.5d
created: 2026-05-06
updated: 2026-05-06
parent: "[[EPIC-0001-m1-onboarding-install]]"
milestone: M1
related_adr: []
related_specs:
  - "[[../../specs/openclaw-upstream-survey]]"
  - "[[../../specs/openclaw-wrapper-runtime]]"
related_packages:
  - "apps/desktop"
  - "packages/adapters/openclaw/wrapper"
tags: [story, openclaw, port, conflict, M1]
depends_on:
  - "[[STORY-0009-openclaw-bootstrap-config]]"
---

# 端口冲突处理 — 19789 被占时按 +20 步进自动迁移

## 背景与目标

EPIC-0001 默认 `gateway.port = 19789`（base+1000，避开上游默认 18789）。极端情况下用户
机器上仍可能 19789 被其他服务占用；需自动迁移到 19809 / 19829 / ...（步进 20 保证派生
端口段隔离），写回 `openclaw.json` + `run/ports.json`。

## 范围 / 非范围

- 范围
  - `ports.py` 实现 `pick_port(preferred=19789, step=20, max_tries=5) -> int`
  - bootstrap（S2）与 start（S3）阶段都调用 `pick_port`；若返回值 ≠ 19789 则更新 openclaw.json
  - UI 非阻塞 toast："端口已切换为 19809（19789 被占用）"
  - 持久化到 `~/.artifexnexus/run/ports.json`，下次启动优先复用上次成功端口
  - 5 次后仍冲突 → 报错让用户手动改配置
- 非范围
  - 用户手工改端口的 UI 表单（M2）
  - 端口冲突原因诊断（占用方进程名等，M2+）

## 验收标准

- [ ] 19789 空闲时返回 19789（不变）
- [ ] 19789 被占（手动 nc -l 19789）时返回 19809，openclaw.json 更新，UI 弹 toast
- [ ] 19789 + 19809 + 19829 都被占时按步进继续，最多 5 次
- [ ] 5 次都失败给出明确错误码 `E_PORT_EXHAUSTED`，UI 引导用户手动设置
- [ ] `run/ports.json` 记录最后一次成功端口，下次启动直接 probe 该端口
- [ ] 派生端口段（base+2、base+11..base+110）也被纳入 probe（确保 controlPort + CDP 段空闲）

## 设计要点

- **probe 方法**：`socket.bind((127.0.0.1, port))` 成功 + 立即 close；TOCTOU 可接受
- **派生端口段同时 probe**：`pick_port` 内部要 probe `[base, base+2, base+11..base+110]` 全部空闲
  才认为 base 可用（避免选中 base 但 controlPort 被占的诡异 bug）
- **持久化优先**：`ports.json` 存在时先 probe 上次端口，空闲就复用（保持稳定）

## 子任务

- [ ] `ports.py` 实现 `pick_port` + 派生段 probe
- [ ] 集成到 bootstrap（S2）与 runtime spawn（S3）流程
- [ ] `run/ports.json` 读写 + 优先级逻辑
- [ ] UI toast 集成
- [ ] 三平台 manual test（含手动 nc 占端口场景）

## 进展日志

- 2026-05-06 created（S5 of 7，依赖 S2 done）
