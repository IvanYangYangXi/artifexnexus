---
id: STORY-0009
kind: story
title: bootstrap 真实初始化 ~/.artifexnexus + silent 写 openclaw.json
status: review
priority: P1
owner: "@ivan"
assignee: ai
estimate: 1d
created: 2026-05-06
updated: 2026-05-06
parent: "[[EPIC-0001-m1-onboarding-install]]"
milestone: M1
related_adr: [0005]
related_specs:
  - "[[../../specs/openclaw-upstream-survey]]"
  - "[[../../specs/openclaw-wrapper-runtime]]"
related_packages:
  - "apps/desktop"
  - "packages/adapters/openclaw/wrapper"
tags: [story, openclaw, bootstrap, config, M1]
depends_on: ["[[STORY-0008-thin-wrapper-installer]]"]
---

# bootstrap 真实初始化 ~/.artifexnexus + silent 写 openclaw.json

## 背景与目标

S1（[[STORY-0008-thin-wrapper-installer]]）装完 CLI 后，需要在 `~/.artifexnexus/.openclaw/`
下生成完整目录布局 + 一份**自包含、可直接 gateway start** 的 `openclaw.json`，跳过上游
`openclaw onboard` 交互向导。本 STORY 完成 bootstrap 全流程，包含 artclaw 历史脚本的
**适配性核对**（详见 [[../../specs/openclaw-upstream-survey]] §8）。

## 范围 / 非范围

- 范围
  - `bootstrap.py` 实现 `bootstrap(home: Path, version: str) -> BootstrapResult`
  - 创建目录布局：`{cli/<ver>/, state/, workspace/skills/{official,team,user}, openclaw.json}`
  - 生成 `openclaw.json`：先 `openclaw gateway start --dry-run`（或类似命令）拿默认 schema →
    diff artclaw 历史脚本字段 → 裁剪复用可保留项 → 注入本项目固定值
  - 自动生成 `gateway.token = secrets.token_hex(24)`
  - 注入 `gateway.port = 19789`、`agents.defaults.workspace = $OPENCLAW_HOME/workspace`、
    `version = "v2026.5.4"`
  - 复制官方 Skill 到 `workspace/skills/official/`
  - 解决 TBD T1：实测 v2026.5.4 `openclaw.json` schema，回填 survey §8 矩阵
- 非范围
  - 端口冲突处理（S5）
  - 拉起 gateway（S3）
  - 健康检查（S4）

## 验收标准

- [ ] 在干净 dev home 上跑 bootstrap，目录布局与 [[../../specs/openclaw-wrapper-runtime]] §2 完全一致
- [ ] 生成的 `openclaw.json` 通过 `<cli>/bin/openclaw config validate`（或等价命令）校验
- [ ] artclaw 历史脚本的每个配置项有明确处置记录（保留 / 弃用 / 重写），回填 survey §8 矩阵
- [ ] 重复 bootstrap 是幂等的（已有 openclaw.json 且 token 不被覆盖）
- [ ] gateway.token 长度 ≥ 48 字符（hex 24 字节）
- [ ] 官方 Skill 文件正确复制到 workspace/skills/official/，权限正常
- [ ] bootstrap 失败时回滚（已创建的目录不留半成品）

## 设计要点

- **schema 探测策略**：S2 implement 第一步——在 dev 机上手动跑一次
  `<cli>/bin/openclaw onboard --dry-run`（如有）或直接 `gateway start` 让上游生成默认
  openclaw.json，dump 出来作为 schema 参考；将 diff 与 artclaw 脚本字段对照表写到
  survey §8 矩阵中
- **provider preset 注入**：默认不写任何 provider token（用户首启在设置面板填）；只写空 placeholder
  保证 schema 完整
- **跳 onboard**：`OPENCLAW_NO_ONBOARD=1` env 已在 S1 install 时带，bootstrap 阶段写 openclaw.json
  即跳过；S3 启动时再带一次保险

## 子任务

- [ ] `bootstrap.py` 实现 `bootstrap(home, version)` + 目录创建 + 幂等性
- [ ] `bootstrap.py` 实现 schema 探测（首次 implement 时 spawn 一次默认 openclaw 拿 default config）
- [ ] 实测 v2026.5.4 schema → 更新 survey §8 表格
- [ ] artclaw 历史脚本字段逐项裁剪复用 / 弃用决策
- [ ] sidecar 注册 RPC `openclaw.bootstrap({ version })`
- [ ] Rust 命令 + 前端 UI 串通

## 进展日志

- 2026-05-06 created（S2 of 7，依赖 S1 done）
- 2026-05-06 implement：`bootstrap.py` 完整实现（目录布局 + openclaw.json 生成 + 幂等 token 保留 + 失败回滚）；TBD T1 部分解决——基于上游文档推测 openclaw.json schema（gateway.port/token、agents.defaults.workspace、version），待首次完整安装后实测核对并回填 survey §8；artclaw 历史脚本字段处置决策已写入代码注释；测试 13/13 pass
