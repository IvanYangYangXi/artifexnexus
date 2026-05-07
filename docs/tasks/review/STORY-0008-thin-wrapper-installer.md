---
id: STORY-0008
kind: story
title: 薄壳安装器 — 调上游 install-cli.sh + NDJSON 进度回传
status: review
priority: P1
owner: "@ivan"
assignee: ai
estimate: 0.5d
created: 2026-05-06
updated: 2026-05-06
parent: "[[EPIC-0001-m1-onboarding-install]]"
milestone: M1
related_adr: [0002, 0005]
related_specs:
  - "[[../../specs/openclaw-upstream-survey]]"
  - "[[../../specs/openclaw-wrapper-install]]"
related_packages:
  - "apps/desktop"
  - "packages/adapters/openclaw/wrapper"
tags: [story, openclaw, install, thin-wrapper, M1]
---

# 薄壳安装器 — 调上游 install-cli.sh + NDJSON 进度回传

## 背景与目标

EPIC-0001 align 阶段确认（详见 [[../../specs/openclaw-upstream-survey]] §10）：上游官方
`install-cli.sh` 原生支持 `--prefix` / `--version` / `--no-onboard` / `--json`（NDJSON
事件流） / `--node-version` 全部所需 flag，**零 fallback**。本 STORY 实现"薄壳安装"：
sidecar 子进程调用 install-cli.sh 把 OpenClaw 装到隔离 prefix，解析 NDJSON 进度回传 UI。

## 范围 / 非范围

- 范围
  - `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/installer.py` 新增
  - sidecar 暴露 JSON-RPC 方法 `openclaw.install({ version, prefix? })`
  - Tauri 命令 `openclaw_install` 调 sidecar，把 NDJSON 进度事件转发为 Tauri event 给前端
  - Win 平台调 `install.ps1`（命令模板对齐，flag 名以 ps1 reference 为准，TBD T5）
  - 失败 / 网络断开的错误码标准化（`E_NETWORK` / `E_DISK_FULL` / `E_PERMISSION` / `E_UNKNOWN`）
- 非范围
  - bootstrap 写 openclaw.json（S2）
  - 拉起 gateway 子进程（S3）
  - 健康检查（S4）

## 验收标准

- [ ] sidecar `openclaw.install` 方法可在 dev home（`~/.artifexnexus.dev/.openclaw/cli/v2026.5.4/`）
      装出可执行 `bin/openclaw`，体积约 250 MB
- [ ] NDJSON 事件被 sidecar 解析成结构化 `{ phase, percent, message }`，每秒至少 1 条转发
- [ ] Tauri 前端能在安装清单 OpenClaw 行实时显示进度条 + 当前步骤文本
- [ ] 中断（`Ctrl+C` / 关闭壳）能干净停掉子进程，无残留 npm 进程
- [ ] 重复装相同版本是幂等的（install-cli.sh 自带 idempotent 行为，不报错）
- [ ] 装完后 `<prefix>/bin/openclaw --version` 输出与传入 `--version` 一致
- [ ] Win11 + macOS 14 + Ubuntu 22.04 各验证一次（CI 矩阵或本机三平台）
- [ ] 离线场景给出明确 `E_NETWORK` 错误，UI 提示"需要联网拉 OpenClaw"

## 设计要点

- **命令模板**（详见 [[../../specs/openclaw-upstream-survey]] §10.3）：
  ```bash
  curl -fsSL --proto '=https' --tlsv1.2 https://openclaw.ai/install-cli.sh \
    | bash -s -- \
      --prefix "$OPENCLAW_HOME/cli/v2026.5.4" \
      --version v2026.5.4 \
      --no-onboard \
      --json
  ```
- **NDJSON 解析**：每行一个 JSON 对象，字段如 `{"event":"download","name":"node-v22","percent":42}`，
  sidecar 用 `json.loads(line)` 逐行解析；上游字段 schema 待 implement 时实测核对（TBD T1）
- **隔离 env 注入**：调用 install-cli.sh 时已带 `OPENCLAW_HOME` / `OPENCLAW_NO_ONBOARD=1`
  (S2 写 openclaw.json 之前，CONFIG_PATH 暂不传，避免 install 阶段读不存在的文件)
- **网络代理透传**：尊重 `HTTPS_PROXY` / `HTTP_PROXY` env；中国大陆 npm 镜像 fallback 留 TBD T4

## 子任务

- [ ] `installer.py` 实现 `install_openclaw(version, prefix) -> Iterator[ProgressEvent]`
- [ ] sidecar `__init__.py` 注册 RPC 方法 `openclaw.install`，把 generator 转 NDJSON 流回 Rust
- [ ] Rust 端 `commands/openclaw_install.rs` 从 sidecar 读 NDJSON，emit Tauri event
- [ ] 前端 `routes/install-checklist` 监听 event，更新 OpenClaw 行的 progress UI
- [ ] Windows `install.ps1` flag 名实测（TBD T5），完成后回填本 STORY 与 survey
- [ ] 三平台 manual smoke test，记日志在本 STORY 进展日志

## 进展日志

- 2026-05-06 created（EPIC-0001 align 完成后正式拆出，S1 of 7）
- 2026-05-06 implement 启动：TBD T5 实测完成——`install.ps1` 无 `--prefix` 参数，仅支持 `-Tag` / `-InstallMethod` / `-NoOnboard` / `-DryRun`；Windows 薄壳改用 `npm install -g --prefix <path>` 模拟；TBD T4 实测 `openclaw.ai` 在中国大陆网络可达（PowerShell Invoke-WebRequest 成功下载 install.ps1）
- 2026-05-06 S1 核心实现完成：`installer.py`（Unix curl|bash + Win npm --prefix 双路径）、`sidecar.py`（新增 openclaw.install RPC）、`ports.py`（端口 14523→19789 + 派生段 probe）、Rust `fs_layout.rs`（三件套 env + DEV 后缀）、测试 17/18 pass（1 skip Win SO_REUSEADDR）
