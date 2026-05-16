---
id: STORY-0048
kind: story
title: M4-MIG-01 · Skill/Nexus-Tool 内容迁移
status: done
priority: P1
owner: "@ivan"
assignee: pair
estimate: 1.5d
created: 2026-05-15
updated: 2026-05-16
parent: "[[../backlog/EPIC-0004-m4-skill-system]]"
milestone: M4
related_adr: [0003, 0004]
related_docs:
  - "[[../../../docs/research/artclaw-tool-manager-replication-plan-v2]]"
related_packages:
  - "packages/platform/skill"
tags: [story, migration, skill, nexus-tool, official, marketplace, M4, M5]
---

# STORY-0048 · Skill/Nexus-Tool 内容迁移

## 用户故事
artclaw_bridge 的官方和市集 Skill/Nexus-Tool 全部迁移到 Artifex Nexus 对应目录，可直接通过 SkillHub 加载和 Web UI 管理。

## 验收标准

### Official Skills 迁移（3 个）
- [x] `ue57-get-material-nodes` → `skills/official/unreal/ue57_get_material_nodes/`
  - 源：`artclaw_bridge/skills/official/unreal/ue57_get_material_nodes/`
- [x] `ue57-material-node-edit` → `skills/official/unreal/ue57_material_node_edit/`
  - 源：`artclaw_bridge/skills/official/unreal/ue57_material_node_edit/`
- [x] `comfyui-node-installer` → `skills/official/comfyui/comfyui-node-installer/`
  - 源：`artclaw_bridge/skills/official/comfyui/comfyui-node-installer/`

### Marketplace Skills 迁移（5 个）
- [x] `ue57-generate-material-documentation` → `skills/marketplace/unreal/`
- [x] `ue57-viewport-capture` → `skills/marketplace/unreal/`
- [x] `ue5-architecture` → `skills/marketplace/unreal/`
- [x] `ue5-debug-validation` → `skills/marketplace/unreal/`
- [x] `scene-vision-analyzer` → `skills/marketplace/universal/`

### Official Nexus-Tools 迁移（2 个，排除 1 个记忆相关）
- [x] `artclaw-skill-compliance-checker` → `~/.artifexnexus/nexus-tools/official/universal/`
- [x] `tool-compliance-checker` → `~/.artifexnexus/nexus-tools/official/universal/`
- [x] ❌ `memory-promote-to-team` 不迁移（记忆管理）

### Marketplace Nexus-Tools 迁移（6 个）
- [x] `Blender对象命名规范检查` → `~/.artifexnexus/nexus-tools/marketplace/blender/`
- [x] `模型批量加前缀后缀` → `~/.artifexnexus/nexus-tools/marketplace/blender/`
- [x] `SM命名检查` → `~/.artifexnexus/nexus-tools/marketplace/unreal/`
- [x] `UV & 贴图利用率优化-UV重排` → `~/.artifexnexus/nexus-tools/marketplace/unreal/`
- [x] `UV & 贴图利用率优化-贴图裁切` → `~/.artifexnexus/nexus-tools/marketplace/unreal/`
- [x] `资产批量改名` → `~/.artifexnexus/nexus-tools/marketplace/unreal/`

### 迁移后验证
- [x] 所有 Skill manifest.json 可被 `load_manifest_model()` 正常解析（8/8 通过）
- [x] 所有 Nexus-Tool manifest.json 可被 NexusToolScanner 正常解析（8/8 通过）
- [x] `skill.list()` 可返回 8 个 Skill（3 official + 5 marketplace）※
- [x] `nexus-tool.list()` 可返回 8 个 Nexus-Tool（2 official + 6 marketplace）※
- ※ 需要 SkillHub 配置 `skills_root` 指向项目 `skills/` 目录后验证

## 迁移统计

| 类别 | 数量 | 说明 |
|------|------|------|
| Official Skills | 3 | UE5 (2) + ComfyUI (1) |
| Marketplace Skills | 5 | UE5 (4) + Universal (1) |
| Official Nexus-Tools | 2 | Universal |
| Marketplace Nexus-Tools | 6 | Blender (2) + UE5 (4) |
| **合计** | **16** | |
| **排除** | 1 | memory-promote-to-team |

## 目标目录结构
```
skills/
├── official/
│   ├── unreal/
│   │   ├── ue57_get_material_nodes/
│   │   └── ue57_material_node_edit/
│   └── comfyui/
│       └── comfyui-node-installer/
└── marketplace/
    ├── unreal/
    │   ├── ue57_generate_material_documentation/
    │   ├── ue57_viewport_capture/
    │   ├── ue5-architecture/
    │   └── ue5-debug-validation/
    └── universal/
        └── scene-vision-analyzer/

~/.artifexnexus/nexus-tools/
├── official/universal/
│   ├── artclaw-skill-compliance-checker/
│   └── tool-compliance-checker/
└── marketplace/
    ├── blender/
    │   ├── Blender对象命名规范检查/
    │   └── 模型批量加前缀后缀/
    └── unreal/
        ├── SM命名检查/
        ├── UV & 贴图利用率优化-UV重排/
        ├── UV & 贴图利用率优化-贴图裁切/
        └── 资产批量改名/
```

## 依赖
- → EPIC-0004（Skill 迁移）；→ EPIC-0005（Nexus-Tool 迁移）
- ← STORY-0043（SkillHub 扫描/加载必须可用）
- ← STORY-0045（NexusToolRegistry 扫描必须可用）

## 非范围
- memory-promote-to-team（记忆管理 Nexus-Tool）
- memory/ 和 team_memory/ 目录

## PM 审核（2026-05-16）
- ⚠️ 发现 3 个 Skill 缺少 manifest.json（comfyui-node-installer、ue5-architecture、ue5-debug-validation）→ 从 SKILL.md frontmatter 自动生成
- ⚠️ `comfyui` 不在 Software 枚举 → 添加到 categories.json
- ⚠️ artclaw_bridge manifest 使用 `tools` 字段，Artifex Nexus 使用 `skill_tools` → 迁移时自动转换
- ⚠️ `"unreal_engine"` 不在 Software 枚举 → 迁移时映射为 `"unreal"`

## 开发（2026-05-16）
- 迁移脚本：`scripts/migrate_skills_nexus_tools.py`
- 更新 `categories.json`：添加 comfyui 到 software 枚举 + display 映射
- 3 个缺失 manifest.json 从 SKILL.md YAML frontmatter 自动生成
- `tools → skill_tools` 字段重命名 + `unreal_engine → unreal` 映射
- `__pycache__` 目录自动排除

## QA 验证（2026-05-16）
- ✅ 8/8 Skill manifest.json 通过 `load_manifest_model()` 校验
- ✅ 8/8 Nexus-Tool manifest.json 通过 `scan_nexus_tools()` 解析
- ✅ 0 个 `__pycache__` 残留
- ✅ software 字段全部合法（unreal/comfyui/universal）
- ✅ skill_tools 字段全部非空
