---
id: STORY-0007
kind: story
title: OpenClaw 上游调研 + 包壳 spec 校正（Node/pnpm 取代 Python/uv 假设）
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
  - "[[../../specs/openclaw-wrapper]]"
  - "[[../../specs/openclaw-wrapper-install]]"
  - "[[../../specs/openclaw-wrapper-runtime]]"
  - "[[../../specs/openclaw-wrapper-dev]]"
related_packages:
  - "packages/adapters/openclaw/wrapper"
  - "apps/desktop"
tags: [story, research, spec, openclaw, M1]
---

# OpenClaw 上游调研 + 包壳 spec 校正

## 背景与目标

EPIC-0001 align 阶段对上游 `https://github.com/openclaw/openclaw`（锁定 tag
`v2026.5.4`）做了一次快速调研，发现上游与现有 spec 假设存在重大事实偏差：

| 现 spec 假设 | 上游实际 |
|---|---|
| OpenClaw 是 Python 项目，用 `uv sync` 装依赖 | TypeScript / Node.js / pnpm monorepo |
| 内置 standalone Python 3.11 拉起 OpenClaw | 需 Node.js runtime（pnpm install） |
| `~/.artifexnexus/.openclaw/venv/`（uv venv） | 实际是 `node_modules/` 或 pnpm store |
| 默认端口 14523（我们自定） | 上游默认 **18789**；本项目改用 **19789**（与上游 multi-gateway 文档 rescue bot 示例对齐，base+1000 远超官方建议的 +20 隔离余量） |
| Windows 双击 `.exe` 即跑 | 上游强烈推荐 WSL2，纯 Win 需评估踩坑面 |
| OpenClaw 启动入口未知 | 已查证：上游官方 `install-cli.sh`，CLI 命令 `openclaw gateway start --port <p>` |
| 隔离需 fork 改路径 | 已查证：上游原生支持 `OPENCLAW_HOME` / `OPENCLAW_STATE_DIR` / `OPENCLAW_CONFIG_PATH` 三件套 + `agents.defaults.workspace`，**零 fork** 即可全隔离 |
| 系统级开机自启服务 | M1 **不注册** systemd / launchd / schtasks，由 Tauri 主进程托管 gateway 子进程（ADR 0005 "主进程托管 sidecar" 模型），彻底回避与用户已装 OpenClaw 的 service 名冲突 |
| 全局 `npm i -g openclaw` | 改用 `install-cli.sh --prefix ~/.artifexnexus/.openclaw/cli/`，**不入用户 PATH**，调用走绝对路径，卸载只需删目录 |
| 直接照搬 artclaw `setup_openclaw_env.py` 配置 | 该脚本基于历史版本 OpenClaw，**`openclaw.json` schema / plugin 列表 / provider preset 字段都可能漂移**，必须按 v2026.5.4 实测核对后再裁剪复用 |
| 版本号硬编码在安装脚本中 | 薄壳模式必须把 OpenClaw 版本号做成一等公民参数，**M1 默认 `v2026.5.4`**，但留 `OPENCLAW_VERSION` env 与 `openclaw.json.version` 字段，M2+ 可一行升级且不破坏隔离布局 |
| install-cli.sh 是否支持 `--version` 需 fallback | **已查证：原生支持 `--version <ver>` flag + `OPENCLAW_VERSION=<ver>` env**，默认 `latest`，**零 fallback**；同时支持 `--prefix` / `--no-onboard` / `--json`（NDJSON 事件流，sidecar 可结构化解析） / `--node-version`（默认 22.22.0） |

如果继续按错误假设拆 S1–S6 实现 STORY，会在 implement 阶段才暴露技术栈不匹配，
代价远大于现在花 0.5d 校正 spec。本 STORY 不写一行实现代码，只产出**调研报告 +
spec 校正补丁**，让 EPIC-0001 的实现型 STORY 拆分基于真实事实。

## 范围 / 非范围

- 范围
  - 阅读上游 README / VISION / docs.openclaw.ai / docker-compose.yml / package.json，
    把 6 项关键事实落到调研报告
  - 修订 `openclaw-wrapper-{install,runtime,dev}.md` 与 ADR 0005 的相关章节
  - 在 EPIC-0001 反链处更新候选 S1–S6 内容（不正式拆卡，留人类启 align）
- 非范围
  - 真正引入 vendor（S1 的工作）
  - 修改 `packages/adapters/openclaw/wrapper/` 任何 `.py`
  - 改 `apps/desktop/` Rust / 前端代码

## 验收标准

- [x] 新增 `docs/specs/openclaw-upstream-survey.md`（≤ 2000 字），覆盖以下事实：
      ① 技术栈与包管理器（Node.js 24 + pnpm，install-cli.sh 自带 standalone Node）
      ② 入口启动命令（`openclaw gateway start --port 19789`）
      ③ 默认端口 18789 + 派生端口规则（browser.controlPort = port+2，CDP = controlPort+9..+108）
         ；本项目固定 `gateway.port = 19789`
      ④ 健康检查端点（HTTP + WebSocket bind 探测；如有 `/healthz` / `/api/version` 优先用，否则
         走 `OPENCLAW_STATE_DIR/lock/` 锁文件 + TCP probe fallback）
      ⑤ Windows 兼容矩阵（纯 Win / WSL2 / Docker）
      ⑥ 安装大小估算（standalone Node + CLI prefix + state + workspace 各占多少）
      ⑦ **多实例隔离 14 项 checklist**（已在 STORY 内列出，原文搬入 survey 表格）
      ⑧ **artclaw `setup_openclaw_env.py` 适配性矩阵**：列脚本里每个配置项（plugin 列表 / provider
         preset / `models.mode` / token 写入路径）→ 在 v2026.5.4 是否仍存在 / 是否 schema 漂移 /
         保留 or 弃用 or 重写
      ⑨ **版本管理策略**：`OPENCLAW_VERSION` env + `openclaw.json.version` 字段双通道；
         M1 默认 `v2026.5.4`；上游 install-cli.sh 已原生支持 `--version` flag，**零 fallback**；
         CLI prefix 按版本分目录（`cli/v2026.5.4/`、`cli/v2026.X.Y/`）支持灰度回滚
      ⑩ **install-cli.sh 完整 flag/env 矩阵**：搬入官方 reference（`--prefix` / `--version` /
         `--no-onboard` / `--json` / `--node-version` / `--install-method` 6 项 flag +
         同名 env 8 项），并标注本项目 M1 实际使用的子集
- [x] `docs/specs/openclaw-wrapper-install.md` §1 安装包构成中"Python runtime"
      行替换为"Node runtime（install-cli.sh 自带 standalone Node-v24，落 `~/.artifexnexus/.openclaw/cli/tools/node-v24/`）"；
      §3 安装流程的 `uv sync` 步骤改为 `bash install-cli.sh --prefix ~/.artifexnexus/.openclaw/cli/`
- [x] `docs/specs/openclaw-wrapper-runtime.md`：
      ① §1 进程模型把 "OpenClaw 主进程（Python）" 改为 "OpenClaw 主进程（Node.js / 由 Tauri 主进程托管）"，
         明确 **M1 不注册系统服务**
      ② §2 目录布局：`venv/` 改为 `cli/`（独立 prefix）+ `state/` + `workspace/` 三栏布局
      ③ §4 端口默认值由 14523 改为 **19789**，并附"为何不沿用上游 18789"的一行说明
      ④ §X 新增"环境变量注入"小节：列 `OPENCLAW_HOME` / `OPENCLAW_STATE_DIR` /
         `OPENCLAW_CONFIG_PATH` 三件套 + `agents.defaults.workspace` 的实际取值
- [x] `docs/specs/openclaw-wrapper-dev.md` 调试章节补 vendor 启动命令快速指引
      （`OPENCLAW_HOME=~/.artifexnexus.dev/.openclaw ~/.artifexnexus.dev/.openclaw/cli/bin/openclaw gateway start --port 19789`）
- [x] ADR 0005 增量小节 "Node runtime 引入 + 不注册系统服务"：解释
      ① 为何同时需要 standalone Python（wrapper sidecar）与 standalone Node（OpenClaw vendor）
      ② 为何 M1 不走 `openclaw gateway install`（systemd / schtasks），改走 Tauri 主进程托管子进程
      **额外**：ADR 0002 同步增补"薄壳模式取代 vendor fork"小节（撤销原决策 #1 #2，保留 #3 #4 #5），闭合引用悬链
- [x] EPIC-0001 卡的候选 S1–S6 描述据校正后 spec 同步刷新（仅文字，不开新 STORY）；扩为 S1–S7（新增版本升级通道）
- [x] 所有改动文件交叉链接齐全：spec ↔ STORY-0007 反链；STORY-0007 反链 EPIC-0001

## 设计要点

- 调研报告**只写已查证事实**，不臆测；查不到的项目明确标 `TBD: <怎么进一步查>`
- spec 修订采用**最小改动**：只动事实错误的句子，不重写章节结构
- 4 项已锁定决策（必须在 survey + spec 中显式呈现，便于后续 implement 期对齐）：
  | # | 决策 | 取值 | 依据 |
  |---|---|---|---|
  | 1 | 隔离机制 | 三 env 变量 + install-cli.sh `--prefix`，**不 fork** | docs.openclaw.ai 原生支持 |
  | 2 | `gateway.port` | **19789** | 与上游 multi-gateway rescue bot 文档对齐，base+1000 安全 |
  | 3 | 系统服务 | **不注册**，Tauri 壳托管 | 回避与用户已装 OpenClaw service 名冲突 |
  | 4 | CLI 安装 | 独立 prefix `~/.artifexnexus/.openclaw/cli/`，不入 PATH | 卸载只需删目录 |
  | 5 | 默认 OpenClaw 版本 | **v2026.5.4** | 当前适配版；通过 `OPENCLAW_VERSION` env 可切，M2+ 升级单点改动 |
  | 6 | artclaw 配置脚本复用 | 仅作**思路参考**，所有字段必须按 v2026.5.4 schema 实测核对后裁剪 | 历史脚本可能 schema 漂移 |
- ADR 0005 不重写，仅在末尾追加"补充：Node runtime 共存 + 不注册系统服务"小节，保持原有决策可追溯
- DEV 隔离按 `.dev` 后缀（`~/.artifexnexus.dev/.openclaw/`），与生产路径逻辑零分支

## 子任务

- [x] 阅读上游 README + VISION + 顶层 `package.json` + `docker-compose.yml` + `appcast.xml`
- [x] 阅读 `docs.openclaw.ai/install/*` 与 `docs.openclaw.ai/start/getting-started`
- [x] 写 `docs/specs/openclaw-upstream-survey.md`
- [x] 改 `docs/specs/openclaw-wrapper-install.md`
- [x] 改 `docs/specs/openclaw-wrapper-runtime.md`
- [x] 改 `docs/specs/openclaw-wrapper-dev.md`
- [x] 改 `docs/decisions/0005-desktop-distribution-tauri-standalone-python.md`
- [x] 改 `docs/decisions/0002-vendor-openclaw-fork.md`（额外，闭合 ADR 0005 引用悬链）
- [x] 更新 EPIC-0001 候选 STORY 文字描述

## 进展日志

- 2026-05-06 created（EPIC-0001 align 期间分裂）—— 状态直接落 ready，等待人类启 implement
- 2026-05-06 align 阶段调研基本完成：
  - 已查证上游官方文档：`docs.openclaw.ai/start/getting-started`、`/gateway/multiple-gateways`、`/gateway/gateway-lock`
  - 已锁定 4 项关键决策（端口 19789 / 不注册服务 / 独立 prefix / 三 env 隔离）
  - 已识别 14 项与"用户已装 OpenClaw"的冲突点，全部可隔离
  - 待 implement 阶段：把以上事实落到 7 份文件（survey + 3 spec + ADR 0005 + EPIC-0001 + board.md）
- 2026-05-06 align 补充（用户提示）：新增 2 项关键约束
  - 决策 5：默认 OpenClaw 版本 **v2026.5.4**，`OPENCLAW_VERSION` env 控制升级，CLI prefix 按版本分目录支持灰度
  - 决策 6：artclaw 历史 `setup_openclaw_env.py` 仅作思路参考，所有 `openclaw.json` 字段必须按 v2026.5.4 schema 实测后再裁剪
  - survey 验收清单从 7 项扩为 9 项（新增 artclaw 适配性矩阵 + 版本管理策略）
- 2026-05-06 align 风险前置调研：核对 `docs.openclaw.ai/install/installer` 完整 flag / env reference
  - **结论：install-cli.sh 原生支持 `--version <ver>` + `OPENCLAW_VERSION` env，零 fallback**
  - 同时支持 `--prefix` / `--no-onboard` / `--json`（NDJSON 事件流） / `--node-version`（默认 22.22.0） / `--install-method`
  - S1 复杂度评估下调（一行命令 + 结构化日志），可考虑估时 1d → 0.5d，预算分配给 S2/S4
  - survey 验收清单从 9 项扩为 10 项（新增 install-cli.sh 完整 flag/env 矩阵）
- 2026-05-06 推进至 in-progress，启 implement 阶段
- 2026-05-06 implement 完成，交付 7 份产出（实际 8 份，含 ADR 0002 引用悬链修补）：
  1. `docs/specs/openclaw-upstream-survey.md` 新建（10 节事实底 + 11 节 TBD 集合）
  2. `docs/specs/openclaw-wrapper-install.md` patch §1 §3 §9 + §3.1 新增（薄壳安装命令）
  3. `docs/specs/openclaw-wrapper-runtime.md` patch §1 §2 §3 §4 §7 §9（端口 14523→19789、env 三件套、不注册服务）
  4. `docs/specs/openclaw-wrapper-dev.md` patch §1 §3 §5 §7 §8 + §3.1 新增（手动启动 vendor 命令）
  5. `docs/decisions/0005-...` 末尾追加"Node runtime 共存 + M1 不注册系统服务"补充小节（保留原决策）
  6. `docs/decisions/0002-...` 末尾追加"薄壳模式取代 vendor fork"补充小节（撤销原 #1 #2，保留 #3 #4 #5）
  7. `docs/tasks/board.md` STORY-0007 由 Ready 移入 In Progress
  8. `docs/tasks/ready/EPIC-0001-...` 候选 S1–S6 扩为 S1–S7，进展日志同步
  → 待 human review；review 通过后 STORY-0007 archive 进 done/，EPIC-0001 即可正式拆 S1–S7 实现型 STORY 进入 implement
