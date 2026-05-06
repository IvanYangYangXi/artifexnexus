# Scripts — 开发者工具

> 本目录存放**开发者日常使用的脚本**，与产品安装器（Tauri build 产出的 `installer.exe`）职责不同，不可互相代替。

## 开发者工具

| 脚本 | 用途 | 平台 |
|---|---|---|
| `dev-desktop.bat` | 一键安装 Node/pnpm/Rust/Python 工具链 + 启动 Tauri dev | Windows |
| `dev-desktop.sh` | 同上，macOS / Linux | macOS / Linux |
| `fetch-python.sh` | 下载 standalone Python 3.11（供 Tauri bundle 使用） | macOS / Linux |
| `fetch-uv.sh` | 下载 `uv` 二进制（供 Tauri bundle 使用） | macOS / Linux |
| `gen-ico.py` | 从 PNG 生成 `.ico` 图标 | 跨平台 |

## 产品安装器

产品安装器由 `pnpm tauri build` 产出，位于：

```
apps/desktop/src-tauri/target/release/bundle/nsis/Artifex Nexus_0.0.0_x64-setup.exe
```

- 内含 standalone Python，**不依赖系统 Python/Node/Rust**
- 终端用户双击即可安装，无需开发者工具链
- 详见 `docs/specs/openclaw-wrapper-install.md` §10

## 职责划分

| | 开发者工具 | 产品安装器 |
|---|---|---|
| **使用者** | 贡献者 / 开发者 | 终端用户 |
| **前置条件** | 需系统级 Node/pnpm/Rust/Python | 零依赖 |
| **产出** | 本地 dev 环境 | 可分发 `.exe` |
| **不可互相代替** | ✅ | ✅ |
