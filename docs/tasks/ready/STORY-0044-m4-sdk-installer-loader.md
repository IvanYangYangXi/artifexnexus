---
id: STORY-0044
kind: story
title: M4-SDK-03 · SkillInstaller + Loader + Config
status: ready
priority: P1
owner: "@ivan"
assignee: pair
estimate: 2d
created: 2026-05-15
updated: 2026-05-16
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

### SkillLoader 扫描器
- [x] **PM 决策 2026-05-16**：Loader 不独立为类，扫描逻辑并入 Hub 内部两阶段（扫描元数据 + 懒加载模块）。
  - Hub 内部维护 `_available`（扫描结果，仅元数据）和 `_loaded`（已导入实例）
  - `get_skill()` / `execute_skill_tool()` 首次调用时自动触发懒加载（ADR 0003：skill_tool 用到时再加载）
  - `loader/__init__.py` 保留为重导出 `SkillHub`

### SkillConfig
- [ ] `SkillConfig` 类：落位 `packages/platform/core/src/artifex_nexus/core/skill_config.py`
- [x] **PM 决策**：不加文件锁（单进程串行 JSON-RPC 场景，原子 rename 已足够）
- [x] **PM 决策**：pin/favorite 从 Installer 移至 SkillConfig（它们是用户偏好，不是安装操作）
- [ ] 路径：`~/.artifexnexus/config/skills.json`
- [ ] 存储 `disabled`, `pinned`, `favorites` 状态
- [ ] 提供 `pin(id)` / `unpin(id)` / `favorite(id)` / `unfavorite(id)` 方法

## 源文件对照

| 目标文件 | 源文件 (artclaw_bridge) | 适配量 | 说明 |
|----------|------------------------|--------|------|
| `packages/platform/skill/src/artifex_nexus/skill/installer.py` | `core/skill_sync.py` + ToolManager `services/skill_service.py` (~600行) | **高** | PM决策：移除 pin/favorite 方法 |
| `packages/platform/skill/src/artifex_nexus/skill/loader/__init__.py` | 新写 | 全写 | PM决策：重导出 SkillHub，不独立 Loader 类 |
| `packages/platform/core/src/artifex_nexus/core/skill_config.py` | ToolManager `services/config_manager.py` (150行) | **中** | PM决策：独立文件，加 pin/favorite 方法 |

## 关键适配

- `SkillService` (FastAPI) → `SkillInstaller`（纯 Python 类）
- ~~`skill_scanner.py` → `SkillLoader`（纯 Python 类）~~ → **取消**，并入 Hub 内部两阶段懒加载
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

## 进展日志

### 2026-05-16 — PM 关卡审核
- **SkillLoader**：取消独立 Loader 类，扫描并入 Hub 内部两阶段（metadata scan + lazy import），遵循 ADR 0003 "skill_tool 用到再加载"。
- **pin/favorite**：从 SkillInstaller 移除，移至 SkillConfig 作为独立用户偏好操作。
- **SkillConfig**：提取到 `packages/platform/core/src/artifex_nexus/core/skill_config.py`，独立文件。
- **线程安全**：不加文件锁，单进程串行场景下原子 rename 已足够。
