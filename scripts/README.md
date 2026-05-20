# Scripts — 开发者工具

> 本目录存放**开发者日常使用的脚本**，与产品安装器（Tauri build 产出的 `installer.exe`）职责不同，不可互相代替。

## 构建 & 打包

| 脚本 | 用途 | 平台 |
|---|---|---|
| `package.ps1` | **主打包脚本**：构建 Tauri → 生成便携版 zip + NSIS 安装器 | Windows |
| `dev-desktop.bat` | 一键安装 Node/pnpm/Rust/Python 工具链 + 启动 Tauri dev | Windows |
| `dev-desktop.sh` | 同上，macOS / Linux | macOS / Linux |
| `fetch-python.sh` | 下载 standalone Python 3.11（供 Tauri bundle 使用） | macOS / Linux |
| `fetch-uv.sh` | 下载 `uv` 二进制（供 Tauri bundle 使用） | macOS / Linux |
| `gen-ico.py` | 从 PNG 生成 `.ico` 图标 | 跨平台 |
| `reset-and-run.bat` | 清理残留进程 + 启动 release EXE（预发布测试用） | Windows |

### `package.ps1` 使用方式

```powershell
# 完整打包（构建 + 便携版 + NSIS）
pnpm package

# 仅便携版
pnpm package:portable

# 跳过编译，基于已有 EXE 快速重新打包
pnpm package:quick

# 直接调用（更多参数）
.\scripts\package.ps1 -SkipBuild -PortableOnly
.\scripts\package.ps1 -WithRuntime    # TODO: 包含 Python/uv 运行时
.\scripts\package.ps1 -OutputDir "D:\releases"
```

**打包流程（4 个阶段）**：

| 阶段 | 操作 | 说明 |
|------|------|------|
| Phase 1 | 创建 `staging/` 目录 | 收集运行时文件（源码树 + Skill/Tool + 标记文件），排除 marketplace |
| Phase 2 | `pnpm tauri build` | 编译 Rust → 构建前端 → NSIS 打包（resources 从 staging 注入） |
| Phase 3 | 组装便携版 zip | EXE/DLL 放根目录 + 完整文件树 → `.zip` |
| Phase 4 | 产物汇总 | 报告文件大小和路径 |

**便携版 zip 结构**（EXE 在根目录）：

```
ArtifexNexus-portable-v0.1.0.zip
└── ArtifexNexus-portable-v0.1.0/
    ├── artifex-nexus-desktop.exe          ← 用户入口
    ├── artifex_nexus_desktop_lib.dll
    ├── pnpm-workspace.yaml
    ├── packages/                          ← 源码树
    ├── skills/official/                   ← 官方 Skill（不含 marketplace）
    └── tools/official/                    ← 官方 Tool（不含 marketplace）
```

## 分发包文件清单

详见 `docs/specs/openclaw-wrapper-install.md` §1（安装包构成）和 §12.2（便携版）。

**入包**（打包脚本自动收集）：

- Python sidecar + wrapper（`packages/adapters/openclaw/wrapper/...`）
- Platform 模块（`packages/platform/{core,skill}/src/` + `contracts/`）
- Gateway MCP Bridge 插件（`gateway-plugin/dist/`，仅构建产物）
- DCC 插件模板（`packages/dcc/{unreal,blender}/`） + SDK
- 前端构建产物（`packages/apps/web/out/`）
- 官方 Skill（`skills/official/`，4 个）
- 官方 Tool（`tools/official/`，2 个）+ `diagnose_dcc_tool_run.py`
- 根标记文件（`pnpm-workspace.yaml`）

**不入包**（打包脚本自动排除）：

- `skills/marketplace/`（~35 个 Skill）
- `tools/marketplace/`（6 个 Tool）
- `gateway-plugin/src/` 和 `node_modules/`（仅要 dist/）
- `docs/`, `scripts/`, `testing/`, `copilot/`, `openspec/`, `vendor/`
- `node_modules/`（根）, `pnpm-lock.yaml`, `pyproject.toml`, `uv.lock`
- OpenClaw CLI（首启在线拉取）

## 产品安装器

产品安装器由 `pnpm tauri build` 产出，位于：

```
apps/desktop/src-tauri/target/release/bundle/nsis/ArtifexNexus_0.1.0_x64-setup.exe
```

- 内含 standalone Python，**不依赖系统 Python/Node/Rust**
- 终端用户双击即可安装，无需开发者工具链
- 详见 `docs/specs/openclaw-wrapper-install.md` §11

## 职责划分

| | 开发者工具 | 产品安装器 |
|---|---|---|
| **使用者** | 贡献者 / 开发者 | 终端用户 |
| **前置条件** | 需系统级 Node/pnpm/Rust/Python | 零依赖 |
| **产出** | 本地 dev 环境 | 可分发 `.exe` |
| **不可互相代替** | ✅ | ✅ |
