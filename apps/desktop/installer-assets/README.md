# Installer

跨平台安装与更新脚本。两种模式：

| 模式 | 命令 | 适用 | 行为 |
|------|------|------|------|
| **link** | `artifex install --link` | 开发者 | `artifexnexus.json.source_path` 写入仓库路径，运行时 sys.path 直接引用源码；Blender addon / Gateway 插件用 symlink；UE 仍 copy |
| **copy** | `artifex install --copy` | 终端用户 / 发布 | 全部 copy 到 `~/.artifexnexus/`，独立稳定 |

## 部署后的目录布局（统一，`~/.artifexnexus/`）

```
~/.artifexnexus/
├── .openclaw/                      # OpenClaw 隔离安装（薄壳模式）
│   ├── cli/                        # 按版本分目录安装
│   │   └── v2026.5.4/
│   ├── extensions/
│   │   └── artifex-nexus-mcp-bridge/  # symlink → packages/adapters/openclaw/gateway-plugin/dist/
│   ├── workspace/
│   │   └── skills/                 # 🟢 Skill 已安装目录（OpenClaw 平台规则）
│   │                               #    由 SkillInstaller 管控版本，不使用 symlink
│   └── openclaw.json               # OpenClaw 自身的配置
│
├── config/
│   └── artifexnexus.json           # Artifex Nexus 单一配置中心
│
└── logs/
```

> **关键设计**：
> - Python 模块通过 `artifexnexus.json.source_path` + `sys.path.insert` 引用源码，**不创建根级 source symlink**
> - Skill 通过版本管理系统 install/publish 到 `.openclaw/workspace/skills/`，**不用 symlink**（保留版本一致性）
> - Blender addon / OpenClaw Gateway 插件这种被宿主主动扫描的目录，**用 symlink 引用源码**
> - UE 插件路径敏感，**用 copy**（`<Project>/Plugins/ArtifexNexusForUnreal/`）

## 子目录

- `scripts/`   shell / PowerShell 安装脚本
- `templates/` 配置模板（artifexnexus.json 默认值、单 DCC、多 DCC 等）

详见 `docs/specs/install.md`。
