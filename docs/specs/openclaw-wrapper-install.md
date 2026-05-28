---
tags: [spec, openclaw, installer, tauri]
created: 2026-05-03
status: accepted
---

# OpenClaw Wrapper — 安装器（Install）

> 详见总览：[[openclaw-wrapper]]。本文只讲"**怎么把东西塞进去 + 双击装出来**"。

## 1. 安装包构成

> **分发物为单个 `.exe` 安装文件**（NSIS 自解压安装器）。所有以下组件被打包进该 `.exe` 内部（LZMA 压缩），
> 用户双击后由 NSIS 解压到 `%LOCALAPPDATA%\ArtifexNexus\`。详见 §11。

| 组件 | 来源 / 仓内路径 | 体积估 | 投放位置 |
|------|-----------------|--------|---------|
| Tauri 壳（含前端） | `artifex-nexus-desktop.exe` + `artifex_nexus_desktop_lib.dll` + `packages/apps/web/out/`（Next.js 构建产物） | 13–16 MB | `<install>/` |
| **Python sidecar + 全部依赖** | `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/*.py`（23 个 .py） + `assets/agents/workspace/`（3 个 .md 人格文件） | < 1 MB | `<install>/packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/` |
| **Skill 系统（sidecar 运行时依赖）** 🔴 | `packages/platform/skill/src/artifex_nexus/skill/`（24 个 .py，含 hub/nexus_tool/manifest/conflict 等子模块） | < 1 MB | `<install>/packages/platform/skill/src/artifex_nexus/skill/` |
| **Core 配置模块（sidecar 运行时依赖）** 🔴 | `packages/platform/core/src/artifex_nexus/core/skill_config.py` | < 1 MB | `<install>/packages/platform/core/src/artifex_nexus/core/` |
| **Gateway MCP Bridge 插件（构建产物）** | `packages/adapters/openclaw/gateway-plugin/dist/{index.js, openclaw.plugin.json}` | < 1 MB | `<install>/packages/adapters/openclaw/gateway-plugin/dist/` |
| standalone Python 3.11 | python-build-standalone | 25–40 MB | `<install>/runtime/python/` |
| `uv` 二进制 | astral-sh/uv release | ~20 MB | `<install>/runtime/uv/` |
| **OpenClaw CLI（薄壳模式）** | ⚠️ **不入安装包**。首启时 `installer.py` 调用上游 `install-cli.sh` / `install.ps1` 在线拉取 standalone Node-v22.22.0 + OpenClaw 包 | 0 MB（~250 MB 由 install-cli.sh 落到 `~/.artifexnexus/.openclaw/cli/v2026.5.4/`） | 不入 `.exe` |
| UE 插件模板 | `packages/dcc/unreal/`（ArtifexNexusForUnreal.uplugin + Source/ + Content/） | 2–5 MB | `<install>/packages/dcc/unreal/` |
| Blender addon 模板 | `packages/dcc/blender/src/` | < 1 MB | `<install>/packages/dcc/blender/src/` |
| **SDK 单一源** | `packages/dcc/shared/artifex_nexus_sdk/`（5 个 .py：__init__.py, params.py, result.py, context.py, event.py, logger.py） | < 1 MB | `<install>/packages/dcc/shared/artifex_nexus_sdk/` |
| **官方 Skill 集（仅 official/）** 🔵 | `skills/official/`（4 个 Skill：artclaw-skill-manage, artclaw-tool-creator, artclaw-tool-executor, dcc-node-graph-workflow） | < 1 MB | `<install>/skills/official/` |
| **官方 Tool 集（仅 official/）** 🔵 | `tools/official/`（2 个 Tool：artclaw-skill-compliance-checker, tool-compliance-checker + `diagnose_dcc_tool_run.py`） | < 1 MB | `<install>/tools/official/`（+ 根级 `tools/diagnose_dcc_tool_run.py`） |
| **契约数据 & Schema** | `packages/platform/contracts/data/categories.json` + `packages/platform/contracts/schemas/*.schema.json`（9 个 schema） | < 1 MB | `<install>/packages/platform/contracts/{data,schemas}/` |
| **项目根标记文件** 🔴 | `pnpm-workspace.yaml`（`sidecar.py::_find_project_root()` 依赖它定位项目根目录） | < 1 KB | `<install>/pnpm-workspace.yaml` |

**明确不入包（排除列表）** ❌：

| 组件 | 原因 |
|------|------|
| `skills/marketplace/`（~35 个 Skill，1.9 MB） | 用户按需从 marketplace 安装，不入基础包 |
| `tools/marketplace/`（6 个 Tool，148 KB） | 同上 |
| `packages/adapters/openclaw/gateway-plugin/src/`、`node_modules/` | 仅分发构建产物 `dist/`，源码和 dev 依赖不入包 |
| `apps/desktop/src/`、`apps/desktop/src-tauri/target/` | 开发用安装向导壳 + Rust 编译中间产物 |
| `docs/`、`scripts/`、`testing/`、`copilot/`、`openspec/`、`vendor/` | 开发文档/脚本/测试，与运行时无关 |
| `node_modules/`（根）、`pnpm-lock.yaml`、`pyproject.toml`、`uv.lock` | dev/build 依赖 |
| OpenClaw CLI | 首启在线拉取（薄壳模式），节省 ~250 MB 安装包体积 |

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
1. 解压壳 + Python runtime + 源码树（packages/ + skills/official/ + tools/official/）   [安装器做]
2. 创建 ~/.artifexnexus/{.openclaw/{cli,state,workspace},config,logs,cache}             [首启做]
3. 写入默认 ~/.artifexnexus/config/artifexnexus.json                                    [首启做]
4. 注入 PYTHONPATH：packages/platform/{core,skill}/src/ + packages/dcc/shared/          [首启做]
5. 调用 install-cli.sh 装 OpenClaw 到隔离 prefix（薄壳模式，详见 §3.1）                [首启做]
6. 写入 ~/.artifexnexus/.openclaw/openclaw.json：                                       [首启做]
   - gateway.port = 19789（避开上游默认 18789，详见 [[openclaw-upstream-survey]] §3）
   - gateway.token = 自动生成（secrets.token_hex(24)）
   - version = "v2026.5.4"
   - agents.defaults.workspace = ~/.artifexnexus/.openclaw/workspace
7. 探测 19789 端口，占用则提示用户改 19799 / 19809（保 +20 派生隔离余量）              [首启做]
8. 启动 OpenClaw gateway 子进程（Tauri 主进程托管，详见 [[openclaw-wrapper-runtime]]）   [首启做]
9. 扫描 UE / Blender → 可选"投放插件"向导                                               [首启做]
10. 预装官方 Skill（copy 到 .openclaw/workspace/skills/）                                [首启做]
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

- Windows：Tauri 使用 NSIS 生成 **单个 `.exe` 自解压安装器**（非 `.exe + 目录` 组合）。详见 §11。
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
- [[../tasks/done/STORY-0007-openclaw-spec-realign]] — 本 spec 校正来源

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

## 11. NSIS 单文件安装器详解

### 11.1 分发形态

**分发物是一个单独的 `.exe` 文件**，例如 `ArtifexNexus_0.1.0_x64-setup.exe`。

用户下载的就是这一个 `.exe`，不是 `.exe + 一堆目录/文件`。所有组件（见 §1）在 CI 构建阶段被打包进该 `.exe` 内部（LZMA 压缩）。

### 11.2 工作原理

> **目录选择已支持**：安装器包含标准 `MUI_PAGE_DIRECTORY` 页面（`installer.nsi` 行 380），
> 用户可在安装向导中自由选择/浏览安装目录。默认路径：`%LOCALAPPDATA%\artifex-nexus·山雀`
> （`currentUser` 模式，见 `.onInit` 行 501）。也支持 `/D=` 命令行参数静默指定。

```
┌──────────────────────────────────────────────────┐
│  ArtifexNexus_0.1.0_x64-setup.exe (单个文件)       │
│                                                    │
│  ┌──────────────────────────────────────────────┐ │
│  │  NSIS 安装器壳（~100 KB）                      │ │
│  │  - 欢迎页 → 目录选择 🔵 → 进度条 → 完成页      │ │
│  │  - 注册表写入（Uninstall 条目）                 │ │
│  │  - 开始菜单快捷方式 + 桌面快捷方式              │ │
│  │  - 卸载器生成（uninstall.exe）                  │ │
│  └──────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────┐ │
│  │  LZMA 压缩载荷（~80-90 MB）                    │ │
│  │                                                │ │
│  │  ├─ artifex-nexus-desktop.exe (Rust EXE)       │ │
│  │  ├─ artifex_nexus_desktop_lib.dll (Rust DLL)   │ │
│  │  ├─ packages/                          ← 源码树 │ │
│  │  │   ├─ adapters/openclaw/wrapper/             │ │
│  │  │   ├─ adapters/openclaw/gateway-plugin/dist/ │ │
│  │  │   ├─ dcc/unreal/                            │ │
│  │  │   ├─ dcc/blender/src/                       │ │
│  │  │   ├─ dcc/shared/artifex_nexus_sdk/          │ │
│  │  │   ├─ apps/web/out/                          │ │
│  │  │   └─ platform/
│  │  │       ├─ contracts/{data,schemas}/           │ │
│  │  │       ├─ core/src/artifex_nexus/core/        │ │
│  │  │       └─ skill/src/artifex_nexus/skill/      │ │
│  │  ├─ skills/official/                           │ │
│  │  ├─ tools/official/                            │ │
│  │  ├─ tools/diagnose_dcc_tool_run.py             │ │
│  │  ├─ runtime/python/    ← standalone Python     │ │
│  │  └─ runtime/uv/        ← uv 二进制            │ │
│  └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘

用户双击 → NSIS 解压全部文件到 %LOCALAPPDATA%\ArtifexNexus\ 
→ 写注册表 → 创建快捷方式 → 完成
```

### 11.3 安装后的磁盘布局

```
%LOCALAPPDATA%\ArtifexNexus\     ← 应用目录（只读，由安装器写入）
│
├─ artifex-nexus-desktop.exe     ← 主程序
├─ artifex_nexus_desktop_lib.dll
├─ uninstall.exe                 ← NSIS 生成的卸载器
├─ pnpm-workspace.yaml           ← 项目根标记（sidecar 用它定位 monorepo 根）
│
├─ packages/                     ← 源码树（保留原始目录结构）
│   ├─ adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/
│   │   ├─ sidecar.py            ← Tauri 查找 sidecar 的入口点
│   │   ├─ bootstrap.py
│   │   ├─ runtime.py
│   │   ├─ installer.py
│   │   ├─ dcc_installer.py
│   │   ├─ tool_sources.py
│   │   ├─ assets/agents/workspace/{IDENTITY,SOUL,USER}.md
│   │   └─ ...（共 23 个 .py）
│   ├─ adapters/openclaw/gateway-plugin/dist/
│   │   ├─ index.js              ← MCP Bridge 插件入口
│   │   └─ openclaw.plugin.json
│   ├─ dcc/unreal/               ← UE 插件模板
│   ├─ dcc/blender/src/          ← Blender addon 源码
│   ├─ dcc/shared/artifex_nexus_sdk/  ← SDK 单一源
│   ├─ apps/web/out/             ← Next.js 前端产物（Tauri WebView 加载）
│   └─ platform/
│       ├─ contracts/{data,schemas}/
│       ├─ core/src/artifex_nexus/core/  ← skill_config.py（sidecar 运行时依赖）
│       └─ skill/src/artifex_nexus/skill/ ← Skill 系统 hub/nexus_tool/manifest...（sidecar 运行时依赖）
│
├─ skills/official/              ← 官方 Skill（仅 official/，不含 marketplace/）
│   ├─ artclaw-skill-manage/
│   ├─ artclaw-tool-creator/
│   ├─ artclaw-tool-executor/
│   └─ dcc-node-graph-workflow/
│
├─ tools/                        ← 官方 Tool（仅 official/，不含 marketplace/）
│   ├─ diagnose_dcc_tool_run.py
│   └─ official/
│       ├─ artclaw-skill-compliance-checker/
│       └─ tool-compliance-checker/
│
├─ runtime/
│   ├─ python/                   ← standalone Python 3.11
│   └─ uv/                       ← uv 二进制
│
└─ .update/                      ← 自动更新预留（Tauri Updater）
```

### 11.4 源码目录管理策略

**核心理念**：安装后的 `packages/` 树是**运行时只读的源码模板**，用户数据全部写入 `~/.artifexnexus/`。

| 目录 | 读写属性 | 生命周期 | 说明 |
|------|---------|---------|------|
| `<install>/` | 安装器写，运行时只读 | 安装/卸载/升级 | NSIS 管理，用户不可直接修改 |
| `~/.artifexnexus/` | 运行时读写 | 永久（除非用户主动删除） | 用户数据神圣领域，卸载默认保留 |

**具体策略**：

1. **Tauri EXE 启动** → `lib.rs:resolve_sidecar_path()` 从 EXE 所在目录向上查找 `packages/adapters/openclaw/wrapper/.../sidecar.py`
2. **Python sidecar** 以 `packages/adapters/openclaw/wrapper/src/artifex_nexus/openclaw_wrapper/` 为 `__package__` 根，通过 `PYTHONPATH` 注入实现模块导入
3. **Skill 安装**：`bootstrap.py` 从 `<install>/skills/official/` **物理拷贝**到 `~/.artifexnexus/.openclaw/workspace/skills/official/`（此后用户数据独立于安装包）
4. **DCC 插件安装**：从 `<install>/packages/dcc/` **物理拷贝**到对应 DCC 的 addons 目录或 UE 项目插件目录
5. **MCP Bridge 部署**：从 `<install>/packages/adapters/openclaw/gateway-plugin/dist/` **物理拷贝**到 `~/.artifexnexus/.openclaw/cli/<ver>/.../extensions/mcp-bridge/`
6. **升级时**：Tauri Updater 替换整个 `<install>/`，`~/.artifexnexus/` 完全不受影响

> **为什么用物理拷贝而非 symlink/junction**：OpenClaw v2026.5.4 的 `fs.realpathSync` 安全检查不兼容跨卷 junction/symlink，详见 ADR 0008。

## 12. 构建产物一览

### 12.1 可分发产物（CI 产出）

| 产物 | 路径（`apps/desktop/src-tauri/target/release/bundle/`） | 格式 |
|------|------|------|
| Windows NSIS 安装程序 | `nsis/ArtifexNexus_<version>_x64-setup.exe` | 单个 `.exe` 自解压安装器 |
| macOS DMG 安装包 | `dmg/ArtifexNexus_<version>_x64.dmg` | `.dmg` |

### 12.2 私自分发（开发阶段）

在 NSIS 打包未完成时（M1-M2），可直接分发以下文件作为**临时绿色包（便携版）**：

```
ArtifexNexus-portable/
├─ artifex-nexus-desktop.exe            ← 🔵 EXE 放根目录，用户一眼可见
├─ artifex_nexus_desktop_lib.dll        ← Rust 动态库（Windows DLL 搜索优先级：EXE 同目录最优先）
├─ pnpm-workspace.yaml                  ← 项目根标记（Rust + Python 双端定位锚点）
├─ packages/                            ← 完整源码树（同上 §11.3）
├─ skills/official/                     ← 官方 Skill（仅 official/）
├─ tools/official/                      ← 官方 Tool（仅 official/）
├─ tools/diagnose_dcc_tool_run.py       ← DCC 诊断工具
└─ runtime/                             ← standalone Python + uv（如有）
```

> **不含** `skills/marketplace/` 和 `tools/marketplace/`。绿色包不写注册表、不创建快捷方式，用户数据同样落 `~/.artifexnexus/`。

#### EXE 放根目录的路径兼容性分析

将 `artifex-nexus-desktop.exe` 从 `apps/desktop/src-tauri/target/release/` 提升到绿色包根目录，**无需修改任何代码**。两端的路径查找逻辑都从 EXE/sidecar.py 位置**向上**遍历父目录，天然兼容：

| 查找步骤 | Rust `resolve_sidecar_path()` | Rust `resolve_project_root()` | Python `_find_project_root()` |
|---------|------|------|------|
| 起点 | `current_exe()` → parent = `root/` | `current_exe()` → parent = `root/` | `__file__` = `packages/.../sidecar.py` |
| 查找目标 | `$dir/packages/adapters/.../sidecar.py` | `$dir/packages/` | `$dir/pnpm-workspace.yaml` |
| 迭代 0 | `root/packages/.../sidecar.py` → **命中** ✅ | `root/packages/` → **命中** ✅ | 向上 5 层到 `root/pnpm-workspace.yaml` → **命中** ✅ |
| 结果 | `root/packages/.../sidecar.py` | `root/` | `root/` |

> **原理**：两个 Rust 函数都从 `current_exe()` 的父目录开始**向上**最多 8 层查找；Python 端从 `__file__` 向上最多 10 层查找 `pnpm-workspace.yaml`。只要 EXE 与 `packages/`、`pnpm-workspace.yaml` 同级或在其子目录中，就一定命中。EXE 放根目录恰好使 `packages/` 成为直接兄弟目录（迭代 0 即命中，最快路径）。

与安装版的差异见下表：

| 维度 | 安装版（NSIS .exe） | 绿色包 |
|------|-------------------|--------|
| 分发形态 | 单个 `.exe` 安装文件（LZMA 压缩） | 目录压缩包（.zip / .7z） |
| 安装位置 | `%LOCALAPPDATA%\ArtifexNexus\`（由 NSIS 解压） | 用户自选目录（手动解压） |
| 注册表 | 写 HKCU Uninstall 条目 | 不写 |
| 开始菜单/桌面快捷方式 | 创建 | 不创建 |
| 卸载 | NSIS 卸载器（uninstall.exe） | 直接删目录 |
| 用户数据 | `~/.artifexnexus/` | `~/.artifexnexus/`（相同） |
