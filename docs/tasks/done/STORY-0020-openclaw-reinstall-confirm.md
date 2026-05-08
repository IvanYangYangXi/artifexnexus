---
id: STORY-0020
kind: story
title: OpenClaw 重装确认弹窗 + 选择性保留
status: done
priority: P2
owner: "@ivan"
assignee: pair
estimate: 0.5d
created: 2026-05-08
updated: 2026-05-08
started: 2026-05-08
parent: "[[EPIC-0001-m1-onboarding-install]]"
milestone: M1
related_specs:
  - "[[../../specs/openclaw-wrapper-runtime]]"
related_packages:
  - "apps/desktop"
  - "packages/adapters/openclaw/wrapper"
openspec_change: "openclaw-reinstall-confirm"
tags: [story, openclaw, installer, reinstall, M1]
---

# OpenClaw 重装确认弹窗 + 选择性保留

## 背景与目标

当前 InstallerWizard 的"重装"操作会无条件覆写 `openclaw.json`，导致用户丢失
所有已配置的 provider、模型列表、auth 绑定关系、agents.defaults 等设置。

目标：重装前弹出确认弹窗，让用户选择保留哪些已有配置。

## 用户故事

作为 Artifex Nexus 用户，我希望在重装 OpenClaw 时能选择保留哪些已有配置，
避免误操作丢失所有供应商和模型设置。

## 设计要点

详见 openspec change: `openspec/changes/openclaw-reinstall-confirm/`

- 前端：已安装状态点"重装"先弹窗确认（首次安装不弹）
- 后端：`bootstrap()` 新增 `preserve_options` 参数，按选项深合并旧配置
- gateway.auth.token 始终重新生成（安全考虑）

## 验收标准

- [ ] 重装时弹出确认弹窗
- [ ] 默认勾选所有"保留"选项
- [ ] 取消勾选某项后重装，该项数据确实被重置
- [ ] 保留项重装后数据完整恢复
- [ ] 不弹窗直接安装（首次安装场景）正常工作
- [ ] Python 单元测试覆盖 preserve_options 各组合
