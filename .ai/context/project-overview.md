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
installer/                   # 一键安装（双模式 link/copy）
```

## 进入项目时 AI 必读顺序

1. `[[../../docs/vision/north-star]]` — 北极星目标
2. `[[../../docs/specs/系统架构设计]]` — 架构
3. `[[../../docs/specs/skill-system]]` — Skill 子系统设计（重要！）
4. `[[../rules/00-architecture]]` — 铁律
5. `[[../rules/20-docs-workflow]]` — 文档流程
6. 你要改的具体包的 `pyproject.toml` / `package.json`
