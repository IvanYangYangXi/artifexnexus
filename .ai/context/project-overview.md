# 项目速览（AI 长程上下文）

**项目**：Artifex Nexus — The AI-Agent Bridge for Digital Creation
**前身**：[artclaw_bridge](https://github.com/IvanYangYangXi/artclaw_bridge)（重构 fork）
**目标平台**：OpenClaw（唯一首发，vendor 锁定版本）
**目标 DCC**：Unreal Engine 5.7、Blender 5.1
**仓库形态**：monorepo（pnpm + Turborepo + uv workspaces）
**文档形态**：Obsidian Vault（`docs/`），单一信息源

## 五大重构目标

详见 `[[../../docs/vision/north-star]]`：

1. **品牌定位** — 改名 Artifex Nexus；DCC 插件统一 `Artifex Nexus for <DCC>`
2. **重构与标准化** — 四层 SDK / 契约：core / platform-adapter / dcc-adapter / skill SDK
3. **收敛范围** — 只接 OpenClaw；DCC 只做 UE5.7 + Blender 5.1
4. **稳定性与分发** — fork OpenClaw 锁版本，安装到 `~/.artifexnexus/.openclaw/`（隔离）；双安装模式 link/copy
5. **入口与体验** — Tool Manager 升级为 Artifex Nexus Web UI（标准入口）

## 架构关键词

- **上行（聊天）**：DCC 内 `adapters/openclaw/uplink` ──WebSocket RPC──► OpenClaw Gateway
- **下行（工具）**：Gateway 内 `adapters/openclaw/gateway-plugin` ──MCP JSON-RPC──► DCC 内 MCP Server
- **唯一 MCP 工具**：`run_python`（Gateway 端自动加 `mcp_<dcc>_` 前缀隔离）
- **Skill ≠ Tool**：Skill 是包，Tool 是包内被 `@tool` 装饰的函数
- **Skill SDK**：`from artifex_nexus.skill import tool, ToolResult, execute, list_skills`
- **契约即源**：所有跨进程数据结构在 `packages/platform/contracts/schemas/` 定义一次，派生 Python/TS

## 包索引

```
packages/
├── platform/                # 平台层（所有 DCC/适配复用）
│   ├── core/                # bridge 协议、配置、记忆、事件总线
│   ├── skill/               # Skill 子系统（按职责拆 8 个子模块）
│   ├── contracts/           # 契约：JSON Schema + pydantic + Python ABC + TS types
│   └── cli/                 # `artifex` 命令
│
├── ui/                      # @artifex-nexus/ui — 统一设计系统（M3 起）
│                            # tokens + Tailwind v4 + shadcn/ui 风格组件（源码包）
│
├── adapters/                # AI 平台适配
│   └── openclaw/
│       ├── uplink/          # Python，DCC 内运行
│       ├── gateway-plugin/  # TS，OpenClaw Gateway 内运行
│       └── config-templates/
│
├── dcc/                     # DCC 插件
│   ├── unreal/              # ArtifexNexusForUnreal.uplugin（C++ 模块名 ArtifexNexus）
│   └── blender/             # Blender 5.1 addon
│
└── apps/                    # 终端用户应用
    └── web/                 # Artifex Nexus Web UI

vendor/openclaw/             # fork 的 OpenClaw（安装到 ~/.artifexnexus/.openclaw/）
apps/desktop/installer-assets/ # 安装器资源（README + 空 scripts/templates 占位）
```

## Tauri 桌面应用编译流程

**环境要求**：
- Node.js + pnpm（前端构建）
- Rust + Cargo（`%USERPROFILE%\.cargo\bin\cargo.exe`）
- Windows: NSIS（安装包生成，可选）

**编译步骤**：

```bash
# 1. 确保 cargo 在 PATH 中
set PATH=%USERPROFILE%\.cargo\bin;%PATH%

# 2. 进入桌面应用目录
cd apps/desktop

# 3. 完整构建（推荐：前端 + Rust + 安装包）
pnpm tauri build
```

**产物位置**：
| 产物 | 路径 |
|------|------|
| 可执行文件 | `apps/desktop/src-tauri/target/release/artifex-nexus-desktop.exe` |
| NSIS 安装包 | `apps/desktop/src-tauri/target/release/bundle/nsis/Artifex Nexus_<version>_x64-setup.exe` |

**常见问题**：
- `cargo: program not found` → 将 `%USERPROFILE%\.cargo\bin` 加入 PATH
- `localhost 拒绝连接` → 说明 exe 未内嵌前端资源。**必须用 `pnpm tauri build`**（不要单独 `cargo build`），因为只有 `tauri build` 会执行 `beforeBuildCommand` 嵌入前端产物
- `Blocking waiting for file lock` → 有残留 cargo/rustc 进程，`taskkill /F /IM cargo.exe` 后重试
- 首次编译需 5-15 分钟（下载依赖），增量编译约 30 秒
- **修改前端代码后**：必须 `pnpm tauri build`，单独的 `cargo build --release` 不会重新嵌入前端资源

**开发模式**（热重载，无需每次编译）：
```bash
cd apps/desktop
pnpm tauri dev    # 自动启动 Vite + Tauri WebView
```

## Sidecar 运行时架构

Tauri 主进程通过 JSON-RPC 2.0 over stdio 与 Python sidecar 通信。

### 启动流程

```
Tauri App 启动
  └─ lib.rs: resolve_sidecar_path()
       ├─ 开发模式: CARGO_MANIFEST_DIR/../../../packages/adapters/openclaw/wrapper/src/.../sidecar.py
       └─ 打包模式: 从 exe 位置向上查找 sidecar.py
  └─ SidecarManager::start()
       ├─ FsLayout::ensure_dirs() → 创建 ~/.artifexnexus/.openclaw/ 等目录
       └─ SidecarClient::spawn()
            ├─ python sidecar.py (stdin/stdout/stderr 全部 piped)
            ├─ Windows: CREATE_NO_WINDOW 隐藏控制台
            ├─ 注入 PYTHONPATH = sidecar.py 所在目录（确保相对导入可用）
            └─ 注入环境变量: OPENCLAW_HOME, OPENCLAW_STATE_DIR, OPENCLAW_CONFIG_PATH,
               OPENCLAW_NO_ONBOARD=1, ARTIFEX_NEXUS_HOME
```

### 关键约束

- **Python 进程必须无窗口**：Windows 上设置 `CREATE_NO_WINDOW (0x08000000)`，stderr 必须 piped（不能 inherit），否则每次 sidecar 启动都会弹出控制台窗口
- **PYTHONPATH 必须注入**：sidecar.py 使用 `from . import bootstrap` 相对导入，打包后 exe 运行时不包含项目源码路径，必须显式将 sidecar.py 所在目录加入 PYTHONPATH
- **sidecar 路径解析**：开发模式用 `CARGO_MANIFEST_DIR`，打包模式从 `current_exe()` 向上查找。打包后 `CARGO_MANIFEST_DIR` 不存在，必须 fallback
- **sidecar 是懒启动**：首次 RPC 调用时才 spawn，不是应用启动时立即启动

### 环境变量三件套

| 变量 | 值 | 用途 |
|------|-----|------|
| `OPENCLAW_HOME` | `~/.artifexnexus/.openclaw/` | OpenClaw 根目录 |
| `OPENCLAW_STATE_DIR` | `~/.artifexnexus/.openclaw/state/` | 状态文件目录 |
| `OPENCLAW_CONFIG_PATH` | `~/.artifexnexus/.openclaw/openclaw.json` | 配置文件路径 |
| `OPENCLAW_NO_ONBOARD` | `1` | 跳过交互式 onboarding |
| `ARTIFEX_NEXUS_HOME` | `~/.artifexnexus/` | Artifex Nexus 根目录 |

### 版本一致性检查

`openclaw.status` RPC 返回 `version_mismatch` 字段：
- 已安装版本 ≠ `DEFAULT_VERSION`（当前 `v2026.5.4`）→ `version_mismatch: true`
- 前端据此显示"有更新"状态，引导用户重装匹配版本

## 进入项目时 AI 必读顺序

1. `[[../../docs/vision/north-star]]` — 北极星目标
2. `[[../../docs/specs/系统架构设计]]` — 架构
3. `[[../../docs/specs/skill-system]]` — Skill 子系统设计（重要！）
4. `[[../rules/00-architecture]]` — 铁律
5. `[[../rules/20-docs-workflow]]` — 文档流程
6. 你要改的具体包的 `pyproject.toml` / `package.json`
