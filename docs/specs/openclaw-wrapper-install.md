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
| OpenClaw vendor 快照 | 本仓 `packages/adapters/openclaw/vendor/` | 5–10 MB | `<install>/openclaw/` |
| UE 插件模板 | `packages/dcc/unreal/` 构建产物 | 2–5 MB | `<install>/plugins/ue/` |
| Blender addon 模板 | `packages/dcc/blender/` | < 1 MB | `<install>/plugins/blender/` |
| 官方 Skill 集 | `packages/platform/skill/official/*` | < 2 MB | `<install>/skills/official/` |

**安装包目标体积：Win ≤ 90 MB，macOS ≤ 100 MB**。

## 2. 安装路径

| OS | 应用路径 | 用户数据路径 |
|----|---------|------------|
| Windows | `%LOCALAPPDATA%\ArtifexNexus\` | `%USERPROFILE%\.artifexnexus\` |
| macOS | `/Applications/Artifex Nexus.app` | `~/.artifexnexus/` |

**强约束**：应用路径只读；一切运行时产物写入 `~/.artifexnexus/`。

## 3. 安装流程（首装）

```
1. 解压壳 + runtime + vendor + templates                [安装器做]
2. 创建 ~/.artifexnexus/{.openclaw, config, logs, cache} [首启做]
3. 写入默认 ~/.artifexnexus/config/artifexnexus.json     [首启做]
4. uv sync --project <install>/openclaw                  [首启做，离线可走本地 index]
5. 探测端口 14523，占用则自增到首个空闲                  [首启做]
6. 启动 OpenClaw 进程（子进程，管道回传日志）            [首启做]
7. 扫描 UE / Blender → 可选"投放插件"向导              [首启做]
8. 预装官方 Skill（copy 到 .openclaw/workspace/skills/） [首启做]
```

首启向导 UI：3 步引导（选 DCC → 确认路径 → 完成）。可跳过。

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

- [ ] Win 10/11 双击 `.exe` 可完成安装，≤ 3 分钟
- [ ] macOS 12+ 双击 `.dmg` 可完成安装，≤ 3 分钟
- [ ] 离线环境可安装（无网络）
- [ ] 端口冲突时自动选用新端口，UI 有非阻塞提示
- [ ] 与外部 `~/.openclaw/` 完全无读写
- [ ] 卸载后应用路径为空；用户数据默认保留

## 相关

- [[openclaw-wrapper]] · [[openclaw-wrapper-runtime]] · [[openclaw-wrapper-ipc]] · [[openclaw-wrapper-dev]]
- ADR [[../decisions/0002-vendor-openclaw-fork]]
