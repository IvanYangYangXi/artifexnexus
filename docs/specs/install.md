---
tags: [spec, install, draft]
created: 2026-05-02
status: draft
---

# 安装与部署

> **目标根目录**：`~/.artifexnexus/`（与 OpenClaw 自身完全隔离在 `.openclaw/` 子目录）

## 1. 部署后目录布局

```
~/.artifexnexus/
├── .openclaw/                                # OpenClaw 隔离安装（薄壳模式，调用上游 install-cli.sh）
│   ├── cli/                                  # 按版本分目录安装
│   │   └── v2026.5.4/
│   │       └── node_modules/openclaw/dist/extensions/
│   │           └── mcp-bridge/               # MCP Bridge 插件（物理拷贝自 gateway-plugin/dist/）
│   ├── workspace/
│   │   ├── IDENTITY.md / SOUL.md / USER.md   # 人格文件（首启预置）
│   │   └── skills/                           # Skill 已安装目录（由 SkillInstaller 管理版本）
│   │       ├── official/                     # 官方 Skill（从 skills/official/ 物理拷贝）
│   │       ├── team/                         # 团队 Skill（预留）
│   │       └── user/                         # 用户自装 Skill（预留）
│   ├── state/                                # OPENCLAW_STATE_DIR（lock/ + deploy-manifest.json）
│   └── openclaw.json                         # OpenClaw 自身配置
│
├── config/
│   ├── artifexnexus.json                     # Artifex Nexus 单一配置中心
│   ├── tool-sources.json                     # 工具/Skill 源码目录注册表
│   └── skills.json                           # Skill 用户偏好（pin/favorite）
│
├── logs/
├── run/                                      # PID 锁文件 + 端口快照
└── backups/                                  # 重装备份
```

## 2. 安装模式

| 模式 | 命令 | 适用 | 行为 |
|------|------|------|------|
| **copy** | `artifex install` | 终端用户/发布/开发者 | 全部 copy 到 `~/.artifexnexus/`，独立稳定。Gateway 插件部署到 `dist/extensions/mcp-bridge/`；DCC addon 物理拷贝到各 DCC 的 addons 目录 |

## 3. 各组件部署策略

| 组件 | 引用方式 | 原因 |
|------|---------|------|
| Python 包（core / skill / contracts / openclaw uplink） | **配置 + sys.path** | Python 天然支持，无需文件系统改动。`packages/platform/{core,skill}/src/` 在打包时随源码树一起分发 |
| OpenClaw Gateway 插件 | **copy** 从 `<install>/packages/adapters/openclaw/gateway-plugin/dist/` → `<OPENCLAW_HOME>/cli/{version}/node_modules/openclaw/dist/extensions/mcp-bridge/` | OpenClaw v2026.5.4 的 `fs.realpathSync` 安全检查不兼容 junction/symlink |
| Blender addon | **copy** 从 `<install>/packages/dcc/blender/src/` → Blender 的 `addons/artifex_nexus/`（详见 [[dcc-plugin-management]]） | 同上；统一 copy 模型 |
| UE 插件 | **copy** 从 `<install>/packages/dcc/unreal/` → `<Project>/Plugins/ArtifexNexusForUnreal/` | UE 路径敏感、编译产物多 |
| 官方 Skill（仅 official/） | **copy** 从 `<install>/skills/official/` → `~/.artifexnexus/.openclaw/workspace/skills/official/` | OpenClaw 平台规则；保证 Gateway 看到的版本与 SkillInstaller 注册的一致 |
| 官方 Tool（仅 official/） | **通过 tool-sources.json 注册** `<install>/tools/official/` 目录路径 | 工具保留在原目录，不复制到 `~/.artifexnexus/nexus-tools/` |
| Marketplace Skill/Tool | **不入安装包**，用户通过 Web UI 在线安装 | 减小组件包体积；用户按需选择 |
| OpenClaw 本身 | **薄壳安装** → `~/.artifexnexus/.openclaw/cli/<version>/` | 调用上游 install-cli.sh，按版本隔离 |

## 4. 平台路径速查

| 项 | 路径 |
|----|------|
| 配置中心 | `~/.artifexnexus/config/artifexnexus.json`（schema: `packages/platform/contracts/schemas/config.schema.json`） |
| OpenClaw home | `~/.artifexnexus/.openclaw/` |
| OpenClaw 配置 | `~/.artifexnexus/.openclaw/openclaw.json` |
| Skill 已安装目录 | `~/.artifexnexus/.openclaw/workspace/skills/` |
| Tool 源码注册表 | `~/.artifexnexus/config/tool-sources.json` |
| 日志 | `~/.artifexnexus/logs/` |
| 运行时锁 | `~/.artifexnexus/run/` |

## 5. 验证

```bash
artifex doctor
```

期望输出：
- ✅ Gateway connected (`ws://127.0.0.1:19789`)
- ✅ MCP server reachable for: unreal, blender
- ✅ Config integrity OK
- ✅ Skills directory: 12 installed, 0 conflicts

## 6. 卸载

```bash
artifex uninstall          # 默认保留 ~/.artifexnexus/.openclaw/workspace/skills/ 与 config
artifex uninstall --purge  # 完全删除 ~/.artifexnexus/
```

## 相关

- `[[../decisions/0002-vendor-openclaw-fork]]`
- `[[skill-system]]`
