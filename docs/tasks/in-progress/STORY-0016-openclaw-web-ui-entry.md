---
id: STORY-0016
kind: story
title: OpenClaw Web UI 入口按钮 + URL 探测
status: in-progress
priority: P1
owner: "@ivan"
assignee: pair
estimate: 0.5d
created: 2026-05-07
updated: 2026-05-07
started: 2026-05-07
parent: "[[EPIC-0001-m1-onboarding-install]]"
milestone: M1
related_adr: [0002, 0005]
related_specs:
  - "[[../../specs/openclaw-upstream-survey]]"
  - "[[../../specs/openclaw-wrapper-runtime]]"
  - "[[../../specs/openclaw-wrapper-ipc]]"
  - "[[../../specs/ui/installer-structure]]"
related_packages:
  - "apps/desktop"
  - "packages/adapters/openclaw/wrapper"
tags: [story, openclaw, web-ui, entry, M1]
---

# OpenClaw Web UI 入口按钮 + URL 探测

## 背景与目标

EPIC-0001 第二批需求 #2：在 Artifex Nexus 自有 Web UI（M3 才做）就绪之前，先给一个
跳板入口直接打开 OpenClaw 上游内建的 Web UI / Studio（如果有）。安装向导 OpenClaw
行右侧加第 4 个按钮"Web UI"，仅在已安装且 Gateway 在跑时可点；点击调用
`tauri-plugin-shell` 用系统默认浏览器打开。

由于 OpenClaw v2026.5.4 是否带内建 Web UI / Web URL 是未知的（[[../../specs/openclaw-upstream-survey]]
§11 T7 未解），本 STORY **必须先 spike 实测**，再实现。

## 范围 / 非范围

- 范围
  - **TBD T7 spike**（0.2d）：sidecar 内跑 `openclaw --help` / `openclaw web --help` /
    `openclaw studio --help` / `openclaw config get`，找出 OpenClaw 暴露 Web UI 的命令与端口
  - 新增 sidecar JSON-RPC `openclaw.web.get_url` → `{url, available, reason?}`
  - `apps/desktop/src/features/installer/InstallItemRow.tsx` OpenClaw 行加第 4 按钮"Web UI"
  - 装 `@tauri-apps/plugin-shell`，配置 Tauri capabilities 允许 `shell:allow-open`
  - 点击按钮 → invoke RPC 拿 URL → `open()` 默认浏览器
  - `openclaw.status` RPC 扩展返回 `web_ui_available: bool` 字段，让 UI 知道是否要永久置灰
- 非范围
  - Artifex Nexus 自家 Web UI（→ EPIC-0003 M3）
  - 嵌套到 Tauri WebView 内部展示
  - Web UI 鉴权 / 单点登录

## 验收标准

- [ ] OpenClaw 行渲染第 4 个按钮"Web UI"，与"检测 / 设置 / 安装"并列
- [ ] `state ≠ installed` → disabled，tooltip "请先安装 OpenClaw"
- [ ] `gateway_running = false` → disabled，tooltip "Gateway 未运行"
- [ ] `web_ui_available = false` → 永久 disabled，tooltip "当前版本未提供 Web UI"
- [ ] 点击后用系统默认浏览器打开，URL 正确（spike 实测得出）
- [ ] sidecar `openclaw.web.get_url` 在 OpenClaw 不带 Web UI 时返回 `{available: false,
      reason: "OpenClaw v2026.5.4 未提供 Web UI"}`，前端按规则置灰
- [ ] Tauri capabilities 仅允许打开 `http://127.0.0.1:*` 与 `https://127.0.0.1:*`，
      不开放任意 URL（避免被恶意 RPC 利用）
- [ ] 单测：`web_ui.py` 三种返回（available / 不可用 / 探测失败）≥ 4 个用例

## 设计要点

### URL 探测优先级（spike 后落定，下面是 fallback 链）

1. `openclaw config get web.url` 拿到显式配置的 URL（最稳）
2. `openclaw web list-urls` / `openclaw studio status` 等内建命令
3. fallback：直访 `http://127.0.0.1:<gateway.port>`，HTTP HEAD 返回 2xx 即视为可用
4. 全部失败 → `available = false`

### Tauri shell 权限最小化

```json
// apps/desktop/src-tauri/capabilities/default.json 追加
{
  "identifier": "shell:allow-open",
  "allow": [
    { "url": "http://127.0.0.1:*" },
    { "url": "https://127.0.0.1:*" }
  ]
}
```

> 不开放任意 URL 避免 sidecar 被劫持后跳到外站。

### 与 STORY-0015 的关系

设置面板内不展示"Web UI URL"字段（URL 由 OpenClaw 自管，本项目只读不写）；
未来 OpenClaw 若把 web port 做成可配置，再考虑加字段。

## 子任务

- [x] **T7 spike**（2026-05-07）：实测 OpenClaw v2026.5.4 自带 Control UI（复用
      `gateway.port`，配置在 `gateway.controlUi.*`）；CLI 命令 `openclaw dashboard --no-open`
      直接打印含 token 的 URL；4 级 fallback 不需要，直接走 dashboard 命令；回填
      [[../../specs/openclaw-upstream-survey]] §14
- [x] `wrapper/web_ui.py` 实现 `get_web_url()`：spawn `openclaw dashboard --no-open`
      → 解析 stdout 提取 URL → 返回 `{url, available, reason?}`
- [ ] `wrapper/web_ui.py` 检查 `gateway.controlUi.enabled`：若 false 则 patch 为 true
      并提示用户重启 gateway（或自动 reload）  *(降级：当前实现仅按返回码探测；patch 由 STORY-0015 设置面板统一处理)*
- [x] `wrapper/sidecar.py` 注册 RPC `openclaw.web.get_url`
- [x] `wrapper/sidecar.py` 扩展 `openclaw.status` 返回 `web_ui_available: bool` 字段
- [x] 单测 ≥ 4 个用例（dashboard 成功 / gateway 未启 / dashboard 命令失败 / URL 解析） — 实测 12 用例通过
- [x] `apps/desktop/package.json` 加 `@tauri-apps/plugin-shell` *(已存在 ^2.0.0)*
- [x] `Cargo.toml` 加 `tauri-plugin-shell` *(已存在 v2)*
- [x] `apps/desktop/src-tauri/src/lib.rs` 注册 shell plugin *(已注册)*
- [x] capabilities 配置 URL 白名单（仅 `127.0.0.1` http/https） — 新建 `capabilities/default.json`
- [x] `apps/desktop/src/ipc/openclaw.ts` 加 `getOpenClawWebUrl()`
- [x] `InstallItemRow.tsx` OpenClaw 行加第 4 按钮"Web UI"
- [x] 三态门禁：not-installed / gateway 未跑 / Web UI 不可用 → 各自 tooltip
- [ ] 三平台手测（Win11 / macOS 14 / Ubuntu 22.04）默认浏览器都能打开 *(待手测)*

## 进展日志

- 2026-05-07 created（EPIC-0001 第二批需求 #2）
- 2026-05-07 T7 spike 完成：实测 OpenClaw 自带 Control UI（复用 gateway.port），CLI `openclaw dashboard --no-open` 一行命令拿含 token 的 URL；4 级 fallback 简化为单命令；STORY-0016 子任务按真相重新拆分
- 2026-05-07 进入 in-progress：开始按子任务推进 sidecar `web_ui.py` + Tauri shell 插件 + `InstallItemRow` 第 4 按钮
- 2026-05-07 后端完成：`web_ui.py` 模块 + sidecar RPC `openclaw.web.get_url` + status 新增 `web_ui_available` 字段；wrapper pytest 66 通过 2 跳过 0 失败（其中 web_ui 12 用例全绿）
- 2026-05-07 前端完成：Tauri 命令 `openclaw_web_get_url` + capabilities `shell:allow-open` 白名单（仅 127.0.0.1/localhost）+ IPC `getOpenClawWebUrl()` + `InstallItemRow` OpenClaw 行第 4 按钮（4 态门禁：not-installed / gateway-down / web-ui-unavailable / opening）；`pnpm typecheck` 通过；剩余三平台手测留到 M1 收口
- 2026-05-07 联调期反馈（Win11 用户）：**Web UI 按钮恒灰** ⇒ 根因是 STORY-0010 R1（`[WinError 193]`）导致 gateway 启不起来 → `gateway_running=false` → 按钮自动置灰，**不是本卡缺陷**。修复路径：ADR 0007 + `_subprocess.py` helper 落地后，本卡 `web_ui.py::get_web_url()` 的 spawn 调用同步迁移到 helper（一并验证 dashboard 命令在 Win 上能拿到 URL）
