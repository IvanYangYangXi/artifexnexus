# 术语表（Glossary）

| 术语 | 含义 |
|------|------|
| **Artifex Nexus** | 项目名。Artifex（工匠）+ Nexus（连接），即"为数字创作者连接 AI Agent 的桥"。中文名「山雀」。 |
| **OpenClaw** | 当前唯一接入的 AI Agent 平台。我们 fork 并锁定版本 `v2026.5.4` 进 `vendor/`，安装到 `~/.artifexnexus/.openclaw/` |
| **Gateway** | OpenClaw 的进程，承担 chat 路由 + 插件宿主。我们在它里面装 `mcp-bridge` 插件，端口 19789 |
| **DCC** | Digital Content Creation 软件。核心支持：UE5.7、Blender 5.1（内部代码路径版本约定，非实际 Blender 发布版本号）、Maya 2023+、3ds Max 2024+。Skill 体系额外覆盖：ComfyUI、Houdini、Substance Painter、Substance Designer、Unity |
| **MCP** | Model Context Protocol。下行（工具调用）走标准 MCP JSON-RPC over WebSocket。每个 DCC 只有一个 MCP 工具 `run_python` |
| **MCP Bridge** | Gateway 内运行的 TS 插件（`@openclaw/mcp-bridge`），连接各 DCC MCP Server，将 `run_python` 注册为 `mcp_<dcc>_run_python` |
| **Sidecar** | Python JSON-RPC 2.0 over stdio 服务，Tauri 主进程通过它与 OpenClaw 交互（安装/配置/启停/会话管理/Skill RPC） |
| **Skill** | 一个 Skill 包（目录 + `SKILL.md` + `manifest.json` + `__init__.py`），分发与版本管理的单位。现有 Skills（数量随开发动态变化，跨 11 种软件） |
| **Tool / Nexus-Tool** | Skill 包内被 `@skill_tool` 装饰的可调用函数，实际执行的单位。三态：无触发器/启动触发/禁用触发 |
| **Skill Hub** | 运行时加载/执行 Skill 的入口。共享核心 + DCC 特定注入（UE 独立实现因需 `unreal.DirectoryWatcher`） |
| **SkillRegistry** | Skill 查询/匹配/最佳版本选择的职责类 |
| **SkillInstaller** | Skill 安装/发布/同步/启停的职责类（全生命周期管理） |
| **DCC 共享 SDK** | `packages/dcc/shared/artifex_nexus_sdk/`，所有 DCC 插件复用的核心模块（BaseDCCAdapter/MCPServer/SkillHub/装饰器/事件） |
| **Contracts** | `packages/platform/contracts/`，存放 JSON Schema + Python ABC + TS types。跨进程跨语言的契约源 |
| **Adapter** | 平台特化代码（`adapters/<platform>/`）：上行 Python 包 + 下行 Gateway 插件 + Python Sidecar |
| **上行 / 下行** | 上行 = 用户消息→AI；下行 = AI 工具调用→DCC。两条独立链路 |
| **vendor 锁版本** | fork OpenClaw 到我们组织 + 固定 git tag/sha → 一起打包分发 |
| **link / copy 安装模式** | 开发者用 `--link`（源码引用 + 配置），用户用 `--copy`（独立部署）。Skill/Blender addon/Gateway 插件用物理拷贝+deploy-manifest |
| **Tauri 2** | 桌面壳框架（Rust 后端 + WebView 前端），提供安装向导 + 系统托盘 + 窗口管理 |
| **App Shell** | Web UI 的四面板布局（Topbar/Sidebar/Content/Panel），响应式适配 |
| **Notifications** | 双通道通知系统（Tauri IPC + Gateway WS），铃铛通知中心 + Toast 气泡 |
