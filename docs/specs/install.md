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
├── .openclaw/                                # vendor 的 OpenClaw 整体隔离
│   ├── gateway/                              # OpenClaw 运行时（来自 vendor/openclaw/）
│   ├── extensions/
│   │   └── artifex-nexus-mcp-bridge/         # symlink → 源码 packages/.../gateway-plugin/dist/
│   ├── workspace/
│   │   └── skills/                           # Skill 已安装目录（由 SkillInstaller 管理版本）
│   └── openclaw.json                         # OpenClaw 自身配置
│
├── config/
│   └── artifexnexus.json                     # Artifex Nexus 单一配置中心
│
└── logs/
```

## 2. 安装模式

| 模式 | 命令 | 适用 | 行为 |
|------|------|------|------|
| **link** | `artifex install --link` | 开发者 | 写入 `artifexnexus.json.source_path = <repo>`；运行时 sys.path 引用源码；Blender addon / Gateway 插件用 symlink；UE 仍 copy |
| **copy** | `artifex install --copy` | 终端用户/发布 | 全部 copy 到 `~/.artifexnexus/`，独立稳定 |

## 3. 各组件部署策略

| 组件 | 引用方式 | 原因 |
|------|---------|------|
| Python 包（core / skill / contracts / openclaw uplink） | **配置 + sys.path** | Python 天然支持，无需文件系统改动 |
| OpenClaw Gateway 插件 | **symlink** 到 `~/.artifexnexus/.openclaw/extensions/` | OpenClaw 主动扫描该目录 |
| Blender addon | **symlink** 到 Blender 的 `addons/` | Blender 主动扫描 |
| UE 插件 | **copy** 到 `<Project>/Plugins/ArtifexNexusForUnreal/` | UE 路径敏感、编译产物多，symlink 在 Win 上易失败 |
| Skill 包 | **copy + 版本管理** 到 `~/.artifexnexus/.openclaw/workspace/skills/` | OpenClaw 平台规则；保证 Gateway 看到的版本与 SkillInstaller 注册的一致 |
| OpenClaw 本身 | **copy** vendor → `~/.artifexnexus/.openclaw/` | vendor 锁版本，不需源码热更新 |

## 4. 平台路径速查

| 项 | 路径 |
|----|------|
| 配置中心 | `~/.artifexnexus/config/artifexnexus.json`（schema: `packages/platform/contracts/schemas/config.schema.json`） |
| OpenClaw home | `~/.artifexnexus/.openclaw/` |
| OpenClaw 配置 | `~/.artifexnexus/.openclaw/openclaw.json` |
| Skill 已安装目录 | `~/.artifexnexus/.openclaw/workspace/skills/` |
| 日志 | `~/.artifexnexus/logs/` |

## 5. 验证

```bash
artifex doctor
```

期望输出：
- ✅ Gateway connected (`ws://127.0.0.1:18789`)
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
