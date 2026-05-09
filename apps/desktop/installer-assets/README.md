# Installer

跨平台安装与更新脚本。统一使用物理拷贝（copy）模式：

| 模式 | 命令 | 适用 | 行为 |
|------|------|------|------|
| **copy** | `artifex install` | 终端用户 / 发布 / 开发者 | 全部 copy 到 `~/.artifexnexus/`，独立稳定。Gateway 插件部署到 `dist/extensions/mcp-bridge/`；DCC addon 物理拷贝到各 DCC 的 addons 目录 |

> **决策变更（2026-05-09）**：全面弃用 junction/symlink，统一使用 copy。
> 原因：OpenClaw v2026.5.4 的 `fs.realpathSync` / trusted-root 安全检查
> 不兼容 junction/symlink，跨卷路径逃逸会被拒绝。

## 部署后的目录布局（统一，`~/.artifexnexus/`）

```
~/.artifexnexus/
├── .openclaw/                      # OpenClaw 隔离安装（薄壳模式）
│   ├── cli/                        # 按版本分目录安装
│   │   └── v2026.5.4/
│   │       └── node_modules/openclaw/dist/extensions/
│   │           └── mcp-bridge/     # 物理拷贝（gateway-plugin → 此处）
│   ├── workspace/
│   │   └── skills/                 # Skill 已安装目录（OpenClaw 平台规则）
│   │                               #    由 SkillInstaller 管控版本
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
> - Blender addon / OpenClaw Gateway 插件统一使用 **物理拷贝**（不用 junction/symlink）
> - UE 插件同样用 **copy**（`<Project>/Plugins/ArtifexNexusForUnreal/`）

## 子目录

- `scripts/`   shell / PowerShell 安装脚本
- `templates/` 配置模板（artifexnexus.json 默认值、单 DCC、多 DCC 等）

详见 `docs/specs/install.md`。
