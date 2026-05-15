---
id: STORY-0044
kind: story
title: M4-SDK-03 · SkillInstaller + Loader + Config
status: backlog
priority: P1
owner: "@ivan"
assignee: pair
estimate: 2d
created: 2026-05-15
updated: 2026-05-15
parent: "[[../backlog/EPIC-0004-m4-skill-system]]"
milestone: M4
related_adr: [0003, 0004]
related_docs:
  - "[[../../../docs/research/artclaw-tool-manager-replication-plan-v2]]"
related_packages:
  - "packages/platform/skill"
  - "packages/platform/core"
tags: [story, skill, sdk, installer, loader, config, M4]
---

# STORY-0044 · SkillInstaller + Loader + Config

## 用户故事
用户可以通过 SkillInstaller 安装/卸载/同步/发布 Skill；系统启动时自动扫描并加载所有已安装 Skill；配置持久化到 `~/.artifexnexus/config/skills.json`。

## 验收标准

### SkillInstaller
- [ ] `SkillInstaller` 类：复制自 `core/skill_sync.py` + ToolManager `services/skill_service.py`
- [ ] `install_skill(skill_id)` 从源路径复制到 `~/.artifexnexus/.openclaw/workspace/skills/{layer}/{dcc}/{name}/`
- [ ] `uninstall_skill(skill_id)` 删除 Skill 目录
- [ ] `sync_skill(skill_id)` 同步源路径变更到安装目录
- [ ] `publish_skill(skill_id, target)` 发布到目标 layer
- [ ] `enable_skill(id)` / `disable_skill(id)` 写入配置
- [ ] `pin_skill(id)` / `unpin_skill(id)` 写入配置
- [ ] `favorite_skill(id)` / `unfavorite_skill(id)` 写入配置

### SkillLoader 扫描器
- [ ] `SkillLoader` 类（复制自 ToolManager `services/skill_scanner.py`）
- [ ] `scan_source_directories()` 扫描 `skills/{layer}/{dcc}/{name}/` 目录结构
- [ ] 支持 official / marketplace / user 三层
- [ ] 返回 `SkillEntry` 列表（中间扫描结果）

### SkillConfig
- [ ] `SkillConfig` 类（复制自 ToolManager `services/config_manager.py`）
- [ ] 线程安全 JSON 配置读写（`fcntl` / `msvcrt` 文件锁）
- [ ] 路径：`~/.artifexnexus/config/skills.json`
- [ ] 存储 pinned / disabled / favorites 状态

## 源文件对照

| 目标文件 | 源文件 (artclaw_bridge) | 适配量 |
|----------|------------------------|--------|
| `packages/platform/skill/src/artifex_nexus/skill/installer.py` | `core/skill_sync.py` + ToolManager `services/skill_service.py` (~600行) | **高** |
| `packages/platform/skill/src/artifex_nexus/skill/loader/core.py` | `cli/artclaw_bridge/skill_hub.py` + ToolManager `services/skill_scanner.py` (~350行) | **高** |
| `packages/platform/skill/src/artifex_nexus/skill/loader/__init__.py` | 新写 | 全写 |
| `packages/platform/core/src/artifex_nexus/core/skill_config.py` | ToolManager `services/config_manager.py` (150行) | **中** |

## 关键适配

- `SkillService` (FastAPI) → `SkillInstaller`（纯 Python 类）
- `skill_scanner.py` → `SkillLoader`（纯 Python 类）
- `ConfigManager` → `SkillConfig`；路径 `~/.artclaw/config.json` → `~/.artifexnexus/config/skills.json`
- `settings` (ToolManager) → 合并到 `SkillConfig`
- 移除所有 FastAPI / HTTP 依赖

## 依赖
- → EPIC-0004（父）
- ← STORY-0043（SkillHub 运行时 + Registry 必须可用）
- ← STORY-0042（装饰器 + Manifest 模型必须可用）

## 非范围
- Sidecar RPC 注册（→ STORY-0046）
- Tool 安装管理（→ STORY-0045）
- Memory 管理
