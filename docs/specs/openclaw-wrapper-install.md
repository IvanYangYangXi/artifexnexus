---
tags: [spec, openclaw, installer, tauri]
created: 2026-05-03
status: draft
---

# OpenClaw Wrapper — 安装器（Install）

> 详见总览：[[openclaw-wrapper]]。本文只讲"**怎么把东西塞进去 + 双击装出来**"。

## 1. 安装包构成

| 组件 | 来源 | 体积估 | 投放位置 |
|------|------|-------|---------|
| Tauri 壳（含前端） | 本仓 `apps/desktop/` | 3–8 MB | `<install>/` |
| `uv` 二进制 | astral-sh/uv release | ~20 MB | `<install>/runtime/uv` |
| standalone Python 3.11 | python-build-standalone | 25–40 MB | `<install>/runtime/python/` |
| **OpenClaw CLI（薄壳模式）** | **运行时拉取**：上游 `install-cli.sh` 自动下载 standalone Node-v22 + npm 全局装 `openclaw@v2026.5.4` 到隔离 prefix | 0 MB（不入安装包，~250 MB 由 install-cli.sh 落到 `~/.artifexnexus/.openclaw/cli/<ver>/`） | 不入 install pkg；首启在线拉 |
| UE 插件模板 | `packages/dcc/unreal/` 构建产物 | 2–5 MB | `<install>/plugins/ue/` |
| Blender addon 模板 | `packages/dcc/blender/` | < 1 MB | `<install>/plugins/blender/` |
| 官方 Skill 集 | `packages/platform/skill/official/*` | < 2 MB | `<install>/skills/official/` |

**安装包目标体积：Win ≤ 90 MB，macOS ≤ 100 MB**（OpenClaw 不入包，运行时拉取，详见 [[openclaw-upstream-survey]] §6）。

> ⚠ **历史 spec 更正**：原假设 OpenClaw 是 Python/uv 项目，已查证为 **Node.js / TypeScript**
> 项目（pnpm monorepo）。本项目采用**薄壳模式**：调用上游官方 `install-cli.sh` 完成安装（自带
> standalone Node-v22.22.0），不在仓内 fork 或 vendor OpenClaw 源码。Python runtime 仍保留——
> 仅供 wrapper sidecar 自身使用（详见 ADR 0005 增量小节）。

## 2. 安装路径

| OS | 应用路径 | 用户数据路径 |
|----|---------|------------|
| Windows | `%LOCALAPPDATA%\ArtifexNexus\` | `%USERPROFILE%\.artifexnexus\` |
| macOS | `/Applications/Artifex Nexus.app` | `~/.artifexnexus/` |

**强约束**：应用路径只读；一切运行时产物写入 `~/.artifexnexus/`。

## 3. 安装流程（首装）

```
1. 解压壳 + Python runtime + 模板                                            [安装器做]
2. 创建 ~/.artifexnexus/{.openclaw/{cli,state,workspace},config,logs,cache}  [首启做]
3. 写入默认 ~/.artifexnexus/config/artifexnexus.json                          [首启做]
4. 调用 install-cli.sh 装 OpenClaw 到隔离 prefix（薄壳模式，详见 §3.1）       [首启做]
5. 写入 ~/.artifexnexus/.openclaw/openclaw.json：                             [首启做]
   - gateway.port = 19789（避开上游默认 18789，详见 [[openclaw-upstream-survey]] §3）
   - gateway.token = 自动生成（secrets.token_hex(24)）
   - version = "v2026.5.4"
   - agents.defaults.workspace = ~/.artifexnexus/.openclaw/workspace
6. 探测 19789 端口，占用则提示用户改 19799 / 19809（保 +20 派生隔离余量）     [首启做]
7. 启动 OpenClaw gateway 子进程（Tauri 主进程托管，详见 [[openclaw-wrapper-runtime]]） [首启做]
8. 扫描 UE / Blender → 可选"投放插件"向导                                   [首启做]
9. 预装官方 Skill（copy 到 .openclaw/workspace/skills/）                    [首启做]
```

首启向导 UI：3 步引导（选 DCC → 确认路径 → 完成）。可跳过。

### 3.1 步骤 4 详解（薄壳安装）

通过子进程调用上游 `install-cli.sh`，注入隔离 env：

```bash
export OPENCLAW_PREFIX="$HOME/.artifexnexus/.openclaw/cli/v2026.5.4"
export OPENCLAW_VERSION="v2026.5.4"
export OPENCLAW_NO_ONBOARD=1
curl -fsSL --proto '=https' --tlsv1.2 https://openclaw.ai/install-cli.sh \
  | bash -s -- --json    # NDJSON 事件流，sidecar 解析进度回传 UI
```

Windows 等价：调用上游 `install.ps1`（同名 flag）。完整 flag/env 矩阵见 [[openclaw-upstream-survey]] §10。

> **隔离效果**：CLI 装在 `~/.artifexnexus/.openclaw/cli/v2026.5.4/`，**不入用户 PATH**；
> Tauri / sidecar 调用时一律走绝对路径 `~/.artifexnexus/.openclaw/cli/v2026.5.4/bin/openclaw`，
> 与用户系统已装的 `openclaw`（如有）零冲突。卸载只需删 `~/.artifexnexus/.openclaw/` 整个目录。

## 4. 卸载流程

- 默认：删应用路径，**保留** `~/.artifexnexus/`（用户数据神圣）
- 勾选"清除所有数据"：连 `~/.artifexnexus/` 一起删，但**不动外部 `~/.openclaw/`**

## 5. 打包工具链

- Windows：Tauri 使用 `wix`（`.msi`）或 `nsis`（`.exe`）。选 **NSIS**（自定义能力强、双击体验好）。
- macOS：Tauri 使用 `bundle.macOS.dmg` + codesign + notarize。
- CI：GitHub Actions Matrix（`windows-latest` + `macos-latest`），产物上传 Release。

## 6. 代码签名

| OS | 证书 | 触发时机 |
|----|------|---------|
| Windows | EV Code Signing（OV 亦可，首次会被 SmartScreen 警告） | CI release build |
| macOS | Apple Developer ID + notarize | CI release build |

未签名的构建仅限内部分发（M3 阶段可先不签，M5 上线前必签）。

## 7. 自动更新

- Tauri Updater，资源清单 `latest.json` 托管在 Releases/自建 CDN
- 策略：后台下载、下次启动时应用；重大版本弹确认
- OpenClaw vendor 的升级与壳**解耦**：壳内置 upgrade channel，只换 `<install>/openclaw/` 子目录

## 8. 回滚

- 保留上一版 `<install>.prev/`；更新失败自动切回
- 用户数据目录结构兼容由 ADR 保障（破坏性变更必须先 ADR）

## 9. 验收标准

- [ ] Win 10/11 双击 `.exe` 可完成安装，≤ 3 分钟（不含首启拉 OpenClaw 的网络时间）
- [ ] macOS 12+ 双击 `.dmg` 可完成安装，≤ 3 分钟
- [ ] 离线环境可安装**壳**；首启拉 OpenClaw 需联网，离线则提示后停在"未安装"状态（不报错）
- [ ] 19789 端口冲突时弹非阻塞提示，建议改 19799 / 19809（保 +20 派生隔离）
- [ ] 与外部 `~/.openclaw/`（用户已装 OpenClaw）完全无读写
- [ ] 卸载后应用路径为空；用户数据默认保留；勾选"清除所有数据"不动外部 `~/.openclaw/`

## 相关

- [[openclaw-wrapper]] · [[openclaw-wrapper-runtime]] · [[openclaw-wrapper-ipc]] · [[openclaw-wrapper-dev]]
- [[openclaw-upstream-survey]] — 上游事实底（v2026.5.4 调研，含 install-cli.sh flag/env 矩阵）
- ADR [[../decisions/0002-vendor-openclaw-fork]]、[[../decisions/0005-desktop-distribution-tauri-standalone-python]]
- [[../tasks/done/STORY-0005-installer-tauri-build-artifact]] — M0 Tauri 可分发产物
- [[../tasks/review/STORY-0007-openclaw-spec-realign]] — 本 spec 校正来源

## 10. M0 构建产物

> 本节由 STORY-0005 填充，后续版本更新。

| 产物 | 路径 | 格式 |
|---|---|---|
| Windows NSIS 安装程序 | `apps/desktop/src-tauri/target/release/bundle/nsis/Artifex Nexus_0.0.0_x64-setup.exe` | `.exe` |
| Windows MSI 安装程序 | `apps/desktop/src-tauri/target/release/bundle/msi/Artifex Nexus_0.0.0_x64_en-US.msi` | `.msi` |

**构建命令**：
```bash
cd apps/desktop
pnpm tauri build
```

**前置条件**：Rust 工具链（`rustup` + `cargo`）、Node.js 18+、pnpm。
