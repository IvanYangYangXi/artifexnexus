# 术语表（Glossary）

| 术语 | 含义 |
|------|------|
| **Artifex Nexus** | 项目名。Artifex（工匠）+ Nexus（连接），即"为数字创作者连接 AI Agent 的桥"。 |
| **OpenClaw** | 当前唯一接入的 AI Agent 平台。我们 fork 并锁定一个版本进 `vendor/`，安装到 `~/.artifexnexus/.openclaw/` |
| **Gateway** | OpenClaw 的进程，承担 chat 路由 + 插件宿主。我们在它里面装 `mcp-bridge` 插件 |
| **DCC** | Digital Content Creation 软件。本项目首发 UE5.7、Blender 5.1 |
| **Skill** | 一个 Skill 包（目录 + `SKILL.md` + `manifest.json` + `__init__.py`），分发与版本管理的单位 |
| **Tool** | Skill 包内被 `@tool` 装饰的可调用函数，实际执行的单位 |
| **Skill Hub** | 运行时加载/执行 Skill 的入口（`from artifex_nexus.skill import execute`） |
| **SkillRegistry** | Skill 查询/匹配/最佳版本选择的职责类（取代原 `VersionManager` 一部分） |
| **SkillInstaller** | Skill 安装/发布/同步/启停的职责类（取代原 `VersionManager` 另一部分） |
| **Contracts** | `packages/platform/contracts/`，存放 JSON Schema + Python ABC + TS types。跨进程跨语言的契约源 |
| **MCP** | Model Context Protocol。下行（工具调用）走标准 MCP JSON-RPC over WebSocket |
| **Adapter** | 平台特化代码（`adapters/<platform>/`）：上行 Python 包 + 下行 Gateway 插件 |
| **上行 / 下行** | 上行 = 用户消息→AI；下行 = AI 工具调用→DCC。两条独立链路 |
| **vendor 锁版本** | fork OpenClaw 到我们组织 + 固定 git tag/sha → 一起打包分发 |
| **link / copy 安装模式** | 开发者用 `--link`（源码引用 + 配置/symlink），用户用 `--copy`（独立部署） |
